/**
 * Catalog data access — products, categories, manufacturers.
 *
 * Mock mode (default): typed TS modules in src/lib/mock.
 * Supabase mode (M2, local dev): server-only reads in ./supabase-reads —
 * see the mapping notes there (name_ar/he/en → translations, package_unit
 * → packageType, availability DERIVED from inventory_items, …).
 *
 * Server components call these directly; client components receive the
 * results as props/context (never fetch themselves).
 */
import {
  categories,
  categoryById,
  inventoryByProductId,
  manufacturerById,
  manufacturers,
  productById,
  products,
} from "@/lib/mock";
import { isLowStock } from "@/lib/catalog-helpers";
import {
  compareProductsForList,
  productMatchesSearch,
  productMatchesStatus,
  totalProductPagesFor,
  type ProductExportRow,
  type ProductsListResult,
  type ProductsQuery,
} from "@/lib/products-query";
import type {
  BaseUnit,
  Category,
  Manufacturer,
  PackageType,
  Product,
} from "@/lib/types";

import { getDataMode } from "./mode";

// ── Write input shapes (M3B) ──────────────────────────────────────────────

export interface ProductWriteInput {
  nameAr: string;
  nameHe: string;
  nameEn: string;
  descriptionAr?: string;
  descriptionHe?: string;
  descriptionEn?: string;
  categoryId: string;
  manufacturerId?: string;
  sku?: string;
  barcode?: string;
  packageUnit: PackageType;
  packageQuantity: number;
  baseUnit: BaseUnit;
  unitSize?: string;
  wholesalePrice: number;
  vatRate?: number;
  imageUrl?: string;
  trackExpiry?: boolean;
  isActive?: boolean;
}

export interface InventoryWriteInput {
  quantityAvailable: number;
  lowStockThreshold?: number;
  warehouseLocation?: string;
  /** ISO date `YYYY-MM-DD`, or omitted. */
  expiryDate?: string;
}

export interface ManufacturerWriteInput {
  nameAr: string;
  nameHe: string;
  nameEn: string;
  logoUrl?: string;
  sortOrder?: number;
}

/**
 * Catalog writes exist only in supabase mode. In mock mode the admin
 * forms show a demo message and never call these (they gate on
 * getDataMode), so reaching one here means a misconfigured caller.
 */
function mockWriteUnsupported(fn: string): never {
  throw new Error(
    `[madaf/data] ${fn} is a Supabase-only catalog write — mock mode does ` +
      "not persist. Run in supabase mode (NEXT_PUBLIC_MADAF_DATA_MODE=" +
      "supabase) or keep the admin form in demo mode.",
  );
}

export async function listProducts(
  options?: { includeInactive?: boolean },
): Promise<Product[]> {
  if (getDataMode() === "supabase") {
    return (await import("./supabase-reads")).sbListProducts(
      options?.includeInactive ?? false,
    );
  }
  // Mock products have no is_active field — all are implicitly active, so
  // includeInactive is a no-op in mock mode.
  return products;
}

export async function getProduct(id: string): Promise<Product | undefined> {
  if (getDataMode() === "supabase") {
    return (await import("./supabase-reads")).sbGetProduct(id);
  }
  return productById.get(id);
}

// ── Server-side products search + pagination (M8F.2) ──────────────────────
// The admin Products list fetches ONLY the current page + the exact filtered
// total (no full-catalog client load). Search covers the product's own columns
// (name ar/he/en, sku, barcode); category / manufacturer / status are filters.
// Supabase runs everything in the tenant-scoped RLS query and signs only the
// current page's images; mock mirrors the same filters/sort/pagination.

/** Filter, sort and paginate the mock catalog exactly like the supabase query
 * (shared, PURE helpers keep them in lock-step). Admin always includes inactive
 * rows — mock products carry no is_active, so they are all implicitly active. */
function filterMockProducts(query: ProductsQuery): Product[] {
  return products
    .filter((p) => {
      if (query.categoryId && p.categoryId !== query.categoryId) return false;
      if (query.manufacturerId && p.manufacturerId !== query.manufacturerId) {
        return false;
      }
      if (!productMatchesStatus(p, query.status)) return false;
      // Product's own columns only (name/sku/barcode) — mirrors the supabase
      // `.or()`. Manufacturer/brand-name free-text search is BLOCKED ON DATABASE
      // DESIGN; manufacturer scoping is the bounded manufacturer FILTER above.
      return productMatchesSearch(p, query.search);
    })
    .sort(compareProductsForList);
}

export async function searchProducts(
  query: ProductsQuery,
): Promise<ProductsListResult> {
  if (getDataMode() === "supabase") {
    return (await import("./supabase-reads")).sbSearchProducts(query);
  }
  const pageSize = Math.max(1, query.pageSize);
  const all = filterMockProducts(query);
  const total = all.length;
  const totalPages = totalProductPagesFor(total, pageSize);
  // Clamp an out-of-range page to the last page (mirrors the supabase count-
  // first clamp) so a stale/shared ?page never yields an empty page or error.
  const page = Math.min(Math.max(1, query.page), totalPages);
  const offset = (page - 1) * pageSize;
  return {
    products: all.slice(offset, offset + pageSize),
    total,
    page,
    pageSize,
    totalPages,
  };
}

/** All filtered products (up to `cap`) for the CSV export — the FULL filtered
 * set, not the current page. Pagination is ignored; filters are preserved. */
export async function listProductsForExport(
  query: ProductsQuery,
  cap: number,
): Promise<ProductExportRow[]> {
  if (getDataMode() === "supabase") {
    return (await import("./supabase-reads")).sbListProductsForExport(
      query,
      cap,
    );
  }
  const limit = Math.max(1, cap);
  return filterMockProducts(query)
    .slice(0, limit)
    .map((product) => {
      const inv = inventoryByProductId.get(product.id);
      return {
        product,
        stockPackages: inv ? inv.stockPackages : null,
        isLowStock: inv ? isLowStock(inv) : null,
      };
    });
}

export async function listCategories(): Promise<Category[]> {
  if (getDataMode() === "supabase") {
    return (await import("./supabase-reads")).sbListCategories();
  }
  return categories;
}

export async function getCategory(id: string): Promise<Category | undefined> {
  if (getDataMode() === "supabase") {
    return (await import("./supabase-reads")).sbGetCategory(id);
  }
  return categoryById.get(id);
}

export async function listManufacturers(): Promise<Manufacturer[]> {
  if (getDataMode() === "supabase") {
    return (await import("./supabase-reads")).sbListManufacturers();
  }
  return manufacturers;
}

export async function getManufacturer(
  id: string,
): Promise<Manufacturer | undefined> {
  if (getDataMode() === "supabase") {
    return (await import("./supabase-reads")).sbGetManufacturer(id);
  }
  return manufacturerById.get(id);
}

// ── Writes (M3B) — supabase-only ──────────────────────────────────────────

export async function createProduct(
  input: ProductWriteInput,
  inventory?: InventoryWriteInput,
): Promise<{ productId: string }> {
  if (getDataMode() !== "supabase") mockWriteUnsupported("createProduct");
  return (await import("./supabase-writes")).sbCreateProduct(input, inventory);
}

export async function updateProduct(
  productId: string,
  input: ProductWriteInput,
  inventory?: InventoryWriteInput,
): Promise<{ productId: string }> {
  if (getDataMode() !== "supabase") mockWriteUnsupported("updateProduct");
  return (await import("./supabase-writes")).sbUpdateProduct(
    productId,
    input,
    inventory,
  );
}

export async function setProductActive(
  productId: string,
  isActive: boolean,
): Promise<{ productId: string }> {
  if (getDataMode() !== "supabase") mockWriteUnsupported("setProductActive");
  return (await import("./supabase-writes")).sbSetProductActive(
    productId,
    isActive,
  );
}

export async function upsertInventory(
  productId: string,
  inventory: InventoryWriteInput,
): Promise<void> {
  if (getDataMode() !== "supabase") mockWriteUnsupported("upsertInventory");
  return (await import("./supabase-writes")).sbUpsertInventory(
    productId,
    inventory,
  );
}

export async function createManufacturer(
  input: ManufacturerWriteInput,
): Promise<{ manufacturerId: string }> {
  if (getDataMode() !== "supabase") mockWriteUnsupported("createManufacturer");
  return (await import("./supabase-writes")).sbCreateManufacturer(input);
}

export async function updateManufacturer(
  manufacturerId: string,
  input: ManufacturerWriteInput,
): Promise<{ manufacturerId: string }> {
  if (getDataMode() !== "supabase") mockWriteUnsupported("updateManufacturer");
  return (await import("./supabase-writes")).sbUpdateManufacturer(
    manufacturerId,
    input,
  );
}

export async function uploadProductImage(input: {
  /** Omitted in create mode (no product row yet) — a tenant-scoped staging
   * path is used instead; see sbUploadProductImage. */
  productId?: string;
  fileName: string;
  contentType: string;
  bytes: Uint8Array;
}): Promise<{ path: string; previewUrl: string }> {
  if (getDataMode() !== "supabase") mockWriteUnsupported("uploadProductImage");
  return (await import("./supabase-writes")).sbUploadProductImage(input);
}

/** M8E.3 — upload a manufacturer/brand logo (private product-images bucket,
 * `<tenant>/manufacturers/…` path). Supabase-only; mock persists nothing. */
export async function uploadManufacturerLogo(input: {
  /** Omitted in create mode (no manufacturer row yet) — a staging path is used. */
  manufacturerId?: string;
  fileName: string;
  contentType: string;
  bytes: Uint8Array;
}): Promise<{ path: string; previewUrl: string }> {
  if (getDataMode() !== "supabase") mockWriteUnsupported("uploadManufacturerLogo");
  return (await import("./supabase-writes")).sbUploadManufacturerLogo(input);
}
