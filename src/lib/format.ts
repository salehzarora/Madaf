/**
 * Language-aware formatting helpers. Always go through these — never
 * hand-format currency, dates or numbers (see docs/I18N_RTL_GUIDE.md).
 */
import { intlLocaleFor, type Locale } from "@/i18n/config";

/** "₪59.90" / "59.90 ₪" depending on locale conventions. ILS only. */
export function formatCurrency(amount: number, locale: Locale): string {
  return new Intl.NumberFormat(intlLocaleFor[locale], {
    style: "currency",
    currency: "ILS",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatNumber(value: number, locale: Locale): string {
  return new Intl.NumberFormat(intlLocaleFor[locale]).format(value);
}

// ── Dates/times live in @/lib/time (M8H.2) ────────────────────────────────
// The old formatDate/formatDateLong here took NO timeZone, so they silently used
// the server machine's zone on SSR and the DEVICE's zone in the browser. Business
// time is now rendered ONLY through the tenant-timezone contract:
//   formatTenantDate / formatTenantTime / formatTenantDateTime / formatTenantDateLong
// and date-ONLY columns (a SQL `date`) through formatDateOnly.
// See src/lib/time.ts.
