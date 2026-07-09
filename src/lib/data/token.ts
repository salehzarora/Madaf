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

import { getProductImageStorageClient } from "./product-image-storage";

/** SHA-256 hex of the raw token — only the hash is ever stored/sent to SQL. */
export function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}

const PRODUCT_IMAGE_BUCKET = "product-images";
/** Signed for a single anonymous shop session; long enough to browse+order,
 * short enough that a copied URL expires soon. */
const SHOP_SIGNED_URL_TTL_SECONDS = 1800; // 30 min

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

/**
 * Resolve a raw token-catalog `image_url` to a DISPLAY url for the anon shop:
 *   - external http(s) URL → passthrough,
 *   - a private storage path we signed → the signed URL,
 *   - anything else → undefined (placeholder). Never crashes.
 */
function resolveShopImageUrl(
  raw: unknown,
  signedByPath: Map<string, string>,
): string | undefined {
  if (isExternalUrl(raw)) return raw;
  if (typeof raw === "string" && signedByPath.has(raw)) {
    return signedByPath.get(raw);
  }
  return undefined;
}

/** Safe, non-secret diagnostic counts for product-image signing (M7I). Never
 * logs tokens, tenant ids, signed URLs, or the service-role key. */
function logImageSigning(
  context: string,
  attempted: number,
  signed: number,
  skipReason: string,
): void {
  console.info(
    `[madaf/${context}] product-image signing: attempted=${attempted} ` +
      `signed=${signed} skipped=${attempted - signed} skipReason=${skipReason}`,
  );
}

/**
 * Sign uploaded product-image paths for an ALREADY-authorized anonymous viewer
 * of `tenantId` (M7F.4 / M7H; M7I decoupled from the documents-PDF client).
 * Signs ONLY objects under `<tenantId>/products/` in the private product-images
 * bucket (strict prefix — a value that isn't an own-tenant product-image path
 * is NEVER signed, so images can't leak across tenants). External URLs are
 * handled by the caller.
 *
 * Fail-closed: a missing service-role key / signing error → empty map
 * (placeholder fallback) with a safe count-only diagnostic — never a crash,
 * never a service_role leak (the client is server-only). Shared by the shop +
 * showcase loaders.
 */
export async function signOwnTenantPaths(
  context: string,
  tenantId: string | null | undefined,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  products: any[],
): Promise<Map<string, string>> {
  const empty = new Map<string, string>();
  if (!tenantId) {
    logImageSigning(context, 0, 0, "no-tenant");
    return empty;
  }
  const prefix = `${tenantId}/products/`;
  const ownPaths = [
    ...new Set(
      products
        .map((p) => p?.image_url)
        .filter((v): v is string => typeof v === "string")
        // Own-tenant storage path (not an external URL). Plain regex avoids the
        // type-guard narrowing of isExternalUrl on an already-string value.
        .filter((v) => !/^https?:\/\//i.test(v) && v.startsWith(prefix)),
    ),
  ];
  if (ownPaths.length === 0) {
    logImageSigning(context, 0, 0, "no-own-paths");
    return empty;
  }

  let storage;
  try {
    storage = getProductImageStorageClient().storage;
  } catch (error) {
    logImageSigning(
      context,
      ownPaths.length,
      0,
      `service-role-key-missing:${error instanceof Error ? error.message : "unknown"}`,
    );
    return empty;
  }
  try {
    const { data, error } = await storage
      .from(PRODUCT_IMAGE_BUCKET)
      .createSignedUrls(ownPaths, SHOP_SIGNED_URL_TTL_SECONDS);
    if (error || !data) {
      logImageSigning(context, ownPaths.length, 0, `sign-error:${error?.message ?? "no-data"}`);
      return empty;
    }
    const out = new Map<string, string>();
    data.forEach((row, i) => {
      if (row.signedUrl) out.set(ownPaths[i], row.signedUrl);
    });
    logImageSigning(context, ownPaths.length, out.size, out.size ? "ok" : "no-signed-urls");
    return out;
  } catch (error) {
    logImageSigning(
      context,
      ownPaths.length,
      0,
      `sign-throw:${error instanceof Error ? error.message : "unknown"}`,
    );
    return empty;
  }
}

/**
 * Sign product images for a VALIDATED private shop token. Resolves the token's
 * AUTHORITATIVE tenant_id server-side (service-role client, by token_hash —
 * never from the client / never from the path), then signs own-tenant paths.
 * Exported for the local probe; server-only.
 */
export async function signTokenProductImages(
  rawToken: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  products: any[],
): Promise<Map<string, string>> {
  const empty = new Map<string, string>();
  let client;
  try {
    client = getProductImageStorageClient();
  } catch (error) {
    logImageSigning(
      "shop",
      0,
      0,
      `service-role-key-missing:${error instanceof Error ? error.message : "unknown"}`,
    );
    return empty;
  }
  const { data: link } = await client
    .from("customer_access_links")
    .select("tenant_id")
    .eq("token_hash", hashToken(rawToken))
    .is("revoked_at", null)
    .maybeSingle();
  return signOwnTenantPaths("shop", link?.tenant_id, products);
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function mapTokenProduct(
  p: any,
  signedByPath: Map<string, string>,
): Product {
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
    // External URLs pass through; uploaded private-bucket images are shown via
    // short-lived signed URLs (M7F.4, signTokenProductImages); anything else
    // falls back to the gradient placeholder.
    imageUrl: resolveShopImageUrl(p.image_url, signedByPath),
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
  // Token is valid (RPC returned a catalog) → sign this tenant's uploaded
  // product images for the anon shop. Fail-closed to placeholders.
  const signedByPath = await signTokenProductImages(rawToken, blob.products);
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
    products: blob.products.map((p) => mapTokenProduct(p, signedByPath)),
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
