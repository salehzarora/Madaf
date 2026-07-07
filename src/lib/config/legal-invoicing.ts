import "server-only";

/**
 * Legal-invoicing feature flags (M6B) — SERVER-ONLY, fail-closed.
 *
 * ⚠️ Madaf does NOT issue legal tax invoices. These flags gate a FUTURE
 * issuing path (M6C+) that does not exist yet; today they only drive the
 * read-only status shown on the admin tax-settings page.
 *
 * Hard rules (docs/LEGAL_INVOICING_ARCHITECTURE.md §D):
 *  - All three default OFF / `disabled`; a missing/blank value = OFF.
 *  - Fail closed: any future legal path must require ALL applicable flags AND
 *    per-tenant readiness; if any is off/incomplete → refuse (never issue).
 *  - `production` provider mode is NEVER reachable in M6B (see below).
 *  - Server-only — NEVER `NEXT_PUBLIC`. The browser never learns provider
 *    config or secrets; the page passes only the derived boolean STATUS to
 *    the client for display.
 *  - Mock/demo never issues anything — there is no legal path at all.
 */

/** Master switch. OFF ⇒ no legal issuing path exists at runtime (M6B: always). */
export function legalInvoicingEnabled(): boolean {
  return process.env.MADAF_LEGAL_INVOICING_ENABLED === "true";
}

export type TaxProviderMode = "disabled" | "sandbox" | "production";

/**
 * Provider mode. `disabled` (default) | `sandbox`. `production` is INTENTIONALLY
 * NOT reachable in M6B — a certified-provider integration does not exist yet, so
 * a stray `production` value is clamped to `disabled` (fail-closed). Real
 * sandbox/production support arrives only in M6D/M6E behind review + the master
 * switch.
 */
export function taxProviderMode(): TaxProviderMode {
  // M6B allows at most a mock/sandbox placeholder that can issue NOTHING;
  // `production` is never honoured here.
  return process.env.MADAF_TAX_PROVIDER_MODE === "sandbox" ? "sandbox" : "disabled";
}

/** Legal numbering. OFF ⇒ no legal number is ever assigned (M6B: always). */
export function legalNumberingEnabled(): boolean {
  return process.env.MADAF_LEGAL_NUMBERING_ENABLED === "true";
}

/**
 * The overall legal-issuing readiness of the PLATFORM (not a tenant). In M6B
 * this is ALWAYS false: no issuing machinery exists, so even if every flag were
 * flipped on and a tenant marked ready, nothing can be issued. Kept as a single
 * fail-closed gate future phases will extend (and per-tenant readiness AND-ed in).
 */
export function legalIssuingActive(): boolean {
  // Deliberately hard-false in M6B: there is no issuing code to enable.
  return false;
}

export interface LegalInvoicingStatus {
  invoicingEnabled: boolean;
  providerMode: TaxProviderMode;
  numberingEnabled: boolean;
  /** True only when a real legal invoice could be issued — always false in M6B. */
  issuingActive: boolean;
}

/** A serializable snapshot of the flag status, safe to pass to a client component
 *  for DISPLAY only (no secrets, no provider config — just on/off state). */
export function legalInvoicingStatus(): LegalInvoicingStatus {
  return {
    invoicingEnabled: legalInvoicingEnabled(),
    providerMode: taxProviderMode(),
    numberingEnabled: legalNumberingEnabled(),
    issuingActive: legalIssuingActive(),
  };
}
