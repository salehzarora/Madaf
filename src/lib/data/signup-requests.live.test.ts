/**
 * REAL local-Supabase test for the SIGNUP-BOUNDEDNESS-FOLLOWUP reads, over live
 * PostgREST under RLS — the behavioural proof behind the static guards in
 * src/lib/signup-boundedness.test.ts.
 *
 * It exercises the EXACT production queries (no duplicated logic), imported via
 * their injectable `sb*` seams:
 *   1. sbListSignupRequestsPage — with >1000 rows (including an equal-`created_at`
 *      cluster straddling a page boundary), paging through visits EVERY row
 *      exactly once (skip-/dup-free), newest-first, with a strict `id DESC`
 *      tie-break; an out-of-range page clamps to the last page; `total` is exact
 *      above the PostgREST max_rows ceiling.
 *   2. sbGetSignupRequestForApproval — resolves a request whose row sits BEYOND
 *      the newest-1000 window (where the old `listSignupRequests().find` would
 *      miss it); cross-tenant and sales_rep callers get undefined (RLS); a
 *      non-UUID id returns undefined without querying.
 *
 * Requires the local Supabase stack; reads its URL/keys from `supabase status
 * -o json` at runtime — NEVER hardcoded. Skips if unreachable. NEVER contacts
 * hosted Supabase.
 *
 * Runner: `npm run test:signup-requests-live` (needs the local stack up).
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";
import {
  sbGetSignupRequestForApproval,
  sbListSignupRequestsPage,
  type SignupRequestsPage,
} from "@/lib/data/customer-signup";

type Client = SupabaseClient<Database>;
type LocalConfig = { url: string; anon: string; service: string } | null;

function localConfig(): LocalConfig {
  try {
    const raw = execFileSync("supabase", ["status", "-o", "json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const j = JSON.parse(raw) as Record<string, string>;
    const url = j.API_URL;
    const anon = j.ANON_KEY;
    const service = j.SERVICE_ROLE_KEY;
    if (!url || !anon || !service) return null;
    return { url, anon, service };
  } catch {
    return null;
  }
}

async function reachable(url: string): Promise<boolean> {
  try {
    await fetch(`${url}/rest/v1/`, { method: "HEAD" });
    return true;
  } catch {
    return false;
  }
}

type Cfg = NonNullable<LocalConfig>;

/** Create a disposable user with `role` in a given tenant and return an
 * authenticated, RLS-scoped client for them. */
async function makeMember(
  service: Client,
  cfg: Cfg,
  tenantId: string,
  role: "owner" | "admin" | "sales_rep",
): Promise<{ client: Client; userId: string }> {
  const email = `signup-req-${role}-${randomUUID()}@madaf.test`;
  const password = `Pw-${randomUUID()}`;
  const created = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  assert.ok(!created.error, `createUser: ${created.error?.message ?? ""}`);
  const userId = created.data.user!.id;
  const mIns = await service
    .from("tenant_users")
    .insert({ tenant_id: tenantId, user_id: userId, role });
  assert.ok(!mIns.error, `membership insert: ${mIns.error?.message ?? ""}`);
  const client: Client = createClient<Database>(cfg.url, cfg.anon, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const signIn = await client.auth.signInWithPassword({ email, password });
  assert.ok(!signIn.error, `signIn: ${signIn.error?.message ?? ""}`);
  return { client, userId };
}

async function provisionTenant(service: Client): Promise<string> {
  const tenantId = randomUUID();
  const ins = await service.from("tenants").insert({
    id: tenantId,
    name_ar: "طلبات",
    name_he: "בקשות",
    name_en: "Signup Requests Live",
  });
  assert.ok(!ins.error, `tenant insert: ${ins.error?.message ?? ""}`);
  return tenantId;
}

/** Seed one signup link + `rows` in ≤500-row chunks (service client). Each row
 * may carry an explicit `id`/`created_at`/`approved_at`. */
async function seedRequests(
  service: Client,
  tenantId: string,
  rows: Record<string, unknown>[],
): Promise<void> {
  const linkId = randomUUID();
  const link = await service.from("customer_signup_links").insert({
    id: linkId,
    tenant_id: tenantId,
    token_hash: randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, ""),
  });
  assert.ok(!link.error, `link insert: ${link.error?.message ?? ""}`);
  const withLink = rows.map((r) => ({ ...r, tenant_id: tenantId, link_id: linkId }));
  for (let i = 0; i < withLink.length; i += 500) {
    const ins = await service
      .from("customer_signup_requests")
      .insert(withLink.slice(i, i + 500) as never);
    assert.ok(!ins.error, `requests insert: ${ins.error?.message ?? ""}`);
  }
}

/** Drain every page via the REAL production reader; returns the rows in
 * traversal order plus the reported total/totalPages/pageSize. */
async function drainAllPages(
  client: Client,
  tenantId: string,
  pageSize: number,
): Promise<{ rows: SignupRequestsPage["rows"]; total: number; totalPages: number }> {
  const first = await sbListSignupRequestsPage(client, tenantId, 1, pageSize);
  const rows = [...first.rows];
  for (let p = 2; p <= first.totalPages; p += 1) {
    const page = await sbListSignupRequestsPage(client, tenantId, p, pageSize);
    assert.equal(page.total, first.total, `total is stable across pages (page ${p})`);
    assert.equal(page.page, p, `page ${p} reports its own clamped number`);
    rows.push(...page.rows);
  }
  return { rows, total: first.total, totalPages: first.totalPages };
}

test("REAL PostgREST: bounded paging visits every request once above the max_rows ceiling", async (t) => {
  const cfg = localConfig();
  if (!cfg || !(await reachable(cfg.url))) {
    t.skip("local Supabase stack not reachable — run `supabase start`");
    return;
  }
  const service: Client = createClient<Database>(cfg.url, cfg.service, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const tenantA = await provisionTenant(service);
  const ownerA = await makeMember(service, cfg, tenantA, "owner");
  const repA = await makeMember(service, cfg, tenantA, "sales_rep");

  const cleanup = async () => {
    await service.from("tenants").delete().eq("id", tenantA);
    for (const id of [ownerA.userId, repA.userId]) {
      try {
        await service.auth.admin.deleteUser(id);
      } catch {
        /* best-effort */
      }
    }
  };

  try {
    // 1100 rows (> the 1000 max_rows ceiling). Rows 570..629 (60 rows, > the
    // page size of 50) all share ONE created_at, so the equal-key cluster
    // straddles a page boundary — if the `id DESC` tie-break were missing, offset
    // paging over the cluster would skip or duplicate a boundary row.
    const N = 1100;
    const PAGE = 50;
    const base = Date.parse("2026-01-01T00:00:00.000Z");
    const clusterMinute = 600;
    const clusterLo = 570;
    const clusterHi = 629; // inclusive
    const clusterTs = new Date(base + clusterMinute * 60000).toISOString();

    const seededIds = new Set<string>();
    const clusterIds = new Set<string>();
    const rows: Record<string, unknown>[] = [];
    for (let i = 0; i < N; i += 1) {
      const id = randomUUID();
      seededIds.add(id);
      const inCluster = i >= clusterLo && i <= clusterHi;
      if (inCluster) clusterIds.add(id);
      const createdAt = inCluster
        ? clusterTs
        : new Date(base + i * 60000).toISOString();
      // Mix statuses — the management list shows ALL statuses (pending +
      // approved/rejected history), so paging must span every one.
      const status: Record<string, unknown> =
        i % 3 === 1
          ? { approved_at: createdAt }
          : i % 3 === 2
            ? { rejected_at: createdAt }
            : {};
      rows.push({ id, name: `req-${i}`, created_at: createdAt, ...status });
    }
    await seedRequests(service, tenantA, rows);

    // ── Drain every page through the REAL production reader ───────────────────
    const { rows: visited, total, totalPages } = await drainAllPages(
      ownerA.client,
      tenantA,
      PAGE,
    );

    assert.equal(total, N, "exact total is correct above the max_rows ceiling");
    assert.equal(totalPages, Math.ceil(N / PAGE), "totalPages = ceil(total/pageSize)");
    assert.equal(visited.length, N, "paging returned every row (no truncation)");

    // No duplicates, no skips: the visited id-set equals the seeded id-set.
    const visitedIds = visited.map((r) => r.id);
    assert.equal(new Set(visitedIds).size, N, "no row visited twice (skip-/dup-free)");
    for (const id of visitedIds) {
      assert.ok(seededIds.has(id), "every visited row was one we seeded");
    }
    assert.equal(
      [...seededIds].filter((id) => !new Set(visitedIds).has(id)).length,
      0,
      "no seeded row was skipped",
    );

    // Global order is newest-first (created_at non-increasing across the whole
    // traversal — equal within the cluster is allowed).
    for (let i = 1; i < visited.length; i += 1) {
      assert.ok(
        visited[i - 1].createdAt >= visited[i].createdAt,
        `created_at is non-increasing across pages (at ${i})`,
      );
    }

    // Tie-break: the equal-created_at cluster (identified by the ids we control —
    // PostgREST echoes timestamptz in a different textual format, so match on id,
    // not on the created_at string) appears exactly once, CONTIGUOUS, and in
    // STRICT id-descending order (proves the `id DESC` secondary sort).
    const clusterPositions: number[] = [];
    const clusterSeq: string[] = [];
    visited.forEach((r, idx) => {
      if (clusterIds.has(r.id)) {
        clusterPositions.push(idx);
        clusterSeq.push(r.id);
      }
    });
    assert.equal(clusterSeq.length, clusterIds.size, "the whole cluster was paged");
    assert.equal(
      clusterPositions[clusterPositions.length - 1] - clusterPositions[0] + 1,
      clusterIds.size,
      "cluster rows are contiguous (equal created_at groups together across pages)",
    );
    assert.deepEqual(
      clusterSeq,
      [...clusterSeq].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0)),
      "cluster rows are id-DESC (tie-break deterministic)",
    );

    // ── Out-of-range page clamps to the last page (no PostgREST 416) ──────────
    const over = await sbListSignupRequestsPage(ownerA.client, tenantA, 9999, PAGE);
    assert.equal(over.page, totalPages, "an over-range ?page normalizes to the last page");
    assert.ok(over.rows.length > 0, "the clamped last page still returns rows");

    // ── A sales_rep pages zero (owner/admin-only RLS) ─────────────────────────
    const repPage = await sbListSignupRequestsPage(repA.client, tenantA, 1, PAGE);
    assert.equal(repPage.total, 0, "a sales_rep sees no signup requests (RLS)");
    assert.equal(repPage.rows.length, 0, "a sales_rep pages zero rows (RLS)");
  } finally {
    await cleanup();
  }
});

test("REAL PostgREST: the targeted approval read finds a request beyond the 1000-row window", async (t) => {
  const cfg = localConfig();
  if (!cfg || !(await reachable(cfg.url))) {
    t.skip("local Supabase stack not reachable — run `supabase start`");
    return;
  }
  const service: Client = createClient<Database>(cfg.url, cfg.service, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const tenantA = await provisionTenant(service);
  const tenantB = await provisionTenant(service);
  const ownerA = await makeMember(service, cfg, tenantA, "owner");
  const repA = await makeMember(service, cfg, tenantA, "sales_rep");

  const cleanup = async () => {
    await service.from("tenants").delete().eq("id", tenantA);
    await service.from("tenants").delete().eq("id", tenantB);
    for (const id of [ownerA.userId, repA.userId]) {
      try {
        await service.auth.admin.deleteUser(id);
      } catch {
        /* best-effort */
      }
    }
  };

  try {
    // 1100 rows ordered newest-first; the OLDEST (i=0) is our target, so it sits
    // ~100 rows BEYOND the newest-1000 window that a capped row-list returns —
    // exactly the request the old `listSignupRequests().find` would have missed.
    const N = 1100;
    const base = Date.parse("2026-01-01T00:00:00.000Z");
    const targetId = randomUUID();
    const targetName = "Beyond The Cap Grocery";
    const targetPhone = "050-1234567";
    const rows: Record<string, unknown>[] = [];
    for (let i = 0; i < N; i += 1) {
      const createdAt = new Date(base + i * 60000).toISOString();
      rows.push(
        i === 0
          ? { id: targetId, name: targetName, phone: targetPhone, created_at: createdAt }
          : { id: randomUUID(), name: `req-${i}`, created_at: createdAt },
      );
    }
    await seedRequests(service, tenantA, rows);

    // Demonstrate the OLD miss: a capped row-list (order desc) tops out at
    // max_rows and does NOT contain the oldest target row.
    const capped = await ownerA.client
      .from("customer_signup_requests")
      .select("id")
      .eq("tenant_id", tenantA)
      .order("created_at", { ascending: false });
    assert.ok(!capped.error, `capped list: ${capped.error?.message ?? ""}`);
    const cappedIds = (capped.data ?? []).map((r) => r.id);
    assert.equal(cappedIds.length, 1000, "the row-list read is capped at max_rows");
    assert.ok(
      !cappedIds.includes(targetId),
      "the target sits BEYOND the capped window (old find would miss it)",
    );

    // ── The FIX: the targeted read resolves it by id (unaffected by max_rows) ──
    const found = await sbGetSignupRequestForApproval(ownerA.client, tenantA, targetId);
    assert.deepEqual(
      found,
      { id: targetId, name: targetName, phone: targetPhone },
      "targeted read returns the request's id/name/phone regardless of the cap",
    );

    // ── Cross-tenant: A's owner cannot resolve a request in tenant B ──────────
    await seedRequests(service, tenantB, [
      { name: "b-store", created_at: new Date(base).toISOString() },
    ]);
    const bRow = await service
      .from("customer_signup_requests")
      .select("id")
      .eq("tenant_id", tenantB)
      .limit(1)
      .maybeSingle();
    assert.ok(bRow.data?.id, "seeded a tenant-B request");
    const crossOwn = await sbGetSignupRequestForApproval(
      ownerA.client,
      tenantB,
      bRow.data.id,
    );
    assert.equal(crossOwn, undefined, "cross-tenant target is invisible (RLS)");

    // ── A sales_rep cannot resolve even an in-tenant request (owner/admin RLS) ─
    const repRead = await sbGetSignupRequestForApproval(repA.client, tenantA, targetId);
    assert.equal(repRead, undefined, "a sales_rep resolves nothing (RLS)");

    // ── A well-formed but unknown id ⇒ undefined (defers to the RPC) ──────────
    const missing = await sbGetSignupRequestForApproval(
      ownerA.client,
      tenantA,
      randomUUID(),
    );
    assert.equal(missing, undefined, "unknown id ⇒ undefined (RPC stays authoritative)");

    // ── A non-UUID id ⇒ undefined WITHOUT querying (no uuid-cast error) ───────
    const bad = await sbGetSignupRequestForApproval(ownerA.client, tenantA, "not-a-uuid");
    assert.equal(bad, undefined, "non-UUID id short-circuits to undefined");
  } finally {
    await cleanup();
  }
});
