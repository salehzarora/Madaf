/**
 * Shared, PURE parser/normalizer for the admin Products list URL state (M8F.2).
 *
 * The URL is the single source of truth for search, filters, and page. This
 * module is the ONE place that reads/normalizes those params and serializes
 * them back, so the page (SSR), the pagination/filter links, and the CSV export
 * all agree on the exact semantics. No `window`, no env, no server-only imports
 * — it runs on the server (page) and the client (links/export) and is unit
 * tested directly. Mirrors src/lib/orders-query.ts (M8F.1).
 *
 * Param names (the Products page had NO URL state before M8F.2, so these are
 * new — chosen to read cleanly and to match the on-screen controls):
 *   q            free-text search (product name ar/he/en, SKU, barcode).
 *                Trimmed, length-capped.
 *   category     a specific category id to scope to.
 *   manufacturer a specific manufacturer id to scope to.
 *   status       all | active | inactive (admin activation facet).
 *   page         1-based page number.
 *   pageSize     rows per page (bounded).
 */
import type { Locale } from "@/i18n/config";
import type { Product } from "@/lib/types";

/** Default rows per page — mirrors the orders/customers/movements convention. */
export const PRODUCTS_PAGE_SIZE = 50;
/** Hard upper bound so a crafted ?pageSize can never request an unbounded list. */
export const PRODUCTS_MAX_PAGE_SIZE = 100;
/** Defensive filtered-export ceiling (unchanged from the old client export). */
export const PRODUCTS_EXPORT_CAP = 5000;
/** Free-text term cap (mirrors the orders/customers search caps). */
export const PRODUCTS_SEARCH_MAX = 120;
/** Absurd-offset guard: page can never exceed this (avoids a giant range()). */
const PRODUCTS_MAX_PAGE = 1_000_000;

export type ProductStatusFacet = "all" | "active" | "inactive";
export const PRODUCT_STATUS_FACETS: readonly ProductStatusFacet[] = [
  "all",
  "active",
  "inactive",
];
export function isProductStatusFacet(v: unknown): v is ProductStatusFacet {
  return (
    typeof v === "string" &&
    (PRODUCT_STATUS_FACETS as readonly string[]).includes(v)
  );
}

/** Normalized Products list query state (the parsed URL). */
export interface ProductsQuery {
  /** Trimmed, length-capped free-text term; "" = no search. */
  search: string;
  /** Specific category scope, or null. */
  categoryId: string | null;
  /** Specific manufacturer scope, or null. */
  manufacturerId: string | null;
  /** Activation facet; "all" = no status filter. */
  status: ProductStatusFacet;
  /** 1-based page. */
  page: number;
  /** Bounded rows per page. */
  pageSize: number;
}

type RawParams = Record<string, string | string[] | undefined>;

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/** A plausible internal id (mirrors isPlausibleId used across the actions). A
 * UUID (supabase) and the mock ids ("cat-drinks", "m-coca") both pass. */
function isPlausibleId(value: string): boolean {
  return value.length > 0 && value.length <= 64 && /^[A-Za-z0-9-]+$/.test(value);
}

function clampInt(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const n = Number.parseInt((value ?? "").trim(), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * Parse + normalize raw URL search params into a safe ProductsQuery. Never
 * throws; every invalid/absent value falls back to a safe default (no filter /
 * page 1). An unknown ?status value normalizes to "all".
 */
export function parseProductsQuery(raw: RawParams): ProductsQuery {
  const search = (first(raw.q) ?? "").trim().slice(0, PRODUCTS_SEARCH_MAX);

  const rawCategory = (first(raw.category) ?? "").trim();
  const categoryId =
    rawCategory && isPlausibleId(rawCategory) ? rawCategory : null;

  const rawManufacturer = (first(raw.manufacturer) ?? "").trim();
  const manufacturerId =
    rawManufacturer && isPlausibleId(rawManufacturer) ? rawManufacturer : null;

  const rawStatus = first(raw.status);
  const status: ProductStatusFacet = isProductStatusFacet(rawStatus)
    ? rawStatus
    : "all";

  const page = clampInt(first(raw.page), 1, 1, PRODUCTS_MAX_PAGE);
  const pageSize = clampInt(
    first(raw.pageSize),
    PRODUCTS_PAGE_SIZE,
    1,
    PRODUCTS_MAX_PAGE_SIZE,
  );

  return { search, categoryId, manufacturerId, status, page, pageSize };
}

/** True when any filter (not pagination) narrows the list. */
export function hasActiveProductFilters(q: ProductsQuery): boolean {
  return (
    q.search !== "" ||
    q.categoryId !== null ||
    q.manufacturerId !== null ||
    q.status !== "all"
  );
}

/**
 * Serialize a ProductsQuery to URLSearchParams, OMITTING defaults (empty
 * search, no category/manufacturer, "all" status, page 1, default pageSize).
 * `patch` overrides fields — pass a filter patch (via withProductFilterChange)
 * to reset the page, or `{ page }` for pagination links (which keep filters).
 */
export function productsQueryToParams(
  q: ProductsQuery,
  patch: Partial<ProductsQuery> = {},
): URLSearchParams {
  const merged: ProductsQuery = { ...q, ...patch };
  const params = new URLSearchParams();
  if (merged.search) params.set("q", merged.search);
  if (merged.categoryId) params.set("category", merged.categoryId);
  if (merged.manufacturerId) params.set("manufacturer", merged.manufacturerId);
  if (merged.status !== "all") params.set("status", merged.status);
  if (merged.page > 1) params.set("page", String(merged.page));
  if (merged.pageSize !== PRODUCTS_PAGE_SIZE) {
    params.set("pageSize", String(merged.pageSize));
  }
  return params;
}

/**
 * Build a filter CHANGE query: applies the patch AND resets to page 1 (any
 * search/filter change restarts pagination). Use this for filter controls; use
 * `productsQueryToParams(q, { page })` for pagination links (which keep filters).
 * Composes against the passed query, so the Products table can pass its LATEST
 * intended (optimistic) query and two quick changes both land.
 */
export function withProductFilterChange(
  q: ProductsQuery,
  patch: Partial<ProductsQuery>,
): ProductsQuery {
  return { ...q, ...patch, page: 1 };
}

/** total pages for a filtered count (always >= 1 so "page 1 of 1" reads right). */
export function totalProductPagesFor(total: number, pageSize: number): number {
  if (total <= 0) return 1;
  return Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
}

/** Paginated Products list result — current-page rows + the exact filtered
 * total. Rows are full Product objects (the table already renders these);
 * only the current page is fetched and only its images are signed. */
export interface ProductsListResult {
  products: Product[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/** A filtered product for the CSV export — the product plus its (current)
 * stock, resolved server-side. Category/manufacturer NAMES are resolved on the
 * client from the bounded reference lists (useShopData); no image is signed. */
export interface ProductExportRow {
  product: Product;
  /** Stock in whole packages, or null when the product has no inventory row. */
  stockPackages: number | null;
  /** Whether stock is below its low-stock threshold, or null when untracked. */
  isLowStock: boolean | null;
}

const SEARCH_LOCALES: Locale[] = ["ar", "he", "en"];

/**
 * Does a product match a free-text term? Mirrors the supabase `.or()` search
 * EXACTLY: the product's own top-level columns — name (all three locales), SKU,
 * and barcode. Used by the mock data layer and the tests so mock and supabase
 * agree and stay exact + count-/pagination-compatible.
 *
 * Manufacturer/brand NAME and category NAME are NOT free-text searched here:
 * OR-unioning a related table's name with the product's own columns cannot be
 * expressed in one count/pagination-compatible PostgREST query without a DB
 * object (generated search column / denormalized column / RPC / view), and the
 * only fold-in — `manufacturer_id.in.(all matching ids)` — is an unbounded URL
 * list. Manufacturer scoping is instead the first-class manufacturer FILTER
 * (bounded `.eq`). Complete brand-name free-text search is BLOCKED ON DATABASE
 * DESIGN — see docs/product/M8F2_PRODUCTS_SERVER_PAGINATION.md. (Category name
 * was never searchable.)
 */
export function productMatchesSearch(product: Product, term: string): boolean {
  const q = term.trim().toLowerCase();
  if (!q) return true;
  return [
    ...SEARCH_LOCALES.map((l) => product.translations[l]?.name ?? ""),
    product.sku ?? "",
    product.barcode ?? "",
  ]
    .join(" ")
    .toLowerCase()
    .includes(q);
}

/** True when a product passes the status facet ("all" always passes; mock rows
 * without is_active are implicitly active). Shared by mock list + export. */
export function productMatchesStatus(
  product: Product,
  status: ProductStatusFacet,
): boolean {
  if (status === "active") return product.isActive !== false;
  if (status === "inactive") return product.isActive === false;
  return true;
}

/** A SKU is "blank" (sorts last) when it is NULL/absent, empty, or only
 * whitespace — the mock/supabase-agreed normalization for the no-SKU case. */
export function isBlankSku(sku: string | null | undefined): boolean {
  return sku == null || sku.trim() === "";
}

/** Deterministic, LOCALE-INDEPENDENT string order: compare by UTF-16 code unit
 * (`<`/`>`), never `localeCompare` (whose result varies by environment locale).
 * For the ASCII SKUs the app produces this equals the DB's byte ordering. */
function codeUnitCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Deterministic product sort — the ONE contract shared by mock and supabase:
 *   1. non-blank SKUs sort BEFORE blank ones (NULL/empty/whitespace last);
 *   2. among non-blank SKUs, ascending by raw SKU, code-unit (not locale-aware);
 *   3. final unique tie-breaker: id ascending (code-unit).
 * Paging is therefore skip-/dup-free. This promotes the existing SECONDARY key
 * (SKU) to primary — the old list sorted by category SHELF order then SKU, but
 * shelf order lives on the categories relation and can't be expressed in a
 * single server-side query without a denormalized column (a migration — out of
 * scope). Supabase mirror: `.order("sku", { ascending, nullsFirst:false })`
 * (NULL last) `.order("id")`; the write path stores SKUs trimmed-or-NULL and as
 * ASCII, so the DB ordering matches this. See the M8F.2 doc.
 */
export function compareProductsForList(a: Product, b: Product): number {
  const blankA = isBlankSku(a.sku);
  const blankB = isBlankSku(b.sku);
  if (blankA !== blankB) return blankA ? 1 : -1;
  if (!blankA) {
    const bySku = codeUnitCompare(a.sku as string, b.sku as string);
    if (bySku !== 0) return bySku;
  }
  return codeUnitCompare(a.id, b.id);
}
