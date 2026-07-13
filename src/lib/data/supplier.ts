/**
 * Supplier (tenant) data access. Mock by default; the Supabase branch is
 * server-only and reads the tenant row under RLS — scoped to the signed-in
 * user's membership tenant (resolved in `getDataContext`, M4A). Anon callers
 * see zero rows.
 */
import { supplier } from "@/lib/mock";
import type { Supplier } from "@/lib/types";
import { DEFAULT_TENANT_TIME_ZONE, resolveTenantTimeZone } from "@/lib/time";

import { getDataMode } from "./mode";

export async function getSupplier(): Promise<Supplier> {
  if (getDataMode() === "supabase") {
    return (await import("./supabase-reads")).sbGetSupplier();
  }
  return supplier;
}

/**
 * M8H.2 — THE authoritative timezone for every business-facing time on this
 * request, in BOTH modes.
 *
 * Supabase: the selected tenant's IANA zone, already loaded by the React-cached
 * session context (`list_memberships` runs once per request) — so this adds NO
 * query and can never be an N+1. Mock: the demo tenant's own zone.
 *
 * It is always SERVER-derived. The browser's/device's timezone has no authority
 * anywhere in the product, and the server machine's zone is never used.
 */
export async function getTenantTimeZone(): Promise<string> {
  if (getDataMode() === "supabase") {
    return (await import("@/lib/auth/session")).getTenantTimeZone();
  }
  return resolveTenantTimeZone(supplier.timezone ?? DEFAULT_TENANT_TIME_ZONE);
}

/**
 * Business-profile write payload (M8E.4). `displayVatRate` is a NON-LEGAL
 * fraction in [0,1); `logoUrl` is either an external URL or a private-bucket
 * object path (persisted verbatim, signed on read).
 */
export interface TenantProfileInput {
  nameAr: string;
  nameHe: string;
  nameEn: string;
  phone?: string;
  email?: string;
  addressAr?: string;
  addressHe?: string;
  addressEn?: string;
  legalName?: string;
  companyId?: string;
  displayVatRate?: number;
  logoUrl?: string;
}

/** Update the selected tenant's business profile (owner/admin). Supabase-only;
 * mock mode does not persist (the settings form short-circuits to a demo). */
export async function updateTenantProfile(
  input: TenantProfileInput,
): Promise<void> {
  if (getDataMode() !== "supabase") {
    throw new Error(
      "[madaf/data] updateTenantProfile is a Supabase-only write — mock mode " +
        "does not persist. Run in supabase mode to save the business profile.",
    );
  }
  return (await import("./supabase-writes")).sbUpdateTenantProfile(input);
}

/**
 * M8H.2 — set the tenant's IANA timezone (owner/admin). Supabase-only; mock does
 * not persist (the control short-circuits to a demo, exactly like the profile
 * form). The DB is the authority: `update_tenant_timezone` re-checks owner/admin
 * via authorize_tenant and rejects anything that is not a recognized IANA name,
 * so the browser can never push an unvalidated zone.
 *
 * Changing this rewrites NO timestamp — only how instants are displayed and how
 * future tenant-local date filters are resolved.
 */
export async function updateTenantTimeZone(timezone: string): Promise<string> {
  if (getDataMode() !== "supabase") {
    throw new Error(
      "[madaf/data] updateTenantTimeZone is a Supabase-only write — mock mode " +
        "does not persist. Run in supabase mode to save the timezone.",
    );
  }
  return (await import("./supabase-writes")).sbUpdateTenantTimeZone(timezone);
}

/** Upload a tenant business logo to the private bucket (`<tenant>/branding/…`),
 * signed on read. Supabase-only; mock persists nothing (M8E.4). */
export async function uploadTenantLogo(input: {
  fileName: string;
  contentType: string;
  bytes: Uint8Array;
}): Promise<{ path: string; previewUrl: string }> {
  if (getDataMode() !== "supabase") {
    throw new Error("[madaf/data] uploadTenantLogo is a Supabase-only write.");
  }
  return (await import("./supabase-writes")).sbUploadTenantLogo(input);
}
