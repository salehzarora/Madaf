/**
 * REAL local-Supabase test for the Dashboard's pending-signup count
 * (PILOT-READINESS-BATCH-C · P2 correction).
 *
 * The Dashboard used to load signup-request ROWS (`listSignupRequests()`, capped
 * at PostgREST max_rows = 1000) and filter `status === "pending"` in JS. Once a
 * tenant crosses 1000 requests and newer PROCESSED rows displace older PENDING
 * ones out of the returned window, that JS filter UNDERCOUNTS. The fix is an
 * exact server-side count (`sbCountPendingSignupRequests`, `count:"exact"` +
 * `head:true`), which this test exercises over live PostgREST, under RLS:
 *   1. it uses the REAL production count query (no duplicated logic);
 *   2. with >1000 mixed requests where the old row-list would undercount, it
 *      returns the exact pending total (and we demonstrate the old undercount);
 *   3. cross-tenant requests are excluded;
 *   4. a sales_rep (unauthorized for signups) counts zero — the RLS contract.
 *
 * Requires the local Supabase stack; reads its URL/keys from
 * `supabase status -o json` at runtime — NEVER hardcoded. Skips if unreachable.
 * NEVER contacts hosted Supabase.
 *
 * Runner: `npm run test:signup-count-live` (needs the local stack up).
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";
import { sbCountPendingSignupRequests } from "@/lib/data/customer-signup";

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

/** Create a disposable user with `role` in a (new or given) tenant and return an
 * authenticated, RLS-scoped client for them. */
async function makeMember(
  service: Client,
  cfg: Cfg,
  tenantId: string,
  role: "owner" | "admin" | "sales_rep",
): Promise<{ client: Client; userId: string }> {
  const email = `signup-${role}-${randomUUID()}@madaf.test`;
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
    name_ar: "تسجيل",
    name_he: "הרשמה",
    name_en: "Signup Live",
  });
  assert.ok(!ins.error, `tenant insert: ${ins.error?.message ?? ""}`);
  return tenantId;
}

/** Seed one signup link + `requests` rows in ≤500-row chunks (service client). */
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

test("REAL PostgREST: exact pending count is correct above the 1000-row list ceiling", async (t) => {
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
  const ownerB = await makeMember(service, cfg, tenantB, "owner");

  const cleanup = async () => {
    await service.from("tenants").delete().eq("id", tenantA);
    await service.from("tenants").delete().eq("id", tenantB);
    for (const id of [ownerA.userId, repA.userId, ownerB.userId]) {
      try {
        await service.auth.admin.deleteUser(id);
      } catch {
        /* best-effort */
      }
    }
  };

  try {
    // Tenant A: 600 PENDING (OLDER) + 600 PROCESSED (NEWER, approved). Ordered
    // created_at desc, the newest 1000 = 600 processed + 400 pending, so the old
    // list-then-filter approach omits 200 of the oldest pending rows.
    const base = Date.parse("2026-01-01T00:00:00.000Z");
    const rowsA: Record<string, unknown>[] = [];
    for (let i = 0; i < 600; i += 1) {
      rowsA.push({
        name: `pending-${i}`,
        created_at: new Date(base + i * 60000).toISOString(), // older
      });
    }
    for (let i = 0; i < 600; i += 1) {
      const at = new Date(base + (600 + i) * 60000).toISOString(); // newer
      rowsA.push({ name: `approved-${i}`, created_at: at, approved_at: at });
    }
    await seedRequests(service, tenantA, rowsA);

    // Tenant B: 5 pending (cross-tenant fixture).
    await seedRequests(
      service,
      tenantB,
      Array.from({ length: 5 }, (_, i) => ({
        name: `b-pending-${i}`,
        created_at: new Date(base + i * 60000).toISOString(),
      })),
    );

    // ── Demonstrate the OLD undercount: a row-list read is capped at max_rows ──
    const list = await ownerA.client
      .from("customer_signup_requests")
      .select("approved_at, rejected_at")
      .eq("tenant_id", tenantA)
      .order("created_at", { ascending: false });
    assert.ok(!list.error, `list: ${list.error?.message ?? ""}`);
    const listed = (list.data ?? []) as {
      approved_at: string | null;
      rejected_at: string | null;
    }[];
    assert.equal(listed.length, 1000, "the row-list read is capped at max_rows");
    const oldPending = listed.filter(
      (r) => r.approved_at === null && r.rejected_at === null,
    ).length;
    assert.ok(
      oldPending < 600,
      `the OLD list+filter undercounts (${oldPending} < 600 true pending)`,
    );

    // ── The FIX: the exact server-side count is complete ──────────────────────
    const exact = await sbCountPendingSignupRequests(ownerA.client, tenantA);
    assert.equal(exact, 600, "exact pending count is correct above max_rows");

    // ── Cross-tenant: A's owner cannot count B's pending requests ─────────────
    const spoof = await sbCountPendingSignupRequests(ownerA.client, tenantB);
    assert.equal(spoof, 0, "cross-tenant pending requests are excluded (RLS)");
    const bOwn = await sbCountPendingSignupRequests(ownerB.client, tenantB);
    assert.equal(bOwn, 5, "B's owner sees only B's 5 pending");

    // ── Unauthorized role: a sales_rep counts zero (owner/admin-only RLS) ─────
    const repCount = await sbCountPendingSignupRequests(repA.client, tenantA);
    assert.equal(repCount, 0, "a sales_rep cannot count signup requests (RLS)");
  } finally {
    await cleanup();
  }
});
