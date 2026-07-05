import "server-only";

/**
 * Supabase read implementations (M2) — SERVER ONLY.
 *
 * Maps database rows (generated types) onto the UI domain types in
 * src/lib/types.ts so every page renders identically in mock and
 * supabase mode. Reached exclusively through the src/lib/data functions
 * via a dynamic import, so nothing here (or in @supabase/supabase-js)
 * ever enters a client bundle.
 *
 * ── Access model in M2 (READ THIS) ──────────────────────────────────────
 * There is no auth yet, and RLS (correctly) gives the anon key zero rows.
 * Rather than loosening RLS or shipping keys to the browser, supabase
 * mode runs on a LOCAL-DEV-ONLY server-side service-role client, pinned
 * to the demo tenant:
 *   - requires SUPABASE_SERVICE_ROLE_KEY in .env.local (server env — the
 *     browser never sees it; this module refuses to load client-side),
 *   - refuses to run in production builds/servers,
 *   - every query filters tenant_id explicitly because the service role
 *     bypasses RLS.
 * M4 replaces this with cookie-bound authenticated clients + RLS, at
 * which point the service-role path here is deleted.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";
import { getSupabaseEnv } from "@/lib/supabase/env";
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

/** The tenant seeded by supabase/seed.sql. */
const DEMO_TENANT_ID = "11111111-1111-4111-8111-111111111111";

type Db = SupabaseClient<Database>;
type Row<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];

let cached: { client: Db; tenantId: string } | undefined;

function getReadContext(): { client: Db; tenantId: string } {
  if (cached) return cached;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "[madaf/data] Supabase read mode is local-development only in M2 — " +
        "production reads require the M4 auth milestone (authenticated " +
        "clients + RLS). Build and run in mock mode instead.",
    );
  }
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new Error(
      "[madaf/data] Supabase read mode needs SUPABASE_SERVICE_ROLE_KEY in " +
        ".env.local (local stack key — run `supabase status`). Without " +
        "auth (M4) the anon key correctly sees zero rows under RLS, so " +
        "M2 dev reads go through a server-only, demo-tenant-scoped " +
        "service-role client. See supabase/README.md.",
    );
  }
  const { url } = getSupabaseEnv();
  const client = createClient<Database>(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const tenantId = process.env.MADAF_SUPABASE_TENANT_ID ?? DEMO_TENANT_ID;
  cached = { client, tenantId };
  return cached;
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
  };
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

export async function sbListProducts(): Promise<Product[]> {
  const { client, tenantId } = getReadContext();
  const { data, error } = await client
    .from("products")
    .select(PRODUCT_SELECT)
    .eq("tenant_id", tenantId)
    .eq("is_active", true);
  if (error) fail("listProducts", error.message);
  // Match the mock catalog's visual order: category shelf order, then SKU.
  return (data as ProductRowWithSort[])
    .sort(
      (a, b) =>
        (a.categories?.sort_order ?? 99) - (b.categories?.sort_order ?? 99) ||
        (a.sku ?? "").localeCompare(b.sku ?? ""),
    )
    .map(mapProduct);
}

export async function sbGetProduct(id: string): Promise<Product | undefined> {
  const { client, tenantId } = getReadContext();
  const { data, error } = await client
    .from("products")
    .select(PRODUCT_SELECT)
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();
  if (error) fail("getProduct", error.message);
  return data ? mapProduct(data as ProductRow) : undefined;
}

export async function sbListCategories(): Promise<Category[]> {
  const { client, tenantId } = getReadContext();
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
  const { client, tenantId } = getReadContext();
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
  const { client, tenantId } = getReadContext();
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
  const { client, tenantId } = getReadContext();
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
  const { client, tenantId } = getReadContext();
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
  const { client, tenantId } = getReadContext();
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
  const { client, tenantId } = getReadContext();
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
  const { client, tenantId } = getReadContext();
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
  const { client, tenantId } = getReadContext();
  const { data, error } = await client
    .from("orders")
    .select(ORDER_SELECT)
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });
  if (error) fail("listOrders", error.message);
  return (data as OrderRow[]).map(mapOrder);
}

export async function sbGetOrder(id: string): Promise<Order | undefined> {
  const { client, tenantId } = getReadContext();
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
  const { client, tenantId } = getReadContext();
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
  const { client, tenantId } = getReadContext();
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
  const { client, tenantId } = getReadContext();
  const { data, error } = await client
    .from("documents")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("order_id", orderId)
    .order("document_number");
  if (error) fail("listDocumentsForOrder", error.message);
  return data.map(mapDocument).sort(byDocumentLifecycle);
}

export async function sbGetSupplier(): Promise<Supplier> {
  const { client, tenantId } = getReadContext();
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
