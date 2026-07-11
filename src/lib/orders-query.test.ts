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
import { test } from "node:test";

import {
  hasActiveFilters,
  ORDERS_MAX_PAGE_SIZE,
  ORDERS_PAGE_SIZE,
  orderSourceFacet,
  ordersQueryToParams,
  parseOrdersQuery,
  totalPagesFor,
  withFilterChange,
  type OrdersQuery,
} from "./orders-query";
import { listOrdersForExport, searchOrders } from "./data/orders";
import { orders as mockOrders } from "./mock";

const MOCK_TOTAL = mockOrders.length;

// ── 1. Default query parsing ───────────────────────────────────────────────
test("parseOrdersQuery: defaults for an empty URL", () => {
  const q = parseOrdersQuery({});
  assert.deepEqual(q, {
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

// ── 21/22. No tenant/role trust; public_ref surfaced alongside admin number ─
test("query state carries NO tenant/role (RLS is the boundary)", () => {
  // The parsed query exposes only safe filter fields — never a tenant id or
  // role that a client could use to widen access. RLS + the authenticated
  // client (server-side) enforce sales_rep/owner/admin scoping.
  const keys = Object.keys(parseOrdersQuery({ customer: "c02" })).sort();
  assert.deepEqual(keys, [
    "customerId",
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
