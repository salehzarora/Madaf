/**
 * M8H.2 — THE TENANT BUSINESS DAY (Codex M8H2-01, M8H2-02, M8H2-04, M8H2-05).
 *
 * Four defects shared one root cause: something other than the tenant's calendar
 * decided what "today" and "this month" meant.
 *
 *  M8H2-04  The Dashboard asked in UTC (`new Date().toISOString().slice(0, 10)`,
 *           `createdAt.slice(0, 10)`), and inventory expiry anchored on a UTC today.
 *           For the hours between the tenant's midnight and UTC's, the KPI cards
 *           disagreed with the timestamps printed right next to them.
 *  M8H2-01  The movements ledger re-resolved "today" on EVERY request while paging by
 *           OFFSET, so a session that crossed midnight paged into a different result
 *           set — skipping rows, repeating others, and exporting a range nobody saw.
 *  M8H2-02  Fixed-offset aliases (`Etc/GMT+3`, `EST`) were storable, and none of them
 *           can express DST.
 *  M8H2-05  The 418-zone catalog was rebuilt in eight client chunks.
 *
 * The reference instant throughout is **2026-08-31T21:30:00Z**, which is
 * **2026-09-01** in Asia/Jerusalem: a different day, a different MONTH, and a
 * different trend bucket than UTC says.
 *
 * Runner: `npm run test:tenant-business-day`.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  isApprovedTenantTimeZone,
  resolveTenantTimeZone,
  tenantDateKey,
  tenantMonthKey,
  tenantToday,
} from "./time";
import { TIME_ZONE_OPTIONS } from "./time-catalog";
import { resolveMovementAnchors, tenantDateRangeUtc } from "./tenant-day";

const JLM = "Asia/Jerusalem";
const NYC = "America/New_York";
const KTM = "Asia/Katmandu"; // +05:45 — a non-hour offset
const readSrc = (rel: string): string =>
  readFileSync(join(process.cwd(), "src", rel), "utf8");
const stripComments = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/** The month-rollover instant: 21:30Z on Aug 31 is already Sept 1 in Jerusalem. */
const ROLLOVER = "2026-08-31T21:30:00.000Z";

// ══ M8H2-04 — the tenant business day ════════════════════════════════════

test("business day: 2026-08-31T21:30Z is 2026-09-01 for the tenant (not August)", () => {
  assert.equal(tenantDateKey(ROLLOVER, JLM), "2026-09-01", "the DAY rolled over");
  assert.equal(tenantMonthKey(ROLLOVER, JLM), "2026-09", "…and so did the MONTH");
  // The raw UTC prefixes — what the Dashboard used to group by — say August.
  assert.equal(ROLLOVER.slice(0, 10), "2026-08-31", "the UTC prefix disagrees");
  assert.equal(ROLLOVER.slice(0, 7), "2026-08");
  assert.notEqual(tenantDateKey(ROLLOVER, JLM), ROLLOVER.slice(0, 10));
});

test("business day: a UTC tenant still sees August 31 for that same instant", () => {
  assert.equal(tenantDateKey(ROLLOVER, "UTC"), "2026-08-31");
  assert.equal(tenantMonthKey(ROLLOVER, "UTC"), "2026-08");
  // …and a western zone is even further back — the key is the ZONE, not the clock.
  assert.equal(tenantDateKey(ROLLOVER, NYC), "2026-08-31");
  // A non-hour offset resolves correctly too: 21:30Z + 05:45 = 03:15 on Sept 1.
  assert.equal(tenantDateKey(ROLLOVER, KTM), "2026-09-01");
});

test("business day: a WINTER instant rolls over on the tenant's +02, not +03", () => {
  // 22:30Z on Jan 31 is 00:30 on Feb 1 in Jerusalem (+02 in winter).
  assert.equal(tenantDateKey("2026-01-31T22:30:00Z", JLM), "2026-02-01");
  assert.equal(tenantMonthKey("2026-01-31T22:30:00Z", JLM), "2026-02");
  // …but 21:30Z is still Jan 31 (23:30 local) — a fixed +03 would wrongly say Feb 1.
  assert.equal(tenantDateKey("2026-01-31T21:30:00Z", JLM), "2026-01-31");
  // In SUMMER (+03) the same 21:30Z wall clock DOES roll over. Same instant-of-day,
  // different answer — which is exactly what a fixed offset cannot express.
  assert.equal(tenantDateKey("2026-08-31T21:30:00Z", JLM), "2026-09-01");
});

test("business day: DASHBOARD grouping — today, month and trend bucket all agree", () => {
  // Reproduce the Dashboard's three business-date computations over a set of orders
  // spanning the tenant's midnight, using the production helpers it now calls.
  const orders = [
    { id: "a", createdAt: "2026-08-31T20:59:00Z", total: 100 }, // 23:59 local, Aug 31
    { id: "b", createdAt: ROLLOVER, total: 200 }, // 00:30 local, Sept 1
    { id: "c", createdAt: "2026-09-01T06:00:00Z", total: 300 }, // 09:00 local, Sept 1
  ];
  const today = tenantToday(JLM, new Date("2026-09-01T06:30:00Z")); // 09:30 local
  assert.equal(today, "2026-09-01");

  // "Today" — the UTC version would have counted only `c`, missing the 00:30 order.
  const todayOrders = orders.filter((o) => tenantDateKey(o.createdAt, JLM) === today);
  assert.deepEqual(todayOrders.map((o) => o.id), ["b", "c"]);
  assert.equal(todayOrders.reduce((s, o) => s + o.total, 0), 500, "today's value");

  // Month-to-date — `b` belongs to SEPTEMBER, though its UTC prefix says August.
  const monthPrefix = today.slice(0, 7);
  assert.equal(monthPrefix, "2026-09");
  const monthOrders = orders.filter((o) =>
    tenantDateKey(o.createdAt, JLM).startsWith(monthPrefix),
  );
  assert.deepEqual(monthOrders.map((o) => o.id), ["b", "c"]);
  // The old raw-prefix test would have put `b` in August:
  assert.ok(orders[1].createdAt.startsWith("2026-08"), "the UTC string says August");

  // Trend buckets — `b` belongs to the Sept 1 bar, not the Aug 31 one.
  const byDay = new Map<string, number>();
  for (const o of orders) {
    const day = tenantDateKey(o.createdAt, JLM);
    byDay.set(day, (byDay.get(day) ?? 0) + o.total);
  }
  assert.deepEqual([...byDay.entries()], [
    ["2026-08-31", 100],
    ["2026-09-01", 500],
  ]);
});

test("business day: INVENTORY EXPIRY anchors on the tenant's today, date-only", () => {
  // The anchor is tenant-local…
  const today = tenantToday(JLM, new Date(ROLLOVER));
  assert.equal(today, "2026-09-01", "the tenant's today, not UTC's Aug 31");

  // …and the classification stays DATE-ONLY: expiry_date is a SQL `date`, so it is
  // compared as a calendar ordinal and never timezone-shifted. (This mirrors
  // inventory-table's horizon arithmetic exactly.)
  const HORIZON_DAYS = 21;
  const horizon =
    new Date(today).getTime() + HORIZON_DAYS * 24 * 60 * 60 * 1000;
  const expiringSoon = (expiry: string) => new Date(expiry).getTime() <= horizon;

  assert.equal(expiringSoon("2026-09-01"), true, "expiring today");
  assert.equal(expiringSoon("2026-09-22"), true, "the last day of the horizon");
  assert.equal(expiringSoon("2026-09-23"), false, "just past the horizon");

  // With the OLD UTC anchor the horizon started a day earlier, so a batch expiring
  // exactly on the boundary flipped class for the hours around midnight.
  const utcToday = ROLLOVER.slice(0, 10); // 2026-08-31
  assert.notEqual(utcToday, today);
  const utcHorizon =
    new Date(utcToday).getTime() + HORIZON_DAYS * 24 * 60 * 60 * 1000;
  assert.equal(
    new Date("2026-09-22").getTime() <= utcHorizon,
    false,
    "the UTC anchor would have MISSED a batch expiring inside the tenant's horizon",
  );

  // The date-only value itself is never shifted by any zone.
  assert.equal(tenantDateKey("2026-09-01T00:00:00Z", "UTC"), "2026-09-01");
});

test("business day: neither the machine timezone nor the locale can move a key", () => {
  const originalTz = process.env.TZ;
  const originalLang = process.env.LANG;
  try {
    for (const machine of ["UTC", "Pacific/Kiritimati", "America/Anchorage"]) {
      process.env.TZ = machine;
      assert.equal(tenantDateKey(ROLLOVER, JLM), "2026-09-01", machine);
      assert.equal(tenantMonthKey(ROLLOVER, JLM), "2026-09", machine);
      assert.equal(
        tenantToday(JLM, new Date(ROLLOVER)),
        "2026-09-01",
        machine,
      );
    }
    for (const lang of ["ar_SA.UTF-8", "he_IL.UTF-8", "en_US.UTF-8"]) {
      process.env.LANG = lang;
      // The key is a KEY, not a display string — no locale digits, no locale order.
      assert.equal(tenantDateKey(ROLLOVER, JLM), "2026-09-01", lang);
    }
  } finally {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
    if (originalLang === undefined) delete process.env.LANG;
    else process.env.LANG = originalLang;
  }
});

test("business day: an invalid instant or zone fails safely", () => {
  assert.equal(tenantDateKey("not-a-date", JLM), "", "never 'Invalid Date'");
  assert.equal(tenantDateKey("", JLM), "");
  // An unstorable zone falls back to UTC (logged) — never the machine's zone.
  assert.equal(tenantDateKey(ROLLOVER, "Not/AZone"), "2026-08-31");
});

test("guard: the Dashboard and inventory pages no longer ask in UTC", () => {
  const dash = stripComments(readSrc("app/[locale]/admin/page.tsx"));
  assert.doesNotMatch(dash, /toISOString\(\)\.slice/, "no UTC today/month prefix");
  assert.doesNotMatch(dash, /createdAt\.slice\(0, ?10\)/, "no UTC day bucket");
  assert.doesNotMatch(dash, /createdAt\.startsWith\(/, "no UTC month bucket");
  assert.match(dash, /tenantToday\(timeZone\)/, "tenant today");
  assert.match(dash, /tenantDateKey\(o\.createdAt, timeZone\)/, "tenant day buckets");

  const inv = stripComments(readSrc("app/[locale]/admin/inventory/page.tsx"));
  assert.doesNotMatch(inv, /toISOString\(\)\.slice/, "no UTC expiry anchor");
  assert.match(inv, /tenantToday\(timeZone\)/, "the expiry anchor is tenant-local");
});

// ══ M8H2-01 — the movements filter session is ANCHORED ═══════════════════

test("anchors: 'today' resolves ONCE, and the anchored range survives midnight", () => {
  // 23:50 local on the tenant's Sept 1 — the session starts here.
  const beforeMidnight = new Date("2026-09-01T20:50:00Z");
  const first = resolveMovementAnchors("today", undefined, undefined, JLM, beforeMidnight);
  assert.equal(first.from, "2026-09-01", "resolved against the TENANT's clock");
  assert.equal(first.to, "2026-09-01", "CLOSED — tomorrow's rows cannot enter (F01)");

  // The tenant's midnight passes. Page 2 is requested at 00:10 local (Sept 2).
  const afterMidnight = new Date("2026-09-01T21:10:00Z");
  assert.equal(
    tenantToday(JLM, afterMidnight),
    "2026-09-02",
    "the tenant's day HAS rolled over",
  );

  // Load-more sends the SESSION'S ANCHORS back — so the range does not move.
  const page2 = resolveMovementAnchors(
    "today", // the label is still "Today"…
    first.from ?? undefined, // …but the concrete anchor wins
    first.to ?? undefined,
    JLM,
    afterMidnight,
  );
  assert.deepEqual(page2, first, "page 2 pages the SAME range page 1 came from");

  // Had it re-resolved, page 2's offset would have been applied to a DIFFERENT
  // result set — rows skipped, rows repeated, hasMore meaningless.
  const drifted = resolveMovementAnchors("today", undefined, undefined, JLM, afterMidnight);
  assert.equal(drifted.from, "2026-09-02");
  assert.notEqual(drifted.from, first.from, "…which is exactly the drift we prevent");
});

test("anchors: the UTC BOUNDS of an anchored session are byte-identical across midnight", () => {
  const before = new Date("2026-09-01T20:50:00Z");
  const after = new Date("2026-09-01T21:10:00Z");
  const a = resolveMovementAnchors("today", undefined, undefined, JLM, before);

  const page1 = tenantDateRangeUtc(a.from, a.to, JLM);
  const anchored = resolveMovementAnchors("today", a.from ?? undefined, a.to ?? undefined, JLM, after);
  const page2 = tenantDateRangeUtc(anchored.from, anchored.to, JLM);
  assert.deepEqual(page2, page1, "the same UTC window → offsets remain meaningful");
  // hasMore and the CSV export are computed from these same bounds.
  assert.equal(page1?.gteIso, "2026-08-31T21:00:00.000Z");
});

test("anchors: EXPORT uses the session's anchors, not a fresh resolution", () => {
  const before = new Date("2026-09-01T20:50:00Z");
  const after = new Date("2026-09-01T21:10:00Z");
  const session = resolveMovementAnchors("today", undefined, undefined, JLM, before);

  // The export request carries the anchors (exactly as the client sends them).
  const exportAnchors = resolveMovementAnchors(
    "today",
    session.from ?? undefined,
    session.to ?? undefined,
    JLM,
    after,
  );
  assert.deepEqual(
    exportAnchors,
    session,
    "the file covers the days the operator was looking at",
  );
});

test("anchors: 7d and month-to-date are anchored too", () => {
  const before = new Date("2026-09-01T20:50:00Z");
  const after = new Date("2026-09-01T21:10:00Z");

  const week = resolveMovementAnchors("7d", undefined, undefined, JLM, before);
  // Aug 26 … Sept 1 inclusive is seven calendar days (Sept 1 minus 6).
  assert.equal(week.from, "2026-08-26", "7 CALENDAR days inclusive of Sept 1");
  assert.equal(week.to, "2026-09-01", "closed at the day the filter was applied");
  assert.deepEqual(
    resolveMovementAnchors("7d", week.from ?? undefined, week.to ?? undefined, JLM, after),
    week,
    "…and it does not slide to 08-27 after midnight",
  );

  const month = resolveMovementAnchors("month", undefined, undefined, JLM, before);
  assert.equal(month.from, "2026-09-01", "month-to-date starts on the 1st");
  assert.equal(month.to, "2026-09-01", "…and is closed at today");
  assert.deepEqual(
    resolveMovementAnchors("month", month.from ?? undefined, month.to ?? undefined, JLM, after),
    month,
  );
  // A month rollover is the harshest case: resolved fresh on Aug 31 it would be
  // August's 1st; the anchored session stays on the month it was opened in.
  const inAugust = resolveMovementAnchors(
    "month",
    undefined,
    undefined,
    JLM,
    new Date("2026-08-31T20:00:00Z"), // 23:00 local, Aug 31
  );
  assert.equal(inAugust.from, "2026-08-01");
  assert.deepEqual(
    resolveMovementAnchors("month", inAugust.from ?? undefined, inAugust.to ?? undefined, JLM, after),
    inAugust,
    "an August session does not become a September one under the operator",
  );
});

test("anchors: a CUSTOM range is already concrete and never re-resolved", () => {
  const custom = resolveMovementAnchors(
    "custom",
    "2026-07-01",
    "2026-07-05",
    JLM,
    new Date("2026-09-01T21:10:00Z"),
  );
  assert.deepEqual(custom, { from: "2026-07-01", to: "2026-07-05" });
  // The clock is irrelevant to it.
  assert.deepEqual(
    resolveMovementAnchors("custom", "2026-07-01", "2026-07-05", JLM, new Date(0)),
    custom,
  );
});

test("anchors: 'all' stays unbounded, and a NEW filter after midnight re-resolves", () => {
  assert.deepEqual(
    resolveMovementAnchors("all", undefined, undefined, JLM, new Date(ROLLOVER)),
    { from: null, to: null },
  );
  // A NEWLY applied "Today" (no anchors sent — the client cleared them on the filter
  // change) correctly picks up the NEW tenant date.
  const fresh = resolveMovementAnchors(
    "today",
    undefined,
    undefined,
    JLM,
    new Date("2026-09-01T21:10:00Z"),
  );
  assert.equal(fresh.from, "2026-09-02", "a new session gets the new day");
});

test("guard: the client drives the SESSION REDUCER — no ad-hoc anchor state", () => {
  const src = stripComments(readSrc("components/admin/movements-table.tsx"));
  // The component owns the I/O; the reducer owns every transition. That is what
  // makes the atomicity testable (and what the behavioural suite actually drives).
  assert.match(src, /useReducer\(\s*movementSessionReducer/, "the production reducer");
  assert.match(src, /initialMovementSession\(initialMovements, timeZone\)/);
  assert.match(src, /dispatch\(\{ type: "filters_changed", filters \}\)/, "atomic reset");
  assert.match(
    src,
    /timeZone: result\.resolvedTimeZone \?\? timeZone/,
    "the SERVER's resolved zone binds the session",
  );
  // Load-more and export both re-send the session's own snapshot + anchors + zone.
  assert.match(src, /sessionRequest\(active, nextOffset\(active\)\)/, "load-more, anchored");
  assert.match(src, /exportMovementsAction\(sessionRequest\(active, 0\)\)/, "export, anchored");
  // …and both are GATED on a resolved session.
  assert.match(src, /if \(!canExportSession\(active\)\) return/, "export gated");
  assert.match(src, /if \(!canLoadMoreSession\(active\)\) return/, "load-more gated");
  // A `timezone_changed` reply invalidates rather than reinterprets.
  assert.match(src, /dispatch\(\{ type: "session_stale"/, "stale → invalidate");
  // The old hand-rolled anchor state is gone.
  assert.doesNotMatch(src, /setAnchors|const \[anchors/, "no ad-hoc anchor state");
});

test("guard: the action returns the resolved anchors and refuses impossible dates", () => {
  const src = stripComments(readSrc("lib/actions/inventory.ts"));
  assert.match(src, /resolvedFrom: resolved\.anchors\.from/, "anchors are returned");
  assert.match(src, /resolvedTo: resolved\.anchors\.to/);
  assert.match(src, /resolvedTimeZone: resolved\.timeZone/, "…and the zone they bind to");
  assert.match(src, /parseDateOnlyStrict/, "dates are STRICTLY validated");
  // Both refusals happen WITHOUT querying: the resolver returns an error string and
  // the action returns it verbatim.
  assert.match(
    src,
    /if \(typeof resolved === "string"\) return \{ ok: false, error: resolved \}/,
    "an impossible date or a changed timezone FAILS the request — no query runs",
  );
  assert.match(src, /return "invalid_date"/, "impossible date");
  assert.match(src, /return "timezone_changed"/, "session bound to its zone");
  // Search AND export both go through the same resolver, so they cannot disagree.
  const uses = src.match(/await resolveMovementFilter\(input\)/g);
  assert.equal(uses?.length, 2, "search + export share one resolution");
});

// ══ M8H2-02 — the stored-timezone contract ═══════════════════════════════

test("timezones: UTC and real Region/City zones are ACCEPTED", () => {
  for (const z of [
    "UTC",
    "Asia/Jerusalem",
    "America/New_York",
    "Europe/London",
    "Asia/Katmandu",
    "Asia/Kathmandu",
    "Australia/Lord_Howe",
    "Pacific/Chatham",
    "America/Argentina/La_Rioja", // multi-segment
    "America/Port-au-Prince", // hyphens
    "Africa/Abidjan", // a real zone that observes NO DST — still valid
  ]) {
    assert.equal(isApprovedTenantTimeZone(z), true, z);
    assert.equal(resolveTenantTimeZone(z), z, `${z} must not fall back`);
  }
});

test("timezones: fixed offsets and legacy aliases are REJECTED", () => {
  for (const z of [
    "+03:00",
    "-0500",
    "UTC+2",
    "GMT-5",
    "Etc/GMT+3", // POSIX-signed: actually UTC-3
    "Etc/GMT-2",
    "Etc/UTC",
    "Etc/GMT",
    "EST",
    "HST",
    "MST",
    "EST5EDT",
    "CST6CDT",
    "GMT",
    "Factory",
    "posix/America/New_York",
    "right/UTC",
    "US/Eastern", // a legacy alias namespace
    "Mars/Olympus",
    "",
    "   ",
    null,
    undefined,
    42,
  ]) {
    assert.equal(isApprovedTenantTimeZone(z as string), false, JSON.stringify(z));
    // …and a stored one would render as UTC (logged), never as the machine's zone.
    assert.equal(resolveTenantTimeZone(z), "UTC", JSON.stringify(z));
  }
});

test("timezones: Etc/GMT+3 really IS the trap (POSIX sign inversion)", () => {
  // Why this matters, concretely: a tenant reaching for "+3" and getting Etc/GMT+3
  // would run SIX hours off, and never observe DST.
  const inEtc = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Etc/GMT+3",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date("2026-07-13T09:57:00Z"));
  assert.equal(inEtc, "06:57", "Etc/GMT+3 is UTC MINUS 3, not plus");
  // Asia/Jerusalem, the zone actually wanted, is +03 in July.
  const inJlm = new Intl.DateTimeFormat("en-GB", {
    timeZone: JLM,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date("2026-07-13T09:57:00Z"));
  assert.equal(inJlm, "12:57");
  assert.equal(isApprovedTenantTimeZone("Etc/GMT+3"), false, "so it is unstorable");
});

// ══ M8H2-05 — the catalog is server-only and DB-compatible ═══════════════

test("catalog: every offered option satisfies the STORED contract", () => {
  assert.ok(TIME_ZONE_OPTIONS.includes("UTC"), "UTC remains available");
  assert.ok(TIME_ZONE_OPTIONS.includes(JLM));
  assert.ok(TIME_ZONE_OPTIONS.length > 400, "no option was accidentally removed");
  assert.ok(TIME_ZONE_OPTIONS.length < 1000, "bounded — not the ~1200-row pg dump");
  assert.equal(
    new Set(TIME_ZONE_OPTIONS).size,
    TIME_ZONE_OPTIONS.length,
    "no duplicates",
  );
  // The picker and the write path share ONE predicate, so the UI cannot offer a
  // value the Server Action or the database trigger would reject.
  for (const z of TIME_ZONE_OPTIONS) {
    assert.equal(isApprovedTenantTimeZone(z), true, z);
  }
  // …and none of the banned shapes survived the filter.
  for (const z of TIME_ZONE_OPTIONS) {
    assert.ok(!/^(posix|right|Etc|SystemV|US|Brazil|Canada|Chile|Mexico)\//i.test(z), z);
    assert.ok(!z.includes("+"), z);
    assert.ok(z === "UTC" || z.includes("/"), `${z}: Region/City or UTC only`);
  }
});

test("catalog: the CLIENT never rebuilds it — the module is server-only", () => {
  const catalog = readSrc("lib/time-catalog.ts");
  assert.match(catalog, /^import "server-only";/m, "the catalog cannot enter a bundle");
  assert.match(catalog, /Intl\.supportedValuesOf\("timeZone"\)/, "…and it owns the call");

  // The client-safe formatter module must NOT construct the catalog.
  const time = readSrc("lib/time.ts");
  assert.doesNotMatch(
    time,
    /supportedValuesOf/,
    "time.ts is imported by client components — it must not build a 418-entry list",
  );
  assert.doesNotMatch(time, /TIME_ZONE_OPTIONS/, "the catalog does not live here");

  // The Settings page (a Server Component) passes it down as plain props.
  const page = readSrc("app/[locale]/admin/settings/business/page.tsx");
  assert.match(page, /from "@\/lib\/time-catalog"/, "sourced server-side");
  assert.match(page, /options=\{TIME_ZONE_OPTIONS\}/, "handed over as a prop");

  // The client component only RECEIVES options; it never derives them.
  const control = stripComments(readSrc("components/admin/timezone-settings.tsx"));
  assert.doesNotMatch(control, /supportedValuesOf/, "no catalog work in the browser");
  assert.match(control, /options: readonly string\[\]/, "options arrive as a prop");
});

// ══ M8H2-06 — the device hint (deterministic SSR) ════════════════════════

test("device hint: the server snapshot is null, so SSR and first client render agree", () => {
  const src = stripComments(readSrc("components/admin/timezone-settings.tsx"));
  // useSyncExternalStore(subscribe, clientSnapshot, SERVER snapshot) — the server
  // snapshot is a literal null, so the prerendered HTML contains NO hint and cannot
  // announce the SERVER machine's zone as "your device".
  assert.match(
    src,
    /useSyncExternalStore\(\s*subscribeNever,\s*readDeviceZone,\s*\(\) => null,/,
  );
  assert.doesNotMatch(src, /suppressHydrationWarning/, "the logic is fixed, not silenced");
  // The hint can never become authoritative.
  assert.doesNotMatch(src, /setSelected\(\s*deviceZone/, "never auto-selects");
  assert.doesNotMatch(src, /timezone:\s*deviceZone/, "never auto-saves");
  assert.match(src, /useState\(current\)/, "the TENANT zone is the selection");
});

test("device hint: the snapshot pair behaves deterministically", () => {
  // Mirror the component's two snapshots. The server one is a constant; the client
  // one is a pure read that degrades to null. Rendering is therefore:
  //   SSR      → null → no hint
  //   hydrate  → null → identical markup → no mismatch
  //   mounted  → the browser's zone → the hint appears
  const serverSnapshot = () => null;
  const clientSnapshot = (impl: () => string | undefined): string | null => {
    try {
      return impl() ?? null;
    } catch {
      return null;
    }
  };
  assert.equal(serverSnapshot(), null, "SSR shows no hint");
  assert.equal(serverSnapshot(), serverSnapshot(), "…deterministically");
  assert.equal(clientSnapshot(() => JLM), JLM, "post-mount: the browser's zone");
  assert.equal(clientSnapshot(() => undefined), null, "unresolvable → no hint");
  assert.equal(
    clientSnapshot(() => {
      throw new Error("Intl unavailable");
    }),
    null,
    "throwing runtime → no hint, never a broken UI",
  );
  // The hint only shows when it DIFFERS from the tenant's zone.
  const shows = (device: string | null, tenant: string) => !!device && device !== tenant;
  assert.equal(shows(null, JLM), false, "no hint during SSR");
  assert.equal(shows(JLM, JLM), false, "no hint when they agree");
  assert.equal(shows(NYC, JLM), true, "hint when the viewer is elsewhere");
});
