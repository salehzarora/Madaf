/**
 * REAL local-Supabase test for the Movements order-reference lookup
 * (PILOT-READINESS-BATCH-C · C2).
 *
 * The Movements page used to hydrate order references from a full `listOrders()`
 * map, which PostgREST caps at max_rows (1000). An order OLDER than the newest
 * 1000 was absent from that map, so a movement referencing it showed a blank
 * reference even though the order exists. The fix resolves references with a
 * TARGETED, chunked `.in("id", …)` read bounded by the (already bounded)
 * movement result set. This test proves — over live PostgREST, under RLS — that:
 *   1. an order beyond the first 1000 (a full-list read would drop) STILL
 *      resolves via the targeted lookup (position-in-history is irrelevant);
 *   2. duplicate ids are deduped; null / non-uuid ids trigger no lookup;
 *   3. a missing order id resolves to nothing (no crash);
 *   4. a cross-tenant order id is never exposed (RLS + tenant filter);
 *   5. > one chunk (chunk size 200) resolves completely.
 *
 * It requires the local Supabase stack and reads its URL/keys from
 * `supabase status -o json` at runtime — NEVER hardcoded, never committed. If
 * the stack is unreachable it SKIPS (so mock-mode `npm test` is unaffected). It
 * NEVER contacts hosted Supabase.
 *
 * Runner: `npm run test:movement-order-refs-live` (needs the local stack up).
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";
import { sbOrderRefsForIds } from "@/lib/data/supabase-reads";

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

/** Provision a disposable owner + tenant and return an RLS-scoped owner client. */
async function provisionOwnerTenant(service: Client, cfg: Cfg) {
  const tenantId = randomUUID();
  const email = `movref-${randomUUID()}@madaf.test`;
  const password = `Pw-${randomUUID()}`;
  const created = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  assert.ok(!created.error, `createUser: ${created.error?.message ?? ""}`);
  const userId = created.data.user!.id;
  const tIns = await service.from("tenants").insert({
    id: tenantId,
    name_ar: "حركات",
    name_he: "תנועות",
    name_en: "Movements Live",
  });
  assert.ok(!tIns.error, `tenant insert: ${tIns.error?.message ?? ""}`);
  const mIns = await service
    .from("tenant_users")
    .insert({ tenant_id: tenantId, user_id: userId, role: "owner" });
  assert.ok(!mIns.error, `membership insert: ${mIns.error?.message ?? ""}`);
  const owner: Client = createClient<Database>(cfg.url, cfg.anon, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const signIn = await owner.auth.signInWithPassword({ email, password });
  assert.ok(!signIn.error, `signIn: ${signIn.error?.message ?? ""}`);
  const cleanup = async () => {
    await service.from("tenants").delete().eq("id", tenantId);
    try {
      await service.auth.admin.deleteUser(userId);
    } catch {
      /* best-effort */
    }
  };
  return { tenantId, owner, cleanup };
}

/** Insert orders in ≤500-row chunks (a write; not subject to the read ceiling). */
async function seedOrders(
  service: Client,
  orders: Record<string, unknown>[],
): Promise<void> {
  for (let i = 0; i < orders.length; i += 500) {
    const ins = await service.from("orders").insert(orders.slice(i, i + 500) as never);
    assert.ok(!ins.error, `orders insert: ${ins.error?.message ?? ""}`);
  }
}

test("REAL PostgREST: an order beyond the first 1000 still resolves via the targeted lookup", async (t) => {
  const cfg = localConfig();
  if (!cfg || !(await reachable(cfg.url))) {
    t.skip("local Supabase stack not reachable — run `supabase start`");
    return;
  }
  const service: Client = createClient<Database>(cfg.url, cfg.service, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { tenantId, owner, cleanup } = await provisionOwnerTenant(service, cfg);

  try {
    // Seed 1,001 orders with strictly-increasing created_at. The OLDEST (index 0)
    // sorts LAST by created_at desc, so a full-list read capped at 1000 drops it.
    const base = Date.parse("2026-01-01T00:00:00.000Z");
    const oldestId = randomUUID();
    const orders = Array.from({ length: 1001 }, (_, i) => ({
      id: i === 0 ? oldestId : randomUUID(),
      tenant_id: tenantId,
      order_number: `OM-${String(i).padStart(5, "0")}`,
      public_ref: `MDF-OM${String(i).padStart(5, "0")}`,
      status: "new",
      source: "sales_visit",
      created_at: new Date(base + i * 60000).toISOString(),
    }));
    await seedOrders(service, orders);

    // Contrast: the OLD full-list shape (order by created_at desc, no range) is
    // capped at 1000 and does NOT contain the oldest order — the exact bug.
    const fullList = await owner
      .from("orders")
      .select("id")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false });
    assert.ok(!fullList.error, `full list: ${fullList.error?.message ?? ""}`);
    assert.equal((fullList.data ?? []).length, 1000, "the full-list read is capped at 1000");
    assert.ok(
      !(fullList.data ?? []).some((r) => (r as { id: string }).id === oldestId),
      "the oldest order is BEYOND the capped full list (the defect)",
    );

    // The FIX: the targeted lookup resolves it regardless of chronological position.
    const refs = await sbOrderRefsForIds(owner, tenantId, [oldestId]);
    assert.equal(refs.size, 1, "the targeted lookup resolves exactly one order");
    assert.equal(refs.get(oldestId)?.number, "OM-00000", "…the correct order number");
    assert.equal(refs.get(oldestId)?.publicRef, "MDF-OM00000", "…and its public ref");
  } finally {
    await cleanup();
  }
});

test("REAL PostgREST: dedup, null/non-uuid skipping, missing id, and >1 chunk", async (t) => {
  const cfg = localConfig();
  if (!cfg || !(await reachable(cfg.url))) {
    t.skip("local Supabase stack not reachable — run `supabase start`");
    return;
  }
  const service: Client = createClient<Database>(cfg.url, cfg.service, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { tenantId, owner, cleanup } = await provisionOwnerTenant(service, cfg);

  try {
    // 450 orders → forces > 2 chunks at the 200-id chunk size.
    const base = Date.parse("2026-02-01T00:00:00.000Z");
    const ids = Array.from({ length: 450 }, () => randomUUID());
    await seedOrders(
      service,
      ids.map((id, i) => ({
        id,
        tenant_id: tenantId,
        order_number: `CH-${String(i).padStart(5, "0")}`,
        public_ref: `MDF-CH${String(i).padStart(5, "0")}`,
        status: "new",
        source: "sales_visit",
        created_at: new Date(base + i * 60000).toISOString(),
      })),
    );

    // Chunking: all 450 resolve across multiple ≤200-id requests.
    const chunked = await sbOrderRefsForIds(owner, tenantId, ids);
    assert.equal(chunked.size, 450, "every id resolved across chunk boundaries");

    // Dedup: the same id repeated resolves once.
    const deduped = await sbOrderRefsForIds(owner, tenantId, [ids[0], ids[0], ids[0]]);
    assert.equal(deduped.size, 1, "duplicate ids are deduped");

    // Null / non-uuid / missing: no crash, no fabricated entries.
    const missingId = randomUUID();
    const mixed = await sbOrderRefsForIds(owner, tenantId, [
      ids[1],
      null,
      "not-a-uuid",
      missingId,
    ]);
    assert.equal(mixed.size, 1, "only the one valid, existing id resolves");
    assert.ok(mixed.has(ids[1]), "…the real order");
    assert.ok(!mixed.has(missingId), "a missing order id yields no entry");

    // Empty input → no query, empty map.
    const empty = await sbOrderRefsForIds(owner, tenantId, [null, "bad"]);
    assert.equal(empty.size, 0, "no valid ids → empty result (no useless lookup)");
  } finally {
    await cleanup();
  }
});

test("REAL PostgREST: a cross-tenant order id is never exposed", async (t) => {
  const cfg = localConfig();
  if (!cfg || !(await reachable(cfg.url))) {
    t.skip("local Supabase stack not reachable — run `supabase start`");
    return;
  }
  const service: Client = createClient<Database>(cfg.url, cfg.service, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const a = await provisionOwnerTenant(service, cfg);
  const b = await provisionOwnerTenant(service, cfg);

  try {
    // An order that belongs to tenant B.
    const bOrderId = randomUUID();
    await seedOrders(service, [
      {
        id: bOrderId,
        tenant_id: b.tenantId,
        order_number: "B-SECRET-1",
        public_ref: "MDF-BSECRET",
        status: "new",
        source: "sales_visit",
        created_at: "2026-03-01T00:00:00.000Z",
      },
    ]);

    // Tenant A's owner asks for B's order id — under A's tenant AND under B's:
    // RLS + the explicit tenant filter both refuse it.
    const asOwnTenant = await sbOrderRefsForIds(a.owner, a.tenantId, [bOrderId]);
    assert.equal(asOwnTenant.size, 0, "B's order is not resolved under A's tenant");
    const spoofTenant = await sbOrderRefsForIds(a.owner, b.tenantId, [bOrderId]);
    assert.equal(spoofTenant.size, 0, "…nor by passing B's tenant id (RLS is authoritative)");
  } finally {
    await a.cleanup();
    await b.cleanup();
  }
});
