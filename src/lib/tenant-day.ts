/**
 * Tenant CALENDAR DAY → UTC bounds (M8H.2) — the reverse time conversion.
 *
 * Forward conversion (an instant → a tenant-local wall clock) is unambiguous and
 * lives in `@/lib/time`. The REVERSE — a calendar date the operator picked → the
 * UTC instant that date STARTS at in the tenant timezone — is the hard direction,
 * and hand-rolled offset math gets it wrong:
 *
 *   • Local 00:00 DOES NOT ALWAYS EXIST. Several zones spring forward AT midnight
 *     (America/Santiago, America/Havana, America/Asuncion, Atlantic/Azores in
 *     2025–2028): the clock goes 23:59:59 → 01:00:00 and 00:00–00:59 never happens.
 *   • A DST step is NOT always one hour (Australia/Lord_Howe moves 30 minutes;
 *     Antarctica/Troll moves TWO), so a local day is not always 23/24/25 hours —
 *     Troll has a 22-hour and a 26-hour day.
 *   • Offsets are not always whole hours (Asia/Kathmandu +05:45, Pacific/Chatham
 *     +12:45/+13:45).
 *
 * The earlier Intl offset math (take the zone's offset, subtract it, re-read and
 * correct) failed exactly there: for a nonexistent local midnight it landed on
 * 23:00 of the PREVIOUS day, so an hour of the previous day was filed under the
 * requested one. Piling on more offset passes does not fix the class of bug — the
 * question "when does this local date begin?" needs a real timezone primitive.
 *
 * So we delegate to **Temporal** (`@js-temporal/polyfill`, the TC39 reference
 * implementation), whose `PlainDate.toZonedDateTime(zone)` is specified as the
 * START OF DAY: the FIRST instant belonging to that calendar date in that zone —
 * not "midnight, disambiguated". It reads the platform's IANA data (the same data
 * `Intl` formats with, so display and filtering can never disagree), hand-rolls no
 * transition table, and is deterministic on every machine.
 *
 * ── The contract ──────────────────────────────────────────────────────────
 *  in   'YYYY-MM-DD' (a tenant-local calendar date) + an IANA zone
 *  out  the ISO UTC instant that date BEGINS at, or null if the date is malformed
 *       or impossible (2026-02-30). Never throws.
 *  • nonexistent local 00:00 (DST gap) → the earliest instant that DOES belong to
 *    the date (e.g. 01:00 local), so no business instant of that date is skipped.
 *  • ambiguous local 00:00 (DST overlap) → the EARLIER of the two instants, so the
 *    whole repeated hour belongs to the date it is displayed on.
 *  • ranges stay start-INCLUSIVE / next-day-start-EXCLUSIVE, so consecutive local
 *    days tile the timeline exactly: no instant is dropped and none is counted twice.
 *
 * SERVER-ONLY on purpose: date filtering is a server concern (the list, the exact
 * count and the export must resolve identical bounds), and this keeps the Temporal
 * polyfill out of the browser bundle. The client only ever needs the FORWARD
 * direction (`@/lib/time`), which is plain `Intl`.
 */
import "server-only";
import { Temporal } from "@js-temporal/polyfill";
import { nextCalendarDay, resolveTenantTimeZone } from "@/lib/time";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The UTC instant (ISO) at which YYYY-MM-DD BEGINS in the tenant timezone — the
 * inclusive lower bound of that local day, and (applied to the NEXT date) its
 * exclusive upper bound. Null for a malformed or impossible calendar date.
 */
export function tenantDayStartUtcIso(
  dateStr: string,
  timeZone: string,
): string | null {
  if (typeof dateStr !== "string" || !DATE_RE.test(dateStr)) return null;
  const zone = resolveTenantTimeZone(timeZone);
  try {
    // Start of day — NOT "midnight". On a spring-forward-at-midnight date the
    // first instant of the day is 01:00 local, and Temporal returns exactly that.
    const start = Temporal.PlainDate.from(dateStr).toZonedDateTime(zone);
    return new Date(start.epochMilliseconds).toISOString();
  } catch {
    // Impossible calendar date (2026-02-30 / 2026-13-40) — Temporal rejects it.
    return null;
  }
}

/** The half-open UTC bounds of a tenant-local date range. */
export interface TenantDateRangeUtc {
  /** created_at >= this (inclusive), or null when no lower bound. */
  gteIso: string | null;
  /** created_at < this (EXCLUSIVE next-day start), or null when no upper bound. */
  ltIso: string | null;
}

/**
 * The ONE builder that turns the operator's `from`/`to` calendar dates into UTC
 * bounds. The Orders page, its exact count and the CSV export all resolve their
 * bounds through this, and the mock path calls the very same function — so the
 * rows, the total and the export can never disagree about which days they cover.
 *
 * `to` is INCLUSIVE of its whole local day, expressed as an exclusive `<` bound at
 * the start of the NEXT local day. That is what makes it correct across DST: it
 * never assumes the day is 24 hours long.
 */
export function tenantDateRangeUtc(
  dateFrom: string | null,
  dateTo: string | null,
  timeZone: string,
): TenantDateRangeUtc {
  return {
    gteIso: dateFrom ? tenantDayStartUtcIso(dateFrom, timeZone) : null,
    ltIso: dateTo
      ? tenantDayStartUtcIso(nextCalendarDay(dateTo), timeZone)
      : null,
  };
}
