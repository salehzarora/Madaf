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
import {
  nextCalendarDay,
  parseDateOnlyStrict,
  resolveTenantTimeZone,
  tenantToday,
} from "@/lib/time";
import type { MovementDatePreset } from "@/lib/types";

/**
 * The UTC instant (ISO) at which YYYY-MM-DD BEGINS in the tenant timezone — the
 * inclusive lower bound of that local day, and (applied to the NEXT date) its
 * exclusive upper bound. Null for a malformed or IMPOSSIBLE calendar date
 * (2026-02-30), which the strict parser rejects rather than rolling into March.
 */
export function tenantDayStartUtcIso(
  dateStr: string,
  timeZone: string,
): string | null {
  if (parseDateOnlyStrict(dateStr) === null) return null;
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
 *
 * FAILS CLOSED. It returns **null** — not a partial range — if a date it was given
 * is not a real calendar date. Yielding `{gteIso: null}` for an impossible `from`
 * would turn a BOUNDED request into an UNBOUNDED one (every row ever, exported),
 * and rolling an impossible `to` into the next month would silently widen it. A
 * caller that gets null must refuse to query.
 */
export function tenantDateRangeUtc(
  dateFrom: string | null,
  dateTo: string | null,
  timeZone: string,
): TenantDateRangeUtc | null {
  let gteIso: string | null = null;
  let ltIso: string | null = null;

  if (dateFrom !== null && dateFrom !== undefined) {
    gteIso = tenantDayStartUtcIso(dateFrom, timeZone);
    if (gteIso === null) return null; // impossible date → refuse, never widen
  }
  if (dateTo !== null && dateTo !== undefined) {
    const next = nextCalendarDay(dateTo);
    if (next === null) return null; // impossible date → refuse, never roll
    ltIso = tenantDayStartUtcIso(next, timeZone);
    if (ltIso === null) return null;
  }
  return { gteIso, ltIso };
}

/** The concrete, tenant-local calendar dates a movements filter session is pinned
 * to. Once resolved they never move — see {@link resolveMovementAnchors}. */
export interface MovementAnchors {
  /** INCLUSIVE lower bound (tenant-local YYYY-MM-DD). Null only for "all". */
  from: string | null;
  /** INCLUSIVE upper bound (tenant-local YYYY-MM-DD). Null only for "all". */
  to: string | null;
}

/**
 * Resolve a movements date filter to a CONCRETE, CLOSED, STABLE tenant-local
 * calendar range.
 *
 * ── Why anchors exist ─────────────────────────────────────────────────────
 * The ledger pages by OFFSET. If "today" were re-resolved on every request, then a
 * session that starts at 23:59 and pages at 00:01 would compute page 2's offset
 * against a *different* result set than page 1 came from: rows shift under the
 * offset, so some are skipped, some repeat, and `hasMore` and the CSV export answer
 * a question the operator never asked. The range must therefore be resolved ONCE,
 * at the moment the filter is applied, and then held still.
 *
 * ── Why the range must be CLOSED ──────────────────────────────────────────
 * Pinning only the LOWER bound is not enough, and the first attempt at this made
 * exactly that mistake. `to = null` leaves the range open at the top, so a movement
 * recorded AFTER tenant midnight — a row that belongs to the NEXT business day —
 * still matches the old session's query. Rows are ordered `created_at DESC`, so a
 * new row lands at the FRONT of the result set and pushes every existing row one
 * position later: page 2's offset then re-reads a row page 1 already showed
 * (a duplicate, dropped by the client's de-dup, which SILENTLY SKIPS a real row)
 * and `hasMore` stops describing the set the operator is looking at. A closed
 * range cannot admit tomorrow's rows, so the offsets stay meaningful.
 *
 * Every relative preset therefore gets BOTH bounds, both concrete:
 *   "today"  → from = tenant today,               to = tenant today
 *   "7d"     → from = tenant today − 6 CAL. days, to = tenant today
 *   "month"  → from = 1st of the tenant's month,  to = tenant today
 *   "custom" → the operator's two validated dates
 *   "all"    → genuinely unbounded (no date predicate at all)
 *
 * The FIRST request for a session sends only the preset; the server resolves it
 * here against the tenant's clock and hands both dates back. Every later request —
 * load-more, retry, export — sends those dates, and this function passes them
 * straight through untouched (an explicit date always wins over a preset). Changing
 * the filter starts a NEW session and a new anchor. Tenant midnight can pass
 * mid-session; the anchored range does not care.
 *
 * `now` is injectable for tests ONLY. It is an absolute instant, never a zone —
 * the machine's timezone is not consulted here or anywhere below it.
 */
export function resolveMovementAnchors(
  preset: MovementDatePreset | undefined,
  dateFrom: string | undefined,
  dateTo: string | undefined,
  timeZone: string,
  now: Date = new Date(),
): MovementAnchors {
  // ALREADY ANCHORED — a concrete date was supplied, so the preset is only a UI
  // label at this point. Never re-resolve; this is the whole point.
  if (dateFrom !== undefined || dateTo !== undefined) {
    return { from: dateFrom ?? null, to: dateTo ?? null };
  }
  if (preset !== "today" && preset !== "7d" && preset !== "month") {
    return { from: null, to: null }; // "all" / "custom"-with-nothing-typed / absent
  }

  const zone = resolveTenantTimeZone(timeZone);
  // The tenant's TODAY — the same instant read on the tenant's clock, not the
  // viewer's and not the server machine's. It is BOTH the upper anchor and the
  // origin of the lower one, so the whole range is fixed to the day the operator
  // applied the filter on.
  const today = Temporal.PlainDate.from(tenantToday(zone, now));
  const start =
    preset === "today"
      ? today
      : preset === "7d"
        ? today.subtract({ days: 6 }) // last 7 days INCLUSIVE of today
        : today.with({ day: 1 }); // month-to-date

  // CLOSED at the top: `to` is inclusive of the whole of that local day, and the
  // query turns it into a next-day-start EXCLUSIVE instant. Tomorrow cannot enter.
  return { from: start.toString(), to: today.toString() };
}
