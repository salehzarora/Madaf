import { isLocale, type Locale } from "./config";

export const LOCALE_COOKIE = "madaf_locale";

/** Non-sensitive, host-only UI preference. Write before starting navigation. */
export function persistLocale(locale: Locale): void {
  if (!isLocale(locale)) return;
  try {
    document.cookie = `${LOCALE_COOKIE}=${locale}; Path=/; SameSite=Lax; Max-Age=31536000${window.location.protocol === "https:" ? "; Secure" : ""}`;
  } catch {
    // A browser that blocks cookies must still be able to switch the current URL.
  }
}
