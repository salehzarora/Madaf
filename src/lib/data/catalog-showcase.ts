import "server-only";

/**
 * Product-SHOWCASE (view-only) tokenized link data path (M7H.3) — SERVER ONLY.
 *
 * A supplier sends a "view products" link; a prospective customer browses the
 * tenant catalog (images, filters) but CANNOT order (no cart, no customer
 * context). Owner/admin create/revoke via RPC; anon reads the catalog ONLY via
 * get_showcase_catalog after in-DB token resolution. Only token_hash is stored.
 * Supabase-mode only.
 */
import { getDataContext } from "@/lib/auth/session";
import { createServerAuthClient } from "@/lib/supabase/server-auth";
import type { Availability, Category, Manufacturer, Product } from "@/lib/types";

import { getProductImageStorageClient } from "./product-image-storage";
import {
  hashToken,
  signOwnTenantLogoPaths,
  signOwnTenantPaths,
  signTenantBrandingLogo,
} from "./token";

export type ShowcaseLinkStatus = "active" | "revoked" | "expired";

export interface ShowcaseLink {
  id: string;
  label: string | null;
  tokenPreview: string | null;
  status: ShowcaseLinkStatus;
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

export interface ShowcaseCatalog {
  tenantName: { ar: string; he: string; en: string };
  /** Supplier business logo for the showcase header (M8E.1) — signed private
   * URL or external URL; absent → name only. */
  tenantLogoUrl?: string;
  products: Product[];
  categories: Category[];
  manufacturers: Manufacturer[];
}

function isExternalUrl(value: unknown): value is string {
  return typeof value === "string" && /^https?:\/\//i.test(value);
}

function linkStatus(
  revokedAt: string | null,
  expiresAt: string | null,
): ShowcaseLinkStatus {
  if (revokedAt) return "revoked";
  if (expiresAt && new Date(expiresAt).getTime() <= Date.now()) return "expired";
  return "active";
}

/**
 * Availability derivation for the public showcase (`/showcase/<token>`), which
 * also gates guest ordering (`showcase-view.tsx` reads `soldOut = availability
 * === "outOfStock"`). Same contract as the shop/admin copies: no tracked
 * quantity → In-stock; quantity 0 → Out-of-stock; below threshold → Low-stock.
 * Exported for behavioural tests (B2) — no behaviour change.
 */
export function deriveAvailability(
  qty: unknown,
  threshold: unknown,
): Availability {
  if (typeof qty !== "number") return "inStock";
  if (qty <= 0) return "outOfStock";
  if (typeof threshold === "number" && qty < threshold) return "lowStock";
  return "inStock";
}

// ── Owner/admin: create / revoke / list showcase links ────────────────────

export async function insertShowcaseLink(input: {
  tokenHash: string;
  tokenPreview?: string;
  label?: string;
  expiresAt?: string;
}): Promise<{ linkId: string }> {
  const { client, tenantId } = await getDataContext();
  const { data, error } = await client.rpc("insert_catalog_showcase_link", {
    p_tenant_id: tenantId,
    p_token_hash: input.tokenHash,
    ...(input.tokenPreview ? { p_token_preview: input.tokenPreview } : {}),
    ...(input.label ? { p_label: input.label } : {}),
    ...(input.expiresAt ? { p_expires_at: input.expiresAt } : {}),
  });
  if (error) throw new Error(`[madaf/data] insertShowcaseLink: ${error.message}`);
  return { linkId: data as string };
}

export async function revokeShowcaseLink(linkId: string): Promise<void> {
  const { client, tenantId } = await getDataContext();
  const { error } = await client.rpc("revoke_catalog_showcase_link", {
    p_tenant_id: tenantId,
    p_link_id: linkId,
  });
  if (error) throw new Error(`[madaf/data] revokeShowcaseLink: ${error.message}`);
}

export async function listShowcaseLinks(): Promise<ShowcaseLink[]> {
  const { client, tenantId } = await getDataContext();
  const { data, error } = await client
    .from("catalog_showcase_links")
    .select("id, label, token_preview, expires_at, revoked_at, last_used_at, created_at")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`[madaf/data] listShowcaseLinks: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: r.id,
    label: r.label,
    tokenPreview: r.token_preview,
    status: linkStatus(r.revoked_at, r.expires_at),
    expiresAt: r.expires_at,
    lastUsedAt: r.last_used_at,
    createdAt: r.created_at,
  }));
}

// ── Anon visitor: view-only catalog (NO customer, NO ordering) ────────────

/** Resolve the showcase token's tenant server-side, then sign own-tenant
 * product images. Fail-closed to placeholders (never a service_role leak). */
async function signShowcaseImages(
  rawToken: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  products: any[],
): Promise<Map<string, string>> {
  const empty = new Map<string, string>();
  let client;
  try {
    client = getProductImageStorageClient();
  } catch {
    return signOwnTenantPaths("showcase", null, products); // logs the diagnostic
  }
  const { data: link } = await client
    .from("catalog_showcase_links")
    .select("tenant_id")
    .eq("token_hash", hashToken(rawToken))
    .is("revoked_at", null)
    .maybeSingle();
  if (!link?.tenant_id) return empty;
  return signOwnTenantPaths("showcase", link.tenant_id, products);
}

/** Sign manufacturer LOGOS for a showcase token (M8E.3) — same token→tenant
 * resolution as signShowcaseImages, then own-tenant logo signing. Fail-closed
 * to an empty map (external-URL / glyph fallback). */
async function signShowcaseLogos(
  rawToken: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  manufacturers: any[],
): Promise<Map<string, string>> {
  const empty = new Map<string, string>();
  let client;
  try {
    client = getProductImageStorageClient();
  } catch {
    return empty;
  }
  const { data: link } = await client
    .from("catalog_showcase_links")
    .select("tenant_id")
    .eq("token_hash", hashToken(rawToken))
    .is("revoked_at", null)
    .maybeSingle();
  if (!link?.tenant_id) return empty;
  return signOwnTenantLogoPaths("showcase", link.tenant_id, manufacturers);
}

/** Resolve a showcase token to its tenant and sign that tenant's business logo
 * (M8E.1). Fail-closed to undefined (name-only header). */
async function signShowcaseTenantLogo(
  rawToken: string,
): Promise<string | undefined> {
  let client;
  try {
    client = getProductImageStorageClient();
  } catch {
    return undefined;
  }
  const { data: link } = await client
    .from("catalog_showcase_links")
    .select("tenant_id")
    .eq("token_hash", hashToken(rawToken))
    .is("revoked_at", null)
    .maybeSingle();
  return signTenantBrandingLogo(client, link?.tenant_id);
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function mapShowcaseProduct(p: any, signed: Map<string, string>): Product {
  const raw = p.image_url;
  const imageUrl = isExternalUrl(raw)
    ? raw
    : typeof raw === "string" && signed.has(raw)
      ? signed.get(raw)
      : undefined;
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
    imageUrl,
    vatRate: p.vat_rate,
    isActive: true,
  };
}

function mapShowcaseCategory(c: any): Category {
  return {
    id: c.id,
    name: { ar: c.name_ar, he: c.name_he, en: c.name_en },
    icon: c.icon ?? "",
    hue: c.color_hue ?? 0,
  };
}

function mapShowcaseManufacturer(
  m: any,
  signedLogos: Map<string, string>,
): Manufacturer {
  // External URL passes through; an uploaded own-tenant logo is shown via a
  // short-lived signed URL (M8E.3); anything else falls back to the glyph.
  const raw = m.logo_url;
  const logoUrl = isExternalUrl(raw)
    ? raw
    : typeof raw === "string" && signedLogos.has(raw)
      ? signedLogos.get(raw)
      : undefined;
  return {
    id: m.id,
    name: { ar: m.name_ar, he: m.name_he, en: m.name_en },
    logoUrl,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export interface GuestStoreInput {
  name: string;
  contactName?: string;
  phone?: string;
  email?: string;
  cityAr?: string;
  cityHe?: string;
  cityEn?: string;
  address?: string;
}

/** Anon guest order via a showcase token → the customer-facing PUBLIC ref
 * (MDF-XXXXXXXX), or null on any failure. Tenant + store snapshot are handled
 * server-side; the visitor never sets tenant/customer. */
export async function submitShowcaseGuestOrder(
  rawToken: string,
  items: { productId: string; quantity: number }[],
  store: GuestStoreInput,
  notes?: string,
): Promise<string | null> {
  const client = await createServerAuthClient();
  const { data, error } = await client
    .rpc("create_order_from_showcase_token", {
      p_token: rawToken,
      p_items: items.map((i) => ({ product_id: i.productId, quantity: i.quantity })),
      p_store_name: store.name,
      ...(store.contactName ? { p_contact_name: store.contactName } : {}),
      ...(store.phone ? { p_phone: store.phone } : {}),
      ...(store.email ? { p_email: store.email } : {}),
      ...(store.cityAr ? { p_city_ar: store.cityAr } : {}),
      ...(store.cityHe ? { p_city_he: store.cityHe } : {}),
      ...(store.cityEn ? { p_city_en: store.cityEn } : {}),
      ...(store.address ? { p_address: store.address } : {}),
      ...(notes ? { p_notes: notes } : {}),
    })
    .single();
  if (error || !data) return null;
  return data.order_number;
}

export async function getShowcaseCatalog(
  rawToken: string,
): Promise<ShowcaseCatalog | null> {
  const client = await createServerAuthClient();
  const { data, error } = await client.rpc("get_showcase_catalog", {
    p_token: rawToken,
  });
  if (error || !data) return null;
  const blob = data as {
    tenant: { name_ar: string; name_he: string; name_en: string };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    products: any[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    categories: any[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    manufacturers: any[];
  };
  const [signed, signedLogos, tenantLogoUrl] = await Promise.all([
    signShowcaseImages(rawToken, blob.products),
    signShowcaseLogos(rawToken, blob.manufacturers),
    signShowcaseTenantLogo(rawToken),
  ]);
  return {
    tenantName: {
      ar: blob.tenant.name_ar,
      he: blob.tenant.name_he,
      en: blob.tenant.name_en,
    },
    tenantLogoUrl,
    products: blob.products.map((p) => mapShowcaseProduct(p, signed)),
    categories: blob.categories.map(mapShowcaseCategory),
    manufacturers: blob.manufacturers.map((m) =>
      mapShowcaseManufacturer(m, signedLogos),
    ),
  };
}
