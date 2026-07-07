"use server";

/**
 * Tenant tax-settings Server Action (M6B).
 *
 * ⚠️ INERT: this ONLY persists a tenant's tax configuration. It does NOT issue
 * a tax invoice, request an allocation number, or contact any provider/tax
 * authority — no such path exists. Authorization (owner/admin of the SELECTED
 * tenant) is enforced by the SECURITY DEFINER `upsert_tenant_tax_settings`
 * RPC; this action never trusts a client tenant_id or role. It validates /
 * normalizes lightly and forwards to the data layer.
 */
import { revalidatePath } from "next/cache";

import { isLocale } from "@/i18n/config";
import {
  upsertTenantTaxSettings,
  type TenantTaxSettingsInput,
} from "@/lib/data/tax-settings";

function safeLocale(value: unknown): string {
  return typeof value === "string" && isLocale(value) ? value : "he";
}

/** Trim, drop-if-empty, and hard-cap length (belt-and-braces; the RPC re-checks). */
function clean(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

export interface SaveTaxSettingsInput {
  legalName?: string | null;
  businessRegistrationNumber?: string | null;
  vatRegistrationNumber?: string | null;
  vatRegistrationType?: string | null;
  countryCode?: string | null;
  /** Human-entered percentage (e.g. 18 → stored as the fraction 0.18). */
  defaultVatRatePercent?: number | null;
  invoiceLanguage?: string | null;
  street?: string | null;
  city?: string | null;
  postalCode?: string | null;
  country?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  legalInvoicingReady?: boolean;
  readinessNotes?: string | null;
  locale: string;
}

/**
 * Save the selected tenant's tax settings. Returns { ok } — never throws to the
 * client. Saving these settings does NOT issue any tax invoice.
 */
export async function saveTaxSettingsAction(
  input: SaveTaxSettingsInput,
): Promise<{ ok: boolean }> {
  try {
    const locale = safeLocale(input.locale);

    // VAT rate: accept a percentage, store as a fraction in [0, 1). Reject
    // out-of-range up front (the RPC/CHECK also enforce this).
    let defaultVatRate: number | null = null;
    const pct = input.defaultVatRatePercent;
    if (pct !== null && pct !== undefined) {
      if (typeof pct !== "number" || !Number.isFinite(pct)) return { ok: false };
      const fraction = pct / 100;
      if (fraction < 0 || fraction >= 1) return { ok: false };
      defaultVatRate = fraction;
    }

    const invoiceLanguage =
      typeof input.invoiceLanguage === "string" &&
      ["ar", "he", "en"].includes(input.invoiceLanguage)
        ? input.invoiceLanguage
        : null;

    const contactEmail = clean(input.contactEmail, 254);

    const payload: TenantTaxSettingsInput = {
      legalName: clean(input.legalName, 200),
      businessRegistrationNumber: clean(input.businessRegistrationNumber, 40),
      vatRegistrationNumber: clean(input.vatRegistrationNumber, 40),
      vatRegistrationType: clean(input.vatRegistrationType, 60),
      countryCode: (clean(input.countryCode, 3) ?? "IL").toUpperCase(),
      defaultVatRate,
      invoiceLanguage,
      street: clean(input.street, 200),
      city: clean(input.city, 120),
      postalCode: clean(input.postalCode, 20),
      country: clean(input.country, 80),
      contactEmail: contactEmail ? contactEmail.toLowerCase() : null,
      contactPhone: clean(input.contactPhone, 40),
      // Operator note only — does NOT enable issuing.
      legalInvoicingReady: input.legalInvoicingReady === true,
      readinessNotes: clean(input.readinessNotes, 2000),
    };

    await upsertTenantTaxSettings(payload);
    revalidatePath(`/${locale}/admin/settings/tax`);
    return { ok: true };
  } catch (error) {
    console.error("[madaf/actions] saveTaxSettingsAction failed:", error);
    return { ok: false };
  }
}
