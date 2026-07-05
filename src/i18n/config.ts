/**
 * Madaf i18n core — locales, directions and Intl locale tags.
 *
 * Rules (see docs/I18N_RTL_GUIDE.md):
 * - `ar` and `he` are RTL, `en` is LTR.
 * - `he` is the default app locale AND the default for documents.
 * - All routes live under /[locale]/… — src/proxy.ts redirects bare paths.
 */
export const locales = ["ar", "he", "en"] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "he";
/** Documents (order / delivery note / invoice draft) default to Hebrew. */
export const defaultDocumentLocale: Locale = "he";

export function isLocale(value: string): value is Locale {
  return (locales as readonly string[]).includes(value);
}

export type Direction = "rtl" | "ltr";

export function dirFor(locale: Locale): Direction {
  return locale === "en" ? "ltr" : "rtl";
}

/** Native-script display names for the locale switcher. */
export const localeNames: Record<Locale, string> = {
  ar: "العربية",
  he: "עברית",
  en: "English",
};

/**
 * BCP-47 tags for Intl formatting. Arabic pins Western (latn) digits —
 * B2B users in the local market expect 24 / ₪58, not ٢٤.
 */
export const intlLocaleFor: Record<Locale, string> = {
  ar: "ar-IL-u-nu-latn",
  he: "he-IL",
  en: "en-IL",
};
