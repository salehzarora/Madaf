/**
 * Supplier (tenant) data access. Mock by default; the Supabase branch is
 * server-only and reads the tenant row under RLS — scoped to the signed-in
 * user's membership tenant (resolved in `getDataContext`, M4A). Anon callers
 * see zero rows.
 */
import { supplier } from "@/lib/mock";
import type { Supplier } from "@/lib/types";

import { getDataMode } from "./mode";

export async function getSupplier(): Promise<Supplier> {
  if (getDataMode() === "supabase") {
    return (await import("./supabase-reads")).sbGetSupplier();
  }
  return supplier;
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
