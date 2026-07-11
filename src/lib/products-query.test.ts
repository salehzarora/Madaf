/**
 * Products server-side search/pagination test suite (M8F.2). Exercises the SAME
 * production functions the page, filter links, export, and data layer use — the
 * shared URL parser/serializer (`products-query.ts`) and the mock-mode data
 * layer (`data/products.ts`, which mirrors the supabase filter/sort/paginate
 * contract). Pure + zero-env: runs in mock mode with no Supabase.
 *
 * Runner: `npm run test:products-search` (tsx → node:test).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  compareProductsForList,
  hasActiveProductFilters,
  isBlankSku,
  manufacturerMatchesSearch,
  parseProductsQuery,
  productMatchesSearch,
  productMatchesStatus,
  productsQueryToParams,
  PRODUCTS_MAX_PAGE_SIZE,
  PRODUCTS_PAGE_SIZE,
  totalProductPagesFor,
  withProductFilterChange,
  type ProductsQuery,
} from "./products-query";
import { listProductsForExport, searchProducts } from "./data/products";
import { manufacturerById, products as mockProducts } from "./mock";
import type { LocalizedText, Product } from "./types";

const TOTAL = mockProducts.length; // 34 mock catalog rows
const DRINKS = "cat-drinks"; // 7 products
const COCA = "m-coca"; // 6 products
const STRAUSS = "m-strauss"; // 4 products; brand name "Strauss" not in product names

/** The manufacturer name for a product (mirrors what the data layer passes to
 * productMatchesSearch), so the tests derive the SAME expected set as the
 * mock/supabase search. */
function manOf(p: Product): LocalizedText | undefined {
  return manufacturerById.get(p.manufacturerId)?.name;
}
/** Full search match INCLUDING manufacturer name — the data-layer contract. */
function matches(p: Product, term: string): boolean {
  return productMatchesSearch(p, term, manOf(p));
}

/** Base query = no filters, page 1, default size. */
const base = (patch: Partial<ProductsQuery> = {}): ProductsQuery => ({
  search: "",
  categoryId: null,
  manufacturerId: null,
  status: "all",
  page: 1,
  pageSize: PRODUCTS_PAGE_SIZE,
  ...patch,
});

/** A synthetic product for pure-function tests (mock rows carry no barcode). */
const synth = (over: Partial<Product> = {}): Product => ({
  id: "px",
  sku: "SKU-9",
  barcode: "7290000000001",
  translations: {
    ar: { name: "ماء معدني" },
    he: { name: "מים מינרלים" },
    en: { name: "Mineral Water" },
  },
  categoryId: DRINKS,
  manufacturerId: COCA,
  packageType: "carton",
  unitsPerPackage: 12,
  baseUnit: "bottles",
  wholesalePrice: 20,
  availability: "inStock",
  ...over,
});

// ── 1. Default query parsing ───────────────────────────────────────────────
test("parseProductsQuery: defaults for an empty URL", () => {
  assert.deepEqual(parseProductsQuery({}), {
    search: "",
    categoryId: null,
    manufacturerId: null,
    status: "all",
    page: 1,
    pageSize: PRODUCTS_PAGE_SIZE,
  });
});

// ── 2. Invalid page normalization ──────────────────────────────────────────
test("parseProductsQuery: invalid/out-of-bounds page normalizes to >= 1", () => {
  assert.equal(parseProductsQuery({ page: "0" }).page, 1);
  assert.equal(parseProductsQuery({ page: "-5" }).page, 1);
  assert.equal(parseProductsQuery({ page: "abc" }).page, 1);
  assert.equal(parseProductsQuery({ page: "" }).page, 1);
  assert.equal(parseProductsQuery({ page: "3" }).page, 3);
  assert.ok(parseProductsQuery({ page: "99999999999" }).page <= 1_000_000);
});

// ── 3. Invalid page-size normalization ─────────────────────────────────────
test("parseProductsQuery: page size is bounded", () => {
  assert.equal(parseProductsQuery({ pageSize: "0" }).pageSize, 1);
  assert.equal(parseProductsQuery({ pageSize: "-1" }).pageSize, 1);
  assert.equal(parseProductsQuery({ pageSize: "abc" }).pageSize, PRODUCTS_PAGE_SIZE);
  assert.equal(parseProductsQuery({ pageSize: "25" }).pageSize, 25);
  assert.equal(parseProductsQuery({ pageSize: "99999" }).pageSize, PRODUCTS_MAX_PAGE_SIZE);
});

// ── 4. Search trimming ─────────────────────────────────────────────────────
test("parseProductsQuery: search is trimmed and length-capped", () => {
  assert.equal(parseProductsQuery({ q: "  cola  " }).search, "cola");
  assert.equal(parseProductsQuery({ q: "x".repeat(500) }).search.length, 120);
  assert.equal(parseProductsQuery({ q: "   " }).search, "");
});

// ── 5. Active/inactive parsing ─────────────────────────────────────────────
test("parseProductsQuery: status facet parses active/inactive/all", () => {
  assert.equal(parseProductsQuery({ status: "active" }).status, "active");
  assert.equal(parseProductsQuery({ status: "inactive" }).status, "inactive");
  assert.equal(parseProductsQuery({ status: "all" }).status, "all");
});

// ── 6. Category parsing ────────────────────────────────────────────────────
test("parseProductsQuery: category id is validated (plausible id only)", () => {
  assert.equal(parseProductsQuery({ category: DRINKS }).categoryId, DRINKS);
  assert.equal(parseProductsQuery({ category: "bad id!" }).categoryId, null);
  assert.equal(parseProductsQuery({ category: "" }).categoryId, null);
  assert.equal(parseProductsQuery({ category: "x".repeat(65) }).categoryId, null);
});

// ── 7. Manufacturer parsing ────────────────────────────────────────────────
test("parseProductsQuery: manufacturer id is validated (plausible id only)", () => {
  assert.equal(parseProductsQuery({ manufacturer: COCA }).manufacturerId, COCA);
  assert.equal(parseProductsQuery({ manufacturer: "bad!" }).manufacturerId, null);
  assert.equal(parseProductsQuery({ manufacturer: "" }).manufacturerId, null);
});

// ── 8 + 9. Unknown filter / stock-facet normalization ──────────────────────
// Low-stock is an INVENTORY-page feature (/admin/inventory?low=1), NOT a
// products filter — so no stock facet exists here. Unknown params are ignored
// and an unknown status normalizes to "all" (never throws).
test("parseProductsQuery: unknown params ignored; unknown status → all", () => {
  assert.equal(parseProductsQuery({ status: "banana" }).status, "all");
  const q = parseProductsQuery({ low: "1", stock: "low", foo: "bar" } as never);
  assert.deepEqual(q, base());
  assert.ok(!("stock" in q) && !("low" in q));
});

// ── 10. Changing a filter resets page to 1 ─────────────────────────────────
test("withProductFilterChange: any filter change resets page to 1", () => {
  const q = base({ page: 5, categoryId: DRINKS });
  assert.equal(withProductFilterChange(q, { search: "cola" }).page, 1);
  assert.equal(withProductFilterChange(q, { manufacturerId: COCA }).page, 1);
  assert.equal(withProductFilterChange(q, { status: "inactive" }).page, 1);
});

// ── 11. Pagination preserves all active filters ────────────────────────────
test("productsQueryToParams: pagination keeps all active filters", () => {
  const q = base({ search: "cola", categoryId: DRINKS, manufacturerId: COCA, status: "active", page: 1 });
  const params = productsQueryToParams(q, { page: 3 });
  assert.equal(params.get("q"), "cola");
  assert.equal(params.get("category"), DRINKS);
  assert.equal(params.get("manufacturer"), COCA);
  assert.equal(params.get("status"), "active");
  assert.equal(params.get("page"), "3");
});

// ── 12. Two rapid filter changes compose against the latest ────────────────
test("two rapid filter changes are BOTH retained (compose against latest)", () => {
  let q = base();
  q = withProductFilterChange(q, { categoryId: DRINKS }); // first change
  q = withProductFilterChange(q, { manufacturerId: COCA }); // second, against latest
  assert.equal(q.categoryId, DRINKS);
  assert.equal(q.manufacturerId, COCA);
  assert.equal(q.page, 1);
});

// ── 13. Filter change during a pending page navigation ─────────────────────
test("a filter change from page > 1 resets to page 1 + keeps the filter", () => {
  const pending = base({ page: 4, categoryId: DRINKS }); // mid-pagination
  const next = withProductFilterChange(pending, { search: "cola" });
  assert.equal(next.page, 1);
  assert.equal(next.search, "cola");
  assert.equal(next.categoryId, DRINKS); // unrelated filter preserved
});

// ── 14. Clearing one filter preserves unrelated filters ────────────────────
test("clearing one filter does NOT clear unrelated filters", () => {
  const q = base({ search: "cola", categoryId: DRINKS, manufacturerId: COCA });
  const next = withProductFilterChange(q, { manufacturerId: null });
  assert.equal(next.manufacturerId, null);
  assert.equal(next.search, "cola");
  assert.equal(next.categoryId, DRINKS);
});

// ── 15. Dashboard / deep-link compatibility ────────────────────────────────
// The Products page had no URL state before M8F.2, so there are no legacy
// products deep links to break. A category deep link parses; an inventory-style
// ?low=1 (the dashboard low-stock link target) is simply ignored here.
test("deep links: category link parses; inventory ?low=1 is ignored", () => {
  assert.equal(parseProductsQuery({ category: DRINKS }).categoryId, DRINKS);
  assert.deepEqual(parseProductsQuery({ low: "1" } as never), base());
});

// ── 16. Deterministic sort contract (SKU asc, then id asc) ─────────────────
test("compareProductsForList: SKU ascending, id tie-break; empty SKU last", () => {
  const a = synth({ id: "a", sku: "AAA" });
  const b = synth({ id: "b", sku: "BBB" });
  assert.ok(compareProductsForList(a, b) < 0);
  assert.ok(compareProductsForList(b, a) > 0);
  // Same SKU → id breaks the tie.
  const c1 = synth({ id: "id-1", sku: "SAME" });
  const c2 = synth({ id: "id-2", sku: "SAME" });
  assert.ok(compareProductsForList(c1, c2) < 0);
  // Empty SKU sorts AFTER a present SKU (mirrors NULLS LAST).
  assert.ok(compareProductsForList(synth({ sku: "" }), synth({ sku: "ZZZ" })) > 0);
});

test("searchProducts (mock): the page is globally sorted by the contract", async () => {
  const res = await searchProducts(base({ pageSize: 100 }));
  for (let i = 1; i < res.products.length; i++) {
    assert.ok(compareProductsForList(res.products[i - 1], res.products[i]) <= 0);
  }
});

// ── 17. No-filter list behavior ────────────────────────────────────────────
test("searchProducts (mock): no filter returns page 1 + exact total", async () => {
  const res = await searchProducts(base());
  assert.equal(res.total, TOTAL);
  assert.equal(res.page, 1);
  assert.equal(res.products.length, Math.min(PRODUCTS_PAGE_SIZE, TOTAL));
});

// ── 18. Combined q + status + category/manufacturer ────────────────────────
test("searchProducts (mock): combined filters narrow correctly", async () => {
  const res = await searchProducts(base({ categoryId: DRINKS, manufacturerId: COCA }));
  const expected = mockProducts.filter(
    (p) => p.categoryId === DRINKS && p.manufacturerId === COCA,
  ).length;
  assert.equal(res.total, expected);
  assert.ok(res.products.every((p) => p.categoryId === DRINKS && p.manufacturerId === COCA));
});

// ── 19 + 20. Mock pagination returns only the requested page; count/pages ──
test("searchProducts (mock): pagination returns only the requested page", async () => {
  const res1 = await searchProducts(base({ pageSize: 10, page: 1 }));
  assert.equal(res1.products.length, 10);
  assert.equal(res1.total, TOTAL);
  assert.equal(res1.totalPages, totalProductPagesFor(TOTAL, 10));
  const last = res1.totalPages;
  const resLast = await searchProducts(base({ pageSize: 10, page: last }));
  assert.equal(resLast.products.length, TOTAL - (last - 1) * 10);
  // Pages don't overlap.
  const ids1 = new Set(res1.products.map((p) => p.id));
  assert.ok(resLast.products.every((p) => !ids1.has(p.id)));
});

// ── 21. Out-of-range page handling ─────────────────────────────────────────
test("searchProducts (mock): out-of-range page clamps to the last page", async () => {
  const res = await searchProducts(base({ pageSize: 10, page: 999 }));
  const totalPages = totalProductPagesFor(TOTAL, 10);
  assert.equal(res.page, totalPages);
  assert.equal(res.products.length, TOTAL - (totalPages - 1) * 10);
});

test("totalProductPagesFor: exact page math (>= 1)", () => {
  assert.equal(totalProductPagesFor(0, 50), 1);
  assert.equal(totalProductPagesFor(50, 50), 1);
  assert.equal(totalProductPagesFor(51, 50), 2);
  assert.equal(totalProductPagesFor(34, 10), 4);
});

// ── 22. All three locales preserve URL state (round-trip) ──────────────────
test("URL state round-trips through parse → serialize → parse", () => {
  const q = base({ search: "cola", categoryId: DRINKS, manufacturerId: COCA, status: "inactive", page: 3, pageSize: 25 });
  const params = productsQueryToParams(q);
  const round = parseProductsQuery(Object.fromEntries(params.entries()));
  assert.deepEqual(round, q);
  // URL params carry no locale — the same query serializes identically for ar/he/en.
});

// ── 23. Product search by name ─────────────────────────────────────────────
test("searchProducts (mock): finds products by name (all locales)", async () => {
  const res = await searchProducts(base({ search: "cola", pageSize: 100 }));
  const expected = mockProducts.filter((p) => matches(p, "cola")).length;
  assert.ok(expected > 0);
  assert.equal(res.total, expected);
  assert.ok(res.products.every((p) => matches(p, "cola")));
});

test("productMatchesSearch: matches name in ar / he / en", () => {
  const p = synth();
  assert.ok(productMatchesSearch(p, "Mineral"));
  assert.ok(productMatchesSearch(p, "מים"));
  assert.ok(productMatchesSearch(p, "ماء"));
  assert.ok(!productMatchesSearch(p, "zzz-nomatch"));
});

// ── 24. Product search by SKU ──────────────────────────────────────────────
test("searchProducts (mock): finds a product by exact SKU", async () => {
  const sample = mockProducts[0];
  const res = await searchProducts(base({ search: sample.sku, pageSize: 100 }));
  assert.ok(res.products.some((p) => p.id === sample.id));
  assert.ok(res.products.every((p) => matches(p, sample.sku)));
});

// ── 25. Product search by barcode ──────────────────────────────────────────
test("productMatchesSearch: matches by barcode (top-level column)", () => {
  const p = synth({ barcode: "7290000000001" });
  assert.ok(productMatchesSearch(p, "7290000000001"));
  assert.ok(productMatchesSearch(p, "729000"));
  assert.ok(!productMatchesSearch(synth({ barcode: undefined }), "7290000000001"));
});

// ── 26. Category filter semantics ──────────────────────────────────────────
test("searchProducts (mock): category filter scopes to that category", async () => {
  const res = await searchProducts(base({ categoryId: DRINKS, pageSize: 100 }));
  assert.equal(res.total, mockProducts.filter((p) => p.categoryId === DRINKS).length);
  assert.ok(res.products.every((p) => p.categoryId === DRINKS));
});

// ── 27. Manufacturer filter semantics ──────────────────────────────────────
test("searchProducts (mock): manufacturer filter scopes to that manufacturer", async () => {
  const res = await searchProducts(base({ manufacturerId: COCA, pageSize: 100 }));
  assert.equal(res.total, mockProducts.filter((p) => p.manufacturerId === COCA).length);
  assert.ok(res.products.every((p) => p.manufacturerId === COCA));
});

// ── 28. Active/inactive behavior ───────────────────────────────────────────
test("searchProducts (mock): status facet (mock rows are all active)", async () => {
  const all = await searchProducts(base({ status: "all", pageSize: 100 }));
  const active = await searchProducts(base({ status: "active", pageSize: 100 }));
  const inactive = await searchProducts(base({ status: "inactive", pageSize: 100 }));
  assert.equal(all.total, TOTAL);
  assert.equal(active.total, TOTAL); // mock products carry no is_active ⇒ implicitly active
  assert.equal(inactive.total, 0);
  assert.ok(productMatchesStatus(synth({ isActive: false }), "inactive"));
  assert.ok(!productMatchesStatus(synth({ isActive: false }), "active"));
});

// ── 29. Low-stock behavior (intentionally NOT a products filter) ───────────
test("no low-stock filter exists on the Products query (inventory feature)", () => {
  const q = parseProductsQuery({});
  assert.deepEqual(Object.keys(q).sort(), [
    "categoryId",
    "manufacturerId",
    "page",
    "pageSize",
    "search",
    "status",
  ]);
});

// ── 30. Current-page-only image contract (only the page is returned) ───────
test("searchProducts (mock): returns ONLY the current page (so only it is signed)", async () => {
  const res = await searchProducts(base({ pageSize: 5, page: 2 }));
  assert.equal(res.products.length, 5); // never the whole catalog
  assert.ok(res.products.length < TOTAL);
});

// ── 31. Export removes pagination and preserves filters ────────────────────
test("listProductsForExport (mock): full filtered set, NOT the current page", async () => {
  // A paginated query (category=drinks, page 2) — export ignores page and
  // returns EVERY drink, preserving the filter.
  const q = base({ categoryId: DRINKS, page: 2, pageSize: 3 });
  const rows = await listProductsForExport(q, 5000);
  const drinks = mockProducts.filter((p) => p.categoryId === DRINKS).length;
  assert.equal(rows.length, drinks);
  assert.ok(rows.every((r) => r.product.categoryId === DRINKS));
});

test("listProductsForExport (mock): respects the cap", async () => {
  const rows = await listProductsForExport(base(), 5);
  assert.equal(rows.length, 5);
});

// ── 32. Role visibility is not broadened (query carries no tenant/role) ────
test("ProductsQuery state carries NO tenant/role (RLS is the boundary)", () => {
  const q = parseProductsQuery({ tenant: "other", role: "owner", tenant_id: "x" } as never);
  assert.ok(!("tenant" in q) && !("role" in q) && !("tenant_id" in q));
});

// ── 33. Private product-image boundary (export carries no image path) ──────
test("listProductsForExport (mock): export rows expose no image URL/path", async () => {
  const rows = await listProductsForExport(base(), 5000);
  assert.ok(rows.every((r) => r.product.imageUrl === undefined));
  assert.ok(rows.every((r) => r.product.imageStoragePath === undefined));
});

// ── 34. Result rows expose the fields the list + export need ────────────────
test("export rows carry the product + resolved stock (no client secret)", async () => {
  const rows = await listProductsForExport(base({ pageSize: 100 }), 5000);
  assert.ok(rows.length > 0);
  for (const r of rows) {
    assert.equal(typeof r.product.id, "string");
    assert.ok(r.stockPackages === null || typeof r.stockPackages === "number");
    assert.ok(r.isLowStock === null || typeof r.isLowStock === "boolean");
  }
});

// ── 35. Dashboard low-stock link remains compatible (inventory, not products)
test("hasActiveProductFilters: true only when a real filter is set", () => {
  assert.equal(hasActiveProductFilters(base()), false);
  assert.equal(hasActiveProductFilters(base({ page: 3 })), false); // pagination is not a filter
  assert.equal(hasActiveProductFilters(base({ search: "x" })), true);
  assert.equal(hasActiveProductFilters(base({ categoryId: DRINKS })), true);
  assert.equal(hasActiveProductFilters(base({ manufacturerId: COCA })), true);
  assert.equal(hasActiveProductFilters(base({ status: "inactive" })), true);
});

// ── 36. Product CRUD/detail links remain compatible (rows carry ids) ───────
test("searchProducts (mock): every row carries an id (edit/detail links work)", async () => {
  const res = await searchProducts(base({ pageSize: 100 }));
  assert.ok(res.products.length > 0);
  assert.ok(res.products.every((p) => typeof p.id === "string" && p.id.length > 0));
});

// ── 37. Manufacturer/brand-name search (all locales) — restored in M8F.2 ───
// The pre-M8F.2 client search matched the manufacturer name (current locale);
// M8F.2 restores it (supabase via a complete tenant-scoped brand pre-query →
// manufacturer_id.in.(…)) and improves it to all three locales.
test("manufacturerMatchesSearch: matches brand name in ar / he / en", () => {
  const strauss = manufacturerById.get(STRAUSS)!.name;
  assert.ok(manufacturerMatchesSearch(strauss, "Strauss"));
  assert.ok(manufacturerMatchesSearch(strauss, "שטראוס"));
  assert.ok(manufacturerMatchesSearch(strauss, "شتراوس"));
  assert.ok(!manufacturerMatchesSearch(strauss, "zzz-nomatch"));
  assert.ok(!manufacturerMatchesSearch(null, "Strauss"));
});

test("searchProducts (mock): finds a brand's products by brand name (en/he/ar)", async () => {
  const straussIds = mockProducts
    .filter((p) => p.manufacturerId === STRAUSS)
    .map((p) => p.id);
  assert.ok(straussIds.length > 0);
  for (const term of ["Strauss", "שטראוס", "شتراوس"]) {
    const res = await searchProducts(base({ search: term, pageSize: 100 }));
    // Expected = full contract (own columns OR brand name) — mock/supabase mirror.
    assert.equal(res.total, mockProducts.filter((p) => matches(p, term)).length);
    // ALL of the brand's products are returned (found via the brand name).
    const got = new Set(res.products.map((p) => p.id));
    assert.ok(straussIds.every((id) => got.has(id)), `all Strauss products for ${term}`);
    assert.ok(res.products.every((p) => matches(p, term)));
  }
});

test("searchProducts (mock): brand-name search composes with category filter", async () => {
  const cat = mockProducts.find((p) => p.manufacturerId === STRAUSS)!.categoryId;
  const res = await searchProducts(base({ search: "Strauss", categoryId: cat, pageSize: 100 }));
  assert.equal(
    res.total,
    mockProducts.filter((p) => p.categoryId === cat && matches(p, "Strauss")).length,
  );
  assert.ok(res.products.every((p) => p.categoryId === cat));
  // A category with no Strauss products + brand search → empty (complete & exact).
  const drinks = await searchProducts(base({ search: "Strauss", categoryId: DRINKS, pageSize: 100 }));
  assert.equal(
    drinks.total,
    mockProducts.filter((p) => p.categoryId === DRINKS && matches(p, "Strauss")).length,
  );
});

// ── 38. Exact sort contract on the tricky SKU fixture + no dup/skip ─────────
const SORT_FIXTURE: Product[] = [
  ["i-empty", ""],
  ["i-ws", "   "],
  ["i-null", null],
  ["i-A10", "A-10"],
  ["i-A2", "A-2"],
  ["i-lower", "a-5"],
  ["i-dupB", "DUP"],
  ["i-dupA", "DUP"],
].map(([id, sku]) => ({ ...synth({ id: id as string }), sku: sku as unknown as string }));

test("isBlankSku: NULL / empty / whitespace-only are blank; a real SKU is not", () => {
  assert.ok(isBlankSku(null));
  assert.ok(isBlankSku(undefined));
  assert.ok(isBlankSku(""));
  assert.ok(isBlankSku("   "));
  assert.ok(!isBlankSku("A-1"));
});

test("compareProductsForList: exact deterministic order on the SKU fixture", () => {
  const order = [...SORT_FIXTURE].sort(compareProductsForList).map((p) => p.id);
  // Non-blank first, code-unit ascending: "A-10" < "A-2" ('1'<'2'); uppercase
  // "DUP" < lowercase "a-5" ('D'0x44 < 'a'0x61); duplicate "DUP" → id order
  // (i-dupA < i-dupB). Blank (empty/whitespace/NULL) LAST, id-ordered
  // (i-empty < i-null < i-ws). No locale collation, no duplicate, no skip.
  assert.deepEqual(order, [
    "i-A10",
    "i-A2",
    "i-dupA",
    "i-dupB",
    "i-lower",
    "i-empty",
    "i-null",
    "i-ws",
  ]);
});

test("fixture paging (sort + slice): no duplicate or skipped product across pages", () => {
  const sorted = [...SORT_FIXTURE].sort(compareProductsForList);
  const pageSize = 3;
  const seen: string[] = [];
  for (let page = 1; (page - 1) * pageSize < sorted.length; page++) {
    seen.push(
      ...sorted.slice((page - 1) * pageSize, page * pageSize).map((p) => p.id),
    );
  }
  assert.equal(seen.length, sorted.length); // no skips
  assert.equal(new Set(seen).size, sorted.length); // no duplicates
  assert.deepEqual(seen, sorted.map((p) => p.id)); // stable, contiguous
});

// ── Architectural guards — the admin Products route must never regress to
// loading the full product/inventory/customer collections (M8F.2 §2). Source-
// level guards (cheap, deterministic) since payload shape can't be asserted
// from a unit test.
const readSrc = (rel: string): string =>
  readFileSync(join(process.cwd(), "src", rel), "utf8");

test("guard: admin Products page fetches only the current page", () => {
  const page = readSrc("app/[locale]/admin/products/page.tsx");
  assert.ok(page.includes("searchProducts"), "must use searchProducts");
  assert.ok(!/\blistProducts\b/.test(page), "must NOT call listProducts (full catalog)");
  assert.ok(!/\blistInventory\b/.test(page), "must NOT call listInventory (full stock)");
});

test("guard: admin layout hydrates only bounded reference data", () => {
  const layout = readSrc("app/[locale]/admin/layout.tsx");
  assert.ok(!/\blistProducts\b/.test(layout), "admin layout must NOT load full products");
  assert.ok(!/\blistCustomers\b/.test(layout), "admin layout must NOT load full customers");
  assert.ok(!/\blistInventory\b/.test(layout), "admin layout must NOT load inventory");
  assert.ok(
    layout.includes("products={[]}") && layout.includes("customers={[]}"),
    "admin ShopData must be product/customer-empty",
  );
});

test("guard: root layout no longer hydrates the full catalog", () => {
  const root = readSrc("app/[locale]/layout.tsx");
  assert.ok(!/\blistProducts\b/.test(root), "root layout must NOT load products");
  assert.ok(!root.includes("ShopDataProvider"), "root layout must NOT provide ShopData");
});
