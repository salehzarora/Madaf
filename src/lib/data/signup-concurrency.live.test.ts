/**
 * DETERMINISTIC concurrency test for the signup review terminal transitions
 * (C2). Proves — over REAL sessions against the REAL approve/reject RPCs, not a
 * re-implemented state machine — that concurrent terminal operations on ONE
 * request can never leave it in the contradictory
 *   approved_at IS NOT NULL AND rejected_at IS NOT NULL
 * state, that at most one Customer + one customer.created audit event is created,
 * and that the loser fails safely.
 *
 * NOT a flaky "launch two promises and hope they overlap" test. The interleaving
 * is FORCED:
 *   • approve/approve and approve/reject use a disposable BEFORE-INSERT barrier
 *     trigger on public.customers that blocks the approving transaction on an
 *     advisory lock held by a coordinator connection — pausing approve at the
 *     Customer insert exactly inside its old read→write race window, so a
 *     concurrent operation is guaranteed to interleave. With the OLD (non-locking)
 *     approve restored this makes the tests FAIL (two Customers; or approve
 *     overwriting a committed rejection); with the fix they pass.
 *   • reject/reject and reject-vs-approve hold one transaction OPEN (the RPC's own
 *     row lock) so the other blocks, then commit in a controlled order.
 * Progress is detected by polling pg_locks / pg_stat_activity (never by sleeping a
 * fixed time). The barrier trigger + function are created and DROPPED inside the
 * test; a final case asserts they are gone. Each racer carries a statement_timeout
 * and its backend is terminated on teardown, so a failing interleaving can never
 * hang the suite.
 *
 * Requires the local Supabase Postgres (DB_URL from `supabase status -o json`,
 * read at runtime — never hardcoded). Skips if unreachable. NEVER hosted.
 *
 * Runner: `npm run test:signup-concurrency-live` (needs the local stack up).
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

/** A private advisory-lock key for the test barrier (fits in 32 bits ⇒ classid
 * 0, objid = key in pg_locks). */
const BARRIER_KEY = 918273645;

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
  // Swallow async connection errors so a socket closing during teardown can never
  // surface as an uncaughtException after a test ends.
  c.on("error", () => {});
  await c.connect();
  // Safety net: no query may block indefinitely, so a failing interleaving fails
  // instead of hanging the suite.
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
  req: string;
  reqName: string;
}

async function provision(admin: PgClient): Promise<Ctx> {
  const tenant = randomUUID();
  const owner = randomUUID();
  const link = randomUUID();
  const req = randomUUID();
  const reqName = `race-${req.slice(0, 8)}`;
  await admin.query("insert into auth.users (id) values ($1)", [owner]);
  await admin.query(
    "insert into public.tenants (id, name_ar, name_he, name_en) values ($1,'r','r','r')",
    [tenant],
  );
  await admin.query(
    "insert into public.tenant_users (tenant_id, user_id, role) values ($1,$2,'owner')",
    [tenant, owner],
  );
  await admin.query(
    "insert into public.customer_signup_links (id, tenant_id, token_hash) values ($1,$2,$3)",
    [link, tenant, randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "")],
  );
  await admin.query(
    "insert into public.customer_signup_requests (id, tenant_id, link_id, name, phone) values ($1,$2,$3,$4,'050-race')",
    [req, tenant, link, reqName],
  );
  return { tenant, owner, req, reqName };
}

async function cleanup(admin: PgClient, ctx: Ctx): Promise<void> {
  const del = async (sql: string, p: unknown[]) => {
    try {
      await admin.query(sql, p);
    } catch {
      /* best-effort */
    }
  };
  await del("delete from public.audit_events where tenant_id=$1", [ctx.tenant]);
  await del("delete from public.customers where tenant_id=$1", [ctx.tenant]);
  await del("delete from public.customer_signup_requests where tenant_id=$1", [ctx.tenant]);
  await del("delete from public.customer_signup_links where tenant_id=$1", [ctx.tenant]);
  await del("delete from public.tenant_users where tenant_id=$1", [ctx.tenant]);
  await del("delete from public.tenants where id=$1", [ctx.tenant]);
  await del("delete from auth.users where id=$1", [ctx.owner]);
}

/** Close racer connections FIRST so any open txn (and its row/advisory locks) is
 * released, THEN drop the barrier and delete the fixtures. A still-blocked query
 * is bounded by each session's statement_timeout, so teardown never hangs and a
 * held lock never deadlocks the DELETEs. */
async function teardown(admin: PgClient, sessions: Session[], ctx: Ctx | undefined): Promise<void> {
  await Promise.allSettled(sessions.map((s) => s.c.end()));
  await dropBarrier(admin);
  if (ctx) await cleanup(admin, ctx);
}

async function createBarrier(admin: PgClient): Promise<void> {
  await admin.query(`
    create or replace function public._test_signup_barrier() returns trigger
    language plpgsql as $fn$
    begin
      if coalesce(current_setting('test.signup_barrier', true), 'off') = 'on' then
        perform pg_advisory_xact_lock(${BARRIER_KEY});
      end if;
      return new;
    end;
    $fn$;`);
  await admin.query("drop trigger if exists _test_signup_barrier_trg on public.customers");
  await admin.query(`
    create trigger _test_signup_barrier_trg before insert on public.customers
    for each row execute function public._test_signup_barrier();`);
}

async function dropBarrier(admin: PgClient): Promise<void> {
  try {
    await admin.query("drop trigger if exists _test_signup_barrier_trg on public.customers");
    await admin.query("drop function if exists public._test_signup_barrier()");
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

/** Begin a txn as the authenticated owner and FIRE the approve RPC without
 * awaiting it. The wrapper object stops the async fn from flattening/awaiting the
 * pending query; the `.catch` swallows an unhandled rejection if the test aborts
 * before the promise is settled. */
async function fireApprove(
  c: PgClient,
  ctx: Ctx,
  withBarrier: boolean,
): Promise<{ p: Promise<pg.QueryResult> }> {
  await c.query("begin");
  await c.query("set local role authenticated");
  await c.query(`set local request.jwt.claims = ${claims(ctx.owner)}`);
  if (withBarrier) await c.query("set local test.signup_barrier = 'on'");
  const p = c.query("select public.approve_customer_signup_request($1,$2)", [ctx.tenant, ctx.req]);
  p.catch(() => {});
  return { p };
}

async function fireReject(c: PgClient, ctx: Ctx): Promise<{ p: Promise<pg.QueryResult> }> {
  await c.query("begin");
  await c.query("set local role authenticated");
  await c.query(`set local request.jwt.claims = ${claims(ctx.owner)}`);
  const p = c.query("select public.reject_customer_signup_request($1,$2)", [ctx.tenant, ctx.req]);
  p.catch(() => {});
  return { p };
}

async function requestState(admin: PgClient, req: string): Promise<{ approved: boolean; rejected: boolean }> {
  const r = await admin.query(
    "select approved_at is not null approved, rejected_at is not null rejected from public.customer_signup_requests where id=$1",
    [req],
  );
  return { approved: r.rows[0].approved as boolean, rejected: r.rows[0].rejected as boolean };
}

async function customerCount(admin: PgClient, ctx: Ctx): Promise<number> {
  const r = await admin.query(
    "select count(*)::int n from public.customers where tenant_id=$1 and name=$2",
    [ctx.tenant, ctx.reqName],
  );
  return r.rows[0].n as number;
}

async function auditCount(admin: PgClient, req: string): Promise<number> {
  const r = await admin.query(
    "select count(*)::int n from public.audit_events where event_type='customer.created' and metadata->>'signup_request_id'=$1",
    [req],
  );
  return r.rows[0].n as number;
}

test("approve vs approve: at most one Customer + one customer.created event", async (t) => {
  const url = dbUrl();
  if (!url) {
    t.skip("local Supabase DB not reachable — run `supabase start`");
    return;
  }
  let adminS: Session;
  try {
    adminS = await openSession(url);
  } catch {
    t.skip("cannot connect to local Postgres");
    return;
  }
  const admin = adminS.c;
  const A = await openSession(url);
  const B = await openSession(url);
  const coord = await openSession(url);
  const mon = await openSession(url);
  let ctx: Ctx | undefined;
  try {
    await createBarrier(admin);
    ctx = await provision(admin);
    await coord.c.query("select pg_advisory_lock($1)", [BARRIER_KEY]); // hold the barrier closed

    const { p: pA } = await fireApprove(A.c, ctx, true);
    await waitFor(() => advisoryWaiters(mon.c).then((n) => n >= 1), "approve A reaches the barrier");
    const { p: pB } = await fireApprove(B.c, ctx, true);
    await waitFor(
      () => blockedRunning(mon.c, "approve_customer_signup_request").then((n) => n >= 2),
      "both approvals are blocked",
    );

    await coord.c.query("select pg_advisory_unlock($1)", [BARRIER_KEY]); // open the barrier
    const rA = await settle(pA);
    await A.c.query(rA.ok ? "commit" : "rollback").catch(() => {});
    const rB = await settle(pB);
    await B.c.query(rB.ok ? "commit" : "rollback").catch(() => {});

    const winners = [rA.ok, rB.ok].filter(Boolean).length;
    assert.equal(winners, 1, "exactly one approval succeeded (the loser raised)");
    assert.equal(await customerCount(admin, ctx), 1, "exactly one Customer created");
    assert.equal(await auditCount(admin, ctx.req), 1, "exactly one customer.created audit event");
    const st = await requestState(admin, ctx.req);
    assert.equal(st.approved, true, "request is APPROVED");
    assert.equal(st.rejected, false, "rejected_at stayed NULL (never both)");
  } finally {
    await teardown(admin, [A, B, coord, mon], ctx);
    await admin.end().catch(() => {});
  }
});

test("approve vs reject: the approver holding the lock wins; never both; RPC is authoritative", async (t) => {
  const url = dbUrl();
  if (!url) {
    t.skip("local Supabase DB not reachable — run `supabase start`");
    return;
  }
  let adminS: Session;
  try {
    adminS = await openSession(url);
  } catch {
    t.skip("cannot connect to local Postgres");
    return;
  }
  const admin = adminS.c;
  const A = await openSession(url);
  const R = await openSession(url);
  const coord = await openSession(url);
  const mon = await openSession(url);
  let ctx: Ctx | undefined;
  try {
    await createBarrier(admin);
    ctx = await provision(admin);
    await coord.c.query("select pg_advisory_lock($1)", [BARRIER_KEY]);

    // approve reaches the barrier while HOLDING the request row's FOR UPDATE lock.
    const { p: pA } = await fireApprove(A.c, ctx, true);
    await waitFor(() => advisoryWaiters(mon.c).then((n) => n >= 1), "approve reaches the barrier");
    // reject then blocks on that row lock (with the fix); poll until it is blocked.
    const { p: pR } = await fireReject(R.c, ctx);
    await waitFor(
      () => blockedRunning(mon.c, "reject_customer_signup_request").then((n) => n >= 1),
      "reject is blocked on the approver's row lock",
    );

    await coord.c.query("select pg_advisory_unlock($1)", [BARRIER_KEY]);
    const rA = await settle(pA);
    await A.c.query(rA.ok ? "commit" : "rollback").catch(() => {}); // committing releases the row lock → reject re-checks
    const rR = await settle(pR);
    await R.c.query(rR.ok ? "commit" : "rollback").catch(() => {});

    assert.equal(rA.ok, true, "the approval (holding the row lock) committed");
    assert.equal(rR.ok, false, "the concurrent rejection failed safely");
    assert.equal(
      errCode(rR.ok ? undefined : rR.e),
      "22023",
      "reject lost with the RPC's own already-reviewed error (the RPC, not the CHECK, is authoritative)",
    );
    const st = await requestState(admin, ctx.req);
    assert.equal(st.approved, true, "request is APPROVED");
    assert.equal(st.rejected, false, "rejected_at stayed NULL (never both)");
    assert.equal(await customerCount(admin, ctx), 1, "exactly one Customer");
    assert.equal(await auditCount(admin, ctx.req), 1, "exactly one customer.created audit event");
  } finally {
    await teardown(admin, [A, R, coord, mon], ctx);
    await admin.end().catch(() => {});
  }
});

test("reject wins vs approve: rejection commits first; approval fails BEFORE any Customer insert", async (t) => {
  const url = dbUrl();
  if (!url) {
    t.skip("local Supabase DB not reachable — run `supabase start`");
    return;
  }
  let adminS: Session;
  try {
    adminS = await openSession(url);
  } catch {
    t.skip("cannot connect to local Postgres");
    return;
  }
  const admin = adminS.c;
  const Rj = await openSession(url);
  const Ap = await openSession(url);
  const mon = await openSession(url);
  let ctx: Ctx | undefined;
  try {
    ctx = await provision(admin);
    // reject runs and HOLDS its transaction open (its UPDATE locks the row).
    await Rj.c.query("begin");
    await Rj.c.query("set local role authenticated");
    await Rj.c.query(`set local request.jwt.claims = ${claims(ctx.owner)}`);
    await Rj.c.query("select public.reject_customer_signup_request($1,$2)", [ctx.tenant, ctx.req]);
    // approve then blocks at its SELECT ... FOR UPDATE on the locked row.
    await Ap.c.query("begin");
    await Ap.c.query("set local role authenticated");
    await Ap.c.query(`set local request.jwt.claims = ${claims(ctx.owner)}`);
    const pAp = Ap.c.query("select public.approve_customer_signup_request($1,$2)", [ctx.tenant, ctx.req]);
    pAp.catch(() => {});
    await waitFor(
      () => blockedRunning(mon.c, "approve_customer_signup_request").then((n) => n >= 1),
      "approve is blocked on the rejecter's row lock",
    );

    await Rj.c.query("commit"); // rejection wins
    const rAp = await settle(pAp);
    await Ap.c.query(rAp.ok ? "commit" : "rollback").catch(() => {});

    assert.equal(rAp.ok, false, "the approval failed safely after rejection won");
    assert.equal(
      errCode(rAp.ok ? undefined : rAp.e),
      "22023",
      "approval raised already-reviewed at the FOR UPDATE re-check (before any Customer insert)",
    );
    const st = await requestState(admin, ctx.req);
    assert.equal(st.rejected, true, "request is REJECTED");
    assert.equal(st.approved, false, "approved_at stayed NULL (never both)");
    assert.equal(await customerCount(admin, ctx), 0, "no Customer was committed by the losing approval");
    assert.equal(await auditCount(admin, ctx.req), 0, "no customer.created event from the losing approval");
  } finally {
    await teardown(admin, [Rj, Ap, mon], ctx);
    await admin.end().catch(() => {});
  }
});

test("reject vs reject: exactly one succeeds; rejected-only; no Customer", async (t) => {
  const url = dbUrl();
  if (!url) {
    t.skip("local Supabase DB not reachable — run `supabase start`");
    return;
  }
  let adminS: Session;
  try {
    adminS = await openSession(url);
  } catch {
    t.skip("cannot connect to local Postgres");
    return;
  }
  const admin = adminS.c;
  const R1 = await openSession(url);
  const R2 = await openSession(url);
  const mon = await openSession(url);
  let ctx: Ctx | undefined;
  try {
    ctx = await provision(admin);
    // reject #1 succeeds but is held open (holds the row lock).
    await R1.c.query("begin");
    await R1.c.query("set local role authenticated");
    await R1.c.query(`set local request.jwt.claims = ${claims(ctx.owner)}`);
    await R1.c.query("select public.reject_customer_signup_request($1,$2)", [ctx.tenant, ctx.req]);
    // reject #2 blocks on the row lock.
    await R2.c.query("begin");
    await R2.c.query("set local role authenticated");
    await R2.c.query(`set local request.jwt.claims = ${claims(ctx.owner)}`);
    const pR2 = R2.c.query("select public.reject_customer_signup_request($1,$2)", [ctx.tenant, ctx.req]);
    pR2.catch(() => {});
    await waitFor(
      () => blockedRunning(mon.c, "reject_customer_signup_request").then((n) => n >= 1),
      "the second reject is blocked",
    );

    await R1.c.query("commit"); // reject #1 wins
    const r2 = await settle(pR2);
    await R2.c.query(r2.ok ? "commit" : "rollback").catch(() => {});

    assert.equal(r2.ok, false, "the second reject failed safely (idempotency-error contract)");
    assert.equal(errCode(r2.ok ? undefined : r2.e), "22023", "the second reject raised already-reviewed");
    const st = await requestState(admin, ctx.req);
    assert.equal(st.rejected, true, "request is REJECTED");
    assert.equal(st.approved, false, "approved_at stayed NULL (never both)");
    const anyCustomer = await admin.query(
      "select count(*)::int n from public.customers where tenant_id=$1",
      [ctx.tenant],
    );
    assert.equal(anyCustomer.rows[0].n, 0, "a rejection creates no Customer");
  } finally {
    await teardown(admin, [R1, R2, mon], ctx);
    await admin.end().catch(() => {});
  }
});

test("teardown: the disposable barrier trigger + function are fully removed", async (t) => {
  const url = dbUrl();
  if (!url) {
    t.skip("local Supabase DB not reachable — run `supabase start`");
    return;
  }
  let adminS: Session;
  try {
    adminS = await openSession(url);
  } catch {
    t.skip("cannot connect to local Postgres");
    return;
  }
  const admin = adminS.c;
  try {
    // Belt-and-braces drop in case a prior case aborted before its own drop.
    await dropBarrier(admin);
    const trg = await admin.query(
      "select count(*)::int n from pg_trigger where tgname='_test_signup_barrier_trg'",
    );
    assert.equal(trg.rows[0].n, 0, "no leftover barrier trigger");
    const fn = await admin.query(
      "select count(*)::int n from pg_proc where proname='_test_signup_barrier'",
    );
    assert.equal(fn.rows[0].n, 0, "no leftover barrier function");
  } finally {
    await admin.end().catch(() => {});
  }
});
