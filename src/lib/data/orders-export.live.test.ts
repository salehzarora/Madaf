/**
 * REAL local PostgREST Orders-export integration test (A1.1).
 *
 * This is NOT pgTAP. pgTAP talks straight to Postgres and therefore cannot
 * exercise the PostgREST HTTP `max_rows` ceiling or the supabase-js request path.
 * This test drives the ACTUAL production keyset reader
 * (`buildOrdersExportPageReader` + `collectExportRows`) over the LOCAL Supabase
 * HTTP API, authenticated as the tenant owner, against 1,001 seeded orders — so
 * it proves the real HTTP layer returns the complete set (no silent 1000-row
 * truncation), in deterministic order, capped=false, with every request ≤500.
 *
 * It requires the local Supabase stack (`supabase start`) and reads its URL/keys
 * from `supabase status -o json` at runtime — NEVER hardcoded, never committed.
 * If the stack is unreachable it SKIPS (so mock-mode `npm test` is unaffected).
 * It NEVER contacts hosted Supabase.
 *
 * Runner: `npm run test:orders-export-live` (needs the local stack up).
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";
import { buildOrdersExportPageReader } from "@/lib/data/supabase-reads";
import {
  collectExportRows,
  ORDERS_EXPORT_BATCH,
  ORDERS_EXPORT_CAP,
  parseOrdersQuery,
  type OrdersExportCursor,
} from "@/lib/orders-query";

type Client = SupabaseClient<Database>;
type LocalConfig = { url: string; anon: string; service: string } | null;

/** Read the LOCAL stack's URL + keys from the CLI (never hardcoded). Returns
 * null if the CLI/stack is unavailable so the test can skip cleanly. */
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
    // Any HTTP answer (even 400/404) means PostgREST is up.
    await fetch(`${url}/rest/v1/`, { method: "HEAD" });
    return true;
  } catch {
    return false;
  }
}

type Cfg = NonNullable<LocalConfig>;

/** Provision a DISPOSABLE owner + tenant + membership on the LOCAL stack and
 * return an RLS-scoped AUTHENTICATED (owner) client plus a cleanup. The tenant
 * cascades to its orders + membership on delete. service_role is used ONLY here
 * for test seeding — never for the export READ, which uses the owner client. */
async function provisionOwnerTenant(service: Client, cfg: Cfg) {
  const tenantId = randomUUID();
  const email = `export-live-${randomUUID()}@madaf.test`;
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
    name_ar: "تصدير",
    name_he: "ייצוא",
    name_en: "Export Live",
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

/** Insert `orders` in ≤500-row chunks via the service client (a write; not
 * subject to the read max_rows). Asserts each chunk succeeds. */
async function seedOrders(
  service: Client,
  orders: Record<string, unknown>[],
): Promise<void> {
  for (let i = 0; i < orders.length; i += 500) {
    const oIns = await service.from("orders").insert(orders.slice(i, i + 500) as never);
    assert.ok(!oIns.error, `orders insert: ${oIns.error?.message ?? ""}`);
  }
}

const SEED_COUNT = 1001; // deliberately > PostgREST max_rows (1000)

test("REAL PostgREST: a 1,001-order export returns them all, ordered, capped=false, ≤500/req", async (t) => {
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
    // ── Seed 1,001 orders with DISTINCT, strictly-increasing created_at ───────
    const base = Date.parse("2026-06-01T00:00:00.000Z");
    await seedOrders(
      service,
      Array.from({ length: SEED_COUNT }, (_, i) => ({
        tenant_id: tenantId,
        order_number: `EL-${String(i).padStart(5, "0")}`,
        public_ref: `MDF-EL${String(i).padStart(5, "0")}`,
        status: "new",
        source: "sales_visit",
        created_at: new Date(base + i * 60000).toISOString(),
      })),
    );

    // ── Drive the PRODUCTION reader over the LIVE HTTP API ────────────────────
    const query = parseOrdersQuery({}); // no filters
    const productionReader = buildOrdersExportPageReader(
      owner,
      tenantId,
      query,
      "Asia/Jerusalem",
    );
    // Wrap ONLY to record each real request's limit — the reader itself is the
    // unmodified production one, so this proves the true per-request page size.
    const requestedLimits: number[] = [];
    const reader = (cursor: OrdersExportCursor | null, limit: number) => {
      requestedLimits.push(limit);
      return productionReader(cursor, limit);
    };

    const rows = await collectExportRows(reader, ORDERS_EXPORT_CAP + 1);

    // ── Assert: complete, unique, ordered, capped=false, ≤500 per request ─────
    assert.equal(rows.length, SEED_COUNT, "all 1,001 orders returned (no HTTP truncation)");
    assert.equal(new Set(rows.map((r) => r.id)).size, SEED_COUNT, "1,001 unique ids");
    assert.equal(rows.length > ORDERS_EXPORT_CAP, false, "capped=false");
    // Deterministic created_at DESC, id DESC across the whole set.
    for (let i = 1; i < rows.length; i += 1) {
      const a = rows[i - 1];
      const b = rows[i];
      const ok =
        a.created_at > b.created_at ||
        (a.created_at === b.created_at && a.id > b.id);
      assert.ok(ok, `order break at ${i}: ${a.created_at}/${a.id} !>= ${b.created_at}/${b.id}`);
    }
    // The newest seeded order is EL-01000; it must be first.
    assert.equal((rows[0] as { order_number: string }).order_number, "EL-01000");
    // No single HTTP request asked for more than the batch bound.
    assert.ok(requestedLimits.length >= 3, "traversed multiple pages");
    assert.ok(
      requestedLimits.every((l) => l <= ORDERS_EXPORT_BATCH),
      `every request ≤ ${ORDERS_EXPORT_BATCH}: got ${requestedLimits.join(",")}`,
    );

    // ── SEARCH + KEYSET compose (the two `.or()` groups AND, over live HTTP) ──
    // `%EL-00%` matches EL-00000..EL-00999 (1,000 rows, spanning 2 keyset pages)
    // and EXCLUDES EL-01000. If the keyset `.or()` and the search `.or()` wrongly
    // OR-merged, EL-01000 would leak OR the keyset would be defeated. This proves
    // they AND: exactly the 1,000 matching rows, complete, ordered, EL-01000 absent.
    const searchReader = buildOrdersExportPageReader(
      owner,
      tenantId,
      parseOrdersQuery({ q: "EL-00" }),
      "Asia/Jerusalem",
    );
    const searchRows = (await collectExportRows(
      searchReader,
      ORDERS_EXPORT_CAP + 1,
    )) as { id: string; order_number: string }[];
    assert.equal(searchRows.length, 1000, "search AND keyset returns exactly the 1,000 matches");
    assert.equal(new Set(searchRows.map((r) => r.id)).size, 1000, "no duplicate under search");
    assert.ok(
      searchRows.every((r) => r.order_number.includes("EL-00")),
      "every returned row actually matches the search (no OR-widening leak)",
    );
    assert.ok(
      !searchRows.some((r) => r.order_number === "EL-01000"),
      "the non-matching EL-01000 is excluded (keyset not defeated by the search .or)",
    );
  } finally {
    await cleanup();
  }
});

test("REAL PostgREST: >500 SAME-created_at orders traverse the id tie-break across a page boundary", async (t) => {
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
    // ── Seed 600 orders ALL sharing an IDENTICAL created_at, with valid UUIDs ──
    // 600 > 500 → the export MUST cross at least one keyset page boundary, and
    // because every created_at is equal the id tie-break is the ONLY thing that
    // orders them and drives the cursor. Explicit random UUID ids (the real PK
    // shape) exercise Postgres's byte-wise uuid comparison, not a synthetic label.
    const SAME_TS = "2026-06-01T00:00:00.000Z";
    const SAME_COUNT = 600;
    const orders = Array.from({ length: SAME_COUNT }, (_, i) => ({
      id: randomUUID(),
      tenant_id: tenantId,
      order_number: `TB-${String(i).padStart(5, "0")}`,
      public_ref: `MDF-TB${String(i).padStart(5, "0")}`,
      status: "new",
      source: "sales_visit",
      created_at: SAME_TS,
    }));
    await seedOrders(service, orders);

    // ── AUTHORITATIVE expected order — FROM THE DB, not an invented JS compare ──
    // A single authed query (600 < max_rows) returns the canonical
    // `created_at DESC, id DESC` sequence Postgres itself produces. This is the
    // oracle the export must reproduce; no JavaScript uuid ordering is invented.
    const expected = await owner
      .from("orders")
      .select("id")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });
    assert.ok(!expected.error, `expected-order query: ${expected.error?.message ?? ""}`);
    const expectedIds = (expected.data as { id: string }[]).map((r) => r.id);
    assert.equal(expectedIds.length, SAME_COUNT, "the DB returns all 600 in canonical order");

    // ── Traverse via the PRODUCTION reader + collector over live HTTP ─────────
    const requestedLimits: number[] = [];
    const productionReader = buildOrdersExportPageReader(
      owner,
      tenantId,
      parseOrdersQuery({}),
      "Asia/Jerusalem",
    );
    const reader = (cursor: OrdersExportCursor | null, limit: number) => {
      requestedLimits.push(limit);
      return productionReader(cursor, limit);
    };
    const rows = await collectExportRows(reader, ORDERS_EXPORT_CAP + 1);
    const gotIds = rows.map((r) => r.id);

    // The export must reproduce the DB's authoritative order EXACTLY — proving the
    // keyset id tie-break matches Postgres uuid comparison ACROSS the 500-row seam,
    // with no skip and no duplicate.
    assert.deepEqual(
      gotIds,
      expectedIds,
      "export order == Postgres created_at DESC, id DESC (uuid tie-break, across the page boundary)",
    );
    assert.equal(new Set(gotIds).size, SAME_COUNT, "no duplicate across the tie-break page boundary");
    assert.equal(gotIds.length, SAME_COUNT, "no skipped row");
    // It genuinely crossed a page boundary (600 > 500 → ≥ 2 pages), each ≤ 500.
    assert.ok(requestedLimits.length >= 2, "traversed at least one keyset page boundary");
    assert.ok(
      requestedLimits.every((l) => l <= ORDERS_EXPORT_BATCH),
      `every request ≤ ${ORDERS_EXPORT_BATCH}: got ${requestedLimits.join(",")}`,
    );
    // Every returned id is a valid UUID (real PK shape, not a synthetic label).
    const UUID =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    assert.ok(gotIds.every((id) => UUID.test(id)), "all returned ids are valid UUIDs");
  } finally {
    await cleanup();
  }
});
