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

/**
 * THE STORED-TIMEZONE CONTRACT — a tenant timezone is **`UTC`, or a Region/City
 * IANA identifier**. Nothing else may ever be persisted.
 *
 * It is stated POSITIVELY, not as a blocklist, because the things that must be
 * rejected are open-ended. PostgreSQL's `pg_timezone_names` happily recognizes all
 * of these, and every one of them breaks the DST contract:
 *
 *   `+03:00`, `UTC+2`, `-0500`  bare offsets — cannot express DST at all
 *   `Etc/GMT+3`, `Etc/GMT-2`    fixed-offset zones (and POSIX-inverted: GMT+3 is
 *                               actually UTC−3 — a silent 6-hour business error)
 *   `EST`, `HST`, `MST`         legacy abbreviations pinned to one offset
 *   `Factory`, `posix/*`, `right/*`  internal/leap-second aliases, not places
 *
 * The rule: `UTC`, or `Area/Location` (`America/Argentina/La_Rioja` and other
 * multi-segment zones included) that this runtime can actually format with. A real
 * Region/City zone is never rejected merely because it currently observes no DST —
 * if its rules change, the IANA database carries the change and we inherit it.
 * The DATABASE is the authority (same rule, in SQL); this is the fast, local echo
 * of it so the UI and the Server Action fail early with a clear message.
 */
const REGION_CITY_RE = /^[A-Za-z][A-Za-z0-9_-]*(?:\/[A-Za-z0-9_+-]*[A-Za-z0-9_-])+$/;
const EXCLUDED_NAMESPACE_RE = /^(?:posix|right|Etc|SystemV|US|Brazil|Canada|Chile|Mexico)\//i;

export function isApprovedTenantTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || tz.length === 0 || tz.length > 64) return false;
  if (tz === "UTC") return true;
  // Region/City only: an identifier with no "/" is a legacy abbreviation (EST,
  // HST, MST, Factory, GMT), and those are pinned to a single offset.
  if (!REGION_CITY_RE.test(tz)) return false;
  // …and the fixed-offset / alias namespaces are not places.
  if (EXCLUDED_NAMESPACE_RE.test(tz)) return false;
  // A "+" can only appear in a fixed-offset name (Etc/GMT+3); no real city has one.
  if (tz.includes("+")) return false;
  // Finally: the runtime must actually know it.
  return isFormattableTimeZone(tz);
}

/** True when this runtime can format with `tz` at all. NOT the storage contract —
 * the runtime also accepts `EST` and `Etc/GMT+3`, which we refuse to store. */
export function isFormattableTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || tz.length === 0) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** @deprecated kept as the storage contract's public name. */
export const isValidTimeZone = isApprovedTenantTimeZone;

/**
 * Resolve a persisted tenant timezone to one that is safe to format with. A value
 * outside the stored contract falls back to UTC and is LOGGED — it never silently
 * becomes the machine or browser zone, and the anomaly stays observable.
 */
export function resolveTenantTimeZone(tz: unknown): string {
  if (isApprovedTenantTimeZone(tz)) return tz;
  console.warn(
    `[madaf/time] invalid tenant timezone ${JSON.stringify(tz)} — falling back to ${FALLBACK_TIME_ZONE}`,
  );
  return FALLBACK_TIME_ZONE;
}

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

/**
 * THE ONE strict date-only parser. `YYYY-MM-DD`, a REAL Gregorian date, or null.
 *
 * Reject semantics, never balance semantics. Every permissive parser in the
 * language will happily take a date that does not exist and quietly move it:
 *
 *   new Date("2026-02-30")            → 2026-03-02   (rolls into March)
 *   Date.parse("2026-02-30T00:00:00") → a number     (so a shape+parse check passes)
 *   Date.UTC(2026, 1, 30)             → 2026-03-02   (balances silently)
 *
 * A filter built on any of those silently returns the WRONG dataset — and if the
 * downstream converter then rejects the date and yields `null`, a *bounded* query
 * becomes an *unbounded* one. So this is the only gate: it round-trips the parsed
 * components and refuses anything that changed, which is what makes "2026-02-30",
 * "2026-04-31" and "2026-02-29" (not a leap year) fail while "2028-02-29" passes.
 *
 * No `Date.parse`, no timezone, no locale, no clock.
 */
export function parseDateOnlyStrict(value: unknown): string | null {
  if (typeof value !== "string") return null;
  // Exact shape: no whitespace, no time part, no `Z`, no offset, zero-padded.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  // Year 0000 is not a business date in this product; months/days must be in range
  // before we even ask whether the combination exists.
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  // The round-trip is the real test: Date.UTC BALANCES an impossible date, so if
  // any component comes back different, the date did not exist.
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (
    dt.getUTCFullYear() !== year ||
    dt.getUTCMonth() !== month - 1 ||
    dt.getUTCDate() !== day
  ) {
    return null;
  }
  return value;
}

/** The calendar day AFTER dateStr (YYYY-MM-DD) — the EXCLUSIVE upper bound, so a
 * `to` date includes its whole local day. Pure date arithmetic (no zone, no
 * instant). Returns null for anything that is not a real calendar date, so an
 * impossible `to` can never ROLL FORWARD into a wider range. */
export function nextCalendarDay(dateStr: string): string | null {
  if (parseDateOnlyStrict(dateStr) === null) return null;
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + 1);
  return dt.toISOString().slice(0, 10);
}

/** Today's calendar date (YYYY-MM-DD) in the TENANT timezone — so a date preset
 * ("today", last 7 days…) agrees with the tenant-timezone filter bounds. */
export function tenantToday(timeZone: string, now: Date = new Date()): string {
  return tenantDateKey(now, timeZone);
}

/**
 * The TENANT-local calendar date (YYYY-MM-DD) an absolute instant falls on — the
 * business-day key for every grouping, bucketing and "is this today?" question.
 *
 * `createdAt.slice(0, 10)` and `new Date().toISOString().slice(0, 10)` are the same
 * question answered in UTC, and they are wrong for exactly the hours that matter:
 * `2026-08-31T21:30:00Z` is **2026-09-01** in Asia/Jerusalem, so a UTC prefix files
 * that order under August — in the previous month, on the previous day, and in the
 * wrong trend bucket, while the screen right next to it says September 1.
 *
 * `en-CA` because it is the locale whose short date format IS `YYYY-MM-DD`; the
 * output is a stable key, not a display string, so no locale can reach it.
 */
export function tenantDateKey(instant: Date | string, timeZone: string): string {
  const d = typeof instant === "string" ? parseInstant(instant) : instant;
  if (!d || Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: resolveTenantTimeZone(timeZone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** The tenant-local calendar MONTH (YYYY-MM) an instant falls in — the business
 * month, so a month-to-date total rolls over on the tenant's midnight, not UTC's. */
export function tenantMonthKey(instant: Date | string, timeZone: string): string {
  return tenantDateKey(instant, timeZone).slice(0, 7);
}
