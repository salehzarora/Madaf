/**
 * Tenant timezone test suite (M8H.2). Exercises the PRODUCTION time contract:
 * the tenant-timezone formatters (explicit zone + explicit locale, ar/he/en),
 * the DST-safe tenant-local-day → UTC boundary conversion (including both
 * Asia/Jerusalem transition days, where the previous single-pass math was an hour
 * off), the date-only rule, the bounded timezone options, and source-level guards
 * for the no-implicit-timezone / no-browser-authority / server-derived contract.
 *
 * Pure + zero-env: runs in mock mode with no Supabase.
 *
 * Runner: `npm run test:tenant-timezone` (tsx → node:test).
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  DEFAULT_TENANT_TIME_ZONE,
  FALLBACK_TIME_ZONE,
  formatDateOnly,
  formatTenantDate,
  formatTenantDateLong,
  formatTenantDateTime,
  formatTenantTime,
  isValidTimeZone,
  nextCalendarDay,
  resolveTenantTimeZone,
  tenantToday,
} from "./time";
import { TIME_ZONE_OPTIONS } from "./time-catalog";
import { tenantDateRangeUtc, tenantDayStartUtcIso } from "./tenant-day";
import { getTenantTimeZone } from "./data/supplier";
import { getDictionary } from "../i18n/dictionaries";

const LOCALES = ["ar", "he", "en"] as const;
const JLM = "Asia/Jerusalem";
const NYC = "America/New_York";

/**
 * Assert a rendered date by its NUMERIC PARTS, not by its separator: the
 * day/month/year order and glyphs are a LOCALE decision (en-IL uses "05/07/2026",
 * another locale may use dots), and pinning the separator would make these tests
 * brittle without testing anything about timezones. The parts ARE the contract.
 */
function assertDateParts(
  rendered: string,
  expected: { day: string; month: string; year: string },
  msg: string,
): void {
  const digits = rendered.match(/\d+/g) ?? [];
  assert.deepEqual(
    digits,
    [expected.day, expected.month, expected.year],
    `${msg} — got ${JSON.stringify(rendered)}`,
  );
}
const readSrc = (rel: string): string =>
  readFileSync(join(process.cwd(), "src", rel), "utf8");
const readRepo = (rel: string): string =>
  readFileSync(join(process.cwd(), rel), "utf8");
/** Strip comments so a guard scans CODE, not the doc-comments that describe the
 * very invariants we forbid in code. */
const stripComments = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const MIGRATION = readRepo(
  "supabase/migrations/20260803100000_m8h2_tenant_timezone.sql",
);

// ══ THE HEADLINE EXAMPLE ══════════════════════════════════════════════════
// The stored instant is correct; only the PRESENTATION was implicit.
test("09:57:17.908Z renders as 12:57 in Asia/Jerusalem (the reported case)", () => {
  const instant = "2026-07-13T09:57:17.908Z";
  for (const locale of LOCALES) {
    assert.equal(
      formatTenantTime(instant, locale, JLM),
      "12:57",
      `${locale}: summer (IDT, UTC+3)`,
    );
  }
  // Minutes, never seconds — and never a raw "+00" offset.
  const dt = formatTenantDateTime(instant, "en", JLM);
  assert.ok(dt.includes("12:57"));
  assert.ok(!/\+00|:17|UTC|GMT/.test(dt), dt);
});

// ══ DST: summer / winter / both transition boundaries ═════════════════════
test("Asia/Jerusalem SUMMER offset (+03) — 21:30Z is 00:30 the NEXT local day", () => {
  assert.equal(formatTenantTime("2026-07-13T09:57:17.908Z", "en", JLM), "12:57");
  // An instant late in UTC evening already belongs to tomorrow locally.
  assertDateParts(
    formatTenantDate("2026-07-04T21:30:00Z", "en", JLM),
    { day: "05", month: "07", year: "2026" },
    "21:30Z on the 4th is already the 5th in Jerusalem",
  );
  assert.equal(formatTenantTime("2026-07-04T21:30:00Z", "en", JLM), "00:30");
});
test("Asia/Jerusalem WINTER offset (+02) — the SAME wall clock maps differently", () => {
  // 09:57Z in January is 11:57 local (+02), not 12:57 (+03). A stored fixed
  // offset would have been wrong for half the year — hence IANA, not "+03:00".
  assert.equal(formatTenantTime("2026-01-13T09:57:17.908Z", "en", JLM), "11:57");
  assertDateParts(
    formatTenantDate("2026-01-14T22:30:00Z", "en", JLM),
    { day: "15", month: "01", year: "2026" },
    "22:30Z on the 14th is already the 15th in Jerusalem (+02)",
  );
});
test("no fixed +03 assumption: the offset differs between winter and summer", () => {
  const winter = formatTenantTime("2026-01-13T09:57:00Z", "en", JLM);
  const summer = formatTenantTime("2026-07-13T09:57:00Z", "en", JLM);
  assert.notEqual(winter, summer, "a fixed offset would render both identically");
  assert.equal(winter, "11:57");
  assert.equal(summer, "12:57");
});

test("DST TRANSITION days: local midnight resolves to the right UTC instant", () => {
  // Spring forward (2026-03-27, 02:00 → 03:00). Local midnight is still +02.
  assert.equal(
    tenantDayStartUtcIso("2026-03-27", JLM),
    "2026-03-26T22:00:00.000Z",
    "DST-start day begins at 22:00Z the previous day (+02), not 21:00Z",
  );
  // Fall back (2026-10-25, 02:00 → 01:00). Local midnight is still +03.
  assert.equal(
    tenantDayStartUtcIso("2026-10-25", JLM),
    "2026-10-24T21:00:00.000Z",
    "DST-end day begins at 21:00Z the previous day (+03), not 22:00Z",
  );
});
test("DST transition: the computed start really IS local midnight (round-trip)", () => {
  for (const day of ["2026-03-27", "2026-10-25", "2026-07-13", "2026-01-15"]) {
    const startIso = tenantDayStartUtcIso(day, JLM)!;
    assert.equal(
      formatTenantTime(startIso, "en", JLM),
      "00:00",
      `${day}: the day boundary must be local 00:00`,
    );
    assert.equal(
      new Intl.DateTimeFormat("en-CA", { timeZone: JLM }).format(new Date(startIso)),
      day,
      `${day}: the boundary must fall on that very calendar day`,
    );
  }
});
test("DST: no business day is SKIPPED or DUPLICATED across a transition", () => {
  // The local day [start, nextStart) must cover 23h (spring) / 25h (autumn) —
  // never 24h blindly, and the ranges must tile without gap or overlap.
  const springStart = Date.parse(tenantDayStartUtcIso("2026-03-27", JLM)!);
  const springEnd = Date.parse(
    tenantDayStartUtcIso(nextCalendarDay("2026-03-27")!, JLM)!,
  );
  assert.equal((springEnd - springStart) / 3_600_000, 23, "spring-forward day is 23h");

  const autumnStart = Date.parse(tenantDayStartUtcIso("2026-10-25", JLM)!);
  const autumnEnd = Date.parse(
    tenantDayStartUtcIso(nextCalendarDay("2026-10-25")!, JLM)!,
  );
  assert.equal((autumnEnd - autumnStart) / 3_600_000, 25, "fall-back day is 25h");

  // Tiling: the previous day's exclusive end == this day's inclusive start.
  const prevEnd = Date.parse(
    tenantDayStartUtcIso(nextCalendarDay("2026-03-26")!, JLM)!,
  );
  assert.equal(prevEnd, springStart, "days tile exactly — no gap, no overlap");
});

// ══ Multi-zone: the SAME instant, two tenants ═════════════════════════════
test("the same instant renders differently for two tenant timezones", () => {
  const instant = "2026-07-13T09:57:17.908Z";
  assert.equal(formatTenantTime(instant, "en", JLM), "12:57");
  assert.equal(formatTenantTime(instant, "en", "UTC"), "09:57");
  assert.equal(formatTenantTime(instant, "en", NYC), "05:57"); // EDT (UTC-4)
  assert.equal(formatTenantTime(instant, "en", "Europe/London"), "10:57"); // BST
});
test("UTC tenant renders the stored wall clock unchanged", () => {
  assert.equal(formatTenantTime("2026-07-13T09:57:17.908Z", "en", "UTC"), "09:57");
  assertDateParts(
    formatTenantDate("2026-07-13T09:57:17.908Z", "en", "UTC"),
    { day: "13", month: "07", year: "2026" },
    "a UTC tenant sees the stored calendar date",
  );
});
test("a second multi-zone region also observes its own DST", () => {
  // New York: EDT (-4) in July, EST (-5) in January.
  assert.equal(formatTenantTime("2026-07-13T12:00:00Z", "en", NYC), "08:00");
  assert.equal(formatTenantTime("2026-01-13T12:00:00Z", "en", NYC), "07:00");
  // And its local midnight maps to a different UTC instant than Jerusalem's.
  assert.notEqual(
    tenantDayStartUtcIso("2026-07-13", NYC),
    tenantDayStartUtcIso("2026-07-13", JLM),
  );
});

// ══ Local day → UTC bounds (inclusive start / next-day-start exclusive) ═══
test("tenant local midnight converts to the correct UTC instant", () => {
  assert.equal(tenantDayStartUtcIso("2026-07-05", JLM), "2026-07-04T21:00:00.000Z");
  assert.equal(tenantDayStartUtcIso("2026-01-05", JLM), "2026-01-04T22:00:00.000Z");
  assert.equal(tenantDayStartUtcIso("2026-07-05", "UTC"), "2026-07-05T00:00:00.000Z");
});
test("a local-day range is start-INCLUSIVE and next-day-start EXCLUSIVE", () => {
  const start = Date.parse(tenantDayStartUtcIso("2026-07-05", JLM)!);
  const end = Date.parse(tenantDayStartUtcIso(nextCalendarDay("2026-07-05")!, JLM)!);

  const firstMoment = Date.parse("2026-07-05T00:00:00+03:00");
  const lastMoment = Date.parse("2026-07-05T23:59:59+03:00");
  const nextDayFirst = Date.parse("2026-07-06T00:00:00+03:00");

  assert.ok(firstMoment >= start, "local 00:00 is INCLUDED");
  assert.ok(lastMoment < end, "local 23:59 is INCLUDED");
  assert.equal(nextDayFirst, end, "the next local day's 00:00 is the EXCLUSIVE end");
  assert.ok(!(nextDayFirst < end), "the next day's first moment is EXCLUDED");
});
test("no UTC-midnight off-by-one: an early-morning local order is not clipped", () => {
  // 00:30 local on 07-05 = 21:30Z on 07-04. A naive UTC bound would exclude it.
  const order = Date.parse("2026-07-05T00:30:00+03:00");
  const bound = Date.parse(tenantDayStartUtcIso("2026-07-05", JLM)!);
  assert.ok(order >= bound, "included by the tenant-tz bound");
  assert.ok(order < Date.parse("2026-07-05T00:00:00Z"), "a naive UTC bound would drop it");
});
test("malformed / impossible dates return null (never a silent wrong bound)", () => {
  assert.equal(tenantDayStartUtcIso("2026-13-40", JLM), null);
  assert.equal(tenantDayStartUtcIso("2026/07/05", JLM), null);
  assert.equal(tenantDayStartUtcIso("", JLM), null);
});

// ══ locale ⟂ timezone ════════════════════════════════════════════════════
test("locale and timezone are INDEPENDENT (ar/he/en all in Asia/Jerusalem)", () => {
  const instant = "2026-07-13T09:57:17.908Z";
  // Same instant + same zone → same wall clock in every locale.
  for (const locale of LOCALES) {
    assert.equal(formatTenantTime(instant, locale, JLM), "12:57");
  }
  // Changing the LOCALE must not change the instant or the zone.
  const ar = formatTenantDate(instant, "ar", JLM);
  const he = formatTenantDate(instant, "he", JLM);
  const en = formatTenantDate(instant, "en", JLM);
  for (const s of [ar, he, en]) assert.ok(s.includes("13"), s); // the 13th, everywhere
  // Arabic pins WESTERN digits (repo rule) — no Eastern-Arabic numerals.
  assert.ok(!/[٠-٩]/.test(ar), `ar must use Western digits: ${ar}`);
});
test("ar / he / en each produce a non-empty long document date", () => {
  for (const locale of LOCALES) {
    const s = formatTenantDateLong("2026-07-13T09:57:17.908Z", locale, JLM);
    assert.ok(s.length > 0, locale);
    assert.ok(s.includes("2026"), `${locale}: ${s}`);
  }
});

// ══ Date-ONLY fields are never timezone-shifted ══════════════════════════
test("a DATE-only value (inventory expiry) is rendered AS WRITTEN, not shifted", () => {
  // A SQL `date` has no instant. Converting it would move the day westward.
  assertDateParts(
    formatDateOnly("2026-07-13", "en"),
    { day: "13", month: "07", year: "2026" },
    "the expiry date is shown exactly as stored",
  );
  assertDateParts(
    formatDateOnly("2026-01-01", "en"),
    { day: "01", month: "01", year: "2026" },
    "new-year expiry does not slip to the previous year",
  );
  // It takes NO timezone at all — so no zone can shift it (the bug we avoid:
  // '2026-07-13' read as UTC midnight in America/New_York would show 07-12).
  assert.equal(formatDateOnly.length, 2, "formatDateOnly takes (dateStr, locale) only");
  assert.equal(formatDateOnly("not-a-date", "en"), "");
});

// ══ Invalid input / invalid timezone fail SAFELY ═════════════════════════
test("invalid instants render empty rather than 'Invalid Date'", () => {
  for (const bad of ["", "not-a-date", "2026-99-99T99:99:99Z"]) {
    assert.equal(formatTenantDate(bad, "en", JLM), "");
    assert.equal(formatTenantTime(bad, "en", JLM), "");
    assert.equal(formatTenantDateTime(bad, "en", JLM), "");
  }
});
test("an invalid stored timezone falls back to UTC — never to the machine zone", () => {
  assert.equal(FALLBACK_TIME_ZONE, "UTC");
  assert.equal(resolveTenantTimeZone("Not/AZone"), "UTC");
  assert.equal(resolveTenantTimeZone(""), "UTC");
  assert.equal(resolveTenantTimeZone(null), "UTC");
  // The fallback is OBSERVABLE (it renders as UTC, not as the host's zone).
  assert.equal(formatTenantTime("2026-07-13T09:57:00Z", "en", "Not/AZone"), "09:57");
});
test("fixed UTC offsets are REJECTED (they cannot express DST)", () => {
  for (const bad of ["+03:00", "-05:00", "+0300", "UTC+2", "GMT-5"]) {
    assert.equal(isValidTimeZone(bad), false, bad);
    assert.equal(resolveTenantTimeZone(bad), "UTC");
  }
  assert.equal(isValidTimeZone(JLM), true);
  assert.equal(isValidTimeZone("UTC"), true);
});

// ══ Timezone options (bounded, canonical, DB-accepted) ═══════════════════
test("the option list is bounded, canonical, and includes Asia/Jerusalem + UTC", () => {
  assert.ok(TIME_ZONE_OPTIONS.includes("UTC"));
  assert.ok(TIME_ZONE_OPTIONS.includes(JLM));
  assert.ok(TIME_ZONE_OPTIONS.length > 100, "a real list");
  assert.ok(TIME_ZONE_OPTIONS.length < 1000, "bounded — not the ~1200-row pg alias dump");
});
test("the option list excludes posix/*, right/* and Factory aliases", () => {
  for (const z of TIME_ZONE_OPTIONS) {
    assert.ok(!/^posix\//.test(z), z);
    assert.ok(!/^right\//.test(z), z);
    assert.notEqual(z, "Factory");
  }
});
test("every offered option is a zone this runtime can actually format with", () => {
  for (const z of TIME_ZONE_OPTIONS) {
    assert.ok(isValidTimeZone(z), z);
  }
});
test("no fixed offset is offered as a selectable value", () => {
  for (const z of TIME_ZONE_OPTIONS) {
    assert.ok(!/^[+-]/.test(z), z);
    assert.ok(!/^(UTC|GMT)[+-]/.test(z), z);
  }
});

// ══ Tenant context (server-derived; mock parity) ═════════════════════════
test("mock mode: the tenant timezone is the demo tenant's, not the device's", async () => {
  const tz = await getTenantTimeZone();
  assert.equal(tz, JLM, "mock supplier's zone");
  assert.equal(DEFAULT_TENANT_TIME_ZONE, JLM);
  // It must NOT be whatever the test machine happens to be set to.
  assert.equal(isValidTimeZone(tz), true);
});
test("tenantToday is computed in the TENANT zone, not the device zone", () => {
  // A fixed instant that is a DIFFERENT calendar day in the two zones:
  // 2026-07-13T21:30Z is still the 13th in UTC but already the 14th in Jerusalem.
  const now = new Date("2026-07-13T21:30:00Z");
  assert.equal(tenantToday("UTC", now), "2026-07-13");
  assert.equal(tenantToday(JLM, now), "2026-07-14");
  assert.equal(tenantToday(NYC, now), "2026-07-13");
});

// ══ SSR / client parity — no hydration drift ═════════════════════════════
test("formatting is deterministic for a given (instant, locale, zone) — no drift", () => {
  const instant = "2026-07-13T09:57:17.908Z";
  // The formatters depend ONLY on their explicit arguments, so the server and the
  // browser (in any device zone)必 produce byte-identical output.
  const a = formatTenantDateTime(instant, "he", JLM);
  const b = formatTenantDateTime(instant, "he", JLM);
  assert.equal(a, b);
  // Nothing in the module reads the ambient zone for business rendering.
  const src = stripComments(readSrc("lib/time.ts"));
  assert.ok(
    !/resolvedOptions\(\)\.timeZone/.test(src),
    "time.ts must never read the ambient/device timezone",
  );
});

// ══ Source guards: no implicit timezone anywhere ═════════════════════════
test("guard: no business formatter uses toLocale* or an implicit-zone Intl", () => {
  // Every date/time render must go through the tenant contract.
  const offenders: string[] = [];
  const files = [
    "app/[locale]/admin/orders/page.tsx",
    "app/[locale]/admin/orders/[id]/page.tsx",
    "app/[locale]/admin/customers/[id]/page.tsx",
    "app/[locale]/admin/documents/page.tsx",
    "app/[locale]/admin/page.tsx",
    "components/admin/orders-table.tsx",
    "components/admin/customers-table.tsx",
    "components/admin/customer-timeline.tsx",
    "components/admin/customer-links-manager.tsx",
    "components/admin/movements-table.tsx",
    "components/admin/signup-manager.tsx",
    "components/admin/showcase-link-manager.tsx",
    "components/admin/team-manager.tsx",
    "components/document-view.tsx",
    "lib/pdf/render-document.ts",
  ];
  for (const f of files) {
    const src = stripComments(readSrc(f));
    if (/toLocaleString|toLocaleDateString|toLocaleTimeString/.test(src)) {
      offenders.push(`${f}: toLocale*`);
    }
    // A bare Intl.DateTimeFormat in a view = an implicit machine/device zone.
    if (/new Intl\.DateTimeFormat/.test(src)) offenders.push(`${f}: raw Intl`);
  }
  assert.deepEqual(offenders, []);
});
test("guard: format.ts no longer exports a timezone-less date formatter", () => {
  const src = readSrc("lib/format.ts");
  assert.ok(!/export function formatDate\b/.test(src));
  assert.ok(!/export function formatDateLong\b/.test(src));
});
test("guard: every tenant formatter REQUIRES an explicit timeZone + locale", () => {
  // 3 required params (iso, locale, timeZone) — a caller cannot omit the zone.
  assert.equal(formatTenantDate.length, 3);
  assert.equal(formatTenantTime.length, 3);
  assert.equal(formatTenantDateTime.length, 3);
  assert.equal(formatTenantDateLong.length, 3);
});
test("guard: the tenant timezone is SERVER-derived; the browser is never the authority", () => {
  const session = stripComments(readSrc("lib/auth/session.ts"));
  assert.ok(/list_memberships/.test(session), "zone rides the existing read context");
  assert.ok(/getTenantTimeZone/.test(session));
  // No page/component may take the device zone as the business zone.
  const control = stripComments(readSrc("components/admin/timezone-settings.tsx"));
  assert.ok(
    /resolvedOptions\(\)\.timeZone/.test(control),
    "the control may READ the device zone…",
  );
  assert.ok(
    /deviceHint/.test(control) && !/setSelected\(deviceZone\)/.test(control),
    "…but only as a HINT — it is never auto-applied/saved",
  );
});
test("guard: no timezone N+1 — the zone comes from the cached session context", () => {
  const supplier = stripComments(readSrc("lib/data/supplier.ts"));
  // Supabase path delegates to the session (React-cached, one list_memberships
  // per request) — it must NOT run its own tenants query per call.
  assert.ok(/getTenantTimeZone/.test(supplier));
  assert.ok(!/from\("tenants"\)/.test(supplier), "no extra tenants query");
});

// ══ Date filters use the tenant zone (count == list == export) ═══════════
test("guard: the orders count, list and export share ONE tenant-zone bound", () => {
  const reads = stripComments(readSrc("lib/data/supabase-reads.ts"));
  // ONE builder resolves the bounds — the count, the page and the export all call
  // buildOrdersQuery, so they cannot disagree about where a calendar day begins.
  assert.ok(/tenantDateRangeUtc\(\s*query\.dateFrom,\s*query\.dateTo,\s*timeZone,?\s*\)/.test(reads));
  assert.ok(/\.gte\("created_at", gteIso\)/.test(reads), "start-INCLUSIVE");
  assert.ok(/\.lt\("created_at", ltIso\)/.test(reads), "next-day-start EXCLUSIVE");
  assert.ok(/function buildOrdersQuery\([\s\S]*?timeZone: string/.test(reads));
  assert.ok(!/ORDERS_MARKET_TIME_ZONE|marketDayStartUtcIso/.test(reads), "no hard-coded market zone");
});
test("guard: the mock filter mirrors the same tenant-zone bounds", () => {
  const orders = stripComments(readSrc("lib/data/orders.ts"));
  assert.ok(/tenantDateRangeUtc\(\s*query\.dateFrom,\s*query\.dateTo,\s*timeZone,?\s*\)/.test(orders));
  assert.ok(/getTenantTimeZone\(\)/.test(orders));
});
test("guard: the reverse conversion uses a real timezone primitive, not offset math", () => {
  const src = stripComments(readSrc("lib/tenant-day.ts"));
  // Temporal's PlainDate.toZonedDateTime IS "start of day" — the first instant that
  // belongs to the date. Offset arithmetic cannot express that: local 00:00 does not
  // exist in every zone on every date.
  assert.ok(/@js-temporal\/polyfill/.test(src), "delegates to Temporal");
  assert.ok(/toZonedDateTime\(zone\)/.test(src));
  // The old two-pass offset math (and any successor) must not come back.
  assert.ok(!/getTimezoneOffset|formatToParts|offset1|offset2/.test(src), "no offset passes");
  // Server-only: the Temporal polyfill must never reach the browser bundle, and
  // date filtering is a server concern (count/list/export must agree).
  assert.ok(/^import "server-only";/m.test(src), "server-only");
  const ordersQuery = stripComments(readSrc("lib/orders-query.ts"));
  assert.ok(
    !/tenant-day|tenantDayStartUtcIso/.test(ordersQuery),
    "the client-imported query module must not pull in the server-only converter",
  );
});

// ══ The zones the old offset math got WRONG (fast subset of the matrix) ══
test("nonexistent local midnight: the day starts at the FIRST instant that exists", () => {
  // These zones spring forward AT midnight — 00:00 never happens. The previous
  // two-pass offset math returned 23:00 of the PREVIOUS day, so an hour of the
  // previous day was counted, listed and exported under this date.
  const SPRING_AT_MIDNIGHT: Array<[zone: string, date: string, expected: string]> = [
    ["America/Santiago", "2025-09-07", "2025-09-07T04:00:00.000Z"],
    ["America/Havana", "2025-03-09", "2025-03-09T05:00:00.000Z"],
    ["America/Asuncion", "2025-10-05", "2025-10-05T04:00:00.000Z"],
    ["Atlantic/Azores", "2025-03-30", "2025-03-30T01:00:00.000Z"],
    ["Asia/Beirut", "2026-03-29", "2026-03-28T22:00:00.000Z"],
  ];
  for (const [zone, date, expected] of SPRING_AT_MIDNIGHT) {
    const iso = tenantDayStartUtcIso(date, zone);
    assert.equal(iso, expected, `${zone} ${date}`);
    const ms = Date.parse(iso!);
    // It belongs to the requested date…
    assert.equal(
      new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(new Date(ms)),
      date,
      `${zone} ${date}: the start must be IN the requested date`,
    );
    // …it is the EARLIEST instant that does…
    assert.notEqual(
      new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(new Date(ms - 1)),
      date,
      `${zone} ${date}: nothing earlier may belong to it`,
    );
    // …and the wall clock reads 01:00, not 00:00 (which does not exist).
    assert.equal(formatTenantTime(iso!, "en", zone), "01:00", `${zone} ${date}`);
  }
});
test("non-hour offsets: Kathmandu (+05:45), Chatham (+12:45/+13:45), Lord Howe (30m DST)", () => {
  // Any code that thinks offsets are whole hours breaks here.
  assert.equal(
    tenantDayStartUtcIso("2026-07-13", "Asia/Kathmandu"),
    "2026-07-12T18:15:00.000Z",
  );
  assert.equal(
    tenantDayStartUtcIso("2026-07-13", "Pacific/Chatham"),
    "2026-07-12T11:15:00.000Z", // +12:45
  );
  assert.equal(
    tenantDayStartUtcIso("2026-12-13", "Pacific/Chatham"),
    "2026-12-12T10:15:00.000Z", // +13:45 (DST)
  );
  // Lord Howe's DST step is THIRTY minutes → +10:30 in winter, +11:00 in summer.
  assert.equal(
    tenantDayStartUtcIso("2026-07-13", "Australia/Lord_Howe"),
    "2026-07-12T13:30:00.000Z",
  );
  assert.equal(
    tenantDayStartUtcIso("2026-12-13", "Australia/Lord_Howe"),
    "2026-12-12T13:00:00.000Z",
  );
});
test("a local day is not always 23/24/25 hours (Antarctica/Troll moves TWO hours)", () => {
  const dayHours = (date: string, zone: string) =>
    (Date.parse(tenantDayStartUtcIso(nextCalendarDay(date)!, zone)!) -
      Date.parse(tenantDayStartUtcIso(date, zone)!)) /
    3_600_000;
  assert.equal(dayHours("2025-03-30", "Antarctica/Troll"), 22, "a 22-hour day");
  assert.equal(dayHours("2025-10-26", "Antarctica/Troll"), 26, "a 26-hour day");
  // …and Lord Howe's half-hour step makes half-hour days.
  assert.equal(dayHours("2026-04-05", "Australia/Lord_Howe"), 24.5);
  assert.equal(dayHours("2026-10-04", "Australia/Lord_Howe"), 23.5);
});
test("the ONE range builder is start-inclusive / next-day-start-exclusive", () => {
  // tenantDateRangeUtc is what the Orders page, its exact count, the CSV export and
  // the mock filter all call — so this is the property they all inherit.
  const day = tenantDateRangeUtc("2026-07-05", "2026-07-05", JLM)!;
  assert.equal(day.gteIso, "2026-07-04T21:00:00.000Z", "the local 5th begins here");
  assert.equal(day.ltIso, "2026-07-05T21:00:00.000Z", "…and the local 6th begins here");
  assert.equal(
    day.ltIso,
    tenantDayStartUtcIso("2026-07-06", JLM),
    "end == next day's start",
  );
  // An open-ended range keeps the missing side null (no accidental bound).
  assert.deepEqual(tenantDateRangeUtc(null, null, JLM), { gteIso: null, ltIso: null });
  assert.equal(tenantDateRangeUtc("2026-07-05", null, JLM)!.ltIso, null);
  assert.equal(tenantDateRangeUtc(null, "2026-07-05", JLM)!.gteIso, null);
  // An IMPOSSIBLE date FAILS THE WHOLE RANGE — it never degrades into a partial
  // (and therefore wider) one. This is the difference between "one day of orders"
  // and "every order ever", exported.
  assert.equal(tenantDateRangeUtc("2026-02-30", null, JLM), null, "impossible from");
  assert.equal(tenantDateRangeUtc(null, "2026-02-30", JLM), null, "impossible to");
  assert.equal(tenantDateRangeUtc("2026-04-31", "2026-07-05", JLM), null);
  // A whole DST-transition day is still covered end to end, at 23h not 24h.
  const spring = tenantDateRangeUtc("2026-03-27", "2026-03-27", JLM)!;
  assert.equal(
    (Date.parse(spring.ltIso!) - Date.parse(spring.gteIso!)) / 3_600_000,
    23,
  );
});

// ══ Timezone change: display-only, never a data rewrite ══════════════════
test("guard: the migration rewrites NO timestamp and creates no fake history", () => {
  const sql = MIGRATION.replace(/--.*$/gm, "");
  // The ONLY data write is populating the new column via the ADD COLUMN default.
  assert.ok(!/update public\.(orders|customers|audit_events|order_items)/i.test(sql));
  assert.ok(!/set created_at|set updated_at\s*=\s*[^n]/i.test(sql));
  assert.ok(!/insert into public\.(orders|customers|audit_events)/i.test(sql));
  // No GLOBAL/session timezone change (SET TIME ZONE / SET timezone TO / ALTER
  // DATABASE … SET timezone). NB: `set timezone = v_tz` inside the RPC is the
  // COLUMN assignment, which is exactly what this phase is supposed to do.
  assert.ok(
    !/\bset\s+time\s+zone\b/i.test(sql) &&
      !/\bset\s+timezone\s+to\b/i.test(sql) &&
      !/alter\s+(database|role|system)/i.test(sql),
    "no global/session DB timezone change",
  );
  assert.ok(!/drop table|truncate|delete from/i.test(sql));
});
test("guard: the migration stores an IANA name and validates it at the TABLE", () => {
  assert.ok(/add column timezone text not null default 'Asia\/Jerusalem'/i.test(MIGRATION));
  assert.ok(/pg_catalog\.pg_timezone_names/.test(MIGRATION), "validated against pg's own data");
  assert.ok(/before insert or update of timezone on public\.tenants/i.test(MIGRATION),
    "a TRIGGER guards the column — a direct table UPDATE cannot bypass it");
  assert.ok(/errcode = '22023'/.test(MIGRATION));
  // The stored contract is stated POSITIVELY (UTC or Region/City), not as a
  // blocklist — a blocklist leaks, and pg_timezone_names MEMBERSHIP alone accepts
  // Etc/GMT+3 and EST, which cannot express DST.
  assert.ok(
    /p_timezone = 'UTC'/.test(MIGRATION),
    "UTC is explicitly allowed",
  );
  assert.ok(
    /\^\[A-Za-z\]\[A-Za-z0-9_-\]\*\(\/\[A-Za-z0-9_-\]\+\)\+\$/.test(MIGRATION),
    "…and otherwise an Area/Location shape is REQUIRED",
  );
  assert.ok(
    /posix\|right\|Etc\|SystemV/.test(MIGRATION),
    "the fixed-offset / alias namespaces are excluded",
  );
});
test("guard: the write RPC is owner/admin-only and never self-authorizes", () => {
  assert.ok(/create function public\.update_tenant_timezone\(/.test(MIGRATION));
  assert.ok(/security definer/.test(MIGRATION) && /set search_path = ''/.test(MIGRATION));
  assert.ok(
    /authorize_tenant\(\s*p_tenant_id, array\['owner', 'admin'\]/.test(MIGRATION),
    "sales_rep / non-member / cross-tenant are refused by authorize_tenant",
  );
  assert.ok(/revoke all on function public\.update_tenant_timezone\(uuid, text\)\s*\n?\s*from public, anon/.test(MIGRATION));
  assert.ok(/grant execute on function public\.update_tenant_timezone\(uuid, text\)\s*\n?\s*to authenticated/.test(MIGRATION));
});
test("guard: the client never writes the tenants table directly", () => {
  const action = stripComments(readSrc("lib/actions/tenant-timezone.ts"));
  assert.ok(/updateTenantTimeZone/.test(action));
  assert.ok(!/from\("tenants"\)|\.update\(/.test(action), "no direct table update");
  const writes = stripComments(readSrc("lib/data/supabase-writes.ts"));
  assert.ok(/\.rpc\("update_tenant_timezone"/.test(writes), "the RPC is the only write path");
  assert.ok(/p_tenant_id: tenantId/.test(writes), "tenant is server-derived");
});
test("guard: changing the timezone emits NO audit event (reads/settings are silent)", () => {
  const action = stripComments(readSrc("lib/actions/tenant-timezone.ts"));
  assert.ok(!/audit|_log_/i.test(action));
  assert.ok(!/_log_customer_audit_event|_log_order_audit_event|audit_events/i.test(MIGRATION));
});

// ══ Scope: the Order Timeline is M8H.3; a global Activity Log is still not ══
// M8H.2 deferred the Order Timeline UI to M8H.3, which has now delivered it.
// What must STILL hold is that M8H.2's own contribution stayed timezone-only,
// and that no tenant-wide audit browser has appeared.
test("guard: no global Activity Log route (still future scope)", () => {
  for (const p of [
    "components/admin/activity-log.tsx",
    "app/[locale]/admin/activity",
    "app/[locale]/admin/audit",
  ]) {
    assert.ok(
      !existsSync(join(process.cwd(), "src", p)),
      `${p} must not exist (a global Activity Log is future scope)`,
    );
  }
  // The M8H.3 Timeline consumes the M8H.2 formatter — it never re-derives a zone.
  const ui = stripComments(readSrc("components/admin/order-timeline.tsx"));
  assert.ok(/formatTenantDateTime\(event\.createdAt, locale, timeZone\)/.test(ui));
  assert.ok(!/Intl\.DateTimeFormat|toLocaleString|resolvedOptions/.test(ui));
});

// ══ Settings control: a11y, explicit save, RTL/LTR, ar/he/en ════════════
test("i18n: the timezone block is complete and non-empty in ar/he/en", () => {
  for (const locale of LOCALES) {
    const t = getDictionary(locale).admin.settings.business.timezone;
    for (const [k, v] of Object.entries(t)) {
      assert.equal(typeof v, "string", `${locale} ${k}`);
      assert.ok((v as string).length > 0, `${locale} ${k}`);
    }
    assert.ok(t.deviceHint.includes("{zone}"), `${locale}: deviceHint interpolates`);
  }
});
test("guard: the control has an explicit Save + loading/success/error states", () => {
  const src = readSrc("components/admin/timezone-settings.tsx");
  assert.ok(/onClick=\{onSave\}/.test(src), "explicit Save action");
  assert.ok(/disabled=\{!dirty \|\| saving\}/.test(src), "no save without a change");
  assert.ok(/t\.saving/.test(src), "loading state");
  assert.ok(/role="status"[\s\S]{0,80}t\.saved/.test(src), "success state (announced)");
  assert.ok(/role="alert"/.test(src), "error state (announced)");
});
test("guard: the control is keyboard + screen-reader accessible and bidi-safe", () => {
  const src = readSrc("components/admin/timezone-settings.tsx");
  assert.ok(/role="radiogroup"/.test(src) && /role="radio"/.test(src));
  assert.ok(/aria-checked=/.test(src), "selection is announced");
  assert.ok(/aria-labelledby="tz-heading"/.test(src));
  assert.ok(/htmlFor="tz-search"/.test(src), "the search input is labelled");
  // IANA names are LTR identifiers — isolated so they read correctly in ar/he.
  assert.ok(/dir="ltr"/.test(src), "zone identifiers are bidi-isolated");
  // Logical properties only (RTL-safe).
  assert.ok(!/\b(ml-|mr-|pl-|pr-|left-|right-|text-left|text-right)/.test(src));
});
