/**
 * The Tenant TIME contract (M8H.2) — the ONE place business time is rendered and
 * the ONE place a tenant-local calendar day is converted to UTC.
 *
 * ── The model ─────────────────────────────────────────────────────────────
 * The database stores absolute instants (`timestamptz` = UTC). `2026-07-13
 * 09:57:17+00` is the SAME moment as `12:57` in Asia/Jerusalem — the SQL editor
 * simply shows it in UTC. Nothing here rewrites a stored instant; this module
 * decides only how an instant is DISPLAYED and how a user-picked calendar date
 * maps back to UTC bounds.
 *
 * ── The rules ─────────────────────────────────────────────────────────────
 *  • timeZone is ALWAYS explicit (an IANA name, never a fixed offset — an offset
 *    cannot express DST: Asia/Jerusalem is +02:00 in winter and +03:00 in summer).
 *  • locale is ALWAYS explicit and is INDEPENDENT of the timezone (Arabic UI in
 *    Asia/Jerusalem is perfectly normal).
 *  • Never `toLocaleString()` without a timeZone — that silently uses the server
 *    machine's timezone on SSR and the DEVICE's timezone in the browser, which is
 *    the exact bug this module exists to remove. Because the timezone and locale
 *    are both explicit, server and client render identically → no hydration drift.
 *  • DST is handled by the platform (Intl/IANA); no offset table is hand-rolled.
 *  • Date-ONLY columns (e.g. inventory_items.expiry_date, a `date`) are NOT
 *    instants and must NOT be timezone-converted — use {@link formatDateOnly}.
 *
 * Pure + isomorphic: no server-only import, no `window`, no machine-local
 * dependency. Unit tested directly.
 */
import { intlLocaleFor, type Locale } from "@/i18n/config";

/**
 * The safe fallback for an impossible/corrupt state ONLY (a tenant row whose
 * timezone somehow isn't a recognized IANA name). It is deliberately UTC — never
 * the server machine's zone and never the browser's zone, both of which would be
 * silently wrong and invisible.
 */
export const FALLBACK_TIME_ZONE = "UTC";

/** The product's approved initial timezone (mirrors the tenants.timezone default). */
export const DEFAULT_TENANT_TIME_ZONE = "Asia/Jerusalem";

/** True for an IANA name this runtime recognizes. A bare offset ('+03:00') is
 * rejected: it cannot express DST. */
export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || tz.length === 0) return false;
  if (/^[+-]/.test(tz) || /^(utc|gmt)\s*[+-]/i.test(tz)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve a persisted tenant timezone to one that is safe to format with. An
 * invalid/corrupt stored value falls back to UTC and is LOGGED — it never
 * silently becomes the machine or browser zone, and the anomaly stays observable.
 */
export function resolveTenantTimeZone(tz: unknown): string {
  if (isValidTimeZone(tz)) return tz;
  console.warn(
    `[madaf/time] invalid tenant timezone ${JSON.stringify(tz)} — falling back to ${FALLBACK_TIME_ZONE}`,
  );
  return FALLBACK_TIME_ZONE;
}

/**
 * The timezone options offered in Settings: the runtime's CANONICAL IANA zones
 * plus UTC. Deliberately NOT `pg_timezone_names` — that carries ~1200 rows
 * including ~600 `posix/*` aliases and `Factory`, which would make the picker
 * unusable. Every name here was verified to be accepted by PostgreSQL, so the UI
 * can never offer a value the database would reject.
 *
 * Computed once per process (pure, bounded, no query, no secret).
 */
export const TIME_ZONE_OPTIONS: readonly string[] = (() => {
  const supported =
    typeof Intl.supportedValuesOf === "function"
      ? Intl.supportedValuesOf("timeZone")
      : [DEFAULT_TENANT_TIME_ZONE];
  // UTC is not part of the canonical list but must always be selectable.
  const all = ["UTC", ...supported.filter((z) => z !== "UTC")];
  // Belt-and-braces: never expose the internal aliases even if a runtime adds them.
  return all.filter((z) => !/^(posix|right)\//.test(z) && z !== "Factory");
})();

// ── Formatting (instants → tenant-local wall clock) ────────────────────────

function parseInstant(iso: string): Date | null {
  if (typeof iso !== "string" || iso.length === 0) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Short date in the TENANT timezone: 13.07.2026 (Arabic pins Western digits). */
export function formatTenantDate(
  iso: string,
  locale: Locale,
  timeZone: string,
): string {
  const d = parseInstant(iso);
  if (!d) return "";
  return new Intl.DateTimeFormat(intlLocaleFor[locale], {
    timeZone: resolveTenantTimeZone(timeZone),
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(d);
}

/** Time-of-day in the TENANT timezone: 12:57 (minutes, never seconds; 24h). */
export function formatTenantTime(
  iso: string,
  locale: Locale,
  timeZone: string,
): string {
  const d = parseInstant(iso);
  if (!d) return "";
  return new Intl.DateTimeFormat(intlLocaleFor[locale], {
    timeZone: resolveTenantTimeZone(timeZone),
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(d);
}

/** Date + time in the TENANT timezone: "13.07.2026, 12:57". The raw UTC offset is
 * never shown to ordinary users. */
export function formatTenantDateTime(
  iso: string,
  locale: Locale,
  timeZone: string,
): string {
  const d = parseInstant(iso);
  if (!d) return "";
  return new Intl.DateTimeFormat(intlLocaleFor[locale], {
    timeZone: resolveTenantTimeZone(timeZone),
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(d);
}

/** Long, human date used on documents: "5 ביולי 2026" — in the TENANT timezone. */
export function formatTenantDateLong(
  iso: string,
  locale: Locale,
  timeZone: string,
): string {
  const d = parseInstant(iso);
  if (!d) return "";
  return new Intl.DateTimeFormat(intlLocaleFor[locale], {
    timeZone: resolveTenantTimeZone(timeZone),
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(d);
}

/**
 * A DATE-ONLY business value (a SQL `date` such as inventory expiry): a calendar
 * date with NO instant and NO timezone. It is rendered AS WRITTEN — converting it
 * would shift the day (e.g. '2026-07-13' viewed as UTC midnight in
 * America/New_York would display 07-12). Accepts 'YYYY-MM-DD'.
 */
export function formatDateOnly(dateStr: string, locale: Locale): string {
  if (typeof dateStr !== "string") return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr);
  if (!m) return "";
  const [, y, mo, d] = m;
  // Format the calendar parts directly (UTC in, UTC out) so no zone can shift it.
  return new Intl.DateTimeFormat(intlLocaleFor[locale], {
    timeZone: "UTC",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d))));
}

// ── Tenant-local calendar day → UTC bounds ─────────────────────────────────
// The REVERSE conversion (a picked calendar date → the UTC instant that date
// BEGINS at in the tenant zone) is NOT here: local 00:00 does not always exist,
// so it needs a real timezone primitive rather than offset arithmetic. It lives in
// `@/lib/tenant-day` (server-only, Temporal-backed) — see that file for why.
// What stays here is zone-INDEPENDENT date arithmetic and the FORWARD direction,
// both of which are client-safe.

/** The calendar day AFTER dateStr (YYYY-MM-DD) — used as the EXCLUSIVE upper
 * bound, so a `to` date includes its whole local day. Pure date arithmetic: no
 * zone and no instant are involved, so nothing here can shift a day. */
export function nextCalendarDay(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + 1);
  return dt.toISOString().slice(0, 10);
}

/** Today's calendar date (YYYY-MM-DD) in the TENANT timezone — so a date preset
 * ("today", last 7 days…) agrees with the tenant-timezone filter bounds. */
export function tenantToday(timeZone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: resolveTenantTimeZone(timeZone),
  }).format(now);
}
