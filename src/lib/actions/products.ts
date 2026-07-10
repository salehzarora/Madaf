"use server";

/**
 * Product / manufacturer / inventory write Server Actions (M3B).
 *
 * The only bridge between admin client components and the catalog write
 * side of the data layer. Client components import THESE (Next compiles
 * them to RPC stubs); the server-only Supabase modules stay out of every
 * client bundle.
 *
 * Server Actions are public endpoints, so inputs are re-validated here
 * (shapes, bounds, lengths) AND again by the service-role-only DB RPCs,
 * which are the real gate — tenant ownership, cross-tenant attachment,
 * SKU uniqueness and every numeric range are enforced in Postgres. The
 * tenant is pinned server-side; no client-supplied tenant_id is trusted.
 *
 * Errors are logged server-side and returned as generic flags — the UI
 * shows a localized message from the dictionary.
 */
import { revalidatePath } from "next/cache";

import {
  createManufacturer,
  createProduct,
  setProductActive,
  updateManufacturer,
  updateProduct,
  uploadManufacturerLogo,
  uploadProductImage,
  uploadTenantLogo,
  upsertInventory,
  type InventoryWriteInput,
  type ManufacturerWriteInput,
  type ProductWriteInput,
} from "@/lib/data";
import { BASE_UNITS, PACKAGE_UNITS } from "@/lib/types";

const MAX_TEXT = 200;
const MAX_LONG_TEXT = 2000;
const MAX_SHORT = 64;
const MAX_URL = 500;
const MAX_ID_LENGTH = 64;

const IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_LOGO_BYTES = 2 * 1024 * 1024; // 2 MB — brand logos stay small (M8E.3)

/**
 * Sniff the real image type from magic bytes so a spoofed Content-Type
 * (client-controlled) can't smuggle a non-image through the allowlist.
 * Dependency-free; recognizes exactly the allowed formats.
 */
function sniffImageMime(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  // WebP: "RIFF"<4 bytes size>"WEBP"
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

function isPlausibleId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_ID_LENGTH &&
    /^[A-Za-z0-9-]+$/.test(value)
  );
}

function str(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

function num(value: unknown): number | undefined {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function revalidateCatalog(locale: string): void {
  if (typeof locale !== "string" || !/^[a-z]{2}$/.test(locale)) return;
  revalidatePath(`/${locale}`, "layout"); // ShopDataProvider in the root layout
  revalidatePath(`/${locale}/catalog`);
  revalidatePath(`/${locale}/admin/products`);
  revalidatePath(`/${locale}/admin/inventory`);
  revalidatePath(`/${locale}/admin`);
}

/** Raw product fields from the admin form → validated ProductWriteInput. */
function readProductInput(raw: Record<string, unknown>): ProductWriteInput | null {
  const nameAr = str(raw.nameAr, MAX_TEXT);
  const nameHe = str(raw.nameHe, MAX_TEXT);
  const nameEn = str(raw.nameEn, MAX_TEXT);
  const categoryId = raw.categoryId;
  const wholesalePrice = num(raw.wholesalePrice);
  if (!nameAr || !nameHe || !nameEn) return null;
  if (!isPlausibleId(categoryId)) return null;
  if (wholesalePrice === undefined || wholesalePrice < 0) return null;

  const packageUnit = raw.packageUnit;
  if (!PACKAGE_UNITS.includes(packageUnit as never)) return null;
  const baseUnit = raw.baseUnit;
  if (!BASE_UNITS.includes(baseUnit as never)) return null;

  const manufacturerId = raw.manufacturerId;
  if (manufacturerId != null && manufacturerId !== "" && !isPlausibleId(manufacturerId)) {
    return null;
  }

  const packageQuantity = num(raw.packageQuantity) ?? 1;
  const vatRate = num(raw.vatRate);

  return {
    nameAr,
    nameHe,
    nameEn,
    descriptionAr: str(raw.descriptionAr, MAX_LONG_TEXT),
    descriptionHe: str(raw.descriptionHe, MAX_LONG_TEXT),
    descriptionEn: str(raw.descriptionEn, MAX_LONG_TEXT),
    categoryId: categoryId as string,
    manufacturerId: isPlausibleId(manufacturerId) ? manufacturerId : undefined,
    sku: str(raw.sku, MAX_SHORT),
    barcode: str(raw.barcode, MAX_SHORT),
    packageUnit: packageUnit as ProductWriteInput["packageUnit"],
    packageQuantity: Math.floor(packageQuantity),
    baseUnit: baseUnit as ProductWriteInput["baseUnit"],
    unitSize: str(raw.unitSize, MAX_SHORT),
    wholesalePrice,
    vatRate: vatRate !== undefined && vatRate >= 0 && vatRate < 1 ? vatRate : undefined,
    imageUrl: str(raw.imageUrl, MAX_URL),
    trackExpiry: raw.trackExpiry === true,
    isActive: raw.isActive !== false,
  };
}

function readInventoryInput(
  raw: Record<string, unknown> | undefined,
): InventoryWriteInput | undefined {
  if (!raw) return undefined;
  const quantityAvailable = num(raw.quantityAvailable);
  if (quantityAvailable === undefined || quantityAvailable < 0) return undefined;
  const lowStockThreshold = num(raw.lowStockThreshold);
  const expiry = str(raw.expiryDate, 10);
  return {
    quantityAvailable: Math.floor(quantityAvailable),
    lowStockThreshold:
      lowStockThreshold !== undefined && lowStockThreshold >= 0
        ? Math.floor(lowStockThreshold)
        : undefined,
    warehouseLocation: str(raw.warehouseLocation, MAX_SHORT),
    expiryDate: expiry && /^\d{4}-\d{2}-\d{2}$/.test(expiry) ? expiry : undefined,
  };
}

export interface ProductWriteResult {
  ok: boolean;
  productId?: string;
}

export async function createProductAction(input: {
  product: Record<string, unknown>;
  inventory?: Record<string, unknown>;
  locale: string;
}): Promise<ProductWriteResult> {
  try {
    const product = readProductInput(input.product);
    if (!product) return { ok: false };
    const inventory = readInventoryInput(input.inventory);
    const result = await createProduct(product, inventory);
    revalidateCatalog(input.locale);
    return { ok: true, productId: result.productId };
  } catch (error) {
    console.error("[madaf/actions] createProductAction failed:", error);
    return { ok: false };
  }
}

export async function updateProductAction(input: {
  productId: string;
  product: Record<string, unknown>;
  inventory?: Record<string, unknown>;
  locale: string;
}): Promise<ProductWriteResult> {
  try {
    if (!isPlausibleId(input.productId)) return { ok: false };
    const product = readProductInput(input.product);
    if (!product) return { ok: false };
    const inventory = readInventoryInput(input.inventory);
    const result = await updateProduct(input.productId, product, inventory);
    revalidateCatalog(input.locale);
    revalidatePath(`/${input.locale}/admin/products/${input.productId}/edit`);
    revalidatePath(`/${input.locale}/product/${input.productId}`);
    return { ok: true, productId: result.productId };
  } catch (error) {
    console.error("[madaf/actions] updateProductAction failed:", error);
    return { ok: false };
  }
}

export async function setProductActiveAction(input: {
  productId: string;
  isActive: boolean;
  locale: string;
}): Promise<ProductWriteResult> {
  try {
    if (!isPlausibleId(input.productId) || typeof input.isActive !== "boolean") {
      return { ok: false };
    }
    const result = await setProductActive(input.productId, input.isActive);
    revalidateCatalog(input.locale);
    return { ok: true, productId: result.productId };
  } catch (error) {
    console.error("[madaf/actions] setProductActiveAction failed:", error);
    return { ok: false };
  }
}

export async function upsertInventoryAction(input: {
  productId: string;
  inventory: Record<string, unknown>;
  locale: string;
}): Promise<{ ok: boolean }> {
  try {
    if (!isPlausibleId(input.productId)) return { ok: false };
    const inventory = readInventoryInput(input.inventory);
    if (!inventory) return { ok: false };
    await upsertInventory(input.productId, inventory);
    revalidateCatalog(input.locale);
    return { ok: true };
  } catch (error) {
    console.error("[madaf/actions] upsertInventoryAction failed:", error);
    return { ok: false };
  }
}

export interface ManufacturerWriteResult {
  ok: boolean;
  manufacturerId?: string;
}

function readManufacturerInput(
  raw: Record<string, unknown>,
): ManufacturerWriteInput | null {
  const nameAr = str(raw.nameAr, MAX_TEXT);
  const nameHe = str(raw.nameHe, MAX_TEXT);
  const nameEn = str(raw.nameEn, MAX_TEXT);
  if (!nameAr || !nameHe || !nameEn) return null;
  const sortOrder = num(raw.sortOrder);
  return {
    nameAr,
    nameHe,
    nameEn,
    logoUrl: str(raw.logoUrl, MAX_URL),
    sortOrder: sortOrder !== undefined ? Math.floor(sortOrder) : undefined,
  };
}

export async function createManufacturerAction(input: {
  manufacturer: Record<string, unknown>;
  locale: string;
}): Promise<ManufacturerWriteResult> {
  try {
    const manufacturer = readManufacturerInput(input.manufacturer);
    if (!manufacturer) return { ok: false };
    const result = await createManufacturer(manufacturer);
    revalidateCatalog(input.locale);
    revalidatePath(`/${input.locale}/admin/manufacturers`);
    return { ok: true, manufacturerId: result.manufacturerId };
  } catch (error) {
    console.error("[madaf/actions] createManufacturerAction failed:", error);
    return { ok: false };
  }
}

export async function updateManufacturerAction(input: {
  manufacturerId: string;
  manufacturer: Record<string, unknown>;
  locale: string;
}): Promise<ManufacturerWriteResult> {
  try {
    if (!isPlausibleId(input.manufacturerId)) return { ok: false };
    const manufacturer = readManufacturerInput(input.manufacturer);
    if (!manufacturer) return { ok: false };
    const result = await updateManufacturer(
      input.manufacturerId,
      manufacturer,
    );
    revalidateCatalog(input.locale);
    revalidatePath(`/${input.locale}/admin/manufacturers`);
    return { ok: true, manufacturerId: result.manufacturerId };
  } catch (error) {
    console.error("[madaf/actions] updateManufacturerAction failed:", error);
    return { ok: false };
  }
}

export interface UploadImageResult {
  ok: boolean;
  /** Object path stored on products.image_url (signed on read). */
  path?: string;
  /** Short-lived signed URL for immediate preview. */
  previewUrl?: string;
  /** Reason surfaced to the UI for a localized message. "type" = unsupported
   * MIME; "invalid" = declared image but the bytes are not a real/matching
   * image (magic-byte mismatch, corrupt); "size" = too large; "failed" =
   * storage/transport/unknown error. */
  reason?: "type" | "invalid" | "size" | "failed";
}

export async function uploadProductImageAction(
  formData: FormData,
): Promise<UploadImageResult> {
  try {
    const rawProductId = formData.get("productId");
    // Edit mode passes a product id (must be plausible); create mode omits it
    // (empty string / null) and uploads to a tenant-scoped staging path.
    const hasProductId =
      typeof rawProductId === "string" && rawProductId.length > 0;
    if (hasProductId && !isPlausibleId(rawProductId)) {
      return { ok: false, reason: "failed" };
    }
    const productId = hasProductId ? (rawProductId as string) : undefined;
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return { ok: false, reason: "failed" };
    }
    if (!IMAGE_MIME_TYPES.has(file.type)) {
      return { ok: false, reason: "type" };
    }
    if (file.size > MAX_IMAGE_BYTES) {
      return { ok: false, reason: "size" };
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    // Magic-byte check: the real content must be an allowed image AND
    // match the declared type — a spoofed Content-Type is rejected.
    const sniffed = sniffImageMime(bytes);
    if (!sniffed || sniffed !== file.type) {
      // Declared an image but the bytes don't match a real allowed image
      // (spoofed Content-Type / corrupt) → distinct "invalid" reason.
      return { ok: false, reason: "invalid" };
    }
    const result = await uploadProductImage({
      ...(productId ? { productId } : {}),
      fileName: file.name || "image",
      contentType: sniffed,
      bytes,
    });
    return { ok: true, path: result.path, previewUrl: result.previewUrl };
  } catch (error) {
    console.error("[madaf/actions] uploadProductImageAction failed:", error);
    return { ok: false, reason: "failed" };
  }
}

/**
 * M8E.3 — upload a manufacturer/brand logo. Same layered validation as the
 * product-image upload (MIME allowlist + size + magic-byte sniff that must
 * match the declared type); the storage RLS (owner/admin on the tenant path)
 * + tenant-ownership check in the data layer are the real gate. Returns the
 * object PATH (persisted on manufacturers.logo_url) + a signed preview URL.
 */
export async function uploadManufacturerLogoAction(
  formData: FormData,
): Promise<UploadImageResult> {
  try {
    const rawId = formData.get("manufacturerId");
    const hasId = typeof rawId === "string" && rawId.length > 0;
    if (hasId && !isPlausibleId(rawId)) {
      return { ok: false, reason: "failed" };
    }
    const manufacturerId = hasId ? (rawId as string) : undefined;
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return { ok: false, reason: "failed" };
    }
    if (!IMAGE_MIME_TYPES.has(file.type)) {
      return { ok: false, reason: "type" };
    }
    if (file.size > MAX_LOGO_BYTES) {
      return { ok: false, reason: "size" };
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const sniffed = sniffImageMime(bytes);
    if (!sniffed || sniffed !== file.type) {
      // Declared an image but the bytes don't match a real allowed image
      // (spoofed Content-Type / corrupt) → distinct "invalid" reason.
      return { ok: false, reason: "invalid" };
    }
    const result = await uploadManufacturerLogo({
      ...(manufacturerId ? { manufacturerId } : {}),
      fileName: file.name || "logo",
      contentType: sniffed,
      bytes,
    });
    return { ok: true, path: result.path, previewUrl: result.previewUrl };
  } catch (error) {
    console.error("[madaf/actions] uploadManufacturerLogoAction failed:", error);
    return { ok: false, reason: "failed" };
  }
}

/**
 * M8E.4 — upload a tenant BUSINESS logo. Same layered image validation as the
 * manufacturer logo (MIME allowlist + 2 MB cap + magic-byte sniff); the
 * storage RLS (owner/admin on the tenant path) is the real gate. Returns the
 * object PATH (persisted on tenants.logo_url) + a signed preview URL.
 */
export async function uploadTenantLogoAction(
  formData: FormData,
): Promise<UploadImageResult> {
  try {
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return { ok: false, reason: "failed" };
    }
    if (!IMAGE_MIME_TYPES.has(file.type)) {
      return { ok: false, reason: "type" };
    }
    if (file.size > MAX_LOGO_BYTES) {
      return { ok: false, reason: "size" };
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const sniffed = sniffImageMime(bytes);
    if (!sniffed || sniffed !== file.type) {
      // Declared an image but the bytes don't match a real allowed image
      // (spoofed Content-Type / corrupt) → distinct "invalid" reason.
      return { ok: false, reason: "invalid" };
    }
    const result = await uploadTenantLogo({
      fileName: file.name || "logo",
      contentType: sniffed,
      bytes,
    });
    return { ok: true, path: result.path, previewUrl: result.previewUrl };
  } catch (error) {
    console.error("[madaf/actions] uploadTenantLogoAction failed:", error);
    return { ok: false, reason: "failed" };
  }
}
