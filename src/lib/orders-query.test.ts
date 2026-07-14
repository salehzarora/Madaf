/**
 * Orders server-side search/pagination test suite (M8F.1). Exercises the SAME
 * production functions the page, links, export, and data layer use — the shared
 * URL parser/serializer (`orders-query.ts`) and the mock-mode data layer
 * (`data/orders.ts`, which mirrors the supabase filter/sort/paginate contract).
 * Pure + zero-env: runs in mock mode with no Supabase.
 *
 * Runner: `npm run test:orders-search` (tsx → node:test).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  clampExportLimit,
  collectExportRows,
  hasActiveFilters,
  tenantToday,
  nextCalendarDay,
  ORDERS_EXPORT_BATCH,
  ORDERS_EXPORT_CAP,
  ORDERS_MAX_PAGE_SIZE,
  ORDERS_PAGE_SIZE,
  orderMatchesSearch,
  orderSourceFacet,
  ordersQueryToParams,
  parseOrdersQuery,
  toggleStatusFilter,
  totalPagesFor,
  withFilterChange,
  type OrdersQuery,
} from "./orders-query";
// The reverse conversion (calendar date → the UTC instant it begins at) is
// server-only — see lib/tenant-day.ts.
import { tenantDayStartUtcIso } from "./tenant-day";
import { listOrdersForExport, searchOrders } from "./data/orders";
import { customers as mockCustomers, orders as mockOrders } from "./mock";

const MOCK_TOTAL = mockOrders.length;
const readSrc = (rel: string): string =>
  readFileSync(join(process.cwd(), "src", rel), "utf8");

// ── 1. Default query parsing ───────────────────────────────────────────────
test("parseOrdersQuery: defaults for an empty URL", () => {
  const q = parseOrdersQuery({});
  assert.deepEqual(q, {
    // M8H.2: `none` is the legitimate unfiltered state — and it is DISTINCT from
    // `invalid`, which must never be allowed to query (Codex F04).
    dateFilter: "none",
    search: "",
    statuses: [],
    source: "all",
    customerId: null,
    dateFrom: null,
    dateTo: null,
    page: 1,
    pageSize: ORDERS_PAGE_SIZE,
  });
});

// ── 2. Invalid page normalization ──────────────────────────────────────────
test("parseOrdersQuery: invalid/out-of-bounds page normalizes to >= 1", () => {
  assert.equal(parseOrdersQuery({ page: "0" }).page, 1);
  assert.equal(parseOrdersQuery({ page: "-5" }).page, 1);
  assert.equal(parseOrdersQuery({ page: "abc" }).page, 1);
  assert.equal(parseOrdersQuery({ page: "" }).page, 1);
  assert.equal(parseOrdersQuery({ page: "3" }).page, 3);
  // Absurd page is clamped (no unbounded offset).
  assert.ok(parseOrdersQuery({ page: "99999999999" }).page <= 1_000_000);
});

// ── 3. Invalid page-size normalization ─────────────────────────────────────
test("parseOrdersQuery: page size is bounded", () => {
  assert.equal(parseOrdersQuery({ pageSize: "0" }).pageSize, 1);
  assert.equal(parseOrdersQuery({ pageSize: "-1" }).pageSize, 1);
  assert.equal(parseOrdersQuery({ pageSize: "abc" }).pageSize, ORDERS_PAGE_SIZE);
  assert.equal(parseOrdersQuery({ pageSize: "25" }).pageSize, 25);
  assert.equal(parseOrdersQuery({ pageSize: "99999" }).pageSize, ORDERS_MAX_PAGE_SIZE);
});

// ── 4. Search trimming ─────────────────────────────────────────────────────
test("parseOrdersQuery: search is trimmed and length-capped", () => {
  assert.equal(parseOrdersQuery({ q: "  hello  " }).search, "hello");
  assert.equal(parseOrdersQuery({ q: "" }).search, "");
  assert.equal(parseOrdersQuery({ q: "x".repeat(500) }).search.length, 120);
});

// ── 5. Status parsing ──────────────────────────────────────────────────────
test("parseOrdersQuery: status group parses, filters junk, dedupes", () => {
  assert.deepEqual(parseOrdersQuery({ status: "confirmed,preparing" }).statuses, [
    "confirmed",
    "preparing",
  ]);
  assert.deepEqual(parseOrdersQuery({ status: "new, bogus ,new" }).statuses, ["new"]);
  assert.deepEqual(parseOrdersQuery({ status: "" }).statuses, []);
  assert.deepEqual(parseOrdersQuery({ status: "nope" }).statuses, []);
});

// ── 6/7. Source + guest facet parsing ──────────────────────────────────────
test("parseOrdersQuery: source facet incl. legacy guest=true alias", () => {
  assert.equal(parseOrdersQuery({ source: "sales_visit" }).source, "sales_visit");
  assert.equal(parseOrdersQuery({ source: "shop_link" }).source, "shop_link");
  assert.equal(parseOrdersQuery({ source: "guest" }).source, "guest");
  assert.equal(parseOrdersQuery({ guest: "true" }).source, "guest"); // legacy alias
  assert.equal(parseOrdersQuery({ guest: "true", source: "sales_visit" }).source, "guest");
  assert.equal(parseOrdersQuery({ source: "bogus" }).source, "all");
  assert.equal(parseOrdersQuery({}).source, "all");
});

// ── 8. Customer id validation ──────────────────────────────────────────────
test("parseOrdersQuery: customer id is validated (plausible id only)", () => {
  assert.equal(parseOrdersQuery({ customer: "c02" }).customerId, "c02");
  assert.equal(parseOrdersQuery({ customer: "cc000000-0000-4000-8000-000000000001" }).customerId, "cc000000-0000-4000-8000-000000000001");
  assert.equal(parseOrdersQuery({ customer: "bad id!" }).customerId, null);
  assert.equal(parseOrdersQuery({ customer: "" }).customerId, null);
  assert.equal(parseOrdersQuery({ customer: "x".repeat(80) }).customerId, null);
});

// ── 9. Date-range parsing ──────────────────────────────────────────────────
test("parseOrdersQuery: date bounds accept valid YYYY-MM-DD only", () => {
  const q = parseOrdersQuery({ from: "2026-07-01", to: "2026-07-31" });
  assert.equal(q.dateFrom, "2026-07-01");
  assert.equal(q.dateTo, "2026-07-31");
  assert.equal(parseOrdersQuery({ from: "2026/07/01" }).dateFrom, null);
  assert.equal(parseOrdersQuery({ from: "not-a-date" }).dateFrom, null);
  assert.equal(parseOrdersQuery({ to: "2026-13-40" }).dateTo, null); // impossible calendar date
});

// ── 10. Changing a filter resets to page 1 ─────────────────────────────────
test("withFilterChange: any filter change resets page to 1", () => {
  const q: OrdersQuery = { ...parseOrdersQuery({ page: "5" }), statuses: ["new"] };
  assert.equal(q.page, 5);
  assert.equal(withFilterChange(q, { source: "guest" }).page, 1);
  assert.equal(withFilterChange(q, { search: "acme" }).page, 1);
  // The changed field is applied; others preserved.
  const changed = withFilterChange(q, { source: "guest" });
  assert.equal(changed.source, "guest");
  assert.deepEqual(changed.statuses, ["new"]);
});

// ── 11. Pagination URLs preserve filters ───────────────────────────────────
test("ordersQueryToParams: pagination keeps all active filters", () => {
  const q = parseOrdersQuery({
    q: "acme",
    status: "confirmed,preparing",
    source: "shop_link",
    customer: "c02",
    from: "2026-07-01",
    to: "2026-07-31",
  });
  const params = ordersQueryToParams(q, { page: 3 });
  assert.equal(params.get("q"), "acme");
  assert.equal(params.get("status"), "confirmed,preparing");
  assert.equal(params.get("source"), "shop_link");
  assert.equal(params.get("customer"), "c02");
  assert.equal(params.get("from"), "2026-07-01");
  assert.equal(params.get("to"), "2026-07-31");
  assert.equal(params.get("page"), "3");
  // Defaults are omitted (page 1, default page size, empty filters).
  assert.equal(ordersQueryToParams(parseOrdersQuery({})).toString(), "");
  assert.equal(ordersQueryToParams(q, { page: 1 }).has("page"), false);
});

// ── 12. Dashboard deep-link params remain supported ────────────────────────
test("parseOrdersQuery: dashboard deep links still parse", () => {
  // ?status=new (needs-confirmation card)
  assert.deepEqual(parseOrdersQuery({ status: "new" }).statuses, ["new"]);
  // ?status=confirmed,preparing (preparing card)
  assert.deepEqual(parseOrdersQuery({ status: "confirmed,preparing" }).statuses, [
    "confirmed",
    "preparing",
  ]);
  // ?guest=true&status=new (guest-orders card)
  const g = parseOrdersQuery({ guest: "true", status: "new" });
  assert.equal(g.source, "guest");
  assert.deepEqual(g.statuses, ["new"]);
});

// ── 20. URL state round-trips (locale-independent) ─────────────────────────
test("URL state round-trips through parse → serialize → parse", () => {
  const original = parseOrdersQuery({
    q: "store",
    status: "delivered",
    source: "guest",
    customer: "c05",
    from: "2026-06-01",
    to: "2026-06-30",
    page: "4",
    pageSize: "25",
  });
  const reparsed = parseOrdersQuery(
    Object.fromEntries(ordersQueryToParams(original)),
  );
  assert.deepEqual(reparsed, original); // no locale in the URL state; stable
});

// ── hasActiveFilters ───────────────────────────────────────────────────────
test("hasActiveFilters: true only when a non-pagination filter is set", () => {
  assert.equal(hasActiveFilters(parseOrdersQuery({})), false);
  assert.equal(hasActiveFilters(parseOrdersQuery({ page: "3" })), false);
  assert.equal(hasActiveFilters(parseOrdersQuery({ q: "x" })), true);
  assert.equal(hasActiveFilters(parseOrdersQuery({ status: "new" })), true);
  assert.equal(hasActiveFilters(parseOrdersQuery({ customer: "c02" })), true);
});

// ── orderSourceFacet classification ────────────────────────────────────────
test("orderSourceFacet mirrors the DB predicates", () => {
  assert.equal(orderSourceFacet({ source: "remote_customer", customerId: "", customerSnapshot: { guest: true } }), "guest");
  assert.equal(orderSourceFacet({ source: "remote_customer", customerId: "c1" }), "shop_link");
  assert.equal(orderSourceFacet({ source: "sales_visit", customerId: "c1" }), "sales_visit");
  assert.equal(orderSourceFacet({ source: undefined, customerId: "c1" }), "sales_visit");
});

// ── 18. total count / total pages ──────────────────────────────────────────
test("totalPagesFor: exact page math (>= 1)", () => {
  assert.equal(totalPagesFor(0, 50), 1);
  assert.equal(totalPagesFor(50, 50), 1);
  assert.equal(totalPagesFor(51, 50), 2);
  assert.equal(totalPagesFor(100, 50), 2);
  assert.equal(totalPagesFor(101, 50), 3);
  assert.equal(totalPagesFor(5, 2), 3);
});

// ── 15. No-filter list returns page 1 + exact total ────────────────────────
test("searchOrders (mock): no filter returns page 1 + exact total", async () => {
  const res = await searchOrders(parseOrdersQuery({}));
  assert.equal(res.total, MOCK_TOTAL);
  assert.equal(res.page, 1);
  assert.equal(res.pageSize, ORDERS_PAGE_SIZE);
  assert.equal(res.totalPages, totalPagesFor(MOCK_TOTAL, ORDERS_PAGE_SIZE));
  assert.equal(res.rows.length, Math.min(MOCK_TOTAL, ORDERS_PAGE_SIZE));
});

// ── 17. Pagination returns ONLY the requested page ─────────────────────────
test("searchOrders (mock): pagination returns only the requested page", async () => {
  const p1 = await searchOrders(parseOrdersQuery({ pageSize: "2", page: "1" }));
  const p2 = await searchOrders(parseOrdersQuery({ pageSize: "2", page: "2" }));
  assert.equal(p1.rows.length, 2);
  assert.equal(p1.total, MOCK_TOTAL);
  assert.equal(p1.pageSize, 2);
  // Page 2 rows are DIFFERENT from page 1 (no overlap, no dup).
  const p1ids = new Set(p1.rows.map((r) => r.id));
  assert.ok(p2.rows.every((r) => !p1ids.has(r.id)));
});

// ── 13. Deterministic sort (created_at DESC, then id DESC) ──────────────────
test("searchOrders (mock): deterministic newest-first sort", async () => {
  const res = await searchOrders(parseOrdersQuery({ pageSize: "100" }));
  for (let i = 1; i < res.rows.length; i++) {
    const prev = res.rows[i - 1];
    const cur = res.rows[i];
    const byDate = cur.createdAt.localeCompare(prev.createdAt);
    // Non-increasing created_at; ties broken by DESC id.
    assert.ok(byDate < 0 || (byDate === 0 && cur.id.localeCompare(prev.id) < 0));
  }
});

// ── 19. Out-of-range page normalizes to the last page (no empty crash) ─────
test("searchOrders (mock): out-of-range page normalizes to last page", async () => {
  const res = await searchOrders(parseOrdersQuery({ pageSize: "2", page: "999" }));
  assert.equal(res.total, MOCK_TOTAL);
  assert.equal(res.page, res.totalPages);
  assert.ok(res.rows.length > 0); // last page has rows (total > 0)
});

// ── 16. Combined search + status filter ────────────────────────────────────
test("searchOrders (mock): combined search + status narrows correctly", async () => {
  // Every mock order number starts with "MDF-"; searching it matches all.
  const all = await searchOrders(parseOrdersQuery({ q: "MDF", pageSize: "100" }));
  assert.equal(all.total, MOCK_TOTAL);
  // A status that no order has → zero; a present status → subset.
  const newOnly = await searchOrders(parseOrdersQuery({ status: "new", pageSize: "100" }));
  assert.ok(newOnly.total <= MOCK_TOTAL);
  assert.ok(newOnly.rows.every((r) => r.status === "new"));
  // A search term matching nothing → zero rows, page 1, one (empty) page.
  const none = await searchOrders(parseOrdersQuery({ q: "zzz-no-such-order-zzz" }));
  assert.equal(none.total, 0);
  assert.equal(none.rows.length, 0);
  assert.equal(none.page, 1);
  assert.equal(none.totalPages, 1);
});

// ── 14 + 23. Export ignores pagination but preserves filters ───────────────
test("listOrdersForExport (mock): full filtered set, NOT the current page", async () => {
  // A tiny page size must NOT limit the export.
  const q = parseOrdersQuery({ pageSize: "1", page: "1" });
  const page = await searchOrders(q);
  const exportRows = await listOrdersForExport(q, 5000);
  assert.equal(page.rows.length, 1); // list is page-limited
  assert.equal(exportRows.length, MOCK_TOTAL); // export is NOT
  // Filters ARE applied to the export.
  const statusFiltered = await listOrdersForExport(
    parseOrdersQuery({ status: "new" }),
    5000,
  );
  assert.ok(statusFiltered.every((r) => r.status === "new"));
  // The export cap truncates.
  assert.equal((await listOrdersForExport(parseOrdersQuery({}), 2)).length, 2);
});

// ══ Export KEYSET paging (A1.1) — the PRODUCTION collectExportRows ══════════
// The collector now traverses by a stable (created_at DESC, id DESC) keyset, not
// offset — so a concurrent filter change cannot skip a still-matching row. The
// fake reader below models a real filtered DESC result set over a MUTABLE dataset
// (so a test can remove/insert rows BETWEEN pages) and honours the keyset cursor
// exactly like the SQL predicate. Every request records its limit so no batch can
// exceed ORDERS_EXPORT_BATCH.

interface KRow {
  id: string;
  created_at: string;
}
type KCursor = { createdAt: string; id: string } | null;

/** Strictly-older-than-cursor, matching the SQL keyset
 * `created_at < c.createdAt OR (created_at = c.createdAt AND id < c.id)`. */
function isOlder(r: KRow, c: NonNullable<KCursor>): boolean {
  return (
    r.created_at < c.createdAt ||
    (r.created_at === c.createdAt && r.id < c.id)
  );
}

/** N rows, index 0 = NEWEST, strictly-decreasing distinct created_at. */
function makeRows(n: number): KRow[] {
  const base = Date.parse("2026-06-01T12:00:00Z");
  return Array.from({ length: n }, (_, i) => ({
    id: `o${i}`,
    created_at: new Date(base - i * 60000).toISOString(),
  }));
}

/** A keyset page reader over a dataset provided by `getRows` (re-read every call,
 * so a mutation between pages takes effect). Records requested limits. */
function keysetReader(getRows: () => KRow[]) {
  const requested: number[] = [];
  const reader = async (cursor: KCursor, limit: number) => {
    requested.push(limit);
    const rows = getRows();
    const older = cursor ? rows.filter((r) => isOlder(r, cursor)) : rows;
    return older.slice(0, limit);
  };
  return { reader, requested };
}

/** A static keyset reader over exactly `total` rows. */
function staticReader(total: number) {
  const rows = makeRows(total);
  return keysetReader(() => rows);
}

test("export: 1001 rows are ALL returned (keyset, no max_rows truncation)", async () => {
  // The P1 scenario: more rows than max_rows. Batches are ≤500, so no single
  // request can be clamped; keyset traversal returns the complete set.
  const { reader, requested } = staticReader(1001);
  const out = await collectExportRows(reader, ORDERS_EXPORT_CAP + 1);
  assert.equal(out.length, 1001, "no silent truncation");
  assert.equal(new Set(out.map((r) => r.id)).size, 1001, "no duplicates");
  // Deterministic newest-first order preserved.
  assert.deepEqual(out.map((r) => r.id).slice(0, 3), ["o0", "o1", "o2"]);
  assert.equal(out[out.length - 1].id, "o1000");
  assert.ok(
    requested.every((l) => l <= ORDERS_EXPORT_BATCH),
    "no single request exceeds ORDERS_EXPORT_BATCH",
  );
  assert.ok(requested.every((l) => l <= 1000));
});

test("export: exact row counts across the boundaries", async () => {
  for (const total of [0, 1, 499, 500, 501, 999, 1000, 1001, 4999, 5000]) {
    const { reader } = staticReader(total);
    const out = await collectExportRows(reader, ORDERS_EXPORT_CAP + 1);
    assert.equal(out.length, total, `${total} rows returned in full`);
    assert.equal(new Set(out.map((r) => r.id)).size, total, `${total} unique`);
    assert.equal(out.length > ORDERS_EXPORT_CAP, false, `${total} capped=false`);
  }
});

test("export: one past the cap (5001) returns CAP+1 so the probe detects capped", async () => {
  const { reader } = staticReader(ORDERS_EXPORT_CAP + 1);
  const out = await collectExportRows(reader, ORDERS_EXPORT_CAP + 1);
  assert.equal(out.length, ORDERS_EXPORT_CAP + 1);
  assert.equal(out.length > ORDERS_EXPORT_CAP, true, "capped=true past the cap");
  assert.equal(out.slice(0, ORDERS_EXPORT_CAP).length, ORDERS_EXPORT_CAP);
});

test("export: 6000 present but cap+1 requested → stops at 5001, ≤500/call", async () => {
  const { reader, requested } = staticReader(6000);
  const out = await collectExportRows(reader, ORDERS_EXPORT_CAP + 1);
  assert.equal(out.length, ORDERS_EXPORT_CAP + 1); // never the whole 6000
  assert.ok(requested.every((l) => l <= ORDERS_EXPORT_BATCH));
});

test("export: an EXACT-MULTIPLE-of-500 set ends on a natural empty page (no over-range)", async () => {
  // Keyset returns an EMPTY page past the last row (a normal filtered query, not
  // an over-range .range()) — so there is no PostgREST 416 / PGRST103 to handle.
  for (const total of [500, 1000, 5000]) {
    const { reader, requested } = staticReader(total);
    const out = await collectExportRows(reader, ORDERS_EXPORT_CAP + 1);
    assert.equal(out.length, total, `all ${total} rows`);
    // total/500 full pages + one empty page that ends the loop.
    assert.equal(requested.length, total / ORDERS_EXPORT_BATCH + 1);
    assert.ok(requested.every((l) => l <= ORDERS_EXPORT_BATCH));
  }
});

test("export: every request is bounded to ≤ ORDERS_EXPORT_BATCH (contract)", async () => {
  for (const total of [500, 1250, 6000]) {
    const { reader, requested } = staticReader(total);
    await collectExportRows(reader, ORDERS_EXPORT_CAP + 1);
    assert.ok(requested.length > 0);
    assert.ok(requested.every((l) => l <= ORDERS_EXPORT_BATCH), `${total}: ≤500`);
    assert.ok(requested.every((l) => l >= 1));
  }
});

test("export: cap of 0 returns nothing and issues no request", async () => {
  const { reader, requested } = staticReader(10);
  const out = await collectExportRows(reader, 0);
  assert.equal(out.length, 0);
  assert.equal(requested.length, 0);
});

// ── maxPages FAILS CLOSED (P2): guard exhaustion is never silent success ────

test("export: a stuck FULL-page-of-duplicates reader FAILS CLOSED (throws, no partial success)", async () => {
  // A reader that IGNORES the cursor and always returns a FULL page (length ==
  // want) of the SAME row: rows.length === want (never short), the cursor never
  // makes unique progress, so no natural end and never safeCap. The ONLY way out
  // is maxPages — which must THROW, not return the 1 accumulated row as success.
  let calls = 0;
  const stuck = async (
    _cursor: { createdAt: string; id: string } | null,
    limit: number,
  ) => {
    calls += 1;
    return Array.from({ length: limit }, () => ({
      id: "same",
      created_at: "2026-06-01T12:00:00.000Z",
    }));
  };
  await assert.rejects(
    () => collectExportRows(stuck, ORDERS_EXPORT_CAP + 1),
    /paging guard exhausted/,
  );
  const maxPages = Math.ceil((ORDERS_EXPORT_CAP + 1) / ORDERS_EXPORT_BATCH) + 2;
  assert.equal(calls, maxPages, "it exhausted the backstop before throwing");
});

test("export: a reader with ONE unique row per stuck full page fails closed (incomplete ≠ success)", async () => {
  // Each page returns a FULL page but only 1 NEW id (the rest duplicates), so the
  // set can never be finished within maxPages — partial, so it MUST fail closed
  // rather than return the handful of unique rows as a complete CSV.
  let n = 0;
  const drip = async (
    _cursor: { createdAt: string; id: string } | null,
    limit: number,
  ) => {
    const fresh = { id: `u${n++}`, created_at: "2026-06-01T12:00:00.000Z" };
    const dupes = Array.from({ length: limit - 1 }, () => ({
      id: "dupe",
      created_at: "2026-06-01T12:00:00.000Z",
    }));
    return [fresh, ...dupes];
  };
  await assert.rejects(
    () => collectExportRows(drip, ORDERS_EXPORT_CAP + 1),
    /paging guard exhausted/,
  );
});

test("export: natural EMPTY-page end still succeeds (exact multiple of the batch)", async () => {
  // 500 rows: page 1 is a FULL page (500), page 2 is EMPTY → completes via the
  // empty-page branch, not the guard.
  const out = await collectExportRows(staticReader(500).reader, ORDERS_EXPORT_CAP + 1);
  assert.equal(out.length, 500);
});

test("export: natural SHORT-page end still succeeds (no throw)", async () => {
  const out = await collectExportRows(staticReader(750).reader, ORDERS_EXPORT_CAP + 1);
  assert.equal(out.length, 750); // 500 + 250 (short) → completes
});

test("export: safeCap completion still succeeds (exact 5000 → capped=false, 5001 → capped=true)", async () => {
  const at5000 = await collectExportRows(staticReader(5000).reader, ORDERS_EXPORT_CAP + 1);
  assert.equal(at5000.length, 5000);
  assert.equal(at5000.length > ORDERS_EXPORT_CAP, false, "5000 → capped=false");
  const at5001 = await collectExportRows(staticReader(5001).reader, ORDERS_EXPORT_CAP + 1);
  assert.equal(at5001.length, ORDERS_EXPORT_CAP + 1);
  assert.equal(at5001.length > ORDERS_EXPORT_CAP, true, "5001 → capped=true");
});

test("export: a large dataset (6000) reaches safeCap WITHOUT tripping the guard", async () => {
  // Regression: the cap+1 probe must complete via the safeCap branch, never via
  // maxPages — so a genuinely large, healthy dataset never wrongly fails closed.
  const rows = await collectExportRows(staticReader(6000).reader, ORDERS_EXPORT_CAP + 1);
  assert.equal(rows.length, ORDERS_EXPORT_CAP + 1);
});

test("guard: the export action converts a collector throw to a safe { ok:false }", () => {
  // The collector fails closed by THROWING; the action must catch it and return
  // its existing safe failure (no partial CSV, no raw error to the browser).
  const src = readSrc("lib/actions/orders.ts");
  const start = src.indexOf("export async function exportOrdersAction");
  assert.ok(start >= 0, "exportOrdersAction exists");
  const body = src.slice(start, start + 2000);
  assert.match(body, /try \{/);
  assert.match(body, /catch \(error\)/);
  // The catch returns the safe flag and logs server-side only — never the message.
  assert.match(body, /return \{ ok: false \}/);
  assert.match(body, /console\.error/);
  assert.doesNotMatch(body, /error\.message/);
});

// ── Concurrency: keyset protects against the offset-shift omission ──────────

/** A keyset reader whose dataset is mutated ONCE, right after page 1 is served. */
function mutatingReader(initial: KRow[], mutateAfterFirst: (rows: KRow[]) => KRow[]) {
  let data = initial;
  let calls = 0;
  const reader = async (cursor: KCursor, limit: number) => {
    const older = cursor ? data.filter((r) => isOlder(r, cursor)) : data;
    const page = older.slice(0, limit);
    calls += 1;
    if (calls === 1) data = mutateAfterFirst(data);
    return page;
  };
  return { reader };
}

test("concurrency: the EXACT Codex scenario — a page-1 row leaves the filter → o500 is NOT skipped", async () => {
  // 1000 rows. Page 1 = o0..o499 (newest 500). Before page 2, o0 leaves the
  // filter. Offset paging would return o501..o999 for page 2 (o500 shifted into
  // page 1's window and skipped). Keyset resumes strictly after o499's key → o500
  // is present.
  const { reader } = mutatingReader(makeRows(1000), (rows) =>
    rows.filter((r) => r.id !== "o0"),
  );
  const out = await collectExportRows(reader, ORDERS_EXPORT_CAP + 1);
  const ids = out.map((r) => r.id);
  assert.ok(ids.includes("o500"), "the previously-omitted boundary row is present");
  assert.equal(new Set(ids).size, ids.length, "no duplicates");
  // o0 was captured in page 1 before it left, so the output holds o0..o999.
  assert.equal(out.length, 1000);
  assert.ok(ids.includes("o0") && ids.includes("o999"));
});

test("concurrency: MULTIPLE page-1 rows leave the filter → no later row is skipped", async () => {
  const { reader } = mutatingReader(makeRows(1000), (rows) =>
    rows.filter((r) => !["o0", "o1", "o2", "o3", "o4"].includes(r.id)),
  );
  const out = await collectExportRows(reader, ORDERS_EXPORT_CAP + 1);
  const ids = new Set(out.map((r) => r.id));
  // Every row from o500 onward (never in page 1) must still be present.
  for (let i = 500; i < 1000; i += 1) {
    assert.ok(ids.has(`o${i}`), `o${i} present after 5 removals`);
  }
  assert.equal(ids.size, out.length, "no duplicates");
});

test("concurrency: a new row inserted AHEAD of the cursor does not corrupt traversal", async () => {
  // Insert a brand-new NEWEST row after page 1. It is ahead of the cursor, so it
  // is simply not part of this traversal (honest: not a snapshot). No existing
  // row is skipped or duplicated.
  const { reader } = mutatingReader(makeRows(1000), (rows) => {
    const newer: KRow = { id: "oNEW", created_at: "2026-07-01T00:00:00.000Z" };
    return [newer, ...rows];
  });
  const out = await collectExportRows(reader, ORDERS_EXPORT_CAP + 1);
  const ids = out.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length, "no duplicates");
  // All original rows still present exactly once.
  for (let i = 0; i < 1000; i += 1) assert.ok(ids.includes(`o${i}`), `o${i}`);
});

test("concurrency: a row AFTER the cursor leaving the filter is simply absent (no skip of others)", async () => {
  // Remove o700 (which lives in page 2's range) after page 1. It legitimately
  // drops out; every OTHER still-matching row is still returned exactly once.
  const { reader } = mutatingReader(makeRows(1000), (rows) =>
    rows.filter((r) => r.id !== "o700"),
  );
  const out = await collectExportRows(reader, ORDERS_EXPORT_CAP + 1);
  const ids = new Set(out.map((r) => r.id));
  assert.ok(!ids.has("o700"), "the removed post-cursor row is absent");
  assert.ok(ids.has("o699") && ids.has("o701"), "its neighbours are still present");
  assert.equal(ids.size, out.length, "no duplicates");
});

test("keyset tie-break: rows sharing an EXACT created_at page by id DESC with no skip/dup", async () => {
  // 1200 rows ALL at the same created_at — so ordering (and the cursor) is driven
  // entirely by the id tie-break. Ids are zero-padded so lexicographic id order
  // (which Postgres uuid/text comparison mirrors) is a total order.
  const ts = "2026-06-01T12:00:00.000Z";
  const rows: KRow[] = Array.from({ length: 1200 }, (_, i) => ({
    id: `o${String(1200 - i).padStart(5, "0")}`, // o01200 (newest) … o00001
    created_at: ts,
  }));
  const { reader } = keysetReader(() => rows);
  const out = await collectExportRows(reader, ORDERS_EXPORT_CAP + 1);
  assert.equal(out.length, 1200, "all same-timestamp rows returned");
  assert.equal(new Set(out.map((r) => r.id)).size, 1200, "no duplicate across the id tie-break seam");
  // Strictly descending by id across the whole sequence (incl. the batch seams).
  for (let i = 1; i < out.length; i += 1) {
    assert.ok(out[i - 1].id > out[i].id, `id DESC at ${i}`);
  }
});

test("middle-page failure: a DB error on a later page aborts the whole export", async () => {
  // A non-end-of-set error after a successful page 1 must propagate (the closure
  // fail()s → the action returns its safe { ok:false }); it must NOT become a
  // partial successful CSV.
  const rows = makeRows(1000);
  let calls = 0;
  const failingReader = async (cursor: KCursor, limit: number) => {
    calls += 1;
    if (calls >= 2) {
      throw new Error("[madaf/data] supabase read failed (listOrdersForExport): boom");
    }
    const older = cursor ? rows.filter((r) => isOlder(r, cursor)) : rows;
    return older.slice(0, limit);
  };
  await assert.rejects(
    () => collectExportRows(failingReader, ORDERS_EXPORT_CAP + 1),
    /boom/,
  );
  assert.ok(calls >= 2, "it did fetch a second page before failing");
});

test("guard: sbListOrdersForExport pages by KEYSET (no offset), never one big range", () => {
  const src = readSrc("lib/data/supabase-reads.ts");
  const reader = src.slice(src.indexOf("export function buildOrdersExportPageReader"));
  const readerBody = reader.slice(0, reader.indexOf("\nexport ", 1));
  // Keyset cursor predicate + a HARD-BOUND .limit(), never .range()/offset.
  assert.match(readerBody, /created_at\.lt\.\$\{cursor\.createdAt\}/);
  assert.match(readerBody, /and\(created_at\.eq\.\$\{cursor\.createdAt\},id\.lt\.\$\{cursor\.id\}\)/);
  // The request size is clamped at the reader boundary, not passed through raw.
  assert.match(readerBody, /\.limit\(clampExportLimit\(limit\)\)/);
  assert.doesNotMatch(readerBody, /\.limit\(limit\)/);
  assert.doesNotMatch(readerBody, /\.range\(/);
  assert.doesNotMatch(readerBody, /offset/);
  const fn = src.slice(src.indexOf("export async function sbListOrdersForExport"));
  const body = fn.slice(0, fn.indexOf("\nexport ", 1));
  assert.match(body, /buildOrdersExportPageReader\(client, tenantId, query, timeZone\)/);
  assert.match(body, /collectExportRows<OrderListDbRow>\(reader, cap\)/);
});

// ── Reader request-size hard bound (P3): clampExportLimit ───────────────────

test("clampExportLimit hard-bounds every request into [1, 500]", () => {
  assert.equal(clampExportLimit(1), 1);
  assert.equal(clampExportLimit(499), 499);
  assert.equal(clampExportLimit(500), 500);
  assert.equal(clampExportLimit(501), 500, ">500 can never produce a request >500");
  assert.equal(clampExportLimit(5000), 500);
  assert.equal(clampExportLimit(1_000_000), 500);
  // 0 / negative → the safe minimum.
  assert.equal(clampExportLimit(0), 1);
  assert.equal(clampExportLimit(-1), 1);
  assert.equal(clampExportLimit(-9999), 1);
  // Fractions truncate toward the integer then clamp.
  assert.equal(clampExportLimit(500.9), 500);
  assert.equal(clampExportLimit(0.5), 1);
  // Non-finite (only reachable at an untyped runtime boundary) → the safe max;
  // still a bounded request that can never exceed 500.
  assert.equal(clampExportLimit(Number.NaN), 500);
  assert.equal(clampExportLimit(Number.POSITIVE_INFINITY), 500);
  assert.equal(clampExportLimit(Number.NEGATIVE_INFINITY), 500);
  // The output is ALWAYS a finite integer in [1, 500].
  for (const v of [1, 500, 501, 0, -3, 5000, 250.7, Number.NaN, Infinity]) {
    const r = clampExportLimit(v);
    assert.ok(Number.isInteger(r) && r >= 1 && r <= 500, `clamp(${String(v)})=${r}`);
  }
});

test("the reader's ACTUAL request bound: whatever the caller asks, the DB sees ≤500", () => {
  // Prove the bound at the reader BOUNDARY, not just the collector: a caller that
  // passes 501/5000/NaN through the reader still issues a `.limit()` ≤ 500. We
  // model the reader's contract — the request size the DB receives is
  // clampExportLimit(limit) — and assert it never exceeds the batch.
  for (const asked of [1, 500, 501, 5000, 1_000_000, 0, -5, Number.NaN, Infinity]) {
    const requested = clampExportLimit(asked); // what buildOrdersExportPageReader passes to .limit()
    assert.ok(requested <= ORDERS_EXPORT_BATCH, `asked ${String(asked)} → ${requested} ≤ 500`);
    assert.ok(requested >= 1);
  }
});

test("guard: the PGRST103 over-range hack is GONE (keyset never over-ranges)", () => {
  // Scan CODE only — explanatory comments may name PGRST103 to say WHY it is no
  // longer needed. What must be gone is the `isRangeNotSatisfiable` helper and any
  // live `.code === "PGRST103"` handling.
  const strip = (s: string) =>
    s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const collector = strip(readSrc("lib/orders-query.ts"));
  const reads = strip(readSrc("lib/data/supabase-reads.ts"));
  assert.doesNotMatch(collector, /isRangeNotSatisfiable/);
  assert.doesNotMatch(collector, /PGRST103/);
  assert.doesNotMatch(reads, /isRangeNotSatisfiable/);
  assert.doesNotMatch(reads, /PGRST103/);
});

// ── 21/22. No tenant/role trust; public_ref surfaced alongside admin number ─
test("query state carries NO tenant/role (RLS is the boundary)", () => {
  // The parsed query exposes only safe filter fields — never a tenant id or
  // role that a client could use to widen access. RLS + the authenticated
  // client (server-side) enforce sales_rep/owner/admin scoping.
  const keys = Object.keys(parseOrdersQuery({ customer: "c02" })).sort();
  assert.deepEqual(keys, [
    "customerId",
    "dateFilter",
    "dateFrom",
    "dateTo",
    "page",
    "pageSize",
    "search",
    "source",
    "statuses",
  ]);
});

test("list rows expose BOTH the admin order number and the customer public_ref", async () => {
  const res = await searchOrders(parseOrdersQuery({ pageSize: "1" }));
  const row = res.rows[0];
  assert.ok("number" in row); // internal (admin-only surface)
  assert.ok("publicRef" in row); // customer-facing reference
  assert.equal(typeof row.number, "string");
});

// ── CORRECTION 1: filter-navigation race composition ───────────────────────
// The Orders table composes every change against its LATEST intended state
// (useOptimistic), so these sequential compositions reflect the real UI. Two
// quick changes must both survive — the exact defect being fixed.
test("two rapid status toggles are BOTH retained (compose against latest)", () => {
  let q = parseOrdersQuery({ page: "4" }); // pretend we were on page 4
  q = toggleStatusFilter(q, "new"); // toggle 1
  q = toggleStatusFilter(q, "confirmed"); // toggle 2 (composes on toggle-1 result)
  assert.deepEqual([...q.statuses].sort(), ["confirmed", "new"]);
  assert.equal(q.page, 1); // any change resets to page 1
});

test("toggling the same status twice removes it (deselect)", () => {
  let q = parseOrdersQuery({});
  q = toggleStatusFilter(q, "new");
  assert.deepEqual(q.statuses, ["new"]);
  q = toggleStatusFilter(q, "new");
  assert.deepEqual(q.statuses, []);
});

test("a rapid status + source change retains BOTH", () => {
  let q = toggleStatusFilter(parseOrdersQuery({}), "new");
  q = withFilterChange(q, { source: "guest" }); // source change composes on the status
  assert.deepEqual(q.statuses, ["new"]);
  assert.equal(q.source, "guest");
  assert.equal(q.page, 1);
});

test("a filter change DURING a pending page navigation resets page 1 + keeps the filter", () => {
  // Optimistic state is on page 3 with a source facet; a status toggle composes.
  const pending: OrdersQuery = { ...parseOrdersQuery({ source: "shop_link" }), page: 3 };
  const next = toggleStatusFilter(pending, "preparing");
  assert.equal(next.page, 1);
  assert.deepEqual(next.statuses, ["preparing"]);
  assert.equal(next.source, "shop_link"); // unrelated filter preserved
});

test("search + date changes do NOT drop existing status/source filters", () => {
  const base: OrdersQuery = {
    ...parseOrdersQuery({ status: "confirmed", source: "shop_link" }),
  };
  const afterSearch = withFilterChange(base, { search: "acme" });
  assert.deepEqual(afterSearch.statuses, ["confirmed"]);
  assert.equal(afterSearch.source, "shop_link");
  assert.equal(afterSearch.search, "acme");
  const afterDate = withFilterChange(afterSearch, { dateFrom: "2026-07-01" });
  assert.deepEqual(afterDate.statuses, ["confirmed"]);
  assert.equal(afterDate.source, "shop_link");
  assert.equal(afterDate.search, "acme");
  assert.equal(afterDate.dateFrom, "2026-07-01");
});

test("clearing one filter does NOT clear unrelated filters", () => {
  const q = parseOrdersQuery({
    status: "new",
    source: "guest",
    from: "2026-07-01",
    to: "2026-07-31",
  });
  const cleared = withFilterChange(q, { dateFrom: null, dateTo: null });
  assert.deepEqual(cleared.statuses, ["new"]);
  assert.equal(cleared.source, "guest");
  assert.equal(cleared.dateFrom, null);
  assert.equal(cleared.dateTo, null);
});

// ── CORRECTION 2: customer/guest search semantics (point-in-time snapshot) ──
// Search matches order_number, public_ref and the buyer name/phone RECORDED on
// the order (customer_snapshot) — populated for EVERY order since the first
// M3A create path (proven from migrations). Identical fields to the supabase
// `.or()`. Known + guest orders are covered; renamed customers are found by
// their name AT ORDER TIME.
test("orderMatchesSearch: known + guest by name and phone", () => {
  const known = { number: "MDF-1042", publicRef: "MDF-ABCD1234", customerSnapshot: { name: "Acme Grocery", phone: "04-555-0102" } };
  assert.equal(orderMatchesSearch(known, "acme"), true); // known name
  assert.equal(orderMatchesSearch(known, "555-0102"), true); // known phone
  assert.equal(orderMatchesSearch(known, "MDF-1042"), true); // internal number
  assert.equal(orderMatchesSearch(known, "ABCD1234"), true); // public ref
  const guest = { number: "MDF-1050", publicRef: "MDF-GUEST999", customerSnapshot: { name: "Walk-in Kiosk", phone: "050-123-4567", guest: true } };
  assert.equal(orderMatchesSearch(guest, "walk-in"), true); // guest name
  assert.equal(orderMatchesSearch(guest, "050-123"), true); // guest phone
});

test("orderMatchesSearch: renamed customer is found by name AT ORDER TIME (point-in-time)", () => {
  // Snapshot holds the name recorded on the order ("Old Name"). A store renamed
  // to "New Name" AFTER ordering is found by the recorded name, not the new one.
  const row = { number: "MDF-9", publicRef: null, customerSnapshot: { name: "Old Name", phone: "1" } };
  assert.equal(orderMatchesSearch(row, "old name"), true);
  assert.equal(orderMatchesSearch(row, "new name"), false);
});

test("orderMatchesSearch: order with NO snapshot is unmatched by name (documented contract)", () => {
  // No historical order actually lacks a snapshot (M3A onward populates it), but
  // the guard is explicit: name search relies on the recorded snapshot.
  const row = { number: "MDF-7", publicRef: "MDF-XY", customerSnapshot: undefined };
  assert.equal(orderMatchesSearch(row, "someone"), false);
  assert.equal(orderMatchesSearch(row, "MDF-7"), true); // number still matches
  assert.equal(orderMatchesSearch(row, ""), true); // empty term matches all
});

test("searchOrders (mock): finds a KNOWN customer's order by the customer name", async () => {
  // Mock orders carry a synthesized snapshot from the linked customer, so the
  // demo search finds a known customer by name — same contract as supabase.
  const linked = mockOrders.find((o) => o.customerId);
  const customer = mockCustomers.find((c) => c.id === linked?.customerId);
  assert.ok(customer, "a mock order links to a customer");
  const term = customer.name.slice(0, 4);
  const res = await searchOrders(parseOrdersQuery({ q: term, pageSize: "100" }));
  assert.ok(res.rows.some((r) => r.customerId === customer.id), `search '${term}' finds the customer's order`);
});

// ── CORRECTION 3 → M8H.2: TENANT-timezone date bounds ──────────────────────
const TZ = "Asia/Jerusalem"; // the demo tenant's zone (mock supplier)

test("tenantDayStartUtcIso: DST-aware tenant-day start (Asia/Jerusalem)", () => {
  assert.equal(tenantDayStartUtcIso("2026-07-05", TZ), "2026-07-04T21:00:00.000Z"); // IDT +3
  assert.equal(tenantDayStartUtcIso("2026-01-05", TZ), "2026-01-04T22:00:00.000Z"); // IST +2
  assert.equal(tenantDayStartUtcIso("2026-13-40", TZ), null); // impossible date
  assert.equal(tenantDayStartUtcIso("2026/07/05", TZ), null); // malformed
});

test("nextCalendarDay: month / leap / year boundaries", () => {
  assert.equal(nextCalendarDay("2026-07-31"), "2026-08-01");
  assert.equal(nextCalendarDay("2024-02-28"), "2024-02-29"); // leap year
  assert.equal(nextCalendarDay("2024-02-29"), "2024-03-01");
  assert.equal(nextCalendarDay("2026-12-31"), "2027-01-01");
});

test("tenantToday returns a stable YYYY-MM-DD", () => {
  assert.match(tenantToday(TZ), /^\d{4}-\d{2}-\d{2}$/);
});

test("date bounds include a just-after-tenant-midnight order (no UTC clipping)", () => {
  // An order at 00:30 tenant time on 2026-07-05 (= 2026-07-04T21:30Z). With the
  // tenant-tz lower bound (2026-07-04T21:00Z) it is INCLUDED; a naive UTC bound
  // (2026-07-05T00:00Z) would wrongly EXCLUDE it.
  const orderMs = Date.parse("2026-07-05T00:30:00+03:00");
  const tenantBound = Date.parse(tenantDayStartUtcIso("2026-07-05", TZ)!);
  assert.ok(orderMs >= tenantBound, "tenant-tz bound includes the early-morning local order");
  assert.ok(orderMs < Date.parse("2026-07-05T00:00:00Z"), "a naive UTC bound would have excluded it");
});

test("searchOrders (mock): date-from/to boundaries + list/export parity", async () => {
  // All mock orders sit on 2026-07-05 (market time). from=that day includes them.
  const incl = await searchOrders(parseOrdersQuery({ from: "2026-07-05", to: "2026-07-05", pageSize: "100" }));
  assert.ok(incl.total > 0, "orders on 2026-07-05 are included by from=to=2026-07-05");
  // to is INCLUSIVE of its whole day.
  const exportRows = await listOrdersForExport(parseOrdersQuery({ from: "2026-07-05", to: "2026-07-05" }), 5000);
  assert.equal(exportRows.length, incl.total, "list + export apply IDENTICAL date bounds");
  // A range entirely OUTSIDE the mock orders (which span 2026-06-27..07-05).
  const outside = await searchOrders(parseOrdersQuery({ from: "2026-05-01", to: "2026-05-31" }));
  assert.equal(outside.total, 0);
  // to is exclusive of the NEXT day: an order on 07-05 is excluded by to=07-04.
  const upTo04 = await searchOrders(parseOrdersQuery({ to: "2026-07-04", pageSize: "100" }));
  assert.ok(upTo04.rows.every((r) => Date.parse(r.createdAt) < Date.parse(tenantDayStartUtcIso("2026-07-05", TZ)!)));
});
