/**
 * DETERMINISTIC concurrency probe for the order-submission idempotency claim
 * (PILOT-OPS-AUDIT-008-FIX1) over the REAL create RPCs across ALL three channels.
 *
 * The claim table's unique PK (tenant, channel, submission_key) is the change
 * gate: a second same-key INSERT blocks on the unique index until the first
 * transaction ends. This harness forces that interleaving WITHOUT a barrier —
 * transaction A creates an order with key K and is HELD OPEN (its claim row
 * uncommitted); transaction B then fires the same key and deterministically
 * blocks on the index. Detected by polling pg_stat_activity (never a fixed
 * sleep). Then:
 *   • A commits  → B unblocks → same payload returns A's order (one order); a
 *     DIFFERENT payload conflicts (MDF40); no second order either way.
 *   • A rolls back → B's INSERT wins → B creates its own order (one order, no
 *     orphan claim).
 * Covered for authenticated / shop-token / showcase channels. Every session has a
 * statement_timeout and is torn down, so a bad interleaving fails, never hangs.
 *
 * Requires the local Supabase Postgres (DB_URL from `supabase status -o json`,
 * read at runtime — never hardcoded). Skips if unreachable. NEVER hosted.
 *
 * Runner: `npm run test:order-idempotency-live` (needs the local stack up).
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

function dbUrl(): string | null {
  try {
    const raw = execFileSync("supabase", ["status", "-o", "json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return (JSON.parse(raw) as Record<string, string>).DB_URL ?? null;
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

async function waitFor(fn: () => Promise<boolean>, label: string, timeoutMs = 8000, stepMs = 25): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return;
    await sleep(stepMs);
  }
  throw new Error(`waitFor timed out: ${label}`);
}

type Settled = { ok: true; v: pg.QueryResult } | { ok: false; e: unknown };
const settle = (p: Promise<pg.QueryResult>): Promise<Settled> =>
  p.then((v) => ({ ok: true as const, v })).catch((e) => ({ ok: false as const, e }));

const errCode = (e: unknown): string | undefined =>
  typeof e === "object" && e !== null && "code" in e ? (e as { code?: string }).code : undefined;

async function blockedRunning(mon: PgClient, fnName: string): Promise<number> {
  const r = await mon.query(
    `select count(*)::int n from pg_stat_activity
     where pid <> pg_backend_pid() and state = 'active'
       and wait_event_type = 'Lock' and query ilike '%' || $1 || '%'`,
    [fnName],
  );
  return r.rows[0].n as number;
}

interface Ctx {
  tenant: string;
  owner: string;
  customer: string;
  product: string;
  shopToken: string;
  showcaseToken: string;
}

async function provision(admin: PgClient): Promise<Ctx> {
  const tenant = randomUUID();
  const owner = randomUUID();
  const customer = randomUUID();
  const product = randomUUID();
  const shopToken = `shop-${randomUUID()}${randomUUID()}`.replace(/-/g, "");
  const showcaseToken = `show-${randomUUID()}${randomUUID()}`.replace(/-/g, "");
  await admin.query("insert into auth.users (id) values ($1)", [owner]);
  await admin.query("insert into public.tenants (id, name_ar, name_he, name_en) values ($1,'i','i','I')", [tenant]);
  await admin.query("insert into public.tenant_users (tenant_id, user_id, role) values ($1,$2,'owner')", [tenant, owner]);
  await admin.query(
    "insert into public.customers (id, tenant_id, name, customer_type, phone, origin, is_active) values ($1,$2,'C','grocery','050','manual',true)",
    [customer, tenant],
  );
  await admin.query(
    `insert into public.products (id, tenant_id, name_ar, name_he, name_en, package_unit, package_quantity, base_unit, wholesale_price, vat_rate, is_active)
     values ($1,$2,'p','p','P','carton',6,'bottles',10.00,0.17,true)`,
    [product, tenant],
  );
  await admin.query(
    "insert into public.inventory_items (tenant_id, product_id, quantity_available, low_stock_threshold) values ($1,$2,1000,5)",
    [tenant, product],
  );
  await admin.query(
    "insert into public.customer_access_links (id, tenant_id, customer_id, token_hash) values ($1,$2,$3, encode(sha256(convert_to($4,'UTF8')),'hex'))",
    [randomUUID(), tenant, customer, shopToken],
  );
  await admin.query(
    "insert into public.catalog_showcase_links (id, tenant_id, token_hash) values ($1,$2, encode(sha256(convert_to($3,'UTF8')),'hex'))",
    [randomUUID(), tenant, showcaseToken],
  );
  return { tenant, owner, customer, product, shopToken, showcaseToken };
}

async function cleanup(admin: PgClient, ctx: Ctx | undefined): Promise<void> {
  if (!ctx) return;
  const del = async (sql: string, p: unknown[]) => {
    try { await admin.query(sql, p); } catch { /* best-effort */ }
  };
  await del("delete from public.audit_events where tenant_id=$1", [ctx.tenant]);
  await del("delete from public.order_submission_claims where tenant_id=$1", [ctx.tenant]);
  await del("delete from public.order_items where tenant_id=$1", [ctx.tenant]);
  await del("delete from public.orders where tenant_id=$1", [ctx.tenant]);
  await del("delete from public.catalog_showcase_links where tenant_id=$1", [ctx.tenant]);
  await del("delete from public.customer_access_links where tenant_id=$1", [ctx.tenant]);
  await del("delete from public.inventory_items where tenant_id=$1", [ctx.tenant]);
  await del("delete from public.products where tenant_id=$1", [ctx.tenant]);
  await del("delete from public.customers where tenant_id=$1", [ctx.tenant]);
  await del("delete from public.tenant_users where tenant_id=$1", [ctx.tenant]);
  await del("delete from public.tenants where id=$1", [ctx.tenant]);
  await del("delete from auth.users where id=$1", [ctx.owner]);
}

async function teardown(admin: PgClient, sessions: Session[], ctx: Ctx | undefined): Promise<void> {
  await Promise.allSettled(sessions.map((s) => s.c.end()));
  await cleanup(admin, ctx);
}

async function orderCount(admin: PgClient, ctx: Ctx): Promise<number> {
  const r = await admin.query("select count(*)::int n from public.orders where tenant_id=$1", [ctx.tenant]);
  return r.rows[0].n as number;
}
async function claimCount(admin: PgClient, ctx: Ctx): Promise<number> {
  const r = await admin.query("select count(*)::int n from public.order_submission_claims where tenant_id=$1", [ctx.tenant]);
  return r.rows[0].n as number;
}
async function createdEventCount(admin: PgClient, ctx: Ctx): Promise<number> {
  const r = await admin.query(
    "select count(*)::int n from public.audit_events where tenant_id=$1 and event_type='order.created'",
    [ctx.tenant],
  );
  return r.rows[0].n as number;
}

const items = (product: string, qty: number) => JSON.stringify([{ product_id: product, quantity: qty }]);

/** Begin a txn on the channel's role and FIRE the create RPC without awaiting.
 * Returns the pending promise (so the caller can hold A open / detect B blocked). */
async function beginAuth(c: PgClient, ctx: Ctx): Promise<void> {
  await c.query("begin");
  await c.query("set local role authenticated");
  await c.query(`set local request.jwt.claims = '{"sub":"${ctx.owner}","role":"authenticated"}'`);
}
async function beginAnon(c: PgClient): Promise<void> {
  await c.query("begin");
  await c.query("set local role anon");
  await c.query(`set local request.jwt.claims = '{"role":"anon"}'`);
}

const AUTH_SQL = "select order_id::text as ref from public.create_order_request($1,$2::jsonb,$3, p_submission_key => $4::uuid)";
const SHOP_SQL = "select order_number as ref from public.create_order_request_from_token($1,$2::jsonb, p_submission_key => $3::uuid)";
const SHOWCASE_SQL =
  "select order_number as ref from public.create_order_from_showcase_token($1,$2::jsonb,'Guest',null,null,null,null,null,null,null,null, p_submission_key => $3::uuid)";

// ── Channel same-key concurrency: A held open, B blocks, A commits → one order ──
for (const ch of [
  { name: "authenticated", fn: "create_order_request" },
  { name: "shop-token", fn: "create_order_request_from_token" },
  { name: "showcase", fn: "create_order_from_showcase_token" },
] as const) {
  test(`${ch.name}: two simultaneous same-key submissions create exactly ONE order`, async (t) => {
    const url = dbUrl();
    if (!url) return void t.skip("local Supabase DB not reachable — run `supabase start`");
    let adminS: Session;
    try { adminS = await openSession(url); } catch { return void t.skip("cannot connect"); }
    const admin = adminS.c;
    const A = await openSession(url);
    const B = await openSession(url);
    const mon = await openSession(url);
    let ctx: Ctx | undefined;
    try {
      ctx = await provision(admin);
      const key = randomUUID();
      // The { p } wrapper stops the async fn from flattening/awaiting the pending
      // query — we need the promise un-awaited so B can block while A is held open.
      const fire = async (c: PgClient): Promise<{ p: Promise<pg.QueryResult> }> => {
        if (ch.name === "authenticated") {
          await beginAuth(c, ctx!);
          return { p: c.query(AUTH_SQL, [ctx!.tenant, items(ctx!.product, 3), ctx!.customer, key]) };
        }
        await beginAnon(c);
        return {
          p: ch.name === "shop-token"
            ? c.query(SHOP_SQL, [ctx!.shopToken, items(ctx!.product, 3), key])
            : c.query(SHOWCASE_SQL, [ctx!.showcaseToken, items(ctx!.product, 3), key]),
        };
      };

      // A creates the order and is HELD OPEN (claim uncommitted).
      const { p: pA } = await fire(A.c);
      const rA = await pA; // resolves; A's txn stays open
      // B fires the same key and blocks on the claim unique index.
      const { p: pB } = await fire(B.c);
      pB.catch(() => {});
      await waitFor(() => blockedRunning(mon.c, ch.fn).then((n) => n >= 1), "B blocks on the claim index");

      await A.c.query("commit"); // release → B unblocks
      const sB = await settle(pB);
      await B.c.query(sB.ok ? "commit" : "rollback").catch(() => {});

      assert.equal(sB.ok, true, "B succeeded (idempotent hit), did not error");
      assert.equal(sB.ok && sB.v.rows[0].ref, rA.rows[0].ref, "B returned the SAME order/ref as A");
      assert.equal(await orderCount(admin, ctx), 1, "exactly one order exists");
      assert.equal(await claimCount(admin, ctx), 1, "exactly one claim exists");
      assert.equal(await createdEventCount(admin, ctx), 1, "exactly one order.created event");
    } finally {
      await teardown(admin, [A, B, mon], ctx);
      await admin.end().catch(() => {});
    }
  });
}

test("authenticated: same key + DIFFERENT payload conflicts; the loser gets MDF40, one order", async (t) => {
  const url = dbUrl();
  if (!url) return void t.skip("local Supabase DB not reachable — run `supabase start`");
  let adminS: Session;
  try { adminS = await openSession(url); } catch { return void t.skip("cannot connect"); }
  const admin = adminS.c;
  const A = await openSession(url);
  const B = await openSession(url);
  const mon = await openSession(url);
  let ctx: Ctx | undefined;
  try {
    ctx = await provision(admin);
    const key = randomUUID();
    await beginAuth(A.c, ctx);
    const rA = await A.c.query(AUTH_SQL, [ctx.tenant, items(ctx.product, 3), ctx.customer, key]);
    await beginAuth(B.c, ctx);
    const pB = B.c.query(AUTH_SQL, [ctx.tenant, items(ctx.product, 9), ctx.customer, key]); // different qty
    pB.catch(() => {});
    await waitFor(() => blockedRunning(mon.c, "create_order_request").then((n) => n >= 1), "B blocks");

    await A.c.query("commit");
    const sB = await settle(pB);
    await B.c.query(sB.ok ? "commit" : "rollback").catch(() => {});

    assert.equal(sB.ok, false, "the changed-payload loser failed safely");
    assert.equal(errCode(sB.ok ? undefined : sB.e), "MDF40", "the loser raised the idempotency-conflict error");
    assert.ok(rA.rows[0].ref, "A's order was created");
    assert.equal(await orderCount(admin, ctx), 1, "only A's order exists");
    assert.equal(await createdEventCount(admin, ctx), 1, "exactly one order.created event");
  } finally {
    await teardown(admin, [A, B, mon], ctx);
    await admin.end().catch(() => {});
  }
});

test("authenticated: a rolled-back first attempt lets the retry create the order (one order, no orphan claim)", async (t) => {
  const url = dbUrl();
  if (!url) return void t.skip("local Supabase DB not reachable — run `supabase start`");
  let adminS: Session;
  try { adminS = await openSession(url); } catch { return void t.skip("cannot connect"); }
  const admin = adminS.c;
  const A = await openSession(url);
  const B = await openSession(url);
  const mon = await openSession(url);
  let ctx: Ctx | undefined;
  try {
    ctx = await provision(admin);
    const key = randomUUID();
    await beginAuth(A.c, ctx);
    await A.c.query(AUTH_SQL, [ctx.tenant, items(ctx.product, 3), ctx.customer, key]); // order created, txn open
    await beginAuth(B.c, ctx);
    const pB = B.c.query(AUTH_SQL, [ctx.tenant, items(ctx.product, 3), ctx.customer, key]);
    pB.catch(() => {});
    await waitFor(() => blockedRunning(mon.c, "create_order_request").then((n) => n >= 1), "B blocks");

    await A.c.query("rollback"); // A abandons → B's claim INSERT wins
    const sB = await settle(pB);
    await B.c.query(sB.ok ? "commit" : "rollback").catch(() => {});

    assert.equal(sB.ok, true, "B created the order after A rolled back");
    assert.equal(await orderCount(admin, ctx), 1, "exactly one order (B's) — A left nothing");
    assert.equal(await claimCount(admin, ctx), 1, "exactly one claim (B's) — no orphan from A");
    assert.equal(await createdEventCount(admin, ctx), 1, "exactly one order.created event");
  } finally {
    await teardown(admin, [A, B, mon], ctx);
    await admin.end().catch(() => {});
  }
});
