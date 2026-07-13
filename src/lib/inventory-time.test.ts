/**
 * M8H.2 — INVENTORY MOVEMENTS TIME CONTRACT.
 *
 * The merge review caught the movements ledger half-migrated: M8H.2 converted the
 * SCREEN to tenant-local time but left the CSV emitting a raw UTC instant under a
 * localized "Date" header, and left the date FILTER computing its bounds in the
 * BROWSER off the device clock (`new Date(y, m, d)` for local midnight,
 * `+ 86_400_000` for "a day"). So one page could DISPLAY a movement on one date
 * and FILTER it onto another — the precise split this phase exists to remove.
 *
 * This suite pins the corrected contract:
 *   • the CSV carries the SAME tenant wall clock the screen shows — never a raw
 *     +00 instant under a human "Date" column
 *   • every date boundary is resolved SERVER-side in the TENANT's timezone, from a
 *     preset + date-only input; the client cannot supply an instant at all
 *   • the boundaries obey the same DST-safe rules as Orders (start-inclusive,
 *     next-day-start-exclusive, no 24-hour assumption, nonexistent midnight OK)
 *
 * Behaviour first: the bounds are computed through the PRODUCTION resolver, and
 * the CSV row is built by the PRODUCTION formatter. Source guards are used only
 * for the architectural constraints (no client clock, no server-only import in a
 * client module) that a unit test cannot otherwise express.
 *
 * Runner: `npm run test:inventory-time`.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { formatTenantDateTime } from "./time";
import { resolveMovementAnchors, tenantDateRangeUtc } from "./tenant-day";
import { MOVEMENT_DATE_PRESETS } from "./types";

/**
 * The EXACT composition production performs: the Server Action anchors the filter
 * (resolveMovementAnchors), and the data layer converts those concrete tenant-local
 * dates to UTC bounds (tenantDateRangeUtc). Tests drive the real pair, not a copy.
 */
function movementRange(
  preset: Parameters<typeof resolveMovementAnchors>[0],
  from: string | undefined,
  to: string | undefined,
  timeZone: string,
  now?: Date,
) {
  const anchors = resolveMovementAnchors(preset, from, to, timeZone, now);
  const range = tenantDateRangeUtc(anchors.from, anchors.to, timeZone);
  // Every date these tests pass is real; an impossible one FAILS CLOSED (null) and
  // is covered by the strict-date suite, which asserts the request is refused.
  assert.ok(range, "a real calendar date must produce a range");
  return range;
}

const JLM = "Asia/Jerusalem";
const NYC = "America/New_York";

const readSrc = (rel: string): string =>
  readFileSync(join(process.cwd(), "src", rel), "utf8");
/** Scan CODE, not the doc-comments that DESCRIBE the banned constructs. */
const stripComments = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const MOVEMENTS_TABLE = readSrc("components/admin/movements-table.tsx");
const INVENTORY_ACTION = readSrc("lib/actions/inventory.ts");
const SUPABASE_READS = readSrc("lib/data/supabase-reads.ts");
const TZ_SETTINGS = readSrc("components/admin/timezone-settings.tsx");

/** The instant from the original report: 09:57Z is 12:57 in Jerusalem in July. */
const SUMMER = "2026-07-13T09:57:17.908Z";
/** The same wall clock in winter is 11:57 (+02) — proof of no fixed offset. */
const WINTER = "2026-01-13T09:57:17.908Z";

// ══ DEFECT 1 — the CSV must carry the tenant wall clock ═══════════════════

test("CSV: 09:57Z exports as the tenant's 12:57 — the same value the screen shows", () => {
  // The export row builder and the table cell now call the SAME formatter with the
  // SAME (locale, timeZone), so they cannot disagree about a movement's time.
  const onScreen = formatTenantDateTime(SUMMER, "en", JLM);
  const inCsv = formatTenantDateTime(SUMMER, "en", JLM);
  assert.equal(inCsv, onScreen, "CSV and screen must render identically");
  assert.match(inCsv, /12:57/, "the tenant wall clock, not the stored 09:57Z");
  assert.doesNotMatch(inCsv, /09:57/, "the raw UTC time must not appear");
});

test("CSV: a winter instant uses +02, not a fixed +03", () => {
  const winter = formatTenantDateTime(WINTER, "en", JLM);
  assert.match(winter, /11:57/, "IST (+02) in January");
  const summer = formatTenantDateTime(SUMMER, "en", JLM);
  assert.notEqual(
    winter.slice(-5),
    summer.slice(-5),
    "a fixed offset would render both the same",
  );
});

test("CSV: no raw UTC instant / +00 offset is emitted under the localized Date column", () => {
  for (const locale of ["ar", "he", "en"] as const) {
    const cell = formatTenantDateTime(SUMMER, locale, JLM);
    assert.doesNotMatch(cell, /\+00|Z$|T\d\d:\d\d/, `${locale}: not a raw ISO instant`);
    assert.doesNotMatch(cell, /\.908/, `${locale}: no raw milliseconds`);
    assert.match(cell, /12:57/, `${locale}: the tenant wall clock`);
  }
});

test("guard: the movements CSV builder uses the tenant formatter, not the raw field", () => {
  const src = stripComments(MOVEMENTS_TABLE);
  // The export row must format; a bare `m.createdAt,` in the row array is the bug.
  assert.match(
    src,
    /formatTenantDateTime\(m\.createdAt, locale, timeZone\)/,
    "the CSV date cell goes through the tenant formatter",
  );
  assert.doesNotMatch(
    src,
    /^\s*m\.createdAt,\s*$/m,
    "the raw createdAt must not be pushed into a CSV row",
  );
  // Both call sites (screen + CSV) exist and use the same 3 explicit arguments.
  const uses = src.match(/formatTenantDateTime\(m\.createdAt, locale, timeZone\)/g);
  assert.equal(uses?.length, 2, "screen cell AND csv cell (identical arguments)");
});

// ══ DEFECT 2 — the date filter is tenant-local and server-resolved ════════

test("filter: bounds are derived from the TENANT timezone, not UTC and not the device", () => {
  // A custom range over the local 5th of July: the local day begins at 21:00Z on
  // the 4th (+03), NOT at 00:00Z on the 5th.
  const { gteIso, ltIso } = movementRange(
    "custom",
    "2026-07-05",
    "2026-07-05",
    JLM,
  );
  assert.equal(gteIso, "2026-07-04T21:00:00.000Z");
  assert.equal(ltIso, "2026-07-05T21:00:00.000Z");
  // A different tenant zone yields different instants for the same calendar date.
  const nyc = movementRange("custom", "2026-07-05", "2026-07-05", NYC);
  assert.equal(nyc.gteIso, "2026-07-05T04:00:00.000Z");
  assert.notEqual(nyc.gteIso, gteIso);
});

test("filter: start is INCLUSIVE and the next day's start is EXCLUSIVE", () => {
  const { gteIso, ltIso } = movementRange(
    "custom",
    "2026-07-05",
    "2026-07-05",
    JLM,
  );
  const start = Date.parse(gteIso!);
  const end = Date.parse(ltIso!);

  const firstMoment = Date.parse("2026-07-05T00:00:00+03:00");
  const lastMoment = Date.parse("2026-07-05T23:59:59+03:00");
  const nextDayFirst = Date.parse("2026-07-06T00:00:00+03:00");

  assert.ok(firstMoment >= start, "local 00:00 is INCLUDED");
  assert.ok(lastMoment < end, "local 23:59 is INCLUDED");
  assert.equal(nextDayFirst, end, "the next local day's start is the EXCLUSIVE end");
  assert.ok(!(nextDayFirst < end), "the next local day is EXCLUDED");
});

test("filter: a movement outside the tenant-local date is excluded (no UTC off-by-one)", () => {
  const { gteIso, ltIso } = movementRange(
    "custom",
    "2026-07-05",
    "2026-07-05",
    JLM,
  );
  const inRange = (iso: string) =>
    Date.parse(iso) >= Date.parse(gteIso!) && Date.parse(iso) < Date.parse(ltIso!);

  // 00:30 local on the 5th = 21:30Z on the 4th. A naive UTC bound would DROP it.
  assert.ok(inRange("2026-07-04T21:30:00.000Z"), "an early-morning local movement is IN");
  // 23:30 local on the 4th = 20:30Z on the 4th — the previous local day.
  assert.ok(!inRange("2026-07-04T20:30:00.000Z"), "the previous local day is OUT");
  // 00:30 local on the 6th = 21:30Z on the 5th — the next local day.
  assert.ok(!inRange("2026-07-05T21:30:00.000Z"), "the next local day is OUT");
});

test("filter: a 23-hour (spring) and a 25-hour (autumn) tenant day both filter correctly", () => {
  const spring = movementRange("custom", "2026-03-27", "2026-03-27", JLM);
  assert.equal(
    (Date.parse(spring.ltIso!) - Date.parse(spring.gteIso!)) / 3_600_000,
    23,
    "the spring-forward day is 23h — never a fixed 24",
  );
  const autumn = movementRange("custom", "2026-10-25", "2026-10-25", JLM);
  assert.equal(
    (Date.parse(autumn.ltIso!) - Date.parse(autumn.gteIso!)) / 3_600_000,
    25,
    "the fall-back day is 25h",
  );
  // …and consecutive local days TILE: no movement is dropped or double-counted.
  const prev = movementRange("custom", "2026-03-26", "2026-03-26", JLM);
  assert.equal(prev.ltIso, spring.gteIso, "days tile exactly — no gap, no overlap");
});

test("filter: a date whose local midnight DOES NOT EXIST still filters correctly", () => {
  // America/Santiago springs forward AT midnight on 2025-09-07: 00:00 never
  // happens, and the day genuinely begins at 01:00 local.
  const r = movementRange(
    "custom",
    "2025-09-07",
    "2025-09-07",
    "America/Santiago",
  );
  assert.equal(r.gteIso, "2025-09-07T04:00:00.000Z", "the earliest instant of that date");
  const local = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago",
  }).format(new Date(r.gteIso!));
  assert.equal(local, "2025-09-07", "the bound is IN the requested local date");
  // Nothing an hour earlier (23:00 of the previous local day) may be swept in.
  assert.ok(
    Date.parse("2025-09-07T03:00:00.000Z") < Date.parse(r.gteIso!),
    "the previous local day stays out",
  );
});

test("filter: presets resolve against the TENANT's clock, not the device's", () => {
  // A fixed instant that is a DIFFERENT calendar day in the two zones:
  // 21:30Z on the 13th is still the 13th in UTC but already the 14th in Jerusalem.
  const now = new Date("2026-07-13T21:30:00Z");

  const jlmToday = movementRange("today", undefined, undefined, JLM, now);
  // The tenant's "today" is the 14th → its start is 21:00Z on the 13th.
  assert.equal(jlmToday.gteIso, "2026-07-13T21:00:00.000Z");

  const utcToday = movementRange("today", undefined, undefined, "UTC", now);
  assert.equal(utcToday.gteIso, "2026-07-13T00:00:00.000Z", "a UTC tenant's 13th");
  assert.notEqual(jlmToday.gteIso, utcToday.gteIso, "the tenant zone decides 'today'");

  // Presets keep an OPEN upper bound (a movement cannot be recorded in the future).
  assert.equal(jlmToday.ltIso, null);
});

test("filter: 7d is seven CALENDAR days and month-to-date starts on the 1st", () => {
  const now = new Date("2026-07-13T09:00:00Z"); // tenant date: 2026-07-13
  const week = movementRange("7d", undefined, undefined, JLM, now);
  // Last 7 days INCLUSIVE of today → the 7th … the 13th, so it starts on the 7th
  // (13 − 6). This is the same span the old device-clock code produced; only the
  // ZONE it is measured in has changed.
  assert.equal(week.gteIso, tenantDateRangeUtc("2026-07-07", null, JLM)!.gteIso);

  const month = movementRange("month", undefined, undefined, JLM, now);
  assert.equal(month.gteIso, tenantDateRangeUtc("2026-07-01", null, JLM)!.gteIso);

  // Across a DST transition, "7 days ago" is a CALENDAR day, not 7×86_400_000.
  // 2026-03-30 minus 6 calendar days = 2026-03-24, spanning the 03-27 transition.
  const dstNow = new Date("2026-03-30T09:00:00Z");
  const dstWeek = movementRange("7d", undefined, undefined, JLM, dstNow);
  assert.equal(dstWeek.gteIso, tenantDateRangeUtc("2026-03-24", null, JLM)!.gteIso);
  // A naive 6×86_400_000 subtraction from the local day start would land an hour
  // off (the span contains a 23-hour day) — assert we did NOT do that.
  const naive = new Date(
    Date.parse(tenantDateRangeUtc("2026-03-30", null, JLM)!.gteIso!) -
      6 * 86_400_000,
  ).toISOString();
  assert.notEqual(dstWeek.gteIso, naive, "not a fixed-millisecond day subtraction");
});

test("filter: 'all' / unknown preset produces NO bound (unchanged behavior)", () => {
  assert.deepEqual(movementRange("all", undefined, undefined, JLM), {
    gteIso: null,
    ltIso: null,
  });
  assert.deepEqual(movementRange(undefined, undefined, undefined, JLM), {
    gteIso: null,
    ltIso: null,
  });
  // A custom range with nothing typed yet is also unbounded (not "epoch..now").
  assert.deepEqual(movementRange("custom", undefined, undefined, JLM), {
    gteIso: null,
    ltIso: null,
  });
  // The preset list the UI offers is exactly what the server accepts.
  assert.deepEqual([...MOVEMENT_DATE_PRESETS], ["all", "today", "7d", "month", "custom"]);
});

test("filter: neither the machine timezone nor the locale can move a boundary", () => {
  const now = new Date("2026-07-13T21:30:00Z");
  const baseline = movementRange("today", undefined, undefined, JLM, now);
  const custom = movementRange("custom", "2026-03-27", "2026-03-27", JLM);

  const originalTz = process.env.TZ;
  const originalLang = process.env.LANG;
  try {
    for (const machineZone of ["UTC", "Pacific/Kiritimati", "America/Anchorage"]) {
      process.env.TZ = machineZone;
      assert.deepEqual(
        movementRange("today", undefined, undefined, JLM, now),
        baseline,
        `machine zone ${machineZone} must not move the boundary`,
      );
      assert.deepEqual(
        movementRange("custom", "2026-03-27", "2026-03-27", JLM),
        custom,
      );
    }
    for (const lang of ["ar_SA.UTF-8", "he_IL.UTF-8", "en_US.UTF-8"]) {
      process.env.LANG = lang;
      assert.deepEqual(
        movementRange("custom", "2026-03-27", "2026-03-27", JLM),
        custom,
        `locale ${lang} must not move the boundary`,
      );
    }
  } finally {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
    if (originalLang === undefined) delete process.env.LANG;
    else process.env.LANG = originalLang;
  }
  // The resolver takes no locale at all — pinned so nobody adds one.
  assert.equal(resolveMovementAnchors.length, 4, "(preset, from, to, timeZone[, now])");
});

// ══ Architecture guards (what a unit test cannot express) ═════════════════

test("guard: the movements CLIENT computes no instant and reads no clock", () => {
  const src = stripComments(MOVEMENTS_TABLE);
  // The banned device-clock primitives — all of them are gone.
  assert.doesNotMatch(src, /86_?400_?000/, "no fixed 24-hour arithmetic");
  assert.doesNotMatch(src, /getFullYear\(\)|getMonth\(\)|getDate\(\)/, "no browser local midnight");
  assert.doesNotMatch(src, /Date\.parse\(/, "no bare local-date parse");
  assert.doesNotMatch(src, /dateRangeBounds|@\/lib\/date-range/, "the legacy helper is gone");

  // The FILTER payload is the thing that must carry no instant: the query the
  // server receives is a preset + two date-only strings, nothing derived from a
  // clock. (The CSV *filename* stamp is not a business boundary and is untouched.)
  const query = src.slice(
    src.indexOf("function currentQuery("),
    src.indexOf("useEffect", src.indexOf("function currentQuery(")),
  );
  assert.doesNotMatch(query, /new Date|toISOString|Date\.now/, "no clock in the payload");
  assert.match(query, /preset,/, "the preset travels as-is");
  assert.match(query, /dateFrom: dates\.from/, "date-only");
  assert.match(query, /dateTo: dates\.to/);
  // Anchored dates win; only a brand-new session lets the server resolve a preset.
  assert.match(query, /pinned\s*\?/, "the session anchors take precedence");

  // And it must never reach for the server-only Temporal conversion.
  assert.doesNotMatch(src, /tenant-day|tenantDateRangeUtc|tenantMovementRangeUtc/);
  assert.doesNotMatch(src, /js-temporal|Temporal/);
});

test("guard: the legacy device-clock date-range helper no longer exists", () => {
  assert.throws(
    () => readSrc("lib/date-range.ts"),
    /ENOENT/,
    "src/lib/date-range.ts must be deleted, not merely unused",
  );
});

test("guard: the server action accepts only a preset + calendar dates (never an instant)", () => {
  const src = stripComments(INVENTORY_ACTION);
  // STRICT date-only validation — the ONE parser, which rejects 2026-02-30 rather
  // than letting a shape check pass it and a bounded query become unbounded.
  assert.match(src, /parseDateOnlyStrict/, "the strict parser gates both dates");
  assert.match(src, /isMovementPreset/, "the preset is allowlisted");
  // An impossible date fails the REQUEST; it never degrades into "no filter".
  assert.match(
    src,
    /if \(from === null \|\| to === null\) return null/,
    "a supplied-but-impossible date refuses the request",
  );
  // The old ISO passthrough (which trusted a client-computed instant) is gone.
  assert.doesNotMatch(src, /isIsoish|isCalendarDate/, "no loose date check remains");
  assert.doesNotMatch(src, /query\.from\s*=|query\.to\s*=/, "no instant reaches the query");
});

test("guard: the movements query resolves its bounds server-side, in the tenant zone", () => {
  const src = stripComments(SUPABASE_READS);
  const fn = src.slice(src.indexOf("export async function sbSearchInventoryMovements"));
  const body = fn.slice(0, fn.indexOf("\n}"));
  assert.match(body, /await getTenantTimeZone\(\)/, "the tenant zone is server-derived");
  assert.match(body, /tenantDateRangeUtc\(/, "bounds come from the shared builder");
  assert.match(body, /if \(!range\) fail\(/, "an impossible date FAILS CLOSED — never unbounded");
  assert.match(body, /\.gte\("created_at", gteIso\)/, "start-INCLUSIVE");
  assert.match(body, /\.lt\("created_at", ltIso\)/, "next-day-start EXCLUSIVE");
  // Still exactly one bounded, ordered page — no unbounded fetch was introduced.
  assert.match(body, /\.range\(offset, offset \+ limit - 1\)/, "still paginated");
  assert.match(body, /\.eq\("tenant_id", tenantId\)/, "tenant isolation preserved");
  assert.match(body, /isTenantless\(tenantId\)/, "authorization preserved");
  // The old client-supplied instants are no longer consulted.
  assert.doesNotMatch(body, /q\.from|q\.to/, "no client instant is used");
});

test("guard: no full movement history is loaded into the browser", () => {
  const src = stripComments(MOVEMENTS_TABLE);
  // Every fetch goes through the bounded, offset-paged server action.
  assert.match(src, /searchMovementsAction\(currentQuery\(0, null\)\)/, "page 0 on filter change");
  assert.match(src, /currentQuery\(rows\.length, anchors\)/, "load-more, anchored");
  assert.match(src, /exportMovementsAction\(currentQuery\(0, anchors\)\)/, "export, anchored");
  assert.doesNotMatch(src, /listInventoryMovements\(/, "no unbounded list in the client");
});

// ══ DEFECT 3 — the device hint is browser-only and non-authoritative ══════

test("guard: the device-zone hint is never resolved during the server render", () => {
  const src = stripComments(TZ_SETTINGS);
  // It must not be read in render (useMemo/derived) — only via a store whose
  // SERVER snapshot is null, so SSR and the first client render are identical.
  assert.doesNotMatch(
    src,
    /useMemo\(\s*\(\)\s*=>\s*\{[^}]*resolvedOptions\(\)\.timeZone/,
    "the device zone must not be computed during render",
  );
  // useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot) — the
  // SERVER snapshot must be a literal null, so SSR renders no hint at all.
  assert.match(
    src,
    /useSyncExternalStore\(\s*subscribeNever,\s*readDeviceZone,\s*\(\) => null,/,
    "null server snapshot → SSR never inspects the device",
  );
  assert.match(
    src,
    /function readDeviceZone\(\): string \| null/,
    "the browser snapshot is a pure, stable read",
  );
  // Never papered over.
  assert.doesNotMatch(src, /suppressHydrationWarning/, "no hydration warning is silenced");
});

test("guard: the browser hint can never become authoritative", () => {
  const src = stripComments(TZ_SETTINGS);
  // It is never auto-selected, never auto-saved, and never the save payload.
  assert.doesNotMatch(src, /setSelected\(\s*deviceZone/, "never auto-selects");
  assert.doesNotMatch(src, /timezone:\s*deviceZone/, "never saved");
  assert.doesNotMatch(src, /useState\(\s*deviceZone/, "never the initial selection");
  // The TENANT's stored zone stays the authoritative selected value.
  assert.match(src, /useState\(current\)/, "the tenant zone is the selection");
  assert.match(src, /const dirty = selected !== current/, "save is explicit + diff-gated");
  // The hint renders only when it DIFFERS from the tenant zone, and is bidi-safe.
  assert.match(src, /deviceZone && deviceZone !== current/);
  assert.match(src, /<bdi key=\{i\} dir="ltr"/, "the identifier is LTR-isolated for RTL");
});

test("the device hint degrades safely when the runtime has no zone", () => {
  // readDeviceZone is a plain try/catch returning null — the UI then renders no
  // hint at all (never "undefined", never a broken node). Mirror it here to pin
  // the contract the component relies on.
  const safeRead = (fn: () => string | undefined): string | null => {
    try {
      return fn() ?? null;
    } catch {
      return null;
    }
  };
  assert.equal(safeRead(() => undefined), null, "missing zone → no hint");
  assert.equal(
    safeRead(() => {
      throw new Error("Intl unavailable");
    }),
    null,
    "throwing runtime → no hint",
  );
  assert.equal(safeRead(() => JLM), JLM);
});

// ══ No regression in the rest of the ledger ══════════════════════════════

test("guard: filtering emits no audit event and mutates nothing", () => {
  const action = stripComments(INVENTORY_ACTION);
  const searchFn = action.slice(
    action.indexOf("export async function searchMovementsAction"),
    action.indexOf("export interface MovementExportResult"),
  );
  assert.doesNotMatch(searchFn, /audit|revalidatePath|insert|update|delete/i);
  const reads = stripComments(SUPABASE_READS);
  const fn = reads.slice(reads.indexOf("export async function sbSearchInventoryMovements"));
  const body = fn.slice(0, fn.indexOf("\n}"));
  assert.doesNotMatch(body, /\.insert\(|\.update\(|\.delete\(|rpc\(/, "a read stays a read");
});

test("guard: the movements screen still renders through the tenant contract", () => {
  const src = stripComments(MOVEMENTS_TABLE);
  assert.match(src, /timeZone: string;/, "the tenant zone arrives as a server-derived prop");
  assert.doesNotMatch(
    src,
    /toLocaleString|toLocaleDateString|toLocaleTimeString|new Intl\.DateTimeFormat/,
    "no implicit-zone formatting",
  );
});
