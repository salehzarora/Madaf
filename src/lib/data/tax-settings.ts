import "server-only";

import { getDataContext } from "@/lib/auth/session";
import { getDataMode } from "./mode";

/**
 * Tenant tax settings data access (M6B) — server-only.
 *
 * ⚠️ INERT: this reads/writes a per-tenant TAX CONFIGURATION record only. It
 * issues NOTHING — no tax invoice, no allocation number, no provider call.
 * The `get`/`upsert` RPCs are owner/admin-gated (authorize_tenant) SECURITY
 * DEFINER functions; the client tenant_id is never trusted. Writes are
 * Supabase-only; mock mode is a demo (nothing persists).
 */
export interface TenantTaxSettings {
  legalName: string | null;
  businessRegistrationNumber: string | null;
  vatRegistrationNumber: string | null;
  vatRegistrationType: string | null;
  countryCode: string;
  /** VAT rate as a fraction in [0, 1), e.g. 0.18 — or null if unset. */
  defaultVatRate: number | null;
  invoiceLanguage: string | null;
  street: string | null;
  city: string | null;
  postalCode: string | null;
  country: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  /** Operator note ONLY — does NOT enable legal issuing (flags stay OFF). */
  legalInvoicingReady: boolean;
  readinessNotes: string | null;
  updatedAt: string | null;
}

export type TenantTaxSettingsInput = Omit<TenantTaxSettings, "updatedAt">;

/**
 * Read the selected tenant's tax settings (owner/admin only). Returns null when
 * none exist yet, in mock mode (demo — nothing persisted), or on any error.
 */
export async function getTenantTaxSettings(): Promise<TenantTaxSettings | null> {
  if (getDataMode() !== "supabase") return null;
  const { client, tenantId } = await getDataContext();
  const { data, error } = await client.rpc("get_tenant_tax_settings", {
    p_tenant_id: tenantId,
  });
  if (error || !data || data.length === 0) return null;
  const r = data[0];
  return {
    legalName: r.legal_name,
    businessRegistrationNumber: r.business_registration_number,
    vatRegistrationNumber: r.vat_registration_number,
    vatRegistrationType: r.vat_registration_type,
    countryCode: r.country_code,
    defaultVatRate: r.default_vat_rate,
    invoiceLanguage: r.invoice_language,
    street: r.street,
    city: r.city,
    postalCode: r.postal_code,
    country: r.country,
    contactEmail: r.contact_email,
    contactPhone: r.contact_phone,
    legalInvoicingReady: r.legal_invoicing_ready,
    readinessNotes: r.readiness_notes,
    updatedAt: r.updated_at,
  };
}

/**
 * Create/update the selected tenant's tax settings (owner/admin only). The RPC
 * validates/normalizes and gates access; this NEVER issues anything. Supabase
 * mode only — mock mode does not persist (the form short-circuits to a demo
 * confirmation before this is ever called).
 */
export async function upsertTenantTaxSettings(
  input: TenantTaxSettingsInput,
): Promise<void> {
  if (getDataMode() !== "supabase") {
    throw new Error(
      "[madaf/data] upsertTenantTaxSettings is a Supabase-only write — mock " +
        "mode does not persist. Run in supabase mode to save tax settings.",
    );
  }
  const { client, tenantId } = await getDataContext();
  // The generated RPC arg types are `string | undefined` (SQL DEFAULT null).
  // Map our nullable fields to `undefined` so an omitted arg falls to the RPC's
  // `default null` → the column is stored/cleared as null (clearing a field).
  const { error } = await client.rpc("upsert_tenant_tax_settings", {
    p_tenant_id: tenantId,
    p_legal_name: input.legalName ?? undefined,
    p_business_registration_number: input.businessRegistrationNumber ?? undefined,
    p_vat_registration_number: input.vatRegistrationNumber ?? undefined,
    p_vat_registration_type: input.vatRegistrationType ?? undefined,
    p_country_code: input.countryCode ?? undefined,
    p_default_vat_rate: input.defaultVatRate ?? undefined,
    p_invoice_language: input.invoiceLanguage ?? undefined,
    p_street: input.street ?? undefined,
    p_city: input.city ?? undefined,
    p_postal_code: input.postalCode ?? undefined,
    p_country: input.country ?? undefined,
    p_contact_email: input.contactEmail ?? undefined,
    p_contact_phone: input.contactPhone ?? undefined,
    p_legal_invoicing_ready: input.legalInvoicingReady,
    p_readiness_notes: input.readinessNotes ?? undefined,
  });
  if (error) {
    throw new Error(`[madaf/data] upsertTenantTaxSettings failed: ${error.message}`);
  }
}
