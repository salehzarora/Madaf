/**
 * M8H.2 — THE STRICT DATE-ONLY CONTRACT (Codex M8H2-03).
 *
 * `2026-02-30` is shaped exactly like a date and is not one. Every permissive
 * parser in the language takes it and quietly MOVES it:
 *
 *   new Date("2026-02-30")            → 2026-03-02
 *   Date.parse("2026-02-30T00:00:00") → a number (so shape+parse checks PASS)
 *   Date.UTC(2026, 1, 30)             → 2026-03-02
 *
 * That is not a cosmetic bug. The old Orders parser did shape + `Date.parse`, so an
 * impossible `from` survived as an ACTIVE filter; the converter then rejected it and
 * returned null for that bound — and a BOUNDED query silently became an UNBOUNDED
 * one. `?from=2026-02-30` did not return "no orders" or "an error". It returned
 * EVERY order, and exported them.
 *
 * So the contract is REJECT, never balance:
 *   • one authoritative parser (parseDateOnlyStrict)
 *   • an impossible date never becomes null-and-therefore-unbounded
 *   • an impossible date never rolls into the next month
 *   • a Server Action refuses the request outright rather than widening it
 *
 * Runner: `npm run test:strict-date`.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { nextCalendarDay, parseDateOnlyStrict } from "./time";
import { resolveMovementAnchors, tenantDateRangeUtc } from "./tenant-day";
import { parseOrdersQuery } from "./orders-query";

const JLM = "Asia/Jerusalem";

// ══ The parser itself ═════════════════════════════════════════════════════

test("strict: real Gregorian dates are accepted", () => {
  for (const d of [
    "2026-01-01",
    "2026-02-28",
    "2028-02-29", // a real leap day
    "2024-02-29", // …and another
    "2026-12-31",
    "2026-07-05",
  ]) {
    assert.equal(parseDateOnlyStrict(d), d, d);
  }
});

test("strict: impossible day/month combinations are REJECTED, not rolled", () => {
  for (const d of [
    "2026-02-29", // 2026 is NOT a leap year
    "2026-02-30",
    "2026-02-31",
    "2026-04-31", // April has 30 days
    "2026-06-31",
    "2026-09-31",
    "2026-11-31",
    "2100-02-29", // a century year that is NOT a leap year
    "2026-00-10", // month 0
    "2026-13-10", // month 13
    "2026-01-00", // day 0
    "2026-01-32",
    "0000-01-01", // year 0 is not a business date
  ]) {
    assert.equal(parseDateOnlyStrict(d), null, `${d} must be rejected`);
  }
});

test("strict: only the exact YYYY-MM-DD shape is accepted", () => {
  for (const bad of [
    " 2026-07-05", // leading whitespace
    "2026-07-05 ", // trailing whitespace
    "2026-07-05T00:00:00", // a timestamp
    "2026-07-05T00:00:00Z", // …with a Z
    "2026-07-05T00:00:00+03:00", // …with an offset
    "2026-07-05Z",
    "2026-7-5", // not zero-padded
    "26-07-05", // two-digit year
    "2026/07/05",
    "05-07-2026",
    "2026-07",
    "",
    null,
    undefined,
    12345,
    {},
  ]) {
    assert.equal(parseDateOnlyStrict(bad), null, `${JSON.stringify(bad)}`);
  }
});

test("strict: Date.parse would have accepted what this rejects (the actual bug)", () => {
  // This is the precise permissiveness the old parser inherited.
  assert.ok(
    !Number.isNaN(Date.parse("2026-02-30T00:00:00")),
    "Date.parse accepts the impossible date…",
  );
  assert.equal(parseDateOnlyStrict("2026-02-30"), null, "…and we do not");
  // …and the balancing that would have silently moved it into March.
  assert.equal(new Date(Date.UTC(2026, 1, 30)).toISOString().slice(0, 10), "2026-03-02");
});

// ══ Next-day arithmetic must not roll an impossible date ══════════════════

test("strict: nextCalendarDay refuses an impossible date instead of rolling it", () => {
  assert.equal(nextCalendarDay("2026-02-30"), null, "must not become 2026-03-03");
  assert.equal(nextCalendarDay("2026-04-31"), null);
  assert.equal(nextCalendarDay("2026-13-01"), null);
  assert.equal(nextCalendarDay("garbage"), null);
});

test("strict: nextCalendarDay is correct across leap days, months and years", () => {
  assert.equal(nextCalendarDay("2028-02-28"), "2028-02-29", "into the leap day");
  assert.equal(nextCalendarDay("2028-02-29"), "2028-03-01", "out of the leap day");
  assert.equal(nextCalendarDay("2026-02-28"), "2026-03-01", "non-leap February");
  assert.equal(nextCalendarDay("2026-07-31"), "2026-08-01");
  assert.equal(nextCalendarDay("2026-12-31"), "2027-01-01");
});

// ══ The range builder FAILS CLOSED ════════════════════════════════════════

test("range: an impossible LOWER bound never becomes unbounded", () => {
  // The whole point. `{gteIso: null}` here would mean "every row ever".
  assert.equal(tenantDateRangeUtc("2026-02-30", null, JLM), null);
  assert.equal(tenantDateRangeUtc("2026-02-30", "2026-07-05", JLM), null);
  // A VALID lower bound still works, so this is not just "everything returns null".
  const ok = tenantDateRangeUtc("2026-07-05", null, JLM);
  assert.equal(ok?.gteIso, "2026-07-04T21:00:00.000Z");
  assert.equal(ok?.ltIso, null, "an absent upper bound is legitimately open");
});

test("range: an impossible UPPER bound never rolls into the next month", () => {
  assert.equal(tenantDateRangeUtc(null, "2026-02-30", JLM), null);
  // Had it rolled, the exclusive end would have been 2026-03-03's start — three
  // extra days of data, silently.
  const rolled = tenantDateRangeUtc(null, "2026-03-02", JLM);
  assert.equal(rolled?.ltIso, "2026-03-02T22:00:00.000Z");
});

test("range: BOTH bounds impossible → still null (never an unbounded query)", () => {
  assert.equal(tenantDateRangeUtc("2026-02-30", "2026-04-31", JLM), null);
});

test("range: valid dates keep start-inclusive / next-day-start-exclusive", () => {
  const r = tenantDateRangeUtc("2026-07-05", "2026-07-05", JLM)!;
  assert.equal(r.gteIso, "2026-07-04T21:00:00.000Z");
  assert.equal(r.ltIso, "2026-07-05T21:00:00.000Z");
  // The leap day is a real, bounded day.
  const leap = tenantDateRangeUtc("2028-02-29", "2028-02-29", JLM)!;
  assert.ok(leap.gteIso && leap.ltIso);
  assert.equal(
    (Date.parse(leap.ltIso!) - Date.parse(leap.gteIso!)) / 3_600_000,
    24,
  );
});

// ══ The Orders URL parser ═════════════════════════════════════════════════

test("orders URL: an impossible date does not survive as an active filter", () => {
  // Previously: from=2026-02-30 passed shape+Date.parse, so it was carried into the
  // query as if real; the converter then nulled that bound → EVERY order returned.
  const q = parseOrdersQuery({ from: "2026-02-30" });
  assert.equal(q.dateFrom, null, "the impossible date is not preserved");
  assert.equal(q.dateTo, null);
  // And the resulting (empty) date filter is genuinely unbounded-by-DEFAULT, which
  // is the visible, deterministic no-filter state — not a half-applied one.
  assert.deepEqual(tenantDateRangeUtc(q.dateFrom, q.dateTo, JLM), {
    gteIso: null,
    ltIso: null,
  });
});

test("orders URL: one impossible side CLEARS THE WHOLE date filter (never half)", () => {
  // Keeping only the valid half would WIDEN a bounded request: `to` alone means
  // "everything up to that day", including years the operator never asked for.
  const a = parseOrdersQuery({ from: "2026-02-30", to: "2026-07-05" });
  assert.equal(a.dateFrom, null);
  assert.equal(a.dateTo, null, "the valid half must NOT survive alone");

  const b = parseOrdersQuery({ from: "2026-07-01", to: "2026-04-31" });
  assert.equal(b.dateFrom, null, "…in either direction");
  assert.equal(b.dateTo, null);
});

test("orders URL: valid dates are preserved exactly, and other filters are untouched", () => {
  const q = parseOrdersQuery({
    from: "2026-07-01",
    to: "2026-07-05",
    status: "new",
    q: "MDF",
  });
  assert.equal(q.dateFrom, "2026-07-01");
  assert.equal(q.dateTo, "2026-07-05");
  assert.deepEqual(q.statuses, ["new"]);
  assert.equal(q.search, "MDF");

  // An impossible DATE must not nuke the non-date filters either.
  const bad = parseOrdersQuery({ from: "2026-02-30", status: "new", q: "MDF" });
  assert.equal(bad.dateFrom, null);
  assert.deepEqual(bad.statuses, ["new"], "status survives");
  assert.equal(bad.search, "MDF", "search survives");
});

test("orders URL: a leap day round-trips", () => {
  const q = parseOrdersQuery({ from: "2028-02-29", to: "2028-02-29" });
  assert.equal(q.dateFrom, "2028-02-29");
  assert.equal(q.dateTo, "2028-02-29");
  const r = tenantDateRangeUtc(q.dateFrom, q.dateTo, JLM);
  assert.ok(r, "a real leap day produces a real range");
});

// ══ The movements anchors ═════════════════════════════════════════════════

test("movements: an impossible anchor produces a range of null (the action refuses)", () => {
  // The action validates with parseDateOnlyStrict BEFORE anchoring, so an impossible
  // date never reaches here. If it somehow did, the range still fails closed.
  const anchors = resolveMovementAnchors("custom", "2026-02-30", undefined, JLM);
  assert.equal(anchors.from, "2026-02-30", "the resolver passes concrete dates through");
  assert.equal(
    tenantDateRangeUtc(anchors.from, anchors.to, JLM),
    null,
    "…and the converter refuses it rather than dropping the bound",
  );
});
