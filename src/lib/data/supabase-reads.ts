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
  DocumentType,
  InventoryItem,
  Manufacturer,
  Order,
  OrderDocument,
  Product,
  Supplier,
} from "@/lib/types";

import type { Db } from "./supabase-context";
import { getDataContext, NO_TENANT } from "@/lib/auth/session";

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

function deriveAvailability(
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
    customerId: row.customer_id ?? "",
    items: items.map((item) => ({
      productId: item.product_id ?? "",
      quantity: item.quantity,
      unitPrice: item.unit_price_snapshot,
    })),
    status: row.status,
    createdAt: row.created_at,
    notes: row.notes ?? undefined,
  };
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
  if (isTenantless(tenantId)) return undefined;
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
  if (isTenantless(tenantId)) return undefined;
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
  return data.map(mapManufacturer);
}

export async function sbGetManufacturer(
  id: string,
): Promise<Manufacturer | undefined> {
  const { client, tenantId } = await getReadContext();
  if (isTenantless(tenantId)) return undefined;
  const { data, error } = await client
    .from("manufacturers")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();
  if (error) fail("getManufacturer", error.message);
  return data ? mapManufacturer(data) : undefined;
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
  if (isTenantless(tenantId)) return undefined;
  const { data, error } = await client
    .from("customers")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();
  if (error) fail("getCustomer", error.message);
  return data ? mapCustomer(data) : undefined;
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
  if (isTenantless(tenantId)) return undefined;
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
  if (isTenantless(tenantId)) return undefined;
  const { data, error } = await client
    .from("orders")
    .select(ORDER_SELECT)
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();
  if (error) fail("getOrder", error.message);
  return data ? mapOrder(data as OrderRow) : undefined;
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
  if (isTenantless(tenantId)) return undefined;
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
  if (isTenantless(tenantId)) return [];
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
  "order_number, created_at, notes, customer_snapshot, subtotal, vat_total, total, currency, " +
  "order_items (id, product_name_snapshot, package_unit_snapshot, package_quantity_snapshot, quantity, unit_price_snapshot, line_subtotal, created_at)";

function localizedFrom(value: unknown): { ar: string; he: string; en: string } {
  const v = (value ?? {}) as { ar?: string; he?: string; en?: string };
  return { ar: v.ar ?? "", he: v.he ?? "", en: v.en ?? "" };
}

export async function sbGetOrderDocumentSource(
  orderId: string,
): Promise<OrderDocumentSource | undefined> {
  const { client, tenantId } = await getReadContext();
  if (isTenantless(tenantId)) return undefined;
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
  };
}
