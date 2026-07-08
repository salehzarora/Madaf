import "server-only";

/**
 * Private shop-link (token) data path (M4A) — SERVER ONLY.
 *
 * A shop opens `/[locale]/shop/[token]` with no login. The raw token is
 * hashed (SHA-256) and the hash is passed to anon-granted SECURITY
 * DEFINER RPCs that validate it (not revoked / not expired) and return
 * ONLY that tenant/customer's scoped catalog or create an order for that
 * customer. There is no anon table access and no public catalog policy;
 * the tenant_id/customer_id never reach the client.
 */
import { createHash } from "node:crypto";

import { createServerAuthClient } from "@/lib/supabase/server-auth";
import type {
  Availability,
  Category,
  Manufacturer,
  Product,
} from "@/lib/types";

/** SHA-256 hex of the raw token — only the hash is ever stored/sent to SQL. */
export function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}

export interface TokenCatalog {
  tenantName: { ar: string; he: string; en: string };
  customer: { name: string; city: { ar: string; he: string; en: string } };
  products: Product[];
  categories: Category[];
  manufacturers: Manufacturer[];
}

function isExternalUrl(value: unknown): value is string {
  return typeof value === "string" && /^https?:\/\//i.test(value);
}

function deriveAvailability(qty: unknown, threshold: unknown): Availability {
  if (typeof qty !== "number") return "inStock";
  if (qty <= 0) return "outOfStock";
  if (typeof threshold === "number" && qty < threshold) return "lowStock";
  return "inStock";
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function mapTokenProduct(p: any): Product {
  return {
    id: p.id,
    sku: p.sku ?? "",
    translations: {
      ar: { name: p.name_ar, description: p.description_ar ?? undefined },
      he: { name: p.name_he, description: p.description_he ?? undefined },
      en: { name: p.name_en, description: p.description_en ?? undefined },
    },
    categoryId: p.category_id ?? "",
    manufacturerId: p.manufacturer_id ?? "",
    packageType: p.package_unit,
    unitsPerPackage: p.package_quantity,
    baseUnit: p.base_unit,
    unitSize: p.unit_size ?? undefined,
    wholesalePrice: p.wholesale_price,
    availability: deriveAvailability(p.quantity_available, p.low_stock_threshold),
    trackExpiry: p.track_expiry || undefined,
    // Anon can't sign private storage objects, so only external image URLs
    // render for the shop; storage-path images fall back to the gradient.
    imageUrl: isExternalUrl(p.image_url) ? p.image_url : undefined,
    vatRate: p.vat_rate,
    isActive: true,
  };
}

function mapTokenCategory(c: any): Category {
  return {
    id: c.id,
    name: { ar: c.name_ar, he: c.name_he, en: c.name_en },
    icon: c.icon ?? "",
    hue: c.color_hue ?? 0,
  };
}

function mapTokenManufacturer(m: any): Manufacturer {
  return {
    id: m.id,
    name: { ar: m.name_ar, he: m.name_he, en: m.name_en },
    logoUrl: isExternalUrl(m.logo_url) ? m.logo_url : undefined,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Resolve a token to its scoped catalog, or null if the token is invalid /
 * revoked / expired (the RPC raises; we translate to null so the route can
 * render a clean "link no longer valid" message).
 */
export async function getTokenCatalog(
  rawToken: string,
): Promise<TokenCatalog | null> {
  const client = await createServerAuthClient();
  // The RAW token goes over the wire; the DB hashes it (so the stored
  // token_hash is never a replayable credential — see _resolve_token).
  const { data, error } = await client.rpc("get_token_catalog", {
    p_token: rawToken,
  });
  if (error || !data) return null;
  const blob = data as {
    tenant: { name_ar: string; name_he: string; name_en: string };
    customer: {
      name: string;
      city_ar: string | null;
      city_he: string | null;
      city_en: string | null;
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    products: any[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    categories: any[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    manufacturers: any[];
  };
  return {
    tenantName: {
      ar: blob.tenant.name_ar,
      he: blob.tenant.name_he,
      en: blob.tenant.name_en,
    },
    customer: {
      name: blob.customer.name,
      city: {
        ar: blob.customer.city_ar ?? "",
        he: blob.customer.city_he ?? "",
        en: blob.customer.city_en ?? "",
      },
    },
    products: blob.products.map(mapTokenProduct),
    categories: blob.categories.map(mapTokenCategory),
    manufacturers: blob.manufacturers.map(mapTokenManufacturer),
  };
}

/**
 * Create an order for the token's linked customer (source =
 * remote_customer). Totals are computed server-side; the shop cannot set
 * tenant/customer. Returns the customer-facing PUBLIC reference
 * (MDF-XXXXXXXX) — the RPC's `order_number` column carries public_ref, NOT
 * the internal sequential number (M7E) — or null on failure.
 */
export async function submitTokenOrder(
  rawToken: string,
  items: { productId: string; quantity: number }[],
  notes?: string,
): Promise<string | null> {
  const client = await createServerAuthClient();
  // Raw token over the wire; the DB re-hashes and validates it server-side.
  const { data, error } = await client
    .rpc("create_order_request_from_token", {
      p_token: rawToken,
      p_items: items.map((i) => ({ product_id: i.productId, quantity: i.quantity })),
      ...(notes ? { p_notes: notes } : {}),
    })
    .single();
  if (error || !data) return null;
  return data.order_number;
}
