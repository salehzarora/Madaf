/**
 * DETERMINISTIC concurrency probe for the order inventory-lock ORDER fix
 * (M8I.7, migration 20260812100000). update_order_status (reserve/restore) and
 * update_order_items (edit reconcile) lock multiple inventory_items rows in a
 * loop; the fix drives every loop on an ASCENDING product_id so all competing
 * order operations acquire the shared rows in one global order and cannot form a
 * lock cycle (SQLSTATE 40P01).
 *
 * NOT a flaky "fire two promises and hope they overlap" test. The interleaving is
 * FORCED with a disposable BEFORE-INSERT barrier trigger on
 * order_inventory_movements that blocks the FIRST reconciling transaction on an
 * advisory lock held by a coordinator — pausing it AFTER it has taken the lowest
 * product_id's row lock but before it finishes. A second order operation over the
 * SAME two products is then started; with the ascending-order fix it deterministically
 * blocks on that SAME lowest product_id's row lock (never reaching the barrier), so
 * only ONE transaction is ever past the first row — there is no cycle, no 40P01, and
 * the final balances are exactly the per-product sum of both operations. (Under the
 * OLD unordered loops the two transactions could grab the two products in opposite
 * order and deadlock; this harness would then surface a 40P01.)
 *
 * Progress is detected by polling pg_locks / pg_stat_activity (never a fixed sleep).
 * Every session carries a statement_timeout and is torn down, so a bad interleaving
 * fails instead of hanging. The barrier trigger + function are created and DROPPED
 * inside the test; a final case asserts they are gone.
 *
 * Requires the local Supabase Postgres (DB_URL from `supabase status -o json`, read
 * at runtime — never hardcoded). Skips if unreachable. NEVER hosted.
 *
 * Runner: `npm run test:order-concurrency-live` (needs the local stack up).
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import pg from "pg";

const { Client } = pg;
type PgClient = InstanceType<typeof Client>;
interface Session {
  c: PgClient;
  pid: number;
}

/** Private advisory-lock key for the barrier (fits in 32 bits ⇒ objid = key). */
const BARRIER_KEY = 771122334;

function dbUrl(): string | null {
  try {
    const raw = execFileSync("supabase", ["status", "-o", "json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const j = JSON.parse(raw) as Record<string, string>;
    return j.DB_URL ?? null;
  } catch {
    return null;
  }
}

async function openSession(url: string): Promise<Session> {
  const c = new Client({ connectionString: url });
  c.on("error", () => {});
  await c.connect();
  await c.query("set statement_timeout = '20000'");
  const r = await c.query("select pg_backend_pid() as pid");
  return { c, pid: r.rows[0].pid as number };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(
  fn: () => Promise<boolean>,
  label: string,
  timeoutMs = 8000,
  stepMs = 25,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return;
    await sleep(stepMs);
  }
  throw new Error(`waitFor timed out: ${label}`);
}

const claims = (owner: string) => `'{"sub":"${owner}","role":"authenticated"}'`;

type Settled = { ok: true; v: pg.QueryResult } | { ok: false; e: unknown };
const settle = (p: Promise<pg.QueryResult>): Promise<Settled> =>
  p.then((v) => ({ ok: true as const, v })).catch((e) => ({ ok: false as const, e }));

const errCode = (e: unknown): string | undefined =>
  typeof e === "object" && e !== null && "code" in e
    ? (e as { code?: string }).code
    : undefined;

interface Ctx {
  tenant: string;
  owner: string;
  category: string;
  p1: string; // lower product_id (locked first under the ascending fix)
  p2: string; // higher product_id
}

async function provision(admin: PgClient): Promise<Ctx> {
  const tenant = randomUUID();
  const owner = randomUUID();
  const category = randomUUID();
  // p1 < p2 so "ascending product_id" is well-defined and both operations lock p1 first.
  const [p1, p2] = [randomUUID(), randomUUID()].sort();
  await admin.query("insert into auth.users (id) values ($1)", [owner]);
  await admin.query(
    "insert into public.tenants (id, name_ar, name_he, name_en) values ($1,'oc','oc','oc')",
    [tenant],
  );
  await admin.query(
    "insert into public.tenant_users (tenant_id, user_id, role) values ($1,$2,'owner')",
    [tenant, owner],
  );
  await admin.query("insert into public.categories(id,tenant_id,name_ar,name_he,name_en) values ($1,$2,'c','c','c')", [category, tenant]);
  for (const pid of [p1, p2]) {
    await admin.query(
      `insert into public.products
         (id, tenant_id, name_ar, name_he, name_en, package_unit, package_quantity,
          base_unit, wholesale_price, vat_rate, is_active)
       values ($1,$2,'p','p','p','carton',6,'bottles',10.00,0.17,true)`,
      [pid, tenant],
    );
    await admin.query(
      `insert into public.inventory_items (tenant_id, product_id, quantity_available, low_stock_threshold)
       values ($1,$2,1000,5)`,
      [tenant, pid],
    );
  }
  await admin.query("update public.products set category_id=$1 where tenant_id=$2", [category, tenant]);
  return { tenant, owner, category, p1, p2 };
}

/** Create an order (service_role) and return its id. Creation reserves NO stock. */
async function createOrder(
  admin: PgClient,
  ctx: Ctx,
  q1: number,
  q2: number,
): Promise<string> {
  const items = JSON.stringify([
    { product_id: ctx.p1, quantity: q1 },
    { product_id: ctx.p2, quantity: q2 },
  ]);
  // A fresh submission key per call — each is a distinct logical order (FIX1).
  const r = await admin.query(
    "select order_id from public.create_order_request($1,$2::jsonb, p_submission_key => $3::uuid)",
    [ctx.tenant, items, randomUUID()],
  );
  return r.rows[0].order_id as string;
}

/** Reserve an order's stock up front (service_role confirm), no barrier. */
async function reserve(admin: PgClient, ctx: Ctx, orderId: string): Promise<void> {
  await admin.query("select public.update_order_status($1,$2,'confirmed')", [ctx.tenant, orderId]);
}

async function avail(admin: PgClient, ctx: Ctx, pid: string): Promise<number> {
  const r = await admin.query(
    "select quantity_available n from public.inventory_items where tenant_id=$1 and product_id=$2",
    [ctx.tenant, pid],
  );
  return r.rows[0].n as number;
}

async function createBarrier(admin: PgClient): Promise<void> {
  await admin.query(`
    create or replace function public._test_order_barrier() returns trigger
    language plpgsql as $fn$
    begin
      if coalesce(current_setting('test.order_barrier', true), 'off') = 'on' then
        perform pg_advisory_xact_lock(${BARRIER_KEY});
      end if;
      return new;
    end;
    $fn$;`);
  await admin.query(
    "drop trigger if exists _test_order_barrier_trg on public.order_inventory_movements",
  );
  await admin.query(`
    create trigger _test_order_barrier_trg before insert on public.order_inventory_movements
    for each row execute function public._test_order_barrier();`);
}

async function dropBarrier(admin: PgClient): Promise<void> {
  try {
    await admin.query(
      "drop trigger if exists _test_order_barrier_trg on public.order_inventory_movements",
    );
    await admin.query("drop function if exists public._test_order_barrier()");
  } catch {
    /* best-effort */
  }
}

async function blockedRunning(mon: PgClient, fnName: string): Promise<number> {
  const r = await mon.query(
    `select count(*)::int n from pg_stat_activity
     where pid <> pg_backend_pid() and state = 'active'
       and wait_event_type = 'Lock' and query ilike '%' || $1 || '%'`,
    [fnName],
  );
  return r.rows[0].n as number;
}

async function advisoryWaiters(mon: PgClient): Promise<number> {
  const r = await mon.query(
    "select count(*)::int n from pg_locks where locktype='advisory' and objid=$1 and not granted",
    [BARRIER_KEY],
  );
  return r.rows[0].n as number;
}

/** Begin as the owner, optionally arm the barrier, and FIRE an order RPC without
 * awaiting it (so the caller can orchestrate the interleaving). */
async function fire(
  c: PgClient,
  ctx: Ctx,
  sql: string,
  params: unknown[],
  barrier: boolean,
): Promise<{ p: Promise<pg.QueryResult> }> {
  await c.query("begin");
  await c.query("set local role authenticated");
  await c.query(`set local request.jwt.claims = ${claims(ctx.owner)}`);
  if (barrier) await c.query("set local test.order_barrier = 'on'");
  const p = c.query(sql, params);
  p.catch(() => {});
  return { p };
}

async function cleanup(admin: PgClient, ctx: Ctx | undefined): Promise<void> {
  if (!ctx) return;
  const del = async (sql: string, p: unknown[]) => {
    try {
      await admin.query(sql, p);
    } catch {
      /* best-effort */
    }
  };
  await del("delete from public.audit_events where tenant_id=$1", [ctx.tenant]);
  await del("delete from public.order_inventory_movements where tenant_id=$1", [ctx.tenant]);
  await del("delete from public.order_items where tenant_id=$1", [ctx.tenant]);
  await del("delete from public.orders where tenant_id=$1", [ctx.tenant]);
  await del("delete from public.inventory_items where tenant_id=$1", [ctx.tenant]);
  await del("delete from public.products where tenant_id=$1", [ctx.tenant]);
  await del("delete from public.categories where tenant_id=$1", [ctx.tenant]);
  await del("delete from public.tenant_users where tenant_id=$1", [ctx.tenant]);
  await del("delete from public.tenants where id=$1", [ctx.tenant]);
  await del("delete from auth.users where id=$1", [ctx.owner]);
}

async function teardown(admin: PgClient, sessions: Session[], ctx: Ctx | undefined): Promise<void> {
  await Promise.allSettled(sessions.map((s) => s.c.end()));
  await dropBarrier(admin);
  await cleanup(admin, ctx);
}

// The RPCs each case fires. Every case follows one shape: A fires (barrier armed)
// and pauses holding p1's row lock; B fires over the same two products and must
// block on p1 without reaching the barrier; release; assert neither raised 40P01,
// both committed, and the balances are the exact per-product sum of both operations.
const STATUS_SQL = "select public.update_order_status($1,$2,$3)";
const EDIT_SQL = "select public.update_order_items($1,$2,$3::jsonb)";

test("reserve vs reserve: two confirms over the same two products never deadlock", async (t) => {
  const url = dbUrl();
  if (!url) return void t.skip("local Supabase DB not reachable — run `supabase start`");
  let adminS: Session;
  try {
    adminS = await openSession(url);
  } catch {
    return void t.skip("cannot connect to local Postgres");
  }
  const admin = adminS.c;
  await admin.query("set request.jwt.claims = '{\"role\":\"service_role\"}'");
  const A = await openSession(url);
  const B = await openSession(url);
  const coord = await openSession(url);
  const mon = await openSession(url);
  let ctx: Ctx | undefined;
  try {
    await createBarrier(admin);
    ctx = await provision(admin);
    const oA = await createOrder(admin, ctx, 2, 3);
    const oB = await createOrder(admin, ctx, 5, 7);
    await coord.c.query("select pg_advisory_lock($1)", [BARRIER_KEY]); // barrier closed

    const { p: pA } = await fire(A.c, ctx, STATUS_SQL, [ctx.tenant, oA, "confirmed"], true);
    await waitFor(() => advisoryWaiters(mon.c).then((n) => n >= 1),
      "confirm A pauses at the barrier holding p1");
    const { p: pB } = await fire(B.c, ctx, STATUS_SQL, [ctx.tenant, oB, "confirmed"], true);
    await waitFor(() => blockedRunning(mon.c, "update_order_status").then((n) => n >= 1),
      "confirm B blocks on p1's row lock (ascending order → no cycle)");
    // Only ONE session is ever at the advisory barrier — the ordered fix means B is
    // stuck on p1 and never reached its first movement insert.
    assert.equal(await advisoryWaiters(mon.c), 1, "exactly one transaction sits at the barrier");

    await coord.c.query("select pg_advisory_unlock($1)", [BARRIER_KEY]);
    const rA = await settle(pA);
    await A.c.query(rA.ok ? "commit" : "rollback").catch(() => {});
    const rB = await settle(pB);
    await B.c.query(rB.ok ? "commit" : "rollback").catch(() => {});

    assert.notEqual(errCode(rA.ok ? undefined : rA.e), "40P01", "confirm A did not deadlock");
    assert.notEqual(errCode(rB.ok ? undefined : rB.e), "40P01", "confirm B did not deadlock");
    assert.equal(rA.ok && rB.ok, true, "both confirms committed");
    assert.equal(await avail(admin, ctx, ctx.p1), 993, "p1 deducted 2+5 (1000 → 993)");
    assert.equal(await avail(admin, ctx, ctx.p2), 990, "p2 deducted 3+7 (1000 → 990)");
  } finally {
    await teardown(admin, [A, B, coord, mon], ctx);
    await admin.end().catch(() => {});
  }
});

test("reserve vs restore: a confirm and a cancel over the same products never deadlock", async (t) => {
  const url = dbUrl();
  if (!url) return void t.skip("local Supabase DB not reachable — run `supabase start`");
  let adminS: Session;
  try {
    adminS = await openSession(url);
  } catch {
    return void t.skip("cannot connect to local Postgres");
  }
  const admin = adminS.c;
  await admin.query("set request.jwt.claims = '{\"role\":\"service_role\"}'");
  const A = await openSession(url);
  const B = await openSession(url);
  const coord = await openSession(url);
  const mon = await openSession(url);
  let ctx: Ctx | undefined;
  try {
    await createBarrier(admin);
    ctx = await provision(admin);
    const oConfirm = await createOrder(admin, ctx, 2, 3);
    const oCancel = await createOrder(admin, ctx, 5, 7);
    await reserve(admin, ctx, oCancel); // pre-reserve the order we will cancel (p1 995, p2 993)
    await coord.c.query("select pg_advisory_lock($1)", [BARRIER_KEY]);

    // A = confirm (reserve loop) pauses at the barrier holding p1.
    const { p: pA } = await fire(A.c, ctx, STATUS_SQL, [ctx.tenant, oConfirm, "confirmed"], true);
    await waitFor(() => advisoryWaiters(mon.c).then((n) => n >= 1),
      "confirm pauses at the barrier holding p1");
    // B = cancel (restore loop) blocks on p1's row lock, ascending.
    const { p: pB } = await fire(B.c, ctx, STATUS_SQL, [ctx.tenant, oCancel, "cancelled"], true);
    await waitFor(() => blockedRunning(mon.c, "update_order_status").then((n) => n >= 1),
      "cancel blocks on p1's row lock (same ascending order → no cycle)");
    assert.equal(await advisoryWaiters(mon.c), 1, "exactly one transaction sits at the barrier");

    await coord.c.query("select pg_advisory_unlock($1)", [BARRIER_KEY]);
    const rA = await settle(pA);
    await A.c.query(rA.ok ? "commit" : "rollback").catch(() => {});
    const rB = await settle(pB);
    await B.c.query(rB.ok ? "commit" : "rollback").catch(() => {});

    assert.notEqual(errCode(rA.ok ? undefined : rA.e), "40P01", "confirm did not deadlock");
    assert.notEqual(errCode(rB.ok ? undefined : rB.e), "40P01", "cancel did not deadlock");
    assert.equal(rA.ok && rB.ok, true, "both operations committed");
    // 995 - 2 (confirm) + 5 (cancel restore) = 998 ; 993 - 3 + 7 = 997.
    assert.equal(await avail(admin, ctx, ctx.p1), 998, "p1 = 995 -2 +5 = 998");
    assert.equal(await avail(admin, ctx, ctx.p2), 997, "p2 = 993 -3 +7 = 997");
  } finally {
    await teardown(admin, [A, B, coord, mon], ctx);
    await admin.end().catch(() => {});
  }
});

test("edit vs edit: two reserved-order edits over the same products never deadlock", async (t) => {
  const url = dbUrl();
  if (!url) return void t.skip("local Supabase DB not reachable — run `supabase start`");
  let adminS: Session;
  try {
    adminS = await openSession(url);
  } catch {
    return void t.skip("cannot connect to local Postgres");
  }
  const admin = adminS.c;
  await admin.query("set request.jwt.claims = '{\"role\":\"service_role\"}'");
  const A = await openSession(url);
  const B = await openSession(url);
  const coord = await openSession(url);
  const mon = await openSession(url);
  let ctx: Ctx | undefined;
  try {
    await createBarrier(admin);
    ctx = await provision(admin);
    const oA = await createOrder(admin, ctx, 2, 3);
    const oB = await createOrder(admin, ctx, 5, 7);
    await reserve(admin, ctx, oA); // both reserved first (p1 993, p2 990)
    await reserve(admin, ctx, oB);
    await coord.c.query("select pg_advisory_lock($1)", [BARRIER_KEY]);

    // A edits oA (p1 2→4, p2 3→1): reconcile loop touches p1 first, pauses at barrier.
    const editA = JSON.stringify([
      { product_id: ctx.p1, quantity: 4 },
      { product_id: ctx.p2, quantity: 1 },
    ]);
    const { p: pA } = await fire(A.c, ctx, EDIT_SQL, [ctx.tenant, oA, editA], true);
    await waitFor(() => advisoryWaiters(mon.c).then((n) => n >= 1),
      "edit A pauses at the barrier holding p1");
    // B edits oB (p1 5→6, p2 7→5): reconcile loop blocks on p1's row lock.
    const editB = JSON.stringify([
      { product_id: ctx.p1, quantity: 6 },
      { product_id: ctx.p2, quantity: 5 },
    ]);
    const { p: pB } = await fire(B.c, ctx, EDIT_SQL, [ctx.tenant, oB, editB], true);
    await waitFor(() => blockedRunning(mon.c, "update_order_items").then((n) => n >= 1),
      "edit B blocks on p1's row lock (same ascending order → no cycle)");
    assert.equal(await advisoryWaiters(mon.c), 1, "exactly one transaction sits at the barrier");

    await coord.c.query("select pg_advisory_unlock($1)", [BARRIER_KEY]);
    const rA = await settle(pA);
    await A.c.query(rA.ok ? "commit" : "rollback").catch(() => {});
    const rB = await settle(pB);
    await B.c.query(rB.ok ? "commit" : "rollback").catch(() => {});

    assert.notEqual(errCode(rA.ok ? undefined : rA.e), "40P01", "edit A did not deadlock");
    assert.notEqual(errCode(rB.ok ? undefined : rB.e), "40P01", "edit B did not deadlock");
    assert.equal(rA.ok && rB.ok, true, "both edits committed");
    // p1: 993 -2 (A +2 reserve) -1 (B +1 reserve) = 990 ; p2: 990 +2 (A -2) +2 (B -2) = 994.
    assert.equal(await avail(admin, ctx, ctx.p1), 990, "p1 = 993 -2 -1 = 990");
    assert.equal(await avail(admin, ctx, ctx.p2), 994, "p2 = 990 +2 +2 = 994");
  } finally {
    await teardown(admin, [A, B, coord, mon], ctx);
    await admin.end().catch(() => {});
  }
});

test("product update before edit: package commit is observed before reservation changes", async (t) => {
  const url = dbUrl();
  if (!url) return void t.skip("local Supabase DB not reachable");
  const admin = (await openSession(url)).c;
  const writer = await openSession(url);
  const editor = await openSession(url);
  let ctx: Ctx | undefined;
  try {
    await admin.query("set request.jwt.claims = '{\"role\":\"service_role\"}'");
    ctx = await provision(admin);
    const order = await createOrder(admin, ctx, 2, 3);
    await reserve(admin, ctx, order);
    const payload = (await admin.query("select to_jsonb(p) payload from public.products p where id=$1", [ctx.p1])).rows[0].payload;
    await writer.c.query("begin");
    await writer.c.query("set local role authenticated");
    await writer.c.query(`set local request.jwt.claims = ${claims(ctx.owner)}`);
    await writer.c.query("select public.update_product($1,$2,$3::jsonb)", [ctx.tenant, ctx.p1, { ...payload, package_quantity: 12 }]);
    const { p } = await fire(editor.c, ctx, EDIT_SQL, [ctx.tenant, order, JSON.stringify([
      { product_id: ctx.p1, quantity: 4 }, { product_id: ctx.p2, quantity: 3 },
    ])], false);
    await waitFor(async () => (await admin.query("select $1::int = any(pg_blocking_pids($2)) blocked", [writer.pid, editor.pid])).rows[0].blocked,
      "edit waits for concurrent product writer");
    await writer.c.query("commit");
    const result = await settle(p);
    await editor.c.query("rollback");
    assert.equal(result.ok, false, "committed package mismatch rejects the edit");
    assert.equal(errCode(result.ok ? undefined : result.e), "22023");
    assert.equal(await avail(admin, ctx, ctx.p1), 998, "rejection leaves reserved stock unchanged");
    assert.equal((await admin.query("select quantity from public.order_items where order_id=$1 and product_id=$2", [order, ctx.p1])).rows[0].quantity, 2);
  } finally {
    await teardown(admin, [writer, editor], ctx);
    await admin.end();
  }
});

test("edit before product update: shared package locks do not invert product/inventory lock order", async (t) => {
  const url = dbUrl();
  if (!url) return void t.skip("local Supabase DB not reachable");
  const admin = (await openSession(url)).c;
  const editor = await openSession(url);
  const writer = await openSession(url);
  const coord = await openSession(url);
  let ctx: Ctx | undefined;
  try {
    await admin.query("set request.jwt.claims = '{\"role\":\"service_role\"}'");
    await createBarrier(admin);
    ctx = await provision(admin);
    const order = await createOrder(admin, ctx, 2, 3);
    await reserve(admin, ctx, order);
    const payload = (await admin.query("select to_jsonb(p) payload from public.products p where id=$1", [ctx.p1])).rows[0].payload;
    await coord.c.query("select pg_advisory_lock($1)", [BARRIER_KEY]);
    const { p: edit } = await fire(editor.c, ctx, EDIT_SQL, [ctx.tenant, order, JSON.stringify([
      { product_id: ctx.p1, quantity: 4 }, { product_id: ctx.p2, quantity: 3 },
    ])], true);
    await waitFor(() => advisoryWaiters(admin).then(n => n === 1), "edit holds package and inventory locks at barrier");
    const { p: write } = await fire(writer.c, ctx, "select public.update_product($1,$2,$3::jsonb,$4::jsonb)",
      [ctx.tenant, ctx.p1, { ...payload, wholesale_price: 40 }, { quantity_available: 1000, low_stock_threshold: 5 }], false);
    await waitFor(async () => (await admin.query("select $1::int = any(pg_blocking_pids($2)) blocked", [editor.pid, writer.pid])).rows[0].blocked,
      "product/inventory write waits on edit's package lock");
    await coord.c.query("select pg_advisory_unlock($1)", [BARRIER_KEY]);
    const edited = await settle(edit);
    await editor.c.query(edited.ok ? "commit" : "rollback");
    const written = await settle(write);
    await writer.c.query(written.ok ? "commit" : "rollback");
    assert.equal(edited.ok && written.ok, true, "both operations finish without deadlock");
    assert.equal((await admin.query("select unit_price_snapshot from public.order_items where order_id=$1 and product_id=$2", [order, ctx.p1])).rows[0].unit_price_snapshot, '10.00');
    assert.equal((await admin.query("select wholesale_price from public.products where id=$1", [ctx.p1])).rows[0].wholesale_price, '40.00');
  } finally {
    await teardown(admin, [editor, writer, coord], ctx);
    await admin.end();
  }
});

test("tracking initialized during edit: incompatible saved packages reject under the inventory lock", async (t) => {
  const url = dbUrl();
  if (!url) return void t.skip("local Supabase DB not reachable");
  const admin = (await openSession(url)).c;
  const editor = await openSession(url);
  const tracker = await openSession(url);
  const coord = await openSession(url);
  let ctx: Ctx | undefined;
  try {
    await admin.query("set request.jwt.claims = '{\"role\":\"service_role\"}'");
    await createBarrier(admin);
    ctx = await provision(admin);
    // Confirmation reserves p1 only; p2 is untracked and retains its saved carton/6.
    await admin.query("delete from public.inventory_items where tenant_id=$1 and product_id=$2", [ctx.tenant, ctx.p2]);
    const order = await createOrder(admin, ctx, 2, 3);
    await reserve(admin, ctx, order);
    await admin.query("update public.products set package_quantity=12 where id=$1", [ctx.p2]);
    const before = (await admin.query(`select to_jsonb(o) header,
      (select jsonb_agg(to_jsonb(i) order by i.id) from public.order_items i where i.order_id=o.id) items,
      (select jsonb_agg(to_jsonb(m) order by m.id) from public.order_inventory_movements m where m.order_id=o.id) movements,
      (select jsonb_agg(to_jsonb(a) order by a.id) from public.audit_events a where a.entity_id=o.id) audit
      from public.orders o where o.id=$1`, [order])).rows[0];
    await coord.c.query("select pg_advisory_lock($1)", [BARRIER_KEY]);
    const { p: edit } = await fire(editor.c, ctx, EDIT_SQL, [ctx.tenant, order, JSON.stringify([
      { product_id: ctx.p1, quantity: 4 }, { product_id: ctx.p2, quantity: 3 },
    ])], true);
    await waitFor(() => advisoryWaiters(admin).then(n => n === 1),
      "edit has passed the early package guard and pauses at p1's movement");
    // The real stock-adjustment RPC can initialize p2 while the edit holds product
    // SHARE locks (its foreign-key KEY SHARE lock is compatible). Commit before
    // reconciliation reads p2; no timing sleeps or direct mutation in this race.
    const { p: track } = await fire(tracker.c, ctx,
      "select public.adjust_inventory_stock($1,$2,1000,'manual_supplier_delivery')",
      [ctx.tenant, ctx.p2], false);
    const tracked = await settle(track);
    await tracker.c.query(tracked.ok ? "commit" : "rollback");
    assert.equal(tracked.ok, true, "stock initialization committed during the edit");
    await coord.c.query("select pg_advisory_unlock($1)", [BARRIER_KEY]);
    const edited = await settle(edit);
    await editor.c.query(edited.ok ? "commit" : "rollback");
    assert.equal(edited.ok, false, "newly tracked mismatched packages reject reconciliation");
    assert.equal(errCode(edited.ok ? undefined : edited.e), "22023");
    assert.equal(await avail(admin, ctx, ctx.p1), 998, "first product's deduction rolled back");
    assert.equal(await avail(admin, ctx, ctx.p2), 1000, "separately committed stock initialization remains untouched");
    const after = (await admin.query(`select to_jsonb(o) header,
      (select jsonb_agg(to_jsonb(i) order by i.id) from public.order_items i where i.order_id=o.id) items,
      (select jsonb_agg(to_jsonb(m) order by m.id) from public.order_inventory_movements m where m.order_id=o.id) movements,
      (select jsonb_agg(to_jsonb(a) order by a.id) from public.audit_events a where a.entity_id=o.id) audit
      from public.orders o where o.id=$1`, [order])).rows[0];
    assert.deepEqual(after, before, "order, snapshots, order ledger and order audit rolled back exactly");
  } finally {
    await teardown(admin, [editor, tracker, coord], ctx);
    await admin.end();
  }
});

test("teardown: the disposable order barrier trigger + function are fully removed", async (t) => {
  const url = dbUrl();
  if (!url) return void t.skip("local Supabase DB not reachable — run `supabase start`");
  let adminS: Session;
  try {
    adminS = await openSession(url);
  } catch {
    return void t.skip("cannot connect to local Postgres");
  }
  const admin = adminS.c;
  try {
    await dropBarrier(admin);
    const trg = await admin.query(
      "select count(*)::int n from pg_trigger where tgname='_test_order_barrier_trg'",
    );
    assert.equal(trg.rows[0].n, 0, "no leftover barrier trigger");
    const fn = await admin.query(
      "select count(*)::int n from pg_proc where proname='_test_order_barrier'",
    );
    assert.equal(fn.rows[0].n, 0, "no leftover barrier function");
  } finally {
    await admin.end().catch(() => {});
  }
});
