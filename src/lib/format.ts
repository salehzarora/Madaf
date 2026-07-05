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

/** Short date: 05.07.2026 / ٥.٧… (Western digits pinned for ar). */
export function formatDate(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(intlLocaleFor[locale], {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(iso));
}

/** Longer, human date used on documents: "5 ביולי 2026". */
export function formatDateLong(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(intlLocaleFor[locale], {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(iso));
}
