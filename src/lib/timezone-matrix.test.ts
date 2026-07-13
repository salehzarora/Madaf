/**
 * M8H.2 — TIMEZONE BOUNDARY MATRIX.
 *
 * The tenant-local → UTC conversion is the one piece of M8H.2 that can silently
 * mis-file business data: if the start of a local day is off by an hour, orders
 * land on the wrong day in the list, the count and the export. Testing it on
 * Asia/Jerusalem proves nothing about the other 417 zones the Settings picker
 * offers — and it did NOT: the original offset arithmetic was correct for
 * Jerusalem and WRONG for every zone that springs forward AT midnight.
 *
 * So this runs the PRODUCTION conversion over EVERY selectable timezone × EVERY
 * date in a four-year window and asserts the contract exhaustively:
 *
 *   • start(d) is a real instant, and start(d+1) is strictly later
 *   • rendering start(d) in the tenant zone gives back exactly d
 *   • start(d) is the EARLIEST such instant (one ms earlier is a different date)
 *   • the day's exclusive end IS the next day's start → the days TILE the timeline
 *     with no gap and no overlap
 *   • no instant of d is skipped and no instant of d+1 is swept in
 *
 * It deliberately assumes NOTHING about offsets: not that they are whole hours
 * (Kathmandu +05:45), not that DST moves by one hour (Lord Howe 30 min, Troll
 * TWO), not that a local day is 23/24/25 hours (Troll has a 22h and a 26h day),
 * and not that local 00:00 exists at all.
 *
 * Runtime is minutes, not seconds, so it is its OWN script (`test:timezone-matrix`)
 * and is not part of the default `npm test`. `test:tenant-timezone` keeps a fast,
 * representative subset for the normal loop.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { tenantDayStartUtcIso, tenantDateRangeUtc } from "@/lib/tenant-day";
import { nextCalendarDay, TIME_ZONE_OPTIONS } from "@/lib/time";

/** The window under test — four full years, so every zone crosses each of its DST
 * transitions ~4 times (and any zone that only transitions in some years is hit). */
const FIRST_DATE = "2025-01-01";
const LAST_DATE = "2028-12-31";

// Formatters are built ONCE per zone: constructing an Intl.DateTimeFormat is the
// expensive part, and this sweep formats ~1.8M times.
const dateFmt = new Map<string, Intl.DateTimeFormat>();
const timeFmt = new Map<string, Intl.DateTimeFormat>();

/** The local CALENDAR DATE of an instant in a zone — the independent oracle. This
 * is the FORWARD direction (always unambiguous), so it can judge the reverse one. */
function localDate(ms: number, zone: string): string {
  let f = dateFmt.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", { timeZone: zone });
    dateFmt.set(zone, f);
  }
  return f.format(new Date(ms));
}

/** The local wall-clock TIME of an instant in a zone (HH:MM, 24h). */
function localTime(ms: number, zone: string): string {
  let f = timeFmt.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    timeFmt.set(zone, f);
  }
  return f.format(new Date(ms));
}

interface Anomaly {
  zone: string;
  date: string;
  startIso: string;
  localTime: string;
  lengthHours: number;
}

/** Results of the single sweep, shared by the assertions below (the sweep is the
 * expensive part — it runs once and every test reads its findings). */
const failures: string[] = [];
/** Days whose start is NOT local 00:00 → local midnight does not exist there. */
const nonexistentMidnights: Anomaly[] = [];
/** Days that are not 24h long → a transition happened during them. */
const irregularDays: Anomaly[] = [];
let shortest = { hours: Infinity, zone: "", date: "" };
let longest = { hours: -Infinity, zone: "", date: "" };
let caseCount = 0;
let dayCount = 0;
const sweptZones: string[] = [];

const sweepStarted = process.hrtime.bigint();

for (const zone of TIME_ZONE_OPTIONS) {
  sweptZones.push(zone);
  let date = FIRST_DATE;
  let prevStartMs: number | null = null;
  let prevDate = "";

  while (date <= LAST_DATE) {
    caseCount++;
    const startIso = tenantDayStartUtcIso(date, zone);

    // (1) a valid UTC instant, always.
    if (startIso === null) {
      failures.push(`${zone} ${date}: conversion returned null`);
      date = nextCalendarDay(date);
      continue;
    }
    const startMs = Date.parse(startIso);
    if (!Number.isFinite(startMs)) {
      failures.push(`${zone} ${date}: not a valid instant (${startIso})`);
      date = nextCalendarDay(date);
      continue;
    }

    // (6) rendering it back in the tenant zone must produce the REQUESTED date.
    const renderedDate = localDate(startMs, zone);
    if (renderedDate !== date) {
      failures.push(
        `${zone} ${date}: start renders as ${renderedDate} ${localTime(startMs, zone)} (${startIso})`,
      );
    } else if (localDate(startMs - 1, zone) === date) {
      // …and it must be the EARLIEST such instant: 1ms earlier is a different date.
      failures.push(
        `${zone} ${date}: not the earliest instant — 1ms earlier is still ${date}`,
      );
    }

    // The day starts at local 00:00 unless the zone SKIPPED midnight (DST gap).
    const startLocalTime = localTime(startMs, zone);
    if (startLocalTime !== "00:00") {
      nonexistentMidnights.push({
        zone,
        date,
        startIso,
        localTime: startLocalTime,
        lengthHours: 0,
      });
    }

    if (prevStartMs !== null) {
      // (3) strictly later than the previous day's start.
      if (!(startMs > prevStartMs)) {
        failures.push(`${zone} ${date}: start is not after ${prevDate}'s start`);
      }
      // (4)+(5) the PREVIOUS day's exclusive end IS this day's start → exact tiling,
      // and it comes from the SAME builder the Orders query/count/export use.
      const { ltIso } = tenantDateRangeUtc(null, prevDate, zone);
      if (ltIso === null || Date.parse(ltIso) !== startMs) {
        failures.push(
          `${zone} ${prevDate}: exclusive end ${ltIso} ≠ next day's start ${startIso} (gap/overlap)`,
        );
      }
      // (7)+(8) the last millisecond of the previous day still belongs to it, and
      // this day's first instant does NOT.
      if (localDate(startMs - 1, zone) !== prevDate) {
        failures.push(`${zone} ${prevDate}: its final millisecond is not in it`);
      }
      const hours = (startMs - prevStartMs) / 3_600_000;
      dayCount++;
      if (hours !== 24) {
        irregularDays.push({
          zone,
          date: prevDate,
          startIso,
          localTime: startLocalTime,
          lengthHours: hours,
        });
      }
      if (hours < shortest.hours) shortest = { hours, zone, date: prevDate };
      if (hours > longest.hours) longest = { hours, zone, date: prevDate };
    }

    prevStartMs = startMs;
    prevDate = date;
    date = nextCalendarDay(date);
  }
}

const sweepMs = Number(process.hrtime.bigint() - sweepStarted) / 1e6;

test("MATRIX: every selectable timezone × every date 2025-01-01..2028-12-31", () => {
  assert.equal(sweptZones.length, TIME_ZONE_OPTIONS.length);
  assert.ok(TIME_ZONE_OPTIONS.length > 400, "the full catalog is under test");
  assert.ok(caseCount > 600_000, `a real sweep (${caseCount} cases)`);
  assert.deepEqual(
    failures.slice(0, 20),
    [],
    `${failures.length} boundary failure(s) — first 20 shown`,
  );
  assert.equal(failures.length, 0);
  console.log(
    `    ↳ ${sweptZones.length} zones × ${caseCount / sweptZones.length} dates = ` +
      `${caseCount} cases in ${(sweepMs / 1000).toFixed(1)}s — 0 failures`,
  );
});

test("MATRIX: local days are NOT all 23/24/25 hours — and every length tiles exactly", () => {
  // The sweep already proved the tiling. What this pins is that the code makes NO
  // assumption about day length: real zones produce 22h and 26h days.
  assert.ok(irregularDays.length > 0, "DST days must be found");
  assert.ok(shortest.hours < 24 && longest.hours > 24);
  console.log(
    `    ↳ shortest local day ${shortest.hours}h (${shortest.zone} ${shortest.date}), ` +
      `longest ${longest.hours}h (${longest.zone} ${longest.date}), ` +
      `${irregularDays.length} irregular of ${dayCount} days`,
  );
  // Antarctica/Troll moves TWO hours, so a one-hour DST assumption is false.
  const troll = irregularDays.filter((d) => d.zone === "Antarctica/Troll");
  assert.ok(troll.length > 0, "Antarctica/Troll transitions in range");
  assert.ok(
    troll.some((d) => d.lengthHours === 22),
    "Antarctica/Troll has a 22-hour day (a 2-hour spring forward)",
  );
  assert.ok(
    troll.some((d) => d.lengthHours === 26),
    "Antarctica/Troll has a 26-hour day (a 2-hour fall back)",
  );
  // Lord Howe moves THIRTY minutes → 23.5h / 24.5h days.
  const lordHowe = irregularDays.filter((d) => d.zone === "Australia/Lord_Howe");
  assert.ok(
    lordHowe.some((d) => d.lengthHours === 23.5),
    "Australia/Lord_Howe has a 23.5-hour day (a 30-minute DST step)",
  );
  assert.ok(
    lordHowe.some((d) => d.lengthHours === 24.5),
    "Australia/Lord_Howe has a 24.5-hour day",
  );
});

test("MATRIX: DISCOVERED zones/dates where local midnight does not exist", () => {
  // Not hardcoded: these are whatever the sweep FOUND. Every one of them is a date
  // whose first instant is NOT 00:00 — the exact case the old offset math got wrong
  // (it returned 23:00 of the PREVIOUS day, filing an hour under the wrong date).
  assert.ok(
    nonexistentMidnights.length > 0,
    "the range must contain zones that spring forward AT midnight",
  );
  const zones = [...new Set(nonexistentMidnights.map((a) => a.zone))].sort();
  console.log(
    `    ↳ ${nonexistentMidnights.length} nonexistent local midnights in ${zones.length} zone(s): ${zones.join(", ")}`,
  );
  // Each one resolves to the EARLIEST instant that really belongs to that date
  // (its local time is later than 00:00, and one ms earlier is the previous date).
  for (const a of nonexistentMidnights) {
    const ms = Date.parse(a.startIso);
    assert.equal(localDate(ms, a.zone), a.date, `${a.zone} ${a.date} start is in-date`);
    assert.notEqual(
      localDate(ms - 1, a.zone),
      a.date,
      `${a.zone} ${a.date} start is the earliest in-date instant`,
    );
    assert.ok(a.localTime > "00:00", `${a.zone} ${a.date} starts at ${a.localTime}`);
  }
});

test("MATRIX: non-hour offsets — Kathmandu, Lord Howe, Chatham", () => {
  // A zone whose offset is not a whole number of hours breaks any code that thinks
  // in hours. These are asserted explicitly because they are the classic failures.
  // The UTC instant must keep the :15 / :30 minutes — any hour rounding shows up here.
  const NON_HOUR: Array<[zone: string, date: string, expectedIso: string]> = [
    // Nepal is a permanent +05:45 → the local day begins at 18:15Z the day before.
    ["Asia/Kathmandu", "2026-07-13", "2026-07-12T18:15:00.000Z"],
    ["Asia/Katmandu", "2026-07-13", "2026-07-12T18:15:00.000Z"], // ICU's spelling
    // Pacific/Chatham is +12:45 (NZ winter) and +13:45 (NZ summer) — non-hour AND DST.
    ["Pacific/Chatham", "2026-07-13", "2026-07-12T11:15:00.000Z"],
    ["Pacific/Chatham", "2026-12-13", "2026-12-12T10:15:00.000Z"],
    // Australia/Lord_Howe is +10:30 / +11:00 — a THIRTY-minute DST step.
    ["Australia/Lord_Howe", "2026-07-13", "2026-07-12T13:30:00.000Z"],
    ["Australia/Lord_Howe", "2026-12-13", "2026-12-12T13:00:00.000Z"],
  ];
  for (const [zone, date, expectedIso] of NON_HOUR) {
    const iso = tenantDayStartUtcIso(date, zone);
    assert.equal(iso, expectedIso, `${zone} ${date}`);
    const ms = Date.parse(expectedIso);
    assert.equal(localDate(ms, zone), date, `${zone} ${date} renders as itself`);
    assert.equal(localTime(ms, zone), "00:00", `${zone} ${date} starts at local 00:00`);
  }

  // Every one of these must be REACHABLE from the Settings picker. Nepal is the
  // documented ICU-vs-IANA difference: ECMA-402 hands us ICU's canonical spelling
  // (`Asia/Katmandu`), while IANA/PostgreSQL prefer `Asia/Kathmandu`. Both name the
  // same +05:45 zone and both are accepted by the database, so we assert the ZONE is
  // offered under whichever spelling this runtime canonicalizes to — rather than
  // pretending the catalogs are identical.
  assert.ok(
    TIME_ZONE_OPTIONS.some((z) => z === "Asia/Kathmandu" || z === "Asia/Katmandu"),
    "the +05:45 Nepal zone is selectable under the runtime's canonical spelling",
  );
  assert.ok(TIME_ZONE_OPTIONS.includes("Pacific/Chatham"));
  assert.ok(TIME_ZONE_OPTIONS.includes("Australia/Lord_Howe"));
});

test("MATRIX: the conversion ignores the MACHINE timezone (process.env.TZ)", () => {
  const original = process.env.TZ;
  const probes: Array<[string, string]> = [
    ["Asia/Jerusalem", "2026-03-27"],
    ["America/Santiago", "2025-09-07"],
    ["Pacific/Chatham", "2026-12-13"],
    ["UTC", "2026-07-05"],
  ];
  const baseline = probes.map(([z, d]) => tenantDayStartUtcIso(d, z));
  try {
    for (const machineZone of ["UTC", "Pacific/Kiritimati", "America/Anchorage"]) {
      process.env.TZ = machineZone;
      const got = probes.map(([z, d]) => tenantDayStartUtcIso(d, z));
      assert.deepEqual(
        got,
        baseline,
        `the result changed when the machine zone was ${machineZone}`,
      );
    }
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
});

test("MATRIX: locale cannot move an instant, and the conversion is deterministic", () => {
  // The tenant's LANGUAGE and the tenant's TIMEZONE are independent axes: an Arabic
  // UI in Asia/Jerusalem is normal. The conversion takes no locale at all — pinned
  // here so nobody "helpfully" adds one.
  assert.equal(tenantDayStartUtcIso.length, 2, "(dateStr, timeZone) — no locale");
  const original = process.env.LANG;
  try {
    const first = tenantDayStartUtcIso("2026-03-27", "Asia/Jerusalem");
    for (const lang of ["ar_SA.UTF-8", "he_IL.UTF-8", "en_US.UTF-8"]) {
      process.env.LANG = lang;
      assert.equal(tenantDayStartUtcIso("2026-03-27", "Asia/Jerusalem"), first);
    }
    // Repeated calls are identical (no clock, no randomness, no cached mutable state).
    for (let i = 0; i < 5; i++) {
      assert.equal(tenantDayStartUtcIso("2026-03-27", "Asia/Jerusalem"), first);
    }
    assert.equal(first, "2026-03-26T22:00:00.000Z");
  } finally {
    if (original === undefined) delete process.env.LANG;
    else process.env.LANG = original;
  }
});

test("MATRIX: the four zones the old offset math got WRONG are now right", () => {
  // Regression pins. Each of these springs forward AT midnight, so local 00:00 does
  // not exist and the day really begins at 01:00. The previous implementation
  // returned 23:00 of the day BEFORE — an hour of the previous day would have been
  // counted, listed and exported under this date.
  const FIXED: Array<[string, string, string]> = [
    ["America/Santiago", "2025-09-07", "2025-09-07T04:00:00.000Z"],
    ["America/Havana", "2025-03-09", "2025-03-09T05:00:00.000Z"],
    ["America/Asuncion", "2025-10-05", "2025-10-05T04:00:00.000Z"],
    ["Atlantic/Azores", "2025-03-30", "2025-03-30T01:00:00.000Z"],
  ];
  for (const [zone, date, expected] of FIXED) {
    assert.equal(tenantDayStartUtcIso(date, zone), expected, `${zone} ${date}`);
    const ms = Date.parse(expected);
    assert.equal(localDate(ms, zone), date, "renders as the requested date");
    assert.equal(localTime(ms, zone), "01:00", "the day begins at 01:00 — 00:00 never happens");
    assert.notEqual(localDate(ms - 1, zone), date, "and it is the earliest such instant");
  }
});
