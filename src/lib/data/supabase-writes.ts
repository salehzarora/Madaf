import "server-only";

/**
 * Supabase write implementations — SERVER ONLY.
 *
 * Thin wrappers around tenant-validated database RPCs that do the real
 * validation/computation atomically. Since M4A they run on the
 * authenticated cookie client (getDataContext) and each RPC is gated by
 * `authorize_tenant` — the tenant comes from membership, never client input:
 *   - M3A orders: create_order_request / update_order_status.
 *   - M3B catalog: create_product / update_product / set_product_active /
 *     upsert_inventory_item / create_manufacturer / update_manufacturer
 *     (supabase/migrations/20260705150000_product_crud_rpcs.sql). Plus
 *     sbUploadProductImage → Storage (private product-images bucket).
 *
 * Reached only through the data layer via dynamic import — never from
 * client code (see src/lib/auth/session.ts for the access model).
 *   - M5A documents: create_order_document records an order-derived
 *     document row (order request / delivery note / invoice DRAFT). It is
 *     the ONLY document write path — documents stay table-level read-only.
 */
import { randomUUID } from "node:crypto";

import { getDataContext, NO_TENANT } from "@/lib/auth/session";
import type { CustomerWriteInput } from "./customers";
import type { OrderSource } from "./orders";
import type {
  InventoryWriteInput,
  ManufacturerWriteInput,
  ProductWriteInput,
} from "./products";
import type { Json } from "@/lib/supabase/database.types";
import type { OrderStatus } from "@/lib/types";

function fail(what: string, message: string): never {
  throw new Error(`[madaf/data] supabase write failed (${what}): ${message}`);
}

export async function sbCreateOrderRequest(input: {
  customerId: string | null;
  items: { productId: string; quantity: number }[];
  notes?: string;
  source: OrderSource;
}): Promise<{ orderId: string; orderNumber: string; publicRef: string }> {
  const { client, tenantId } = await getDataContext();
  const { data, error } = await client
    .rpc("create_order_request", {
      p_tenant_id: tenantId,
      p_items: input.items.map((item) => ({
        product_id: item.productId,
        quantity: item.quantity,
      })),
      ...(input.customerId ? { p_customer_id: input.customerId } : {}),
      ...(input.notes ? { p_notes: input.notes } : {}),
      p_source: input.source,
    })
    .single();
  if (error) fail("createOrderRequest", error.message);
  // Read back the customer-facing public ref (the RPC returns only the
  // internal number). The just-created order is RLS-accessible to the caller.
  const { data: refRow } = await client
    .from("orders")
    .select("public_ref")
    .eq("id", data.order_id)
    .maybeSingle();
  return {
    orderId: data.order_id,
    orderNumber: data.order_number,
    publicRef: refRow?.public_ref ?? "",
  };
}

export async function sbUpdateOrderStatus(
  orderId: string,
  nextStatus: OrderStatus,
): Promise<{ orderId: string; oldStatus: OrderStatus; newStatus: OrderStatus }> {
  const { client, tenantId } = await getDataContext();
  const { data, error } = await client
    .rpc("update_order_status", {
      p_tenant_id: tenantId,
      p_order_id: orderId,
      p_new_status: nextStatus,
    })
    .single();
  if (error) fail("updateOrderStatus", error.message);
  return {
    orderId: data.order_id,
    oldStatus: data.old_status,
    newStatus: data.new_status,
  };
}

// ── M5A: document generation ──────────────────────────────────────────────

/**
 * Record an order-derived document via the create_order_document RPC
 * (SECURITY DEFINER — authorize_tenant + can_access_order). Returns the
 * internal document number + creation timestamp. invoice_draft rows stay
 * status 'draft' with a guaranteed legal notice — never a legal tax invoice.
 */
export async function sbCreateOrderDocument(input: {
  orderId: string;
  documentType: "order_request" | "delivery_note" | "invoice_draft";
  documentLocale: "ar" | "he" | "en";
  legalNotice: string | null;
}): Promise<{
  documentId: string;
  documentNumber: string;
  documentDate: string;
  storagePath: string | null;
}> {
  const { client, tenantId } = await getDataContext();
  const { data, error } = await client
    .rpc("create_order_document", {
      p_tenant_id: tenantId,
      p_order_id: input.orderId,
      p_document_type: input.documentType,
      p_document_locale: input.documentLocale,
      ...(input.legalNotice ? { p_legal_notice: input.legalNotice } : {}),
    })
    .single();
  if (error) fail("createOrderDocument", error.message);
  return {
    documentId: data.id,
    documentNumber: data.document_number,
    documentDate: data.created_at,
    // The path of a previously-stored PDF (M5B.1 reuse check), or null.
    storagePath: data.storage_path ?? null,
  };
}

/**
 * Record the stored-PDF metadata (path/size/checksum) of a document via the
 * set_document_storage RPC (SECURITY DEFINER — authorize_tenant +
 * can_access_order + EXACT expected-path check, M5B.1). documents stay
 * table-level read-only; this is the only write path for the storage columns.
 */
export async function sbSetDocumentStorage(input: {
  documentId: string;
  storagePath: string;
  fileSizeBytes: number;
  checksum: string;
}): Promise<void> {
  const { client, tenantId } = await getDataContext();
  const { error } = await client.rpc("set_document_storage", {
    p_tenant_id: tenantId,
    p_document_id: input.documentId,
    p_storage_path: input.storagePath,
    p_file_size_bytes: input.fileSizeBytes,
    p_checksum: input.checksum,
  });
  if (error) fail("setDocumentStorage", error.message);
}

// ── M3B: catalog writes ───────────────────────────────────────────────────

/** UI field names → jsonb payload keys the product RPCs expect. */
function toProductPayload(input: ProductWriteInput): Json {
  return {
    name_ar: input.nameAr,
    name_he: input.nameHe,
    name_en: input.nameEn,
    description_ar: input.descriptionAr ?? null,
    description_he: input.descriptionHe ?? null,
    description_en: input.descriptionEn ?? null,
    category_id: input.categoryId,
    manufacturer_id: input.manufacturerId ?? null,
    sku: input.sku ?? null,
    barcode: input.barcode ?? null,
    package_unit: input.packageUnit,
    package_quantity: input.packageQuantity,
    base_unit: input.baseUnit,
    unit_size: input.unitSize ?? null,
    wholesale_price: input.wholesalePrice,
    vat_rate: input.vatRate ?? 0.18,
    image_url: input.imageUrl ?? null,
    track_expiry: input.trackExpiry ?? false,
    is_active: input.isActive ?? true,
  };
}

function toInventoryPayload(inv: InventoryWriteInput): Json {
  return {
    quantity_available: inv.quantityAvailable,
    low_stock_threshold: inv.lowStockThreshold ?? 10,
    warehouse_location: inv.warehouseLocation ?? null,
    expiry_date: inv.expiryDate ?? null,
  };
}

export async function sbCreateProduct(
  input: ProductWriteInput,
  inventory?: InventoryWriteInput,
): Promise<{ productId: string }> {
  const { client, tenantId } = await getDataContext();
  const { data, error } = await client.rpc("create_product", {
    p_tenant_id: tenantId,
    p_product: toProductPayload(input),
    ...(inventory ? { p_inventory: toInventoryPayload(inventory) } : {}),
  });
  if (error) fail("createProduct", error.message);
  return { productId: data as string };
}

export async function sbUpdateProduct(
  productId: string,
  input: ProductWriteInput,
  inventory?: InventoryWriteInput,
): Promise<{ productId: string }> {
  const { client, tenantId } = await getDataContext();
  const { data, error } = await client.rpc("update_product", {
    p_tenant_id: tenantId,
    p_product_id: productId,
    p_product: toProductPayload(input),
    ...(inventory ? { p_inventory: toInventoryPayload(inventory) } : {}),
  });
  if (error) fail("updateProduct", error.message);
  return { productId: data as string };
}

export async function sbSetProductActive(
  productId: string,
  isActive: boolean,
): Promise<{ productId: string }> {
  const { client, tenantId } = await getDataContext();
  const { data, error } = await client.rpc("set_product_active", {
    p_tenant_id: tenantId,
    p_product_id: productId,
    p_is_active: isActive,
  });
  if (error) fail("setProductActive", error.message);
  return { productId: data as string };
}

export async function sbUpsertInventory(
  productId: string,
  inventory: InventoryWriteInput,
): Promise<void> {
  const { client, tenantId } = await getDataContext();
  const { error } = await client.rpc("upsert_inventory_item", {
    p_tenant_id: tenantId,
    p_product_id: productId,
    p_inventory: toInventoryPayload(inventory),
  });
  if (error) fail("upsertInventory", error.message);
}

export async function sbCreateManufacturer(
  input: ManufacturerWriteInput,
): Promise<{ manufacturerId: string }> {
  const { client, tenantId } = await getDataContext();
  const { data, error } = await client.rpc("create_manufacturer", {
    p_tenant_id: tenantId,
    p_name_ar: input.nameAr,
    p_name_he: input.nameHe,
    p_name_en: input.nameEn,
    ...(input.logoUrl ? { p_logo_url: input.logoUrl } : {}),
    ...(input.sortOrder != null ? { p_sort_order: input.sortOrder } : {}),
  });
  if (error) fail("createManufacturer", error.message);
  return { manufacturerId: data as string };
}

export async function sbUpdateManufacturer(
  manufacturerId: string,
  input: ManufacturerWriteInput,
): Promise<{ manufacturerId: string }> {
  const { client, tenantId } = await getDataContext();
  const { data, error } = await client.rpc("update_manufacturer", {
    p_tenant_id: tenantId,
    p_manufacturer_id: manufacturerId,
    p_name_ar: input.nameAr,
    p_name_he: input.nameHe,
    p_name_en: input.nameEn,
    p_logo_url: input.logoUrl ?? "",
    ...(input.sortOrder != null ? { p_sort_order: input.sortOrder } : {}),
  });
  if (error) fail("updateManufacturer", error.message);
  return { manufacturerId: data as string };
}

const PRODUCT_IMAGE_BUCKET = "product-images";

/**
 * Upload a product image to the private product-images bucket under a
 * tenant-scoped path whose FIRST segment is always the tenant uuid (the only
 * thing the storage RLS policy keys on). Returns the object PATH (stored on
 * products.image_url — the read layer signs it) plus a short-lived signed URL
 * for immediate preview. The upload runs on the authenticated client, so the
 * storage RLS policy ("owners/admins can upload" to their `<tenant_id>/…`
 * path) is the real gate (M4A).
 *
 * EDIT mode (`productId` given): the product must belong to the tenant
 * (checked here) and the object lives at `<tenant_id>/products/<id>/<file>`.
 * CREATE mode (`productId` omitted): there is no product row yet, so the
 * object lives at `<tenant_id>/products/uploads/<uuid>-<file>` — still under
 * the tenant prefix, so RLS + signProductImages both keep working, and the
 * path is persisted verbatim by create_product on save (M7F.1).
 */
export async function sbUploadProductImage(input: {
  productId?: string;
  fileName: string;
  contentType: string;
  bytes: Uint8Array;
}): Promise<{ path: string; previewUrl: string }> {
  const { client, tenantId } = await getDataContext();
  // Anon / no membership can never own a tenant storage prefix — fail closed
  // (the storage RLS would reject anyway, but be explicit).
  if (tenantId === NO_TENANT) {
    fail("uploadProductImage", "no tenant membership for the caller");
  }

  if (input.productId) {
    const { data: product, error: productError } = await client
      .from("products")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("id", input.productId)
      .maybeSingle();
    if (productError) fail("uploadProductImage", productError.message);
    if (!product) {
      fail("uploadProductImage", "product is unknown or belongs to another tenant");
    }
  }

  const safeName = input.fileName
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(-80);
  const path = input.productId
    ? `${tenantId}/products/${input.productId}/${safeName || "image"}`
    : `${tenantId}/products/uploads/${randomUUID()}-${safeName || "image"}`;

  const { error: uploadError } = await client.storage
    .from(PRODUCT_IMAGE_BUCKET)
    .upload(path, input.bytes, {
      contentType: input.contentType,
      upsert: true,
    });
  if (uploadError) fail("uploadProductImage", uploadError.message);

  const { data: signed, error: signError } = await client.storage
    .from(PRODUCT_IMAGE_BUCKET)
    .createSignedUrl(path, 3600);
  if (signError) fail("uploadProductImage", signError.message);

  return { path, previewUrl: signed.signedUrl };
}

// ── Customers (M7F.2) — create_customer / update_customer RPCs ─────────────

/** Only send optional params that carry a value (RPC defaults handle the rest). */
function customerRpcArgs(input: CustomerWriteInput) {
  return {
    p_name: input.name,
    p_customer_type: input.type,
    ...(input.contactName ? { p_contact_name: input.contactName } : {}),
    ...(input.phone ? { p_phone: input.phone } : {}),
    ...(input.cityAr ? { p_city_ar: input.cityAr } : {}),
    ...(input.cityHe ? { p_city_he: input.cityHe } : {}),
    ...(input.cityEn ? { p_city_en: input.cityEn } : {}),
    ...(input.address ? { p_address: input.address } : {}),
    ...(input.notes ? { p_notes: input.notes } : {}),
  };
}

export async function sbCreateCustomer(
  input: CustomerWriteInput,
): Promise<{ customerId: string }> {
  const { client, tenantId } = await getDataContext();
  const { data, error } = await client.rpc("create_customer", {
    p_tenant_id: tenantId,
    ...customerRpcArgs(input),
  });
  if (error) fail("createCustomer", error.message);
  return { customerId: data as string };
}

export async function sbUpdateCustomer(
  customerId: string,
  input: CustomerWriteInput,
): Promise<{ customerId: string }> {
  const { client, tenantId } = await getDataContext();
  const { data, error } = await client.rpc("update_customer", {
    p_tenant_id: tenantId,
    p_customer_id: customerId,
    ...customerRpcArgs(input),
  });
  if (error) fail("updateCustomer", error.message);
  return { customerId: data as string };
}
