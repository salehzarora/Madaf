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
import type { LocalizedText, Product } from "@/lib/types";

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

/** Literal, case-insensitive substring match on ONE field — mirrors the RPC's
 * `strpos(lower(field), lower(term)) > 0` (per-field, not a joined haystack, so
 * a term can't match across a field boundary). */
function fieldMatches(field: string | null | undefined, q: string): boolean {
  return (field ?? "").toLowerCase().includes(q);
}

/**
 * Does a product match a free-text term? Mirrors the RPC search EXACTLY (M8F.2):
 * a literal, case-insensitive substring against the product's OWN columns —
 * name (all three locales), SKU, barcode — OR (when the manufacturer name is
 * supplied) the manufacturer/brand NAME in any locale. The manufacturer-name
 * arm restores the pre-M8F.2 brand search and broadens it to all three locales;
 * supabase resolves it through the `search_product_page_ids` RPC's real
 * products⇄manufacturers LEFT JOIN. Category name is NOT searched (it never was).
 * Used by the mock data layer and the tests so mock and supabase agree.
 */
export function productMatchesSearch(
  product: Product,
  term: string,
  manufacturerName?: LocalizedText | null,
): boolean {
  const q = term.trim().toLowerCase();
  if (!q) return true;
  const own =
    SEARCH_LOCALES.some((l) => fieldMatches(product.translations[l]?.name, q)) ||
    fieldMatches(product.sku, q) ||
    fieldMatches(product.barcode, q);
  return own || manufacturerMatchesSearch(manufacturerName, term);
}

/** Does a manufacturer/brand NAME (any locale) match the term? The mock mirror
 * of the RPC's manufacturer-name arm — kept separate so both the combined match
 * and the brand-name semantics are unit-tested directly. */
export function manufacturerMatchesSearch(
  name: LocalizedText | null | undefined,
  term: string,
): boolean {
  const q = term.trim().toLowerCase();
  if (!q || !name) return false;
  return SEARCH_LOCALES.some((l) => fieldMatches(name[l], q));
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

/**
 * The SKU SORT KEY — mirrors the SQL `nullif(btrim(sku), '')`: trim ONLY ASCII
 * spaces (btrim's default, NOT all whitespace) and treat the result as absent
 * when empty. So a NULL/absent, all-spaces SKU sorts as "blank" (last); the
 * ordering key for a non-blank SKU is its space-trimmed value.
 */
export function skuSortKey(sku: string | null | undefined): string | null {
  if (sku == null) return null;
  const trimmed = sku.replace(/^ +/, "").replace(/ +$/, "");
  return trimmed === "" ? null : trimmed;
}

/** A SKU is "blank" (sorts last) when its sort key is absent — NULL, empty, or
 * spaces-only — matching SQL `nullif(btrim(sku), '') is null`. */
export function isBlankSku(sku: string | null | undefined): boolean {
  return skuSortKey(sku) === null;
}

const utf8 = new TextEncoder();

/**
 * Compare two strings by their UTF-8 BYTES — EXACTLY PostgreSQL `COLLATE "C"`
 * (byte order on the UTF-8 encoding). Not `localeCompare` (locale-dependent) and
 * not JS `<`/`>` (UTF-16 code-UNIT order, which mis-sorts astral characters vs
 * high-BMP relative to code points / UTF-8 bytes). Browser- and Node-safe.
 */
export function utf8ByteCompare(a: string, b: string): number {
  const ba = utf8.encode(a);
  const bb = utf8.encode(b);
  const n = Math.min(ba.length, bb.length);
  for (let i = 0; i < n; i++) {
    if (ba[i] !== bb[i]) return ba[i] < bb[i] ? -1 : 1;
  }
  return ba.length === bb.length ? 0 : ba.length < bb.length ? -1 : 1;
}

/**
 * Deterministic product sort — the ONE contract shared by mock and supabase,
 * mirroring the RPC's `order by (nullif(btrim(sku),'') is null),
 * nullif(btrim(sku),'') collate "C" asc, id asc`:
 *   1. non-blank SKUs before blank ones (NULL/empty/spaces-only last);
 *   2. non-blank SKUs ascending by their space-trimmed value, UTF-8 byte order
 *      (== `COLLATE "C"`) — locale-independent, exact in every environment;
 *   3. final unique tie-breaker: id ascending (UTF-8 byte order).
 * Paging is therefore skip-/dup-free. (Supabase's id is a uuid ordered by its
 * binary value — the SKU ordering is what must match; id is only a tie-break.)
 */
export function compareProductsForList(a: Product, b: Product): number {
  const ka = skuSortKey(a.sku);
  const kb = skuSortKey(b.sku);
  if ((ka === null) !== (kb === null)) return ka === null ? 1 : -1;
  if (ka !== null && kb !== null) {
    const bySku = utf8ByteCompare(ka, kb);
    if (bySku !== 0) return bySku;
  }
  return utf8ByteCompare(a.id, b.id);
}
