import "server-only";

/**
 * Supabase read implementations (M2, re-homed onto auth in M4A) — SERVER
 * ONLY.
 *
 * Maps database rows (generated types) onto the UI domain types in
 * src/lib/types.ts so every page renders identically in mock and
 * supabase mode. Reached exclusively through the src/lib/data functions
 * via a dynamic import, so nothing here (or in @supabase/supabase-js)
 * ever enters a client bundle.
 *
 * Access model (M4A): reads run through the cookie-bound *authenticated*
 * client under RLS — a signed-in member sees only their tenant's rows.
 * The effective tenant comes from the caller's membership (getDataContext),
 * never from client input, and every query still filters tenant_id
 * explicitly as belt-and-braces. Anonymous / membership-less callers carry
 * the NO_TENANT sentinel: since anon holds no table grants (a public read
 * would 500, not silently empty), those reads short-circuit to empty
 * BEFORE touching the DB — the catalog is never globally public.
 */
import type { Database } from "@/lib/supabase/database.types";
import type { OrderDocumentSource } from "@/lib/pdf/document-model";
import type {
  Availability,
  Category,
  Customer,
  CustomerQuery,
  DocumentType,
  InventoryItem,
  InventoryMovement,
  MovementQuery,
  Manufacturer,
  Order,
  OrderCustomerSnapshot,
  OrderDocument,
  OrderStatus,
  Product,
  Supplier,
} from "@/lib/types";
import {
  clampExportLimit,
  collectExportRows,
  ORDERS_MAX_PAGE_SIZE,
  totalPagesFor,
  type OrderListRow,
  type OrdersExportCursor,
  type OrdersListResult,
  type OrdersQuery,
} from "@/lib/orders-query";
import { tenantDateRangeUtc } from "@/lib/tenant-day";
import {
  PRODUCTS_MAX_PAGE_SIZE,
  type ProductExportRow,
  type ProductsListResult,
  type ProductsQuery,
} from "@/lib/products-query";
import { resolveTenantTimeZone } from "@/lib/time";

import type { Db } from "./supabase-context";
import type { CustomerRowStat } from "./customers";
import type { DashboardMetrics } from "./dashboard";
import {
  getDataContext,
  getSessionContext,
  getTenantTimeZone,
  NO_TENANT,
} from "@/lib/auth/session";
import {
  buildTimelineEvent,
  decodeTimelineCursor,
  distinctActorIds,
  encodeTimelineCursor,
  resolveTimelineActor,
  type TimelinePage,
} from "@/lib/customer-timeline";
import {
  buildOrderTimelineEvent,
  type OrderTimelinePage,
} from "@/lib/order-timeline";
import {
  buildProductTimelineEvent,
  type ProductTimelinePage,
} from "@/lib/product-timeline";
import {
  buildInventoryTimelineEvent,
  type InventoryTimelinePage,
} from "@/lib/inventory-timeline";
import {
  buildTeamTimelineEvent,
  type TeamTimelinePage,
} from "@/lib/team-timeline";
import {
  buildSettingsTimelineEvent,
  type SettingsTimelinePage,
} from "@/lib/settings-timeline";
import {
  buildSalesRepAssignmentTimelineEvent,
  type SalesRepAssignmentTimelinePage,
} from "@/lib/sales-rep-assignment-timeline";

type Row<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];

// M4A: reads run through the authenticated cookie-bound client under RLS
// (a member sees only their tenant; anon sees zero rows). The explicit
// tenant filter below is belt-and-braces on top of RLS.
const getReadContext = getDataContext;

/**
 * True when the caller has no tenant membership (anon or not-yet-onboarded).
 * Such callers hold no table grants, so a query would raise "permission
 * denied" (a 500) rather than return empty — every read guards on this and
 * returns an empty result without hitting the DB.
 */
function isTenantless(tenantId: string): boolean {
  return tenantId === NO_TENANT;
}

/**
 * The domain types use `""` for a missing id (e.g. an order with no linked
 * customer maps `customer_id: null → customerId: ""`). Passing `""` (or any
 * non-UUID) to `.eq("<uuid col>", …)` makes Postgres raise
 * `invalid input syntax for type uuid`, which would surface as a 500/error
 * page instead of a clean "not found". Every single-row getter below guards
 * on this and returns `undefined` WITHOUT querying — a blank/unknown id simply
 * has no row.
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(id: string): boolean {
  return typeof id === "string" && UUID_RE.test(id);
}

function fail(what: string, message: string): never {
  throw new Error(`[madaf/data] supabase read failed (${what}): ${message}`);
}

// ── Row → UI-type mappers ─────────────────────────────────────────────────
// The UI types predate the DB and use "" for a few required-but-missing
// strings (sku, categoryId…); lookups against "" simply miss, which every
// consumer already tolerates for unknown ids.

function mapCategory(row: Row<"categories">): Category {
  return {
    id: row.id,
    name: { ar: row.name_ar, he: row.name_he, en: row.name_en },
    icon: row.icon ?? "",
    hue: row.color_hue,
  };
}

function mapManufacturer(row: Row<"manufacturers">): Manufacturer {
  return {
    id: row.id,
    name: { ar: row.name_ar, he: row.name_he, en: row.name_en },
    logoUrl: row.logo_url ?? undefined,
  };
}

/**
 * Availability derivation for the admin catalog + `/product/[id]` read path
 * (via `mapProduct`). Reads the embedded `inventory_items` row: NO row →
 * In-stock (untracked/available); quantity 0 → Out-of-stock; below the
 * threshold → Low-stock. Exported for behavioural tests (B2) — no behaviour
 * change. (The public shop uses the parallel copy in `token.ts`.)
 */
export function deriveAvailability(
  inv: Pick<
    Row<"inventory_items">,
    "quantity_available" | "low_stock_threshold"
  > | null,
): Availability {
  if (!inv) return "inStock";
  if (inv.quantity_available <= 0) return "outOfStock";
  if (inv.quantity_available < inv.low_stock_threshold) return "lowStock";
  return "inStock";
}

// inventory_items embeds as a SINGLE OBJECT (not an array): the unique
// (tenant_id, product_id) constraint covers the FK, so PostgREST treats
// the relationship as one-to-one (isOneToOne in database.types.ts).
type ProductRow = Row<"products"> & {
  inventory_items: Pick<
    Row<"inventory_items">,
    "quantity_available" | "low_stock_threshold"
  > | null;
};

function mapProduct(row: ProductRow): Product {
  const description = {
    ar: row.description_ar ?? undefined,
    he: row.description_he ?? undefined,
    en: row.description_en ?? undefined,
  };
  return {
    id: row.id,
    sku: row.sku ?? "",
    barcode: row.barcode ?? undefined,
    translations: {
      ar: { name: row.name_ar, description: description.ar },
      he: { name: row.name_he, description: description.he },
      en: { name: row.name_en, description: description.en },
    },
    categoryId: row.category_id ?? "",
    manufacturerId: row.manufacturer_id ?? "",
    packageType: row.package_unit,
    unitsPerPackage: row.package_quantity,
    baseUnit: row.base_unit,
    unitSize: row.unit_size ?? undefined,
    wholesalePrice: row.wholesale_price,
    availability: deriveAvailability(row.inventory_items),
    trackExpiry: row.track_expiry || undefined,
    // Raw image_url: an external URL passes through; a storage object path
    // is resolved to a signed URL by signProductImages() before returning.
    imageUrl: row.image_url ?? undefined,
    vatRate: row.vat_rate,
    isActive: row.is_active,
  };
}

/** Product-images bucket (private); storage paths get signed at read time. */
const PRODUCT_IMAGE_BUCKET = "product-images";
const SIGNED_URL_TTL_SECONDS = 3600;

function isExternalUrl(value: string | undefined): boolean {
  return typeof value === "string" && /^https?:\/\//i.test(value);
}

/**
 * Resolve storage-object-path imageUrls to fresh signed URLs (the bucket
 * is private) and record the raw path in imageStoragePath so the edit
 * form can re-persist the PATH, not the ephemeral signed URL.
 *
 * Only paths under the CURRENT tenant's prefix are signed — a free-text
 * image_url that isn't an http(s) URL and isn't an own-tenant object path
 * falls back to no image (gradient), so a hand-typed cross-tenant path
 * can never be signed and served. External http(s) URLs pass through.
 * One batched signing call per read; reads are per-request server-side,
 * so the short TTL never expires in a rendered page.
 */
async function signProductImages(
  client: Db,
  tenantId: string,
  products: Product[],
): Promise<Product[]> {
  const prefix = `${tenantId}/`;
  const pathItems = products
    .map((p, index) => ({ index, path: p.imageUrl }))
    .filter(
      (x): x is { index: number; path: string } =>
        typeof x.path === "string" &&
        !isExternalUrl(x.path) &&
        x.path.startsWith(prefix),
    );

  const out = products.map((p) =>
    // External URL → keep as display, no storage path. Non-http value not
    // under our tenant prefix → not a servable image (drop to gradient).
    isExternalUrl(p.imageUrl)
      ? p
      : p.imageUrl && p.imageUrl.startsWith(prefix)
        ? { ...p, imageStoragePath: p.imageUrl }
        : { ...p, imageUrl: undefined },
  );
  if (pathItems.length === 0) return out;

  const { data } = await client.storage
    .from(PRODUCT_IMAGE_BUCKET)
    .createSignedUrls(
      pathItems.map((x) => x.path),
      SIGNED_URL_TTL_SECONDS,
    );

  pathItems.forEach((item, k) => {
    const signed = data?.[k]?.signedUrl;
    // Keep imageStoragePath (raw) for editing; imageUrl becomes the signed
    // display URL, or undefined (gradient) if the object is missing.
    out[item.index] = { ...out[item.index], imageUrl: signed ?? undefined };
  });
  return out;
}

/**
 * Same signing model as signProductImages, for manufacturer/brand logos
 * (M8E.3). External http(s) URLs pass through; an own-tenant storage object
 * path (under `<tenantId>/`) is recorded on `logoStoragePath` (so the edit
 * form re-persists the PATH, not the ephemeral signed URL) and signed for
 * display; anything else drops to no logo (glyph fallback). A hand-typed
 * cross-tenant path can never be signed. Logos live under
 * `<tenantId>/manufacturers/…` in the same private product-images bucket.
 */
async function signManufacturerLogos(
  client: Db,
  tenantId: string,
  manufacturers: Manufacturer[],
): Promise<Manufacturer[]> {
  const prefix = `${tenantId}/`;
  const pathItems = manufacturers
    .map((m, index) => ({ index, path: m.logoUrl }))
    .filter(
      (x): x is { index: number; path: string } =>
        typeof x.path === "string" &&
        !isExternalUrl(x.path) &&
        x.path.startsWith(prefix),
    );

  const out = manufacturers.map((m) =>
    isExternalUrl(m.logoUrl)
      ? m
      : m.logoUrl && m.logoUrl.startsWith(prefix)
        ? { ...m, logoStoragePath: m.logoUrl }
        : { ...m, logoUrl: undefined },
  );
  if (pathItems.length === 0) return out;

  const { data } = await client.storage
    .from(PRODUCT_IMAGE_BUCKET)
    .createSignedUrls(
      pathItems.map((x) => x.path),
      SIGNED_URL_TTL_SECONDS,
    );

  pathItems.forEach((item, k) => {
    const signed = data?.[k]?.signedUrl;
    out[item.index] = { ...out[item.index], logoUrl: signed ?? undefined };
  });
  return out;
}

function mapCustomer(row: Row<"customers">): Customer {
  return {
    id: row.id,
    name: row.name,
    type: row.customer_type,
    city: {
      ar: row.city_ar ?? "",
      he: row.city_he ?? "",
      en: row.city_en ?? "",
    },
    phone: row.phone ?? "",
    contactName: row.contact_name ?? "",
    address: row.address ?? undefined,
    notes: row.notes ?? undefined,
    isActive: row.is_active,
    origin: row.origin,
  };
}

function mapInventory(row: Row<"inventory_items">): InventoryItem {
  return {
    productId: row.product_id,
    stockPackages: row.quantity_available,
    location: row.warehouse_location ?? "",
    nearestExpiry: row.expiry_date ?? undefined,
    lowStockThreshold: row.low_stock_threshold,
  };
}

type OrderRow = Row<"orders"> & {
  order_items: Pick<
    Row<"order_items">,
    "product_id" | "quantity" | "unit_price_snapshot" | "created_at" | "id"
  >[];
};

function mapOrder(row: OrderRow): Order {
  // Stable line order across requests: embeds come back in unspecified
  // heap order. created_at ties within the seed (single INSERT), so id
  // breaks ties deterministically. M3's write path inserts lines with
  // distinct timestamps, restoring true insertion order.
  const items = [...row.order_items].sort(
    (a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
  );
  return {
    id: row.id,
    number: row.order_number,
    publicRef: row.public_ref,
    customerId: row.customer_id ?? "",
    source: row.source,
    customerSnapshot: mapCustomerSnapshot(row.customer_snapshot),
    items: items.map((item) => ({
      productId: item.product_id ?? "",
      quantity: item.quantity,
      unitPrice: item.unit_price_snapshot,
    })),
    status: row.status,
    createdAt: row.created_at,
    notes: row.notes ?? undefined,
    // Server-stored totals (M8E.5) — the document preview renders THESE (same
    // as the PDF) instead of recomputing, so preview and PDF never diverge.
    subtotal: row.subtotal ?? undefined,
    vatTotal: row.vat_total ?? undefined,
    total: row.total ?? undefined,
  };
}

/** Guest-order buyer snapshot (M7I). Free-form jsonb → typed, string-guarded;
 * only surfaced when the order has no linked customer. */
function mapCustomerSnapshot(raw: unknown): OrderCustomerSnapshot | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const s = raw as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
  const cityRaw =
    s.city && typeof s.city === "object"
      ? (s.city as Record<string, unknown>)
      : undefined;
  const snap: OrderCustomerSnapshot = {
    name: str(s.name),
    contactName: str(s.contact_name),
    phone: str(s.phone),
    email: str(s.email),
    address: str(s.address),
    city: cityRaw
      ? { ar: str(cityRaw.ar), he: str(cityRaw.he), en: str(cityRaw.en) }
      : undefined,
    guest: s.guest === true,
  };
  // Nothing meaningful → treat as absent (sales-visit / shop orders).
  return snap.name || snap.guest ? snap : undefined;
}

const DOCUMENT_TYPE_FROM_DB: Record<
  Row<"documents">["document_type"],
  DocumentType
> = {
  order_request: "order",
  delivery_note: "delivery",
  invoice_draft: "invoiceDraft",
};

function mapDocument(row: Row<"documents">): OrderDocument {
  return {
    id: row.id,
    type: DOCUMENT_TYPE_FROM_DB[row.document_type],
    orderId: row.order_id,
    number: row.document_number,
    date: row.created_at,
    status: row.status,
    generatedAt: row.generated_at ?? undefined,
  };
}

// Within an order, documents display in lifecycle order — order request,
// delivery note, invoice draft — exactly like the mock derivation.
const DOCUMENT_TYPE_RANK: Record<DocumentType, number> = {
  order: 0,
  delivery: 1,
  invoiceDraft: 2,
};

function byDocumentLifecycle(a: OrderDocument, b: OrderDocument): number {
  return DOCUMENT_TYPE_RANK[a.type] - DOCUMENT_TYPE_RANK[b.type];
}

// ── Reads ─────────────────────────────────────────────────────────────────

const PRODUCT_SELECT =
  "*, inventory_items (quantity_available, low_stock_threshold), categories (sort_order)";

type ProductRowWithSort = ProductRow & {
  categories: Pick<Row<"categories">, "sort_order"> | null;
};

export async function sbListProducts(
  includeInactive = false,
): Promise<Product[]> {
  const { client, tenantId } = await getReadContext();
  if (isTenantless(tenantId)) return [];
  let query = client
    .from("products")
    .select(PRODUCT_SELECT)
    .eq("tenant_id", tenantId);
  // Catalog reads see only active products; admin passes includeInactive.
  if (!includeInactive) query = query.eq("is_active", true);
  const { data, error } = await query;
  if (error) fail("listProducts", error.message);
  // Match the mock catalog's visual order: category shelf order, then SKU.
  const mapped = (data as ProductRowWithSort[])
    .sort(
      (a, b) =>
        (a.categories?.sort_order ?? 99) - (b.categories?.sort_order ?? 99) ||
        (a.sku ?? "").localeCompare(b.sku ?? ""),
    )
    .map(mapProduct);
  return signProductImages(client, tenantId, mapped);
}

export async function sbGetProduct(id: string): Promise<Product | undefined> {
  const { client, tenantId } = await getReadContext();
  if (isTenantless(tenantId) || !isUuid(id)) return undefined;
  const { data, error } = await client
    .from("products")
    .select(PRODUCT_SELECT)
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();
  if (error) fail("getProduct", error.message);
  if (!data) return undefined;
  const [signed] = await signProductImages(client, tenantId, [
    mapProduct(data as ProductRow),
  ]);
  return signed;
}

// ── Products server-side search + pagination (M8F.2) ──────────────────────
// The admin list fetches ONLY the current page + the exact filtered total,
// signing only the current page's images. Search covers the product's OWN
// columns (name ar/he/en, sku, barcode); category / manufacturer / status are
// filters. RLS scopes rows to the tenant (admin sees inactive too under the
// products SELECT policy); the explicit tenant_id filter is belt-and-braces.
// LIST select embeds inventory_items so availability is derived per row without
// a second query (no N+1) — categories(sort_order) is NOT needed (the sort is
// sku-based, expressible in the DB) so the leaner select is used.
const PRODUCT_LIST_SELECT =
  "*, inventory_items (quantity_available, low_stock_threshold)";

// One metadata row from public.search_product_page_ids (M8F.2). Complete
// free-text search (product name ar/he/en + sku + barcode OR manufacturer name
// ar/he/en) via a tenant-safe LEFT JOIN, deterministic COLLATE "C" SKU order,
// exact count, and the CURRENT page's ordered ids (bounded ≤ page size). The
// RPC is SECURITY INVOKER — RLS is the authorization boundary; p_tenant_id is
// server-derived (getReadContext) belt-and-braces. Detail rows (incl. inventory
// for availability) are fetched afterwards for just those bounded ids.
type SearchPageRow = {
  total_count: number | string;
  page: number;
  page_size: number;
  total_pages: number;
  product_ids: string[] | null;
};

async function callSearchProductPage(
  client: Db,
  tenantId: string,
  query: ProductsQuery,
  page: number,
  pageSize: number,
): Promise<SearchPageRow | null> {
  const { data, error } = await client.rpc("search_product_page_ids", {
    p_tenant_id: tenantId,
    p_search: query.search,
    // Non-UUID ids are guarded to empty by the callers before we get here, so
    // these are a valid uuid or omitted (→ RPC default null; no cast failure).
    p_category_id: query.categoryId ?? undefined,
    p_manufacturer_id: query.manufacturerId ?? undefined,
    p_status: query.status,
    p_page: page,
    p_page_size: pageSize,
  });
  if (error) fail("searchProductPage", error.message);
  return (data as SearchPageRow[] | null)?.[0] ?? null;
}

/** Fetch the detail rows for a BOUNDED set of current-page ids (≤ page size),
 * preserving the RPC order and safely skipping any id whose row vanished
 * between the count and the fetch (deleted concurrently). */
async function sbProductRowsByIdsOrdered(
  client: Db,
  tenantId: string,
  ids: string[],
): Promise<ProductRow[]> {
  if (ids.length === 0) return [];
  const { data, error } = await client
    .from("products")
    .select(PRODUCT_LIST_SELECT)
    .eq("tenant_id", tenantId)
    .in("id", ids);
  if (error) fail("productRowsByIds", error.message);
  const byId = new Map(
    (data as unknown as ProductRow[]).map((r) => [r.id, r]),
  );
  return ids
    .map((id) => byId.get(id))
    .filter((r): r is ProductRow => r != null);
}

export async function sbSearchProducts(
  query: ProductsQuery,
): Promise<ProductsListResult> {
  const { client, tenantId } = await getReadContext();
  const pageSize = Math.min(Math.max(1, query.pageSize), PRODUCTS_MAX_PAGE_SIZE);
  const empty: ProductsListResult = {
    products: [],
    total: 0,
    page: 1,
    pageSize,
    totalPages: 1,
  };
  if (isTenantless(tenantId)) return empty;
  // A present-but-non-UUID category/manufacturer id can match no product (the
  // RPC's uuid params would cast-fail); return zero rows instead.
  if (query.categoryId && !isUuid(query.categoryId)) return empty;
  if (query.manufacturerId && !isUuid(query.manufacturerId)) return empty;

  // The RPC does the search (incl. manufacturer-name via JOIN), the exact
  // count, the deterministic C-collation order, the page clamp, and returns the
  // current page's ORDERED ids (bounded ≤ pageSize) — no unbounded id set.
  const row = await callSearchProductPage(client, tenantId, query, query.page, pageSize);
  if (!row) return empty;
  const total = Number(row.total_count) || 0;
  const page = row.page ?? 1;
  const totalPages = row.total_pages ?? 1;
  const ids = row.product_ids ?? [];
  if (ids.length === 0) return { products: [], total, page, pageSize, totalPages };

  // Detail fetch for the bounded page ids only, kept in RPC order; sign ONLY
  // the current page's images.
  const rows = await sbProductRowsByIdsOrdered(client, tenantId, ids);
  const signed = await signProductImages(client, tenantId, rows.map(mapProduct));
  return { products: signed, total, page, pageSize, totalPages };
}

export async function sbListProductsForExport(
  query: ProductsQuery,
  cap: number,
): Promise<ProductExportRow[]> {
  const { client, tenantId } = await getReadContext();
  if (isTenantless(tenantId)) return [];
  if (query.categoryId && !isUuid(query.categoryId)) return [];
  if (query.manufacturerId && !isUuid(query.manufacturerId)) return [];
  const limit = Math.max(1, cap);
  const batch = PRODUCTS_MAX_PAGE_SIZE; // bounded per-request id set (≤ 100)
  const out: ProductExportRow[] = [];
  const seen = new Set<string>();
  // Bounded loop over RPC pages: at most one page more than needed to reach the
  // cap; the total_pages break + the maxPages guard prevent an infinite loop,
  // and `seen` de-dupes any id that reappears (concurrent insert shifting rows).
  const maxPages = Math.ceil(limit / batch) + 2;
  for (let page = 1, totalPages = 1; page <= maxPages && out.length < limit; page++) {
    const row = await callSearchProductPage(client, tenantId, query, page, batch);
    if (!row) break;
    totalPages = row.total_pages ?? 1;
    const ids = (row.product_ids ?? []).filter((id) => !seen.has(id));
    if (ids.length > 0) {
      ids.forEach((id) => seen.add(id));
      const rows = await sbProductRowsByIdsOrdered(client, tenantId, ids);
      // The CSV never includes images — strip the raw storage path so it never
      // reaches the client; sign NO images for the export.
      for (const r of rows) {
        const inv = r.inventory_items;
        out.push({
          product: { ...mapProduct(r), imageUrl: undefined, imageStoragePath: undefined },
          stockPackages: inv ? inv.quantity_available : null,
          isLowStock: inv ? inv.quantity_available < inv.low_stock_threshold : null,
        });
      }
    }
    if (page >= totalPages) break;
  }
  return out.slice(0, limit);
}

export async function sbListCategories(): Promise<Category[]> {
  const { client, tenantId } = await getReadContext();
  if (isTenantless(tenantId)) return [];
  const { data, error } = await client
    .from("categories")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("sort_order");
  if (error) fail("listCategories", error.message);
  return data.map(mapCategory);
}

export async function sbGetCategory(
  id: string,
): Promise<Category | undefined> {
  const { client, tenantId } = await getReadContext();
  if (isTenantless(tenantId) || !isUuid(id)) return undefined;
  const { data, error } = await client
    .from("categories")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();
  if (error) fail("getCategory", error.message);
  return data ? mapCategory(data) : undefined;
}

export async function sbListManufacturers(): Promise<Manufacturer[]> {
  const { client, tenantId } = await getReadContext();
  if (isTenantless(tenantId)) return [];
  const { data, error } = await client
    .from("manufacturers")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("sort_order");
  if (error) fail("listManufacturers", error.message);
  return signManufacturerLogos(client, tenantId, data.map(mapManufacturer));
}

export async function sbGetManufacturer(
  id: string,
): Promise<Manufacturer | undefined> {
  const { client, tenantId } = await getReadContext();
  if (isTenantless(tenantId) || !isUuid(id)) return undefined;
  const { data, error } = await client
    .from("manufacturers")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();
  if (error) fail("getManufacturer", error.message);
  if (!data) return undefined;
  const [signed] = await signManufacturerLogos(client, tenantId, [
    mapManufacturer(data),
  ]);
  return signed;
}

// ── Customer order statistics (M8F.3) ─────────────────────────────────────
// One bounded aggregate for the current Customers page's ids — replaces the
// former full-orders scan. SECURITY INVOKER RPC: RLS scopes both customers
// (can_access_customer) and the joined orders (can_access_order), so a
// sales_rep's stats cover only their assigned stores and an inaccessible id
// yields no row. The tenant is server-derived; ids are a bounded array arg.
type CustomerStatDbRow = {
  customer_id: string;
  order_count: number | string;
  last_order_at: string | null;
};

export async function sbGetCustomerStatsForIds(
  ids: string[],
): Promise<Record<string, CustomerRowStat>> {
  const { client, tenantId } = await getReadContext();
  if (isTenantless(tenantId)) return {};
  // Only UUID ids can match customers.id (a non-UUID would cast-fail the uuid[]
  // arg); the RPC starts from visible customers, so a dropped id has no row.
  const uuidIds = ids.filter(isUuid);
  if (uuidIds.length === 0) return {};
  const { data, error } = await client.rpc("get_customer_stats_for_ids", {
    p_tenant_id: tenantId,
    p_customer_ids: uuidIds,
  });
  if (error) fail("getCustomerStatsForIds", error.message);
  const out: Record<string, CustomerRowStat> = {};
  for (const row of (data as CustomerStatDbRow[] | null) ?? []) {
    out[row.customer_id] = {
      count: Number(row.order_count) || 0,
      lastOrder: row.last_order_at ?? undefined,
    };
  }
  return out;
}

// ── Customer Timeline (M8G.3) ─────────────────────────────────────────────
// A bounded, cursor-paginated read of the M8G.2 audit_events for ONE customer.
// RLS is the authorization boundary: the M8G.2 policy scopes customer rows by
// can_access_customer, so a sales_rep sees ONLY assigned customers' events and
// an inaccessible/foreign customer yields zero rows. Tenant is server-derived;
// entity_type is fixed. Actors are resolved in ONE roster lookup (no N+1) and
// only to owner/admin (a sales_rep sees a neutral "team member" label). Never
// selects or returns tokens/hashes/URLs/PII — metadata is client-safe-projected.
type AuditEventRow = {
  id: number;
  event_type: string;
  actor_user_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

export async function sbGetCustomerTimelinePage(input: {
  customerId: string;
  cursor: string | null;
  pageSize: number;
}): Promise<TimelinePage> {
  const { client, tenantId } = await getReadContext();
  if (isTenantless(tenantId) || !isUuid(input.customerId)) {
    return { events: [], nextCursor: null, hasMore: false };
  }
  const cursor = decodeTimelineCursor(input.cursor);

  let query = client
    .from("audit_events")
    .select("id, event_type, actor_user_id, metadata, created_at")
    .eq("tenant_id", tenantId)
    .eq("entity_type", "customer")
    .eq("entity_id", input.customerId);

  // Keyset predicate: rows strictly OLDER than the cursor in (created_at DESC,
  // id DESC) order — the row-value comparison (created_at, id) < (c_ts, c_id),
  // expanded for PostgREST. Row-value (not id-only) so it is correct even if id
  // and created_at ever diverge (backfill / clock skew).
  if (cursor) {
    query = query.or(
      `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`,
    );
  }

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(input.pageSize + 1);
  if (error) fail("getCustomerTimelinePage", error.message);

  const rows = (data as AuditEventRow[] | null) ?? [];
  const hasMore = rows.length > input.pageSize;
  const page = rows.slice(0, input.pageSize);

  // Resolve labels for ONLY this page's DISTINCT actor ids (bounded ≤ pageSize,
  // deduped) — never a per-row lookup and never the whole roster held here.
  // owner/admin fall back to named/former; a sales_rep sees the neutral "team
  // member" label (sbGetTimelineActorLabels returns no identity for them).
  const role = (await getSessionContext()).membership?.role ?? null;
  const isAdmin = role === "owner" || role === "admin";
  const emails = await sbGetTimelineActorLabels(
    distinctActorIds(page.map((r) => r.actor_user_id)),
  );

  const events = page.map((r) =>
    buildTimelineEvent({
      id: String(r.id),
      eventType: r.event_type,
      createdAt: r.created_at,
      actor: resolveTimelineActor(r.actor_user_id, { isAdmin, emails }),
      metadata: r.metadata,
    }),
  );

  const last = page[page.length - 1];
  const nextCursor =
    hasMore && last
      ? encodeTimelineCursor({ createdAt: last.created_at, id: String(last.id) })
      : null;
  return { events, nextCursor, hasMore };
}

/**
 * Display labels for ONLY the given DISTINCT page actor ids (bounded ≤ 50 by
 * {@link distinctActorIds}; empty input → NO query). Named labels are
 * owner/admin-only, matching the team-roster visibility: a sales_rep / non-member
 * gets an empty map with NO query, so no actor identity is exposed.
 *
 * Resolution is ONE genuinely bounded RPC — `get_timeline_actor_labels_for_ids`
 * (20260801110000) — that joins ONLY these requested ids to the tenant's current
 * members and `auth.users`, returning at most `{ actor_user_id, actor_email }`
 * rows for them. The full roster is never read (no `list_tenant_members`), a
 * cross-tenant / non-member / unknown id yields no row, and only final labels
 * reach the caller — raw member/auth rows never cross the boundary. The tenant is
 * server-derived and re-validated inside the RPC (owner/admin of the NAMED
 * tenant); no client-supplied tenant is trusted and there is no elevated path.
 */
export async function sbGetTimelineActorLabels(
  actorIds: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (actorIds.length === 0) return out;
  const { client, tenantId } = await getReadContext();
  if (isTenantless(tenantId)) return out;
  const role = (await getSessionContext()).membership?.role ?? null;
  if (role !== "owner" && role !== "admin") return out; // sales_rep → no query
  const { data, error } = await client.rpc("get_timeline_actor_labels_for_ids", {
    p_tenant_id: tenantId,
    p_actor_user_ids: actorIds,
  });
  if (error || !data) return out;
  for (const row of data) out.set(row.actor_user_id, row.actor_email);
  return out;
}

// ── Order Timeline (M8H.3) ────────────────────────────────────────────────
// The SAME bounded, cursor-paginated audit read as the Customer Timeline, with
// entity_type fixed to 'order'. RLS is the authorization boundary: the M8H.1
// SELECT clause requires `entity_id is not null and can_access_order(tenant_id,
// entity_id)`, so a sales_rep sees ONLY the history of orders they can already
// open, and an inaccessible / foreign order yields zero rows — this function
// adds no authorization of its own and must not be asked to.
//
// It reuses the M8G.3 index (tenant_id, entity_type, entity_id, created_at desc,
// id desc), which is entity-generic — so no migration and no new index is
// needed. Actors are resolved in ONE bounded RPC (never per row), and metadata
// is client-safe-projected before it leaves the server.
export async function sbGetOrderTimelinePage(input: {
  orderId: string;
  cursor: string | null;
  pageSize: number;
}): Promise<OrderTimelinePage> {
  const { client, tenantId } = await getReadContext();
  if (isTenantless(tenantId) || !isUuid(input.orderId)) {
    return { events: [], nextCursor: null, hasMore: false };
  }
  const cursor = decodeTimelineCursor(input.cursor);

  let query = client
    .from("audit_events")
    .select("id, event_type, actor_user_id, metadata, created_at")
    .eq("tenant_id", tenantId)
    .eq("entity_type", "order")
    .eq("entity_id", input.orderId);

  // Keyset predicate: rows strictly OLDER than the cursor in (created_at DESC,
  // id DESC) order — the row-value comparison (created_at, id) < (c_ts, c_id),
  // expanded for PostgREST. Row-value (not id-only) so it stays correct even if
  // id and created_at ever diverge (backfill / clock skew).
  if (cursor) {
    query = query.or(
      `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`,
    );
  }

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(input.pageSize + 1);
  if (error) fail("getOrderTimelinePage", error.message);

  const rows = (data as AuditEventRow[] | null) ?? [];
  const hasMore = rows.length > input.pageSize;
  const page = rows.slice(0, input.pageSize);

  // One bounded lookup for this page's DISTINCT actors — never per row, never
  // the whole roster. owner/admin resolve to named/former; a sales_rep gets the
  // neutral "team member" label (the lookup returns no identity for them).
  const role = (await getSessionContext()).membership?.role ?? null;
  const isAdmin = role === "owner" || role === "admin";
  const emails = await sbGetTimelineActorLabels(
    distinctActorIds(page.map((r) => r.actor_user_id)),
  );

  const events = page.map((r) =>
    buildOrderTimelineEvent({
      id: String(r.id),
      eventType: r.event_type,
      createdAt: r.created_at,
      actor: resolveTimelineActor(r.actor_user_id, { isAdmin, emails }),
      metadata: r.metadata,
    }),
  );

  const last = page[page.length - 1];
  const nextCursor =
    hasMore && last
      ? encodeTimelineCursor({ createdAt: last.created_at, id: String(last.id) })
      : null;
  return { events, nextCursor, hasMore };
}

// ── Product Timeline (M8I.1) ──────────────────────────────────────────────
// The SAME bounded, cursor-paginated audit read as the Customer/Order timelines,
// with entity_type fixed to 'product'. RLS is the authorization boundary: the
// M8I.1 SELECT clause requires has_tenant_role(owner/admin) for product rows, so
// a sales_rep reads NO product audit history and a foreign tenant's rows yield
// zero — this function adds no authorization of its own and must not be asked to.
// It reuses the M8G.3 generic (tenant_id, entity_type, entity_id, created_at desc,
// id desc) index — no migration and no new index is needed. Actors are resolved
// in ONE bounded RPC (never per row), and metadata is client-safe-projected.
export async function sbGetProductTimelinePage(input: {
  productId: string;
  cursor: string | null;
  pageSize: number;
}): Promise<ProductTimelinePage> {
  const { client, tenantId } = await getReadContext();
  if (isTenantless(tenantId) || !isUuid(input.productId)) {
    return { events: [], nextCursor: null, hasMore: false };
  }
  const cursor = decodeTimelineCursor(input.cursor);

  let query = client
    .from("audit_events")
    .select("id, event_type, actor_user_id, metadata, created_at")
    .eq("tenant_id", tenantId)
    .eq("entity_type", "product")
    .eq("entity_id", input.productId);

  // Keyset predicate: rows strictly OLDER than the cursor in (created_at DESC,
  // id DESC) order — the row-value comparison (created_at, id) < (c_ts, c_id),
  // expanded for PostgREST. Row-value (not id-only) so it stays correct even if
  // id and created_at ever diverge (backfill / clock skew).
  if (cursor) {
    query = query.or(
      `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`,
    );
  }

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(input.pageSize + 1);
  if (error) fail("getProductTimelinePage", error.message);

  const rows = (data as AuditEventRow[] | null) ?? [];
  const hasMore = rows.length > input.pageSize;
  const page = rows.slice(0, input.pageSize);

  // One bounded lookup for this page's DISTINCT actors — never per row, never the
  // whole roster. Product audit rows are owner/admin-only by RLS, so the viewer
  // is always owner/admin here; resolve names accordingly.
  const role = (await getSessionContext()).membership?.role ?? null;
  const isAdmin = role === "owner" || role === "admin";
  const emails = await sbGetTimelineActorLabels(
    distinctActorIds(page.map((r) => r.actor_user_id)),
  );

  const events = page.map((r) =>
    buildProductTimelineEvent({
      id: String(r.id),
      eventType: r.event_type,
      createdAt: r.created_at,
      actor: resolveTimelineActor(r.actor_user_id, { isAdmin, emails }),
      metadata: r.metadata,
    }),
  );

  const last = page[page.length - 1];
  const nextCursor =
    hasMore && last
      ? encodeTimelineCursor({ createdAt: last.created_at, id: String(last.id) })
      : null;
  return { events, nextCursor, hasMore };
}

// ── Inventory Timeline (M8I.2) ────────────────────────────────────────────
// The SAME bounded, cursor-paginated audit read as the Product timeline, with
// entity_type fixed to 'inventory'. RLS is the authorization boundary: the M8I.2
// SELECT clause requires has_tenant_role(owner/admin) for inventory rows, so a
// sales_rep reads NO inventory audit history and a foreign tenant's rows yield
// zero. Reuses the M8G.3 generic (tenant_id, entity_type, entity_id, created_at
// desc, id desc) index. Actors resolved in ONE bounded RPC; metadata client-safe.
export async function sbGetInventoryTimelinePage(input: {
  productId: string;
  cursor: string | null;
  pageSize: number;
}): Promise<InventoryTimelinePage> {
  const { client, tenantId } = await getReadContext();
  if (isTenantless(tenantId) || !isUuid(input.productId)) {
    return { events: [], nextCursor: null, hasMore: false };
  }
  const cursor = decodeTimelineCursor(input.cursor);

  let query = client
    .from("audit_events")
    .select("id, event_type, actor_user_id, metadata, created_at")
    .eq("tenant_id", tenantId)
    .eq("entity_type", "inventory")
    .eq("entity_id", input.productId);

  if (cursor) {
    query = query.or(
      `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`,
    );
  }

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(input.pageSize + 1);
  if (error) fail("getInventoryTimelinePage", error.message);

  const rows = (data as AuditEventRow[] | null) ?? [];
  const hasMore = rows.length > input.pageSize;
  const page = rows.slice(0, input.pageSize);

  // Inventory audit rows are owner/admin-only by RLS, so the viewer is always
  // owner/admin here; resolve names via the one bounded lookup (no N+1).
  const role = (await getSessionContext()).membership?.role ?? null;
  const isAdmin = role === "owner" || role === "admin";
  const emails = await sbGetTimelineActorLabels(
    distinctActorIds(page.map((r) => r.actor_user_id)),
  );

  const events = page.map((r) =>
    buildInventoryTimelineEvent({
      id: String(r.id),
      eventType: r.event_type,
      createdAt: r.created_at,
      actor: resolveTimelineActor(r.actor_user_id, { isAdmin, emails }),
      metadata: r.metadata,
    }),
  );

  const last = page[page.length - 1];
  const nextCursor =
    hasMore && last
      ? encodeTimelineCursor({ createdAt: last.created_at, id: String(last.id) })
      : null;
  return { events, nextCursor, hasMore };
}

// ── Team Timeline (M8I.3) ─────────────────────────────────────────────────
// A TENANT-WIDE bounded, cursor-paginated audit read with entity_type fixed to
// 'team' (no entity_id filter — the stream spans invitations AND memberships).
// RLS is the authorization boundary: the M8I.3 SELECT clause requires
// has_tenant_role(owner/admin) for team rows, so a sales_rep reads NO Team
// activity and a foreign tenant's rows yield zero. Served by the M8I.3
// (tenant_id, entity_type, created_at desc, id desc) index. Actors resolved in
// ONE bounded RPC; the affected member is carried inline as target_email
// (client-safe projection) so there is NO second identity lookup.
export async function sbGetTeamTimelinePage(input: {
  cursor: string | null;
  pageSize: number;
}): Promise<TeamTimelinePage> {
  const { client, tenantId } = await getReadContext();
  if (isTenantless(tenantId)) {
    return { events: [], nextCursor: null, hasMore: false };
  }
  const cursor = decodeTimelineCursor(input.cursor);

  let query = client
    .from("audit_events")
    .select("id, event_type, actor_user_id, metadata, created_at")
    .eq("tenant_id", tenantId)
    .eq("entity_type", "team");

  if (cursor) {
    query = query.or(
      `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`,
    );
  }

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(input.pageSize + 1);
  if (error) fail("getTeamTimelinePage", error.message);

  const rows = (data as AuditEventRow[] | null) ?? [];
  const hasMore = rows.length > input.pageSize;
  const page = rows.slice(0, input.pageSize);

  // Team audit rows are owner/admin-only by RLS, so the viewer is always
  // owner/admin here; resolve names via the one bounded lookup (no N+1). The
  // affected member is NOT looked up — it is the client-safe target_email snapshot.
  const role = (await getSessionContext()).membership?.role ?? null;
  const isAdmin = role === "owner" || role === "admin";
  const emails = await sbGetTimelineActorLabels(
    distinctActorIds(page.map((r) => r.actor_user_id)),
  );

  const events = page.map((r) =>
    buildTeamTimelineEvent({
      id: String(r.id),
      eventType: r.event_type,
      createdAt: r.created_at,
      actor: resolveTimelineActor(r.actor_user_id, { isAdmin, emails }),
      metadata: r.metadata,
    }),
  );

  const last = page[page.length - 1];
  const nextCursor =
    hasMore && last
      ? encodeTimelineCursor({ createdAt: last.created_at, id: String(last.id) })
      : null;
  return { events, nextCursor, hasMore };
}

// ── Settings Timeline (M8I.4) ─────────────────────────────────────────────
// A TENANT-WIDE bounded, cursor-paginated audit read with entity_type fixed to
// 'settings' (no entity_id filter — the stream spans business/timezone/tax events;
// each row's entity_id is the tenant id). RLS is the authorization boundary: the
// M8I.4 SELECT clause requires has_tenant_role(owner/admin) for settings rows, so a
// sales_rep reads NO Settings activity and a foreign tenant's rows yield zero. Served
// by the M8I.4 (tenant_id, created_at desc, id desc) WHERE entity_type='settings'
// partial index. Actors resolved in ONE bounded RPC; metadata client-safe-projected.
export async function sbGetSettingsTimelinePage(input: {
  cursor: string | null;
  pageSize: number;
}): Promise<SettingsTimelinePage> {
  const { client, tenantId } = await getReadContext();
  if (isTenantless(tenantId)) {
    return { events: [], nextCursor: null, hasMore: false };
  }
  const cursor = decodeTimelineCursor(input.cursor);

  let query = client
    .from("audit_events")
    .select("id, event_type, actor_user_id, metadata, created_at")
    .eq("tenant_id", tenantId)
    .eq("entity_type", "settings");

  if (cursor) {
    query = query.or(
      `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`,
    );
  }

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(input.pageSize + 1);
  if (error) fail("getSettingsTimelinePage", error.message);

  const rows = (data as AuditEventRow[] | null) ?? [];
  const hasMore = rows.length > input.pageSize;
  const page = rows.slice(0, input.pageSize);

  // Settings audit rows are owner/admin-only by RLS, so the viewer is always
  // owner/admin here; resolve names via the one bounded lookup (no N+1).
  const role = (await getSessionContext()).membership?.role ?? null;
  const isAdmin = role === "owner" || role === "admin";
  const emails = await sbGetTimelineActorLabels(
    distinctActorIds(page.map((r) => r.actor_user_id)),
  );

  const events = page.map((r) =>
    buildSettingsTimelineEvent({
      id: String(r.id),
      eventType: r.event_type,
      createdAt: r.created_at,
      actor: resolveTimelineActor(r.actor_user_id, { isAdmin, emails }),
      metadata: r.metadata,
    }),
  );

  const last = page[page.length - 1];
  const nextCursor =
    hasMore && last
      ? encodeTimelineCursor({ createdAt: last.created_at, id: String(last.id) })
      : null;
  return { events, nextCursor, hasMore };
}

// ── Assignment Activity Timeline (M8I.5) ──────────────────────────────────
// A TENANT-WIDE bounded, cursor-paginated audit read with entity_type fixed to
// 'sales_rep_assignment' (no entity_id filter — the stream spans every affected
// customer; each row's entity_id is that customer id). RLS is the authorization
// boundary: the M8I.5 SELECT clause requires has_tenant_role(owner/admin) for
// sales_rep_assignment rows, so a sales_rep reads NO assignment activity (incl.
// its own) and a foreign tenant's rows yield zero. Served by the M8I.5 (tenant_id,
// created_at desc, id desc) WHERE entity_type='sales_rep_assignment' partial index.
// Actors resolved in ONE bounded RPC; the affected customer + representative are
// carried inline as client-safe snapshots (customer_name/rep_email) — no second lookup.
export async function sbGetAssignmentTimelinePage(input: {
  cursor: string | null;
  pageSize: number;
}): Promise<SalesRepAssignmentTimelinePage> {
  const { client, tenantId } = await getReadContext();
  if (isTenantless(tenantId)) {
    return { events: [], nextCursor: null, hasMore: false };
  }
  const cursor = decodeTimelineCursor(input.cursor);

  let query = client
    .from("audit_events")
    .select("id, event_type, actor_user_id, metadata, created_at")
    .eq("tenant_id", tenantId)
    .eq("entity_type", "sales_rep_assignment");

  if (cursor) {
    query = query.or(
      `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`,
    );
  }

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(input.pageSize + 1);
  if (error) fail("getAssignmentTimelinePage", error.message);

  const rows = (data as AuditEventRow[] | null) ?? [];
  const hasMore = rows.length > input.pageSize;
  const page = rows.slice(0, input.pageSize);

  // Assignment audit rows are owner/admin-only by RLS, so the viewer is always
  // owner/admin here; resolve names via the one bounded lookup (no N+1). The
  // affected customer + rep are NOT looked up — they are the client-safe snapshots.
  const role = (await getSessionContext()).membership?.role ?? null;
  const isAdmin = role === "owner" || role === "admin";
  const emails = await sbGetTimelineActorLabels(
    distinctActorIds(page.map((r) => r.actor_user_id)),
  );

  const events = page.map((r) =>
    buildSalesRepAssignmentTimelineEvent({
      id: String(r.id),
      eventType: r.event_type,
      createdAt: r.created_at,
      actor: resolveTimelineActor(r.actor_user_id, { isAdmin, emails }),
      metadata: r.metadata,
    }),
  );

  const last = page[page.length - 1];
  const nextCursor =
    hasMore && last
      ? encodeTimelineCursor({ createdAt: last.created_at, id: String(last.id) })
      : null;
  return { events, nextCursor, hasMore };
}

export async function sbListCustomers(): Promise<Customer[]> {
  const { client, tenantId } = await getReadContext();
  if (isTenantless(tenantId)) return [];
  // Deterministic seed ids ascend in the mock's original order.
  const { data, error } = await client
    .from("customers")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("id");
  if (error) fail("listCustomers", error.message);
  return data.map(mapCustomer);
}

export async function sbGetCustomer(
  id: string,
): Promise<Customer | undefined> {
  const { client, tenantId } = await getReadContext();
  if (isTenantless(tenantId) || !isUuid(id)) return undefined;
  const { data, error } = await client
    .from("customers")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();
  if (error) fail("getCustomer", error.message);
  return data ? mapCustomer(data) : undefined;
}

/**
 * Server-side customer search + pagination (M8E.2) — filters run in the DB
 * query (RLS scopes rows to the caller's tenant), so the client never loads
 * every store. Search matches name / contact / phone / address / city via
 * ILIKE; the free-text term is sanitized of the PostgREST or-grammar
 * metacharacters (commas/parens/wildcards) before interpolation — RLS still
 * bounds the result to the tenant regardless. Deterministic order (active
 * first, then name, then id) makes offset paging skip-/dup-free.
 *
 * `hasLink` filters by whether the store has a LIVE private link
 * (customer_access_links, owner/admin SELECT under RLS): the matching
 * customer ids are fetched once, then applied as an id in/not-in clause.
 */
export async function sbSearchCustomers(
  q: CustomerQuery,
  offset = 0,
  limit = 50,
): Promise<Customer[]> {
  const { client, tenantId } = await getReadContext();
  if (isTenantless(tenantId)) return [];

  let query = client.from("customers").select("*").eq("tenant_id", tenantId);

  const term = (q.q ?? "").replace(/[,()%\\*]/g, " ").trim();
  if (term) {
    const like = `%${term}%`;
    query = query.or(
      [
        `name.ilike.${like}`,
        `contact_name.ilike.${like}`,
        `phone.ilike.${like}`,
        `address.ilike.${like}`,
        `city_ar.ilike.${like}`,
        `city_he.ilike.${like}`,
        `city_en.ilike.${like}`,
      ].join(","),
    );
  }

  if (q.status === "active") query = query.eq("is_active", true);
  else if (q.status === "inactive") query = query.eq("is_active", false);

  // M8G.1 — acquisition-origin facet, applied in the DB BEFORE the range/order
  // (so pagination + any count reflect it). RLS still bounds rows to the tenant.
  if (q.origin) query = query.eq("origin", q.origin);

  if (q.hasLink !== undefined) {
    const linkIds = await sbActiveLinkCustomerIds(client, tenantId);
    if (q.hasLink) {
      if (linkIds.length === 0) return []; // no store has a live link
      query = query.in("id", linkIds);
    } else if (linkIds.length > 0) {
      query = query.not("id", "in", `(${linkIds.join(",")})`);
    }
  }

  const { data, error } = await query
    .order("is_active", { ascending: false })
    .order("name", { ascending: true })
    .order("id", { ascending: true })
    .range(offset, offset + limit - 1);
  if (error) fail("searchCustomers", error.message);
  return (data ?? []).map(mapCustomer);
}

/** Distinct customer ids that currently have a LIVE private link (not revoked,
 * not expired) for the tenant. Reads under the owner/admin SELECT policy on
 * customer_access_links (a sales_rep sees none). */
async function sbActiveLinkCustomerIds(
  client: Db,
  tenantId: string,
): Promise<string[]> {
  const nowIso = new Date().toISOString();
  const { data, error } = await client
    .from("customer_access_links")
    .select("customer_id")
    .eq("tenant_id", tenantId)
    .is("revoked_at", null)
    .or(`expires_at.is.null,expires_at.gt.${nowIso}`);
  if (error) fail("activeLinkCustomerIds", error.message);
  return [...new Set((data ?? []).map((r) => r.customer_id))];
}

/** Stock-movement ledger (M8B) — RLS limits reads to owner/admin; a
 * sales_rep (or non-member) simply gets zero rows. Newest first. */
export async function sbListInventoryMovements(
  offset = 0,
): Promise<InventoryMovement[]> {
  return sbSearchInventoryMovements({}, offset, 500);
}

/** The order-reference fields the Movements table + CSV show. */
export type MovementOrderRef = { number: string; publicRef: string | null };

/**
 * Batch C — the max order ids per `.in()` request when hydrating movement order
 * references. The DISTINCT orders referenced by ONE movement page/batch (≤ the
 * export batch of 500) are fetched in chunks of this size, so the request URL
 * stays bounded — never a thousands-long IN list, and never a full Orders scan.
 */
const MOVEMENT_ORDER_REF_CHUNK = 200;

/**
 * Resolve `{ number, public_ref }` for a set of order ids with a TARGETED,
 * tenant-scoped, RLS-authoritative read — chunked so the query is bounded by the
 * (already bounded) movement result set, NOT by total order history. A null /
 * non-uuid / duplicate id never triggers a lookup; an inaccessible or missing
 * order simply has no entry (the caller renders "—"). No N+1: one query per
 * ≤200-id chunk, never one per movement.
 */
export async function sbOrderRefsForIds(
  client: Db,
  tenantId: string,
  orderIds: (string | null)[],
): Promise<Map<string, MovementOrderRef>> {
  const out = new Map<string, MovementOrderRef>();
  const ids = [
    ...new Set(orderIds.filter((id): id is string => !!id && isUuid(id))),
  ];
  for (let i = 0; i < ids.length; i += MOVEMENT_ORDER_REF_CHUNK) {
    const chunk = ids.slice(i, i + MOVEMENT_ORDER_REF_CHUNK);
    const { data, error } = await client
      .from("orders")
      .select("id, order_number, public_ref")
      .eq("tenant_id", tenantId)
      .in("id", chunk);
    if (error) fail("orderRefsForIds", error.message);
    for (const r of (data ?? []) as {
      id: string;
      order_number: string;
      public_ref: string | null;
    }[]) {
      out.set(r.id, { number: r.order_number, publicRef: r.public_ref });
    }
  }
  return out;
}

/**
 * Server-side stock-movement search (M8D) — filters run in the DB query
 * (RLS-scoped, owner/admin), so the client never loads more than one page.
 * Deterministic order (created_at desc, id desc) makes offset paging
 * skip-/dup-free. `productIds` is resolved client-side from the search term
 * against the already-loaded catalog; `[]` means "no product matched" →
 * zero rows (correct), `undefined` means "no product filter".
 */
export async function sbSearchInventoryMovements(
  q: MovementQuery,
  offset = 0,
  limit = 50,
): Promise<InventoryMovement[]> {
  const { client, tenantId } = await getReadContext();
  if (isTenantless(tenantId)) return [];

  // M8H.2 — the query receives CONCRETE tenant-local calendar dates (the Server
  // Action anchored them once for the whole filter session), and converts them to
  // UTC bounds in the TENANT's zone. One tz read per call, from the React-cached
  // session context (no extra query, no N+1).
  const timeZone = await getTenantTimeZone();
  const range = tenantDateRangeUtc(q.dateFrom ?? null, q.dateTo ?? null, timeZone);
  // FAIL CLOSED: an impossible calendar date yields null, and an unbounded ledger
  // read is exactly the wrong way to recover from it.
  if (!range) fail("searchInventoryMovements", "invalid tenant calendar date");
  const { gteIso, ltIso } = range;

  let query = client
    .from("order_inventory_movements")
    .select("id, product_id, order_id, quantity_delta, reason, note, created_at, created_by")
    .eq("tenant_id", tenantId);

  if (gteIso) query = query.gte("created_at", gteIso);
  if (ltIso) query = query.lt("created_at", ltIso);
  if (q.reason) query = query.eq("reason", q.reason);
  if (q.direction === "in") query = query.gt("quantity_delta", 0);
  else if (q.direction === "out") query = query.lt("quantity_delta", 0);
  else if (q.direction === "manual") query = query.is("order_id", null);
  if (q.productIds) query = query.in("product_id", q.productIds);

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) fail("searchInventoryMovements", error.message);
  const rows = (data ?? []).map((r) => ({
    id: r.id,
    productId: r.product_id,
    orderId: r.order_id,
    quantityDelta: r.quantity_delta,
    reason: r.reason,
    note: r.note ?? undefined,
    createdAt: r.created_at,
    // M8I.2 — the acting user id (owner/admin who adjusted or drove the Order
    // transition), for page-scoped actor-label resolution in the movements UI.
    // The CSV export does NOT include it (unchanged export contract).
    createdBy: r.created_by ?? null,
  }));
  // Batch C — hydrate the order reference for ONLY the orders THIS page's
  // movements point at (distinct ids, chunked, RLS-scoped). This replaces the
  // former full listOrders() map on the page, so an order older than the first
  // PostgREST page still resolves and no full Orders table is read.
  const refs = await sbOrderRefsForIds(
    client,
    tenantId,
    rows.map((m) => m.orderId),
  );
  return rows.map((m) => {
    const ref = m.orderId ? refs.get(m.orderId) : undefined;
    return {
      ...m,
      orderNumber: ref?.number,
      orderPublicRef: ref?.publicRef ?? undefined,
    };
  });
}

// ── Movement actor labels (M8I.2) ─────────────────────────────────────────
// Page-scoped, owner/admin-only display labels for the DISTINCT created_by ids on
// a movements page. Reuses the bounded timeline actor-label RPC (≤50 ids, one
// query, no N+1, no full roster; a sales_rep / non-member gets an empty map with
// NO query). A null / deleted / non-member actor simply has no entry — the UI
// then shows a safe fallback rather than a raw UUID.
export async function sbGetMovementActorLabels(
  movements: ReadonlyArray<{ createdBy?: string | null }>,
): Promise<Record<string, string>> {
  const ids = distinctActorIds(movements.map((m) => m.createdBy ?? null));
  if (ids.length === 0) return {};
  const map = await sbGetTimelineActorLabels(ids);
  return Object.fromEntries(map);
}

export async function sbListInventory(): Promise<InventoryItem[]> {
  const { client, tenantId } = await getReadContext();
  if (isTenantless(tenantId)) return [];
  const { data, error } = await client
    .from("inventory_items")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("warehouse_location");
  if (error) fail("listInventory", error.message);
  return data.map(mapInventory);
}

export async function sbGetInventoryForProduct(
  productId: string,
): Promise<InventoryItem | undefined> {
  const { client, tenantId } = await getReadContext();
  if (isTenantless(tenantId) || !isUuid(productId)) return undefined;
  const { data, error } = await client
    .from("inventory_items")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("product_id", productId)
    .maybeSingle();
  if (error) fail("getInventoryForProduct", error.message);
  return data ? mapInventory(data) : undefined;
}

const ORDER_SELECT =
  "*, order_items (id, product_id, quantity, unit_price_snapshot, created_at)";

export async function sbListOrders(): Promise<Order[]> {
  const { client, tenantId } = await getReadContext();
  if (isTenantless(tenantId)) return [];
  const { data, error } = await client
    .from("orders")
    .select(ORDER_SELECT)
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });
  if (error) fail("listOrders", error.message);
  return (data as OrderRow[]).map(mapOrder);
}

export async function sbGetOrder(id: string): Promise<Order | undefined> {
  const { client, tenantId } = await getReadContext();
  if (isTenantless(tenantId) || !isUuid(id)) return undefined;
  const { data, error } = await client
    .from("orders")
    .select(ORDER_SELECT)
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();
  if (error) fail("getOrder", error.message);
  return data ? mapOrder(data as OrderRow) : undefined;
}

// ── Dashboard metrics — ONE bounded aggregate (C1) ────────────────────────
// Replaces the dashboard's full listOrders() scan with the get_dashboard_metrics
// RPC (SECURITY INVOKER; RLS is the authorization boundary). The tenant zone is
// resolved server-side (getTenantTimeZone) and passed so tenant-local
// today/month/trend boundaries match the M8H.2 contract.

/** The get_dashboard_metrics RPC jsonb blob (numbers may arrive as strings for
 * numeric money, so every value is coerced through `dashNum`). */
type DashboardMetricsJson = {
  status_counts: Record<string, unknown>;
  total_orders: unknown;
  today: { count: unknown; revenue: unknown };
  month: { count: unknown; revenue: unknown };
  guest_pending: unknown;
  trend: { day: string; total: unknown }[];
  top_products: {
    product_id: string;
    name_ar: string;
    name_he: string;
    name_en: string;
    revenue: unknown;
  }[];
  top_shops: {
    customer_id: string;
    name: string;
    total: unknown;
    count: unknown;
  }[];
  active_product_count: unknown;
  active_shop_count: unknown;
  low_stock: {
    count: unknown;
    out_of_stock_count: unknown;
    items: {
      product_id: string;
      name_ar: string;
      name_he: string;
      name_en: string;
      location: string | null;
      stock: unknown;
      threshold: unknown;
    }[];
  };
};

function dashNum(v: unknown): number {
  if (typeof v === "number") return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function emptyDashboardMetrics(): DashboardMetrics {
  return {
    statusCounts: { new: 0, confirmed: 0, preparing: 0, delivered: 0, cancelled: 0 },
    totalOrders: 0,
    today: { count: 0, revenue: 0 },
    month: { count: 0, revenue: 0 },
    guestPending: 0,
    trend: [],
    topProducts: [],
    topShops: [],
    activeProductCount: 0,
    activeShopCount: 0,
    lowStock: { count: 0, outOfStockCount: 0, items: [] },
  };
}

export async function sbGetDashboardMetrics(): Promise<DashboardMetrics> {
  const { client, tenantId } = await getReadContext();
  if (isTenantless(tenantId)) return emptyDashboardMetrics();
  // Authoritative tenant zone (from the cached membership; never client input).
  const timeZone = await getTenantTimeZone();
  const { data, error } = await client.rpc("get_dashboard_metrics", {
    p_tenant_id: tenantId,
    p_time_zone: timeZone,
  });
  if (error) fail("getDashboardMetrics", error.message);
  if (!data) return emptyDashboardMetrics();
  const m = data as unknown as DashboardMetricsJson;
  const sc = m.status_counts ?? {};
  return {
    statusCounts: {
      new: dashNum(sc.new),
      confirmed: dashNum(sc.confirmed),
      preparing: dashNum(sc.preparing),
      delivered: dashNum(sc.delivered),
      cancelled: dashNum(sc.cancelled),
    },
    totalOrders: dashNum(m.total_orders),
    today: { count: dashNum(m.today?.count), revenue: dashNum(m.today?.revenue) },
    month: { count: dashNum(m.month?.count), revenue: dashNum(m.month?.revenue) },
    guestPending: dashNum(m.guest_pending),
    trend: (m.trend ?? []).map((t) => ({
      day: t.day,
      total: dashNum(t.total),
    })),
    topProducts: (m.top_products ?? []).map((p) => ({
      productId: p.product_id,
      name: { ar: p.name_ar, he: p.name_he, en: p.name_en },
      revenue: dashNum(p.revenue),
    })),
    topShops: (m.top_shops ?? []).map((s) => ({
      customerId: s.customer_id,
      name: s.name,
      total: dashNum(s.total),
      count: dashNum(s.count),
    })),
    activeProductCount: dashNum(m.active_product_count),
    activeShopCount: dashNum(m.active_shop_count),
    lowStock: {
      count: dashNum(m.low_stock?.count),
      outOfStockCount: dashNum(m.low_stock?.out_of_stock_count),
      items: (m.low_stock?.items ?? []).map((i) => ({
        productId: i.product_id,
        name: { ar: i.name_ar, he: i.name_he, en: i.name_en },
        location: i.location ?? "",
        stock: dashNum(i.stock),
        threshold: dashNum(i.threshold),
      })),
    },
  };
}

// ── Orders server-side search + pagination (M8F.1) ────────────────────────
// LEAN list select: the live customer name/phone (LEFT embed — keeps guest
// null-customer orders), the item count (aggregate embed — no items shipped),
// and the stored ex-VAT subtotal. RLS (can_access_order) scopes the rows:
// owner/admin see all incl. guest orders; a sales_rep sees only assigned-
// customer orders and never guest/null-customer orders. Search covers the
// order's OWN fields (order_number, public_ref) and the buyer name/phone
// RECORDED ON THE ORDER (customer_snapshot — populated for EVERY order at
// creation), so the search is complete with no join/pre-scan and no order is
// missed. tenant_id is derived server-side (never client-trusted) + belt-and-
// braces alongside RLS.
const ORDER_LIST_SELECT =
  "id, order_number, public_ref, status, source, created_at, customer_id, " +
  "customer_snapshot, subtotal, customers (name, phone), order_items (count)";

type OrderListDbRow = {
  id: string;
  order_number: string;
  public_ref: string | null;
  status: OrderStatus;
  source: "sales_visit" | "remote_customer" | "admin";
  created_at: string;
  customer_id: string | null;
  customer_snapshot: unknown;
  subtotal: number | null;
  customers: { name: string; phone: string | null } | null;
  order_items: { count: number }[];
};

function mapOrderListRow(row: OrderListDbRow): OrderListRow {
  return {
    id: row.id,
    number: row.order_number,
    publicRef: row.public_ref,
    status: row.status,
    source: row.source,
    createdAt: row.created_at,
    customerId: row.customer_id ?? "",
    customerName: row.customers?.name ?? null,
    customerPhone: row.customers?.phone ?? null,
    customerSnapshot: mapCustomerSnapshot(row.customer_snapshot),
    itemCount: row.order_items?.[0]?.count ?? 0,
    subtotalAmount: row.subtotal ?? 0,
  };
}

/** Build the tenant-scoped, filtered orders query (no order/range yet). Shared
 * by the count, the paged list, and the export so their filter semantics are
 * identical. `select` is caller-chosen ("id" for a head count, ORDER_LIST_SELECT
 * for rows). A non-UUID customer id is handled by the callers (returns empty)
 * BEFORE calling this — the DB customer_id column is uuid. */
function buildOrdersQuery(
  client: Db,
  tenantId: string,
  query: OrdersQuery,
  select: string,
  /** M8H.2 — the TENANT's IANA zone. The count, the list and the export are all
   * built here, so they can never disagree about where a calendar day begins. */
  timeZone: string,
  selectOptions?: { count?: "exact" | "planned" | "estimated"; head?: boolean },
) {
  let qb = client
    .from("orders")
    .select(select, selectOptions)
    .eq("tenant_id", tenantId);

  if (query.statuses.length === 1) qb = qb.eq("status", query.statuses[0]);
  else if (query.statuses.length > 1) qb = qb.in("status", query.statuses);

  // Source facet → DB predicates (mirrors orderSourceFacet + the client sourceOf).
  if (query.source === "guest") {
    qb = qb.eq("source", "remote_customer").is("customer_id", null);
  } else if (query.source === "shop_link") {
    qb = qb.eq("source", "remote_customer").not("customer_id", "is", null);
  } else if (query.source === "sales_visit") {
    qb = qb.neq("source", "remote_customer");
  }

  if (query.customerId) qb = qb.eq("customer_id", query.customerId);

  // TENANT-timezone calendar-day bounds: `from` is the inclusive START of that
  // local day (which is not always 00:00 — some zones spring forward AT midnight),
  // and `to` is INCLUSIVE of its whole local day via a next-day-start EXCLUSIVE
  // upper bound. One builder, shared with the mock path and every caller below.
  // FAIL CLOSED. An `invalid` date filter must NEVER reach a query — a query built
  // from it would carry no date predicates at all, i.e. it would list (and export)
  // EVERY order. The builder refuses rather than silently widening.
  if (query.dateFilter === "invalid") {
    fail("searchOrders", "refusing to query with an invalid date filter");
  }
  const range = tenantDateRangeUtc(query.dateFrom, query.dateTo, timeZone);
  if (!range) fail("searchOrders", "invalid tenant calendar date");
  if (range.gteIso) qb = qb.gte("created_at", range.gteIso);
  if (range.ltIso) qb = qb.lt("created_at", range.ltIso);

  // Free-text: sanitize or-grammar metacharacters (mirrors sbSearchCustomers),
  // then union order_number / public_ref / recorded buyer name+phone.
  const term = query.search.replace(/[,()%\\*]/g, " ").trim();
  if (term) {
    const like = `%${term}%`;
    qb = qb.or(
      [
        `order_number.ilike.${like}`,
        `public_ref.ilike.${like}`,
        `customer_snapshot->>name.ilike.${like}`,
        `customer_snapshot->>phone.ilike.${like}`,
      ].join(","),
    );
  }
  return qb;
}

export async function sbSearchOrders(query: OrdersQuery): Promise<OrdersListResult> {
  const { client, tenantId } = await getReadContext();
  const pageSize = Math.min(Math.max(1, query.pageSize), ORDERS_MAX_PAGE_SIZE);
  const empty: OrdersListResult = { rows: [], total: 0, page: 1, pageSize, totalPages: 1 };
  if (isTenantless(tenantId)) return empty;
  // A present-but-non-UUID customer id can match no order (customer_id is uuid);
  // return zero rows rather than let the DB raise a uuid-cast error.
  if (query.customerId && !isUuid(query.customerId)) return empty;

  // COUNT FIRST (head, no rows) → derive totalPages → CLAMP the page. This makes
  // an out-of-range ?page (stale/shared/hand-edited link) normalize to the last
  // page instead of a PostgREST 416 (a ranged fetch past the row count errors).
  // ONE tenant zone for BOTH the count and the page, so pagination can never
  // disagree with the rows about which local day an order belongs to.
  const timeZone = await getTenantTimeZone();
  const { count, error: countError } = await buildOrdersQuery(
    client,
    tenantId,
    query,
    "id",
    timeZone,
    { count: "exact", head: true },
  );
  if (countError) fail("searchOrders", countError.message);
  const total = count ?? 0;
  const totalPages = totalPagesFor(total, pageSize);
  if (total === 0) return { rows: [], total: 0, page: 1, pageSize, totalPages };

  const page = Math.min(Math.max(1, query.page), totalPages);
  const offset = (page - 1) * pageSize; // < total ⇒ always a satisfiable range
  const { data, error } = await buildOrdersQuery(
    client,
    tenantId,
    query,
    ORDER_LIST_SELECT,
    timeZone,
  )
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(offset, offset + pageSize - 1);
  if (error) fail("searchOrders", error.message);
  return {
    rows: (data as unknown as OrderListDbRow[]).map(mapOrderListRow),
    total,
    page,
    pageSize,
    totalPages,
  };
}

/**
 * The production Orders-export KEYSET page reader, extracted so the real local
 * PostgREST integration test can exercise the EXACT production query + cursor
 * (no duplicated pagination logic). Given the resolved (client, tenant, query,
 * timeZone), returns a `(cursor, limit) => rows` reader that:
 *   • rebuilds the SAME filtered/tenant-scoped query every page (a supabase query
 *     builder is single-use), so no batch can reinterpret the tenant, the
 *     filters, or the tenant-timezone-derived date boundaries;
 *   • orders `created_at DESC, id DESC` and, for a non-first page, adds the keyset
 *     predicate `created_at < c.createdAt OR (created_at = c.createdAt AND id <
 *     c.id)` — the same row-value keyset the Customer Timeline uses;
 *   • requests `.limit(clampExportLimit(limit))` — the request size is HARD-BOUND
 *     to [1, ORDERS_EXPORT_BATCH] AT THIS reader boundary (not only in the
 *     collector), so no caller of this reusable server-side function can issue a
 *     request >500 that PostgREST could silently clamp to max_rows. No offset, no
 *     range, no over-range/PGRST103 case. Any DB error aborts the export via fail().
 */
export function buildOrdersExportPageReader(
  client: Db,
  tenantId: string,
  query: OrdersQuery,
  timeZone: string,
): (cursor: OrdersExportCursor | null, limit: number) => Promise<OrderListDbRow[]> {
  return async (cursor, limit) => {
    let qb = buildOrdersQuery(client, tenantId, query, ORDER_LIST_SELECT, timeZone)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });
    if (cursor) {
      // Rows strictly OLDER than the cursor in (created_at DESC, id DESC).
      qb = qb.or(
        `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`,
      );
    }
    // Hard-bound the request size at the actual HTTP boundary (defence in depth
    // on top of the collector's own ≤500 `want`).
    const { data, error } = await qb.limit(clampExportLimit(limit));
    if (error) fail("listOrdersForExport", error.message);
    return (data as unknown as OrderListDbRow[]) ?? [];
  };
}

export async function sbListOrdersForExport(
  query: OrdersQuery,
  cap: number,
): Promise<OrderListRow[]> {
  const { client, tenantId } = await getReadContext();
  if (isTenantless(tenantId)) return [];
  if (query.customerId && !isUuid(query.customerId)) return [];
  // ONE tenant zone, resolved once, drives every page — the same bounds as the
  // list + count, so an export can never contain a different set of days than
  // the screen it was exported from, and batch 2+ can never reinterpret them.
  const timeZone = await getTenantTimeZone();
  // Stable KEYSET traversal (no offset) so a concurrent filter change can never
  // skip a still-matching row; collectExportRows dedupes by id as defence only.
  const reader = buildOrdersExportPageReader(client, tenantId, query, timeZone);
  const dbRows = await collectExportRows<OrderListDbRow>(reader, cap);
  return dbRows.map(mapOrderListRow);
}

export async function sbListDocuments(): Promise<OrderDocument[]> {
  const { client, tenantId } = await getReadContext();
  if (isTenantless(tenantId)) return [];
  const { data, error } = await client
    .from("documents")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .order("document_number");
  if (error) fail("listDocuments", error.message);
  // Same-order documents tie on created_at (seeded from the order date):
  // present them in lifecycle order like the mock derivation does.
  return data
    .map(mapDocument)
    .sort(
      (a, b) =>
        b.date.localeCompare(a.date) ||
        (a.orderId === b.orderId ? byDocumentLifecycle(a, b) : 0),
    );
}

export async function sbGetDocument(
  id: string,
): Promise<OrderDocument | undefined> {
  const { client, tenantId } = await getReadContext();
  if (isTenantless(tenantId) || !isUuid(id)) return undefined;
  const { data, error } = await client
    .from("documents")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();
  if (error) fail("getDocument", error.message);
  return data ? mapDocument(data) : undefined;
}

export async function sbListDocumentsForOrder(
  orderId: string,
): Promise<OrderDocument[]> {
  const { client, tenantId } = await getReadContext();
  if (isTenantless(tenantId) || !isUuid(orderId)) return [];
  const { data, error } = await client
    .from("documents")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("order_id", orderId)
    .order("document_number");
  if (error) fail("listDocumentsForOrder", error.message);
  return data.map(mapDocument).sort(byDocumentLifecycle);
}

// ── Document render source (M5A) ──────────────────────────────────────────
// A snapshot-faithful read for PDF generation: the order's totals +
// customer_snapshot + every order_items snapshot column. Runs under the
// authenticated RLS client, so `can_access_order` (M4D.1) gates it — a
// sales_rep only sees assigned-customer orders; anyone else gets undefined.

interface DocOrderData {
  order_number: string;
  public_ref: string | null;
  created_at: string;
  notes: string | null;
  customer_snapshot: unknown;
  subtotal: number;
  vat_total: number;
  total: number;
  currency: string;
  order_items: {
    id: string;
    product_name_snapshot: unknown;
    package_unit_snapshot: Row<"order_items">["package_unit_snapshot"];
    package_quantity_snapshot: number;
    quantity: number;
    unit_price_snapshot: number;
    line_subtotal: number;
    created_at: string;
  }[];
}

const DOC_ORDER_SELECT =
  "order_number, public_ref, created_at, notes, customer_snapshot, subtotal, vat_total, total, currency, " +
  "order_items (id, product_name_snapshot, package_unit_snapshot, package_quantity_snapshot, quantity, unit_price_snapshot, line_subtotal, created_at)";

function localizedFrom(value: unknown): { ar: string; he: string; en: string } {
  const v = (value ?? {}) as { ar?: string; he?: string; en?: string };
  return { ar: v.ar ?? "", he: v.he ?? "", en: v.en ?? "" };
}

export async function sbGetOrderDocumentSource(
  orderId: string,
): Promise<OrderDocumentSource | undefined> {
  const { client, tenantId } = await getReadContext();
  if (isTenantless(tenantId) || !isUuid(orderId)) return undefined;
  const { data, error } = await client
    .from("orders")
    .select(DOC_ORDER_SELECT)
    .eq("tenant_id", tenantId)
    .eq("id", orderId)
    .maybeSingle();
  if (error) fail("getOrderDocumentSource", error.message);
  if (!data) return undefined; // RLS-denied (rep, non-member) or unknown id.

  const row = data as unknown as DocOrderData;
  const supplier = await sbGetSupplier();

  const snap = (row.customer_snapshot ?? null) as {
    name?: string;
    city?: { ar?: string; he?: string; en?: string };
    phone?: string;
    contact_name?: string;
  } | null;

  const items = [...row.order_items]
    .sort(
      (a, b) =>
        a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
    )
    .map((it) => ({
      name: localizedFrom(it.product_name_snapshot),
      packageUnit: it.package_unit_snapshot,
      packageQuantity: it.package_quantity_snapshot,
      quantity: it.quantity,
      unitPrice: it.unit_price_snapshot,
      // EXCL-VAT line total (= quantity × unit price). NOT order_items.line_total,
      // which is VAT-INCLUSIVE (line_subtotal + line_vat) — the document lays
      // out excl-VAT lines + a separate VAT row (matches the mock path).
      lineTotal: it.line_subtotal,
    }));

  return {
    supplier,
    orderNumber: row.order_number,
    // Customer-facing ref; never fall back to the internal number (M7G). A
    // supabase order always has public_ref (M7E NOT NULL + backfill).
    publicRef: row.public_ref ?? "",
    orderDate: row.created_at,
    notes: row.notes ?? undefined,
    customer: snap
      ? {
          name: snap.name ?? "—",
          city: localizedFrom(snap.city),
          phone: snap.phone ?? "",
          contactName: snap.contact_name ?? "",
        }
      : null,
    items,
    totals: {
      subtotal: row.subtotal,
      vatTotal: row.vat_total,
      total: row.total,
      currency: row.currency,
    },
  };
}

export async function sbGetSupplier(): Promise<Supplier> {
  const { client, tenantId } = await getReadContext();
  const { data, error } = await client
    .from("tenants")
    .select("*")
    .eq("id", tenantId)
    .maybeSingle();
  if (error) fail("getSupplier", error.message);
  if (!data) fail("getSupplier", `tenant ${tenantId} not found — seed the DB`);

  // Business logo (M8E.4): an external http(s) URL passes through; an
  // own-tenant private-bucket object path is signed for display + kept raw on
  // logoStoragePath (so the settings form re-persists the PATH); anything else
  // drops to no logo (the app LogoMark). Signing reuses the same private
  // product-images bucket + own-tenant prefix check as manufacturer logos.
  let logoUrl: string | undefined = data.logo_url ?? undefined;
  let logoStoragePath: string | undefined;
  const prefix = `${data.id}/`;
  if (logoUrl && !isExternalUrl(logoUrl)) {
    if (logoUrl.startsWith(prefix)) {
      logoStoragePath = logoUrl;
      const { data: signed } = await client.storage
        .from(PRODUCT_IMAGE_BUCKET)
        .createSignedUrl(logoUrl, SIGNED_URL_TTL_SECONDS);
      logoUrl = signed?.signedUrl ?? undefined;
    } else {
      logoUrl = undefined; // not an own-tenant object → never signed
    }
  }

  return {
    id: data.id,
    name: { ar: data.name_ar, he: data.name_he, en: data.name_en },
    legalName: data.legal_name ?? "",
    companyId: data.company_id ?? "",
    phone: data.phone ?? "",
    address: {
      ar: data.address_ar ?? "",
      he: data.address_he ?? "",
      en: data.address_en ?? "",
    },
    email: data.email ?? undefined,
    logoUrl,
    logoStoragePath,
    displayVatRate: data.display_vat_rate ?? undefined,
    // M8H.2 — a corrupt/unknown stored zone resolves to UTC and is logged, never
    // to the server machine's or the browser's zone.
    timezone: resolveTenantTimeZone(data.timezone),
  };
}
