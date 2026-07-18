/**
 * DETERMINISTIC concurrency probe for onboarding serialization
 * (PILOT-OPS-AUDIT-008-FIX1). create_tenant_with_owner takes a FOR UPDATE lock on
 * the caller's OWN auth.users row before the membership check, so two genuinely
 * simultaneous self-onboards by the SAME auth user serialize into exactly ONE
 * tenant, while different users never block each other.
 *
 * The interleaving is FORCED (no fixed sleep): transaction A onboards user U and
 * is HELD OPEN (holding U's auth.users row lock); transaction B then onboards the
 * same U and deterministically blocks on that row lock (detected via
 * pg_stat_activity). A commits → B re-checks membership under the lock, sees A's
 * membership, and fails with the established already-member error (42501). Exactly
 * one tenant, one owner membership, one starter-category set. A separate case
 * proves two DIFFERENT users onboard concurrently without blocking.
 *
 * Requires the local Supabase Postgres (DB_URL from `supabase status -o json`,
 * read at runtime — never hardcoded). Skips if unreachable. NEVER hosted.
 *
 * Runner: `npm run test:onboarding-concurrency-live` (needs the local stack up).
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

const ONBOARD_SQL = "select public.create_tenant_with_owner('متجر','חנות','Shop') as tenant_id";

async function beginAs(c: PgClient, user: string): Promise<void> {
  await c.query("begin");
  await c.query("set local role authenticated");
  await c.query(`set local request.jwt.claims = '{"sub":"${user}","role":"authenticated"}'`);
}

async function tenantsForUser(admin: PgClient, user: string): Promise<number> {
  const r = await admin.query("select count(*)::int n from public.tenant_users where user_id=$1", [user]);
  return r.rows[0].n as number;
}

async function cleanupUser(admin: PgClient, user: string): Promise<void> {
  const del = async (sql: string, p: unknown[]) => {
    try { await admin.query(sql, p); } catch { /* best-effort */ }
  };
  // Tenants this user owns (find via membership) → drop categories, memberships, tenants.
  const t = await admin.query("select tenant_id from public.tenant_users where user_id=$1", [user]);
  for (const row of t.rows) {
    await del("delete from public.categories where tenant_id=$1", [row.tenant_id]);
    await del("delete from public.tenant_users where tenant_id=$1", [row.tenant_id]);
    await del("delete from public.tenants where id=$1", [row.tenant_id]);
  }
  await del("delete from auth.users where id=$1", [user]);
}

test("same user, two simultaneous onboards → exactly ONE tenant; the loser gets 42501", async (t) => {
  const url = dbUrl();
  if (!url) return void t.skip("local Supabase DB not reachable — run `supabase start`");
  let adminS: Session;
  try { adminS = await openSession(url); } catch { return void t.skip("cannot connect"); }
  const admin = adminS.c;
  const A = await openSession(url);
  const B = await openSession(url);
  const mon = await openSession(url);
  const user = randomUUID();
  try {
    await admin.query("insert into auth.users (id) values ($1)", [user]);

    // A onboards and is HELD OPEN (holding user's auth.users row lock).
    await beginAs(A.c, user);
    const rA = await A.c.query(ONBOARD_SQL);
    // B onboards the SAME user and blocks on the auth.users row lock.
    await beginAs(B.c, user);
    const pB = B.c.query(ONBOARD_SQL);
    pB.catch(() => {});
    await waitFor(() => blockedRunning(mon.c, "create_tenant_with_owner").then((n) => n >= 1),
      "B blocks on the auth.users row lock");

    await A.c.query("commit"); // release → B re-checks membership under the lock
    const sB = await settle(pB);
    await B.c.query(sB.ok ? "commit" : "rollback").catch(() => {});

    assert.equal(sB.ok, false, "the second onboard failed safely (did not create a tenant)");
    assert.equal(errCode(sB.ok ? undefined : sB.e), "42501", "the loser got the established already-member error");
    assert.ok(rA.rows[0].tenant_id, "A created a tenant");
    assert.equal(await tenantsForUser(admin, user), 1, "the user has exactly ONE owner membership");
    const cats = await admin.query(
      "select count(*)::int n from public.categories where tenant_id=(select tenant_id from public.tenant_users where user_id=$1)",
      [user],
    );
    assert.equal(cats.rows[0].n, 6, "exactly one starter-category set (6) was created");
    const tenantCount = await admin.query(
      "select count(*)::int n from public.tenants where id in (select tenant_id from public.tenant_users where user_id=$1)",
      [user],
    );
    assert.equal(tenantCount.rows[0].n, 1, "exactly one tenant row — no partial second tenant");
  } finally {
    await Promise.allSettled([A, B, mon].map((s) => s.c.end()));
    await cleanupUser(admin, user);
    await admin.end().catch(() => {});
  }
});

test("two DIFFERENT users onboard concurrently without blocking each other", async (t) => {
  const url = dbUrl();
  if (!url) return void t.skip("local Supabase DB not reachable — run `supabase start`");
  let adminS: Session;
  try { adminS = await openSession(url); } catch { return void t.skip("cannot connect"); }
  const admin = adminS.c;
  const A = await openSession(url);
  const B = await openSession(url);
  const u1 = randomUUID();
  const u2 = randomUUID();
  try {
    await admin.query("insert into auth.users (id) values ($1),($2)", [u1, u2]);

    // A onboards u1 and is held open; B onboards u2 and must NOT block (different row).
    await beginAs(A.c, u1);
    await A.c.query(ONBOARD_SQL);
    await beginAs(B.c, u2);
    const sB = await settle(B.c.query(ONBOARD_SQL)); // resolves while A is still open ⇒ no cross-user block
    assert.equal(sB.ok, true, "u2 onboarded while u1's onboard was still open (no cross-user blocking)");

    await A.c.query("commit");
    await B.c.query("commit");
    assert.equal(await tenantsForUser(admin, u1), 1, "u1 has its own tenant");
    assert.equal(await tenantsForUser(admin, u2), 1, "u2 has its own tenant");
  } finally {
    await Promise.allSettled([A, B].map((s) => s.c.end()));
    await cleanupUser(admin, u1);
    await cleanupUser(admin, u2);
    await admin.end().catch(() => {});
  }
});
