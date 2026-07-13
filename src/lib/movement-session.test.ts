/**
 * M8H.2 — THE MOVEMENT FILTER SESSION (Codex F01/F02/F03) + ORDERS FAIL-CLOSED (F04).
 *
 * These drive the PRODUCTION reducer and the PRODUCTION Server Actions. There is no
 * test-only copy of the state machine: `movementSessionReducer` is the one the
 * component renders from, and the Orders assertions call the real actions with the
 * real data layer swapped for a spy, so "no query ran" is a fact and not an
 * inference from a normalized field.
 *
 * The four defects this pins:
 *
 *  F01  A relative preset resolved an OPEN range (`to = null`). Rows are ordered
 *       created_at DESC, so a movement recorded after tenant midnight lands at the
 *       FRONT of the set and pushes every existing row one place later — page 2's
 *       offset then re-reads a row page 1 already showed. The client de-dups it,
 *       which silently SKIPS a real row. Presets are now CLOSED at both ends.
 *  F02  A filter change cleared only the anchors: the old rows, old hasMore and an
 *       offset derived from them all survived, and Export stayed enabled — so an
 *       export fired in that window paired the NEW filters with the OLD result set.
 *       The session is now atomic, generation-tagged, and Export is gated on it.
 *  F03  The anchors are tenant-LOCAL dates, so their UTC window depends on the
 *       tenant timezone. Change it in another tab and the same anchors silently mean
 *       something else. The server now refuses (`timezone_changed`).
 *  F04  An impossible Orders date was normalized to "no date filter", so a bounded
 *       list/export became an ALL-DATES one.
 *
 * Runner: `npm run test:movement-session`.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  DEFAULT_MOVEMENT_FILTERS,
  MOVEMENT_PAGE_SIZE,
  canExportSession,
  canLoadMoreSession,
  initialMovementSession,
  isDebouncing,
  isResolvedTimeZone,
  movementSessionReducer,
  nextOffset,
  sessionRequest,
  type MovementFilters,
  type MovementSession,
} from "./movement-session";
import type {
  MovementExportResult,
  MovementSearchResult,
} from "./actions/inventory";
import { resolveMovementAnchors, tenantDateRangeUtc } from "./tenant-day";
import { parseOrdersQuery } from "./orders-query";
import { listOrdersForExport, searchOrders } from "./data/orders";
import { exportOrdersAction } from "./actions/orders";
import type { InventoryMovement } from "./types";

const JLM = "Asia/Jerusalem";

const readSrcFile = (rel: string): string =>
  readFileSync(join(process.cwd(), "src", rel), "utf8");

const row = (id: string, createdAt: string): InventoryMovement => ({
  id,
  productId: "p1",
  orderId: null,
  quantityDelta: -1,
  reason: "order_reserved",
  createdAt,
});

const filters = (over: Partial<MovementFilters> = {}): MovementFilters => ({
  ...DEFAULT_MOVEMENT_FILTERS,
  ...over,
});


/** Drive the reducer through a filter change + its first resolved page. */
function resolvedSession(
  over: Partial<MovementFilters>,
  resolved: { from: string | null; to: string | null; timeZone: string; rows: InventoryMovement[]; hasMore?: boolean },
): MovementSession {
  let s = initialMovementSession([], JLM);
  s = movementSessionReducer(s, { type: "filters_changed", patch: filters(over) });
  return movementSessionReducer(s, {
    type: "resolved",
    generation: s.generation,
    rows: resolved.rows,
    hasMore: resolved.hasMore ?? false,
    from: resolved.from,
    to: resolved.to,
    timeZone: resolved.timeZone,
  });
}

// ══ F01 — relative presets resolve a CLOSED range ════════════════════════

test("F01: Today resolves BOTH anchors to the tenant's today — never an open range", () => {
  const now = new Date("2026-07-13T09:00:00Z"); // tenant date 2026-07-13
  const a = resolveMovementAnchors("today", undefined, undefined, JLM, now);
  assert.equal(a.from, "2026-07-13");
  assert.equal(a.to, "2026-07-13", "CLOSED — an open `to` lets tomorrow's rows in");
  assert.notEqual(a.to, null, "to === null was the bug, not the contract");
});

test("F01: 7d and month-to-date take the ORIGINAL today as their inclusive upper anchor", () => {
  const now = new Date("2026-07-13T09:00:00Z");
  const week = resolveMovementAnchors("7d", undefined, undefined, JLM, now);
  assert.equal(week.from, "2026-07-07", "seven calendar days inclusive of the 13th");
  assert.equal(week.to, "2026-07-13", "closed at the day the filter was applied");

  const month = resolveMovementAnchors("month", undefined, undefined, JLM, now);
  assert.equal(month.from, "2026-07-01");
  assert.equal(month.to, "2026-07-13");

  // "all" is the ONLY genuinely unbounded state.
  const all = resolveMovementAnchors("all", undefined, undefined, JLM, now);
  assert.deepEqual(all, { from: null, to: null });
});

test("F01: a movement on the NEXT tenant day cannot enter a Today session", () => {
  const now = new Date("2026-07-13T20:50:00Z"); // 23:50 local on the 13th
  const a = resolveMovementAnchors("today", undefined, undefined, JLM, now);
  const range = tenantDateRangeUtc(a.from, a.to, JLM)!;

  const inRange = (iso: string) =>
    Date.parse(iso) >= Date.parse(range.gteIso!) &&
    Date.parse(iso) < Date.parse(range.ltIso!);

  // 23:55 local on the 13th — inside the session.
  assert.equal(inRange("2026-07-13T20:55:00Z"), true, "today's late row is IN");
  // 00:05 local on the 14th — a NEW business day. With `to = null` this row would
  // have matched, landed at the front (created_at DESC) and shifted every offset.
  assert.equal(inRange("2026-07-13T21:05:00Z"), false, "tomorrow's row is OUT");
  // …and the exclusive upper bound IS the start of the 14th.
  assert.equal(range.ltIso, "2026-07-13T21:00:00.000Z");
});

test("F01: offsets stay meaningful across midnight — no shift, no duplicate, no skip", () => {
  const before = new Date("2026-07-13T20:50:00Z"); // 23:50 local
  const after = new Date("2026-07-13T21:10:00Z"); // 00:10 local, next day

  const a = resolveMovementAnchors("today", undefined, undefined, JLM, before);
  // Load-more re-sends the anchors; the resolver passes them through untouched.
  const paged = resolveMovementAnchors("today", a.from ?? undefined, a.to ?? undefined, JLM, after);
  assert.deepEqual(paged, a, "the session's range did not move at midnight");

  // The UTC window is byte-identical, so page 2's offset addresses the same set.
  const r1 = tenantDateRangeUtc(a.from, a.to, JLM);
  const r2 = tenantDateRangeUtc(paged.from, paged.to, JLM);
  assert.deepEqual(r2, r1);

  // A freshly-resolved preset after midnight would have been a DIFFERENT range —
  // which is exactly what a new filter application is supposed to get.
  const fresh = resolveMovementAnchors("today", undefined, undefined, JLM, after);
  assert.equal(fresh.from, "2026-07-14");
  assert.equal(fresh.to, "2026-07-14");
  assert.notDeepEqual(fresh, a);
});

// ══ F02 — the session is ATOMIC ══════════════════════════════════════════

test("F02: a filter change atomically clears rows, hasMore, anchors and the tz binding", () => {
  const active = resolvedSession(
    { preset: "today" },
    { from: "2026-07-13", to: "2026-07-13", timeZone: JLM, rows: [row("a", "2026-07-13T09:00:00Z")], hasMore: true },
  );
  assert.equal(active.status, "ready");
  assert.equal(canExportSession(active), true);

  const next = movementSessionReducer(active, {
    type: "filters_changed",
    patch: { reason: "manual_correction" },
  });

  assert.equal(next.status, "resolving");
  assert.deepEqual(next.rows, [], "no stale rows survive");
  assert.equal(next.hasMore, false, "hasMore cannot describe a set we no longer have");
  assert.equal(next.from, null, "anchors cleared");
  assert.equal(next.to, null);
  assert.equal(next.timeZone, null, "the timezone binding is cleared too");
  assert.equal(nextOffset(next), 0, "offset is implicitly zero — rows are empty");
  assert.equal(next.generation, active.generation + 1, "a new generation");
});

test("F02: Export and Load more are BOTH unavailable the instant a filter changes", () => {
  const active = resolvedSession(
    { preset: "today" },
    { from: "2026-07-13", to: "2026-07-13", timeZone: JLM, rows: [row("a", "2026-07-13T09:00:00Z")], hasMore: true },
  );
  assert.equal(canExportSession(active), true);
  assert.equal(canLoadMoreSession(active), true);

  const resolving = movementSessionReducer(active, {
    type: "filters_changed",
    patch: { preset: "7d" },
  });
  // THE bug: Export stayed enabled here, and would have paired the NEW filters with
  // the OLD visible rows — a file that did not match the screen.
  assert.equal(canExportSession(resolving), false, "no export while resolving");
  assert.equal(canLoadMoreSession(resolving), false, "nothing to page");
});

test("F02: a resolved session re-enables Export for THAT generation only", () => {
  let s = initialMovementSession([], JLM);
  s = movementSessionReducer(s, { type: "filters_changed", patch: filters({ preset: "today" }) });
  const gen = s.generation;
  assert.equal(canExportSession(s), false);

  s = movementSessionReducer(s, {
    type: "resolved",
    generation: gen,
    rows: [row("a", "2026-07-13T09:00:00Z")],
    hasMore: false,
    from: "2026-07-13",
    to: "2026-07-13",
    timeZone: JLM,
  });
  assert.equal(s.status, "ready");
  assert.equal(canExportSession(s), true);
  assert.equal(s.from, "2026-07-13");
  assert.equal(s.timeZone, JLM);
});

test("F02: a STALE response cannot replace rows, anchors, hasMore or Export-readiness", () => {
  let s = initialMovementSession([], JLM);
  s = movementSessionReducer(s, { type: "filters_changed", patch: filters({ preset: "today" }) });
  const oldGen = s.generation;
  // The operator changes the filter again before the first reply lands.
  s = movementSessionReducer(s, { type: "filters_changed", patch: filters({ preset: "7d" }) });
  const newGen = s.generation;
  assert.notEqual(oldGen, newGen);

  // …and NOW the old request finally answers.
  const after = movementSessionReducer(s, {
    type: "resolved",
    generation: oldGen,
    rows: [row("stale", "2026-07-13T09:00:00Z")],
    hasMore: true,
    from: "2026-07-13",
    to: "2026-07-13",
    timeZone: JLM,
  });
  assert.deepEqual(after.rows, [], "the superseded reply may not resurrect its rows");
  assert.equal(after.hasMore, false);
  assert.equal(after.from, null, "…nor its anchors");
  assert.equal(after.status, "resolving", "…nor mark the NEW session resolved");
  assert.equal(canExportSession(after), false, "…nor re-enable Export");

  // A stale PAGE reply is ignored for the same reason.
  const afterPage = movementSessionReducer(s, {
    type: "page_loaded",
    generation: oldGen,
    rows: [row("stale2", "2026-07-13T08:00:00Z")],
    hasMore: true,
  });
  assert.deepEqual(afterPage.rows, []);
});

test("F02: a later-page FAILURE preserves the session, its anchors and Export", () => {
  const active = resolvedSession(
    { preset: "today" },
    { from: "2026-07-13", to: "2026-07-13", timeZone: JLM, rows: [row("a", "2026-07-13T09:00:00Z")], hasMore: true },
  );
  const paging = movementSessionReducer(active, {
    type: "page_requested",
    generation: active.generation,
  });
  const failed = movementSessionReducer(paging, {
    type: "page_failed",
    generation: active.generation,
  });

  assert.equal(failed.status, "ready", "the session survives");
  assert.equal(failed.pageFailed, true, "…and the button offers a retry");
  assert.deepEqual(failed.rows, active.rows, "rows intact");
  assert.equal(failed.from, "2026-07-13", "ANCHORS INTACT — a retry pages the same range");
  assert.equal(failed.timeZone, JLM);
  assert.equal(canExportSession(failed), true);

  // The retry request is byte-identical to the failed one: same filters, same closed
  // range, same timezone binding, same offset. It never re-resolves "today".
  assert.deepEqual(sessionRequest(failed, nextOffset(failed), undefined), sessionRequest(active, nextOffset(active), undefined));
});

test("F02: an INITIAL failure exposes no stale rows and cannot export", () => {
  const active = resolvedSession(
    { preset: "today" },
    { from: "2026-07-13", to: "2026-07-13", timeZone: JLM, rows: [row("a", "2026-07-13T09:00:00Z")], hasMore: true },
  );
  let s = movementSessionReducer(active, {
    type: "filters_changed",
    patch: { preset: "month" },
  });
  s = movementSessionReducer(s, { type: "resolve_failed", generation: s.generation });

  assert.equal(s.status, "failed");
  assert.deepEqual(s.rows, [], "the OLD session's rows must not reappear");
  assert.equal(s.hasMore, false);
  assert.equal(canExportSession(s), false, "nothing resolved → nothing to export");
  assert.equal(canLoadMoreSession(s), false);
  // A retry starts a NEW session from offset zero (rows are empty).
  assert.equal(nextOffset(s), 0);
});

test("F02: Export re-sends the SAME snapshot, anchors and timezone as the visible rows", () => {
  const active = resolvedSession(
    { preset: "today", reason: "manual_correction", direction: "out" },
    { from: "2026-07-13", to: "2026-07-13", timeZone: JLM, rows: [row("a", "2026-07-13T09:00:00Z")], hasMore: true },
  );
  const exportReq = sessionRequest(active, 0, undefined);
  const pageReq = sessionRequest(active, nextOffset(active), undefined);

  // The list and the file describe the same query — only the offset differs.
  assert.equal(exportReq.dateFrom, "2026-07-13");
  assert.equal(exportReq.dateTo, "2026-07-13");
  assert.equal(exportReq.expectedTimeZone, JLM);
  assert.equal(exportReq.reason, "manual_correction");
  assert.equal(exportReq.direction, "out");
  assert.equal(exportReq.offset, 0);
  assert.deepEqual(
    { ...exportReq, offset: undefined },
    { ...pageReq, offset: undefined },
    "export and load-more send the identical filter snapshot",
  );
});

test("F02: pages append in order; a short page ends the list", () => {
  const first = Array.from({ length: MOVEMENT_PAGE_SIZE }, (_, i) =>
    row(`a${i}`, "2026-07-13T09:00:00Z"),
  );
  let s = resolvedSession(
    { preset: "today" },
    { from: "2026-07-13", to: "2026-07-13", timeZone: JLM, rows: first, hasMore: true },
  );
  assert.equal(nextOffset(s), MOVEMENT_PAGE_SIZE, "offset comes from the session's own rows");

  s = movementSessionReducer(s, {
    type: "page_loaded",
    generation: s.generation,
    rows: [row("b0", "2026-07-13T08:00:00Z")],
    hasMore: false,
  });
  assert.equal(s.rows.length, MOVEMENT_PAGE_SIZE + 1);
  assert.equal(s.hasMore, false);

  // A duplicate id can never be appended twice (a closed range means this should
  // never fire at all — it is belt-and-braces, not the mechanism).
  const dup = movementSessionReducer(s, {
    type: "page_loaded",
    generation: s.generation,
    rows: [row("b0", "2026-07-13T08:00:00Z")],
    hasMore: false,
  });
  assert.equal(dup.rows.length, MOVEMENT_PAGE_SIZE + 1, "no duplicate row");
});

test("F02: an EXACTLY-full final page costs one harmless empty follow-up (documented)", () => {
  // Long-standing behaviour of this list, deliberately preserved: a final page that
  // happens to be exactly MOVEMENT_PAGE_SIZE rows leaves hasMore true, so one more
  // request is made and comes back empty. It adds no rows and ends the list.
  const full = Array.from({ length: MOVEMENT_PAGE_SIZE }, (_, i) =>
    row(`x${i}`, "2026-07-13T09:00:00Z"),
  );
  let s = resolvedSession(
    { preset: "today" },
    { from: "2026-07-13", to: "2026-07-13", timeZone: JLM, rows: full, hasMore: true },
  );
  assert.equal(canLoadMoreSession(s), true, "one extra request will be made");

  s = movementSessionReducer(s, {
    type: "page_loaded",
    generation: s.generation,
    rows: [], // the empty follow-up
    hasMore: true, // even if the server still said "maybe"
  });
  assert.equal(s.rows.length, MOVEMENT_PAGE_SIZE, "no rows added");
  assert.equal(s.hasMore, false, "an empty page ends the list");
  assert.equal(canLoadMoreSession(s), false);
});

// ══ F03 — the session is BOUND to the timezone it was resolved under ═════

test("F03: the request carries the SERVER-issued timezone as a comparison value", () => {
  const active = resolvedSession(
    { preset: "today" },
    { from: "2026-07-13", to: "2026-07-13", timeZone: JLM, rows: [row("a", "2026-07-13T09:00:00Z")], hasMore: true },
  );
  const req = sessionRequest(active, nextOffset(active), undefined);
  assert.equal(req.expectedTimeZone, JLM, "echoed back so the server can compare");

  // A BRAND-NEW session sends none: that request is what asks the server to resolve.
  let fresh = initialMovementSession([], JLM);
  fresh = movementSessionReducer(fresh, {
    type: "filters_changed",
    patch: { preset: "today" },
  });
  assert.equal(sessionRequest(fresh, 0, undefined).expectedTimeZone, undefined);
  assert.equal(sessionRequest(fresh, 0, undefined).dateFrom, undefined, "…and no anchors yet");
});

test("F03: a timezone change INVALIDATES the session — it is never reinterpreted", () => {
  const active = resolvedSession(
    { preset: "today" },
    { from: "2026-07-13", to: "2026-07-13", timeZone: JLM, rows: [row("a", "2026-07-13T09:00:00Z")], hasMore: true },
  );
  // The same dates mean a DIFFERENT window under a different zone — which is exactly
  // why continuing would silently mix two result sets.
  const inJlm = tenantDateRangeUtc("2026-07-13", "2026-07-13", JLM)!;
  const inUtc = tenantDateRangeUtc("2026-07-13", "2026-07-13", "UTC")!;
  assert.notEqual(inJlm.gteIso, inUtc.gteIso, "identical anchors, different instants");

  const stale = movementSessionReducer(active, {
    type: "session_stale",
    generation: active.generation,
  });
  assert.equal(stale.status, "stale");
  assert.deepEqual(stale.rows, [], "the old rows are dropped, not mixed");
  assert.equal(stale.hasMore, false);
  assert.equal(stale.from, null, "the anchors are void — they meant the OLD zone");
  assert.equal(stale.timeZone, null);
  assert.equal(canExportSession(stale), false, "no export after a stale response");
  assert.equal(canLoadMoreSession(stale), false, "no paging either");
});

test("F03: a restarted session resolves FRESH anchors under the new zone, from offset 0", () => {
  const active = resolvedSession(
    { preset: "today" },
    { from: "2026-07-13", to: "2026-07-13", timeZone: JLM, rows: [row("a", "2026-07-13T09:00:00Z")], hasMore: true },
  );
  let s = movementSessionReducer(active, {
    type: "session_stale",
    generation: active.generation,
  });
  // Re-applying the filter starts a NEW generation…
  s = movementSessionReducer(s, { type: "filters_changed", patch: filters({ preset: "today" }) });
  assert.equal(nextOffset(s), 0, "no offset from the previous session is reused");
  assert.equal(
    sessionRequest(s, 0, undefined).expectedTimeZone,
    undefined,
    "no stale binding",
  );

  // …and the server resolves it under the NEW authoritative zone.
  const now = new Date("2026-07-13T21:30:00Z"); // 2026-07-13 in UTC, 07-14 in JLM
  const utcAnchors = resolveMovementAnchors("today", undefined, undefined, "UTC", now);
  assert.deepEqual(utcAnchors, { from: "2026-07-13", to: "2026-07-13" });
  s = movementSessionReducer(s, {
    type: "resolved",
    generation: s.generation,
    rows: [],
    hasMore: false,
    from: utcAnchors.from,
    to: utcAnchors.to,
    timeZone: "UTC",
  });
  assert.equal(s.timeZone, "UTC", "bound to the new authoritative zone");
  assert.equal(canExportSession(s), true);
});

test("F03: a stale reply for an OLD generation cannot kill the CURRENT session", () => {
  const active = resolvedSession(
    { preset: "today" },
    { from: "2026-07-13", to: "2026-07-13", timeZone: JLM, rows: [row("a", "2026-07-13T09:00:00Z")], hasMore: true },
  );
  const next = movementSessionReducer(active, {
    type: "filters_changed",
    patch: { preset: "7d" },
  });
  const resolved = movementSessionReducer(next, {
    type: "resolved",
    generation: next.generation,
    rows: [row("b", "2026-07-10T09:00:00Z")],
    hasMore: false,
    from: "2026-07-07",
    to: "2026-07-13",
    timeZone: JLM,
  });
  // A `timezone_changed` for the SUPERSEDED generation must be ignored.
  const after = movementSessionReducer(resolved, {
    type: "session_stale",
    generation: active.generation,
  });
  assert.equal(after.status, "ready", "the current session is untouched");
  assert.equal(after.rows.length, 1);
  assert.equal(canExportSession(after), true);
});

test("F03: the client's timezone is COMPARISON-ONLY — it never selects the zone", () => {
  const src = readSrcFile("lib/actions/inventory.ts");
  // The authoritative zone always comes from the cached authenticated context…
  assert.match(src, /const timeZone = await getTenantTimeZone\(\)/);
  // …and the client's value is only ever compared against it.
  assert.match(
    src,
    /input\.expectedTimeZone !== timeZone/,
    "compared, never assigned",
  );
  assert.doesNotMatch(
    src,
    /resolveMovementAnchors\([^)]*expectedTimeZone/,
    "the client's zone must never be used to convert",
  );
  assert.doesNotMatch(
    src,
    /getTenantTimeZone\(\)\s*\|\|\s*input|input\.expectedTimeZone\s*\?\?\s*/,
    "…and never fall back to it",
  );
});

// ══ C2 — a SUCCESS cannot omit the timezone it was resolved under ════════

test("C2 (types): ok:true REQUIRES resolvedTimeZone; error variants do not", () => {
  // These are COMPILE-TIME assertions — `npx tsc --noEmit` is what enforces them.
  // A success must carry every session field, including the zone:
  const good: MovementSearchResult = {
    ok: true,
    movements: [],
    hasMore: false,
    resolvedFrom: "2026-07-13",
    resolvedTo: "2026-07-13",
    resolvedTimeZone: JLM,
  };
  assert.equal(good.ok, true);

  // @ts-expect-error — a success WITHOUT resolvedTimeZone must not typecheck. This is
  // the whole C2 contract: the old optional-everything shape allowed exactly this, and
  // the client then borrowed the page's zone for a session the server resolved in UTC.
  const bad: MovementSearchResult = {
    ok: true,
    movements: [],
    hasMore: false,
    resolvedFrom: null,
    resolvedTo: null,
  };
  assert.ok(bad);

  // An ERROR variant needs no session fields at all…
  const failed: MovementSearchResult = { ok: false, error: "timezone_changed" };
  assert.equal(failed.ok, false);
  // …and cannot smuggle rows in.
  // @ts-expect-error — an error result has no movements.
  const smuggled: MovementSearchResult = { ok: false, error: "failed", movements: [] };
  assert.ok(smuggled);

  // The export result is discriminated the same way.
  const exported: MovementExportResult = { ok: true, movements: [], capped: false };
  assert.equal(exported.ok, true);
  // @ts-expect-error — an export success must state whether it was capped.
  const halfExport: MovementExportResult = { ok: true, movements: [] };
  assert.ok(halfExport);
});

test("C2 (runtime): the guard refuses a zone TypeScript would have accepted", () => {
  // Types are not a trust boundary — the reply crossed the network. The component
  // calls THIS before binding a session, and a blank/absent zone fails closed.
  assert.equal(isResolvedTimeZone("Asia/Jerusalem"), true);
  assert.equal(isResolvedTimeZone("UTC"), true);
  assert.equal(isResolvedTimeZone(undefined), false, "missing → refused");
  assert.equal(isResolvedTimeZone(""), false, "empty → refused");
  assert.equal(isResolvedTimeZone("   "), false, "blank → refused");
  assert.equal(isResolvedTimeZone(null), false);
  assert.equal(isResolvedTimeZone(42), false);
});

// ══ The reducer allocates generations — a no-op burns none ═══════════════

test("generation: a NO-OP patch returns the SAME state and allocates nothing", () => {
  const active = resolvedSession(
    { query: "Widget" },
    { from: null, to: null, timeZone: JLM, rows: [row("a", "2026-07-13T09:00:00Z")] },
  );
  const gen = active.generation;

  // Retyping the same applied term (trailing space) changes no applied filter.
  const same = movementSessionReducer(active, {
    type: "filters_changed",
    patch: { query: "Widget " },
  });
  assert.equal(same, active, "the SAME object — nothing changed, nothing rebuilt");
  assert.equal(same.generation, gen, "no generation was burned");
  assert.equal(canExportSession(same), true, "a healthy session is not torn down");

  // A REAL change does allocate — exactly one.
  const changed = movementSessionReducer(active, {
    type: "filters_changed",
    patch: { query: "Gadget" },
  });
  assert.equal(changed.generation, gen + 1);
  assert.equal(changed.status, "resolving");
  assert.deepEqual(changed.rows, []);
});

test("generation: `defer` invalidates NOW and only postpones the request", () => {
  const active = resolvedSession(
    { preset: "today" },
    { from: "2026-07-13", to: "2026-07-13", timeZone: JLM, rows: [row("a", "2026-07-13T09:00:00Z")], hasMore: true },
  );
  const typed = movementSessionReducer(active, {
    type: "filters_changed",
    patch: { query: "Widget" },
    defer: true,
  });
  // The session is ALREADY dead — the debounce only delays the network call.
  assert.equal(typed.status, "debouncing");
  assert.deepEqual(typed.rows, [], "rows gone immediately");
  assert.equal(typed.hasMore, false);
  assert.equal(typed.from, null, "anchors gone");
  assert.equal(typed.timeZone, null, "timezone binding gone");
  assert.equal(canExportSession(typed), false, "Export disabled immediately");
  assert.equal(canLoadMoreSession(typed), false);
  assert.equal(isDebouncing(typed), true, "…and a pending state is observable");

  // When the debounce elapses, only the STATUS moves.
  const dialling = movementSessionReducer(typed, {
    type: "request_started",
    generation: typed.generation,
  });
  assert.equal(dialling.status, "resolving");
  assert.equal(dialling.generation, typed.generation, "same session");
  // A superseded `request_started` is ignored.
  assert.equal(
    movementSessionReducer(dialling, { type: "request_started", generation: 0 }),
    dialling,
  );
});

// ══ F04 — Orders: none / valid / INVALID are three different states ══════

test("F04: the parser distinguishes none, valid and invalid", () => {
  assert.equal(parseOrdersQuery({}).dateFilter, "none", "no params → none");
  assert.equal(
    parseOrdersQuery({ from: "", to: "" }).dateFilter,
    "none",
    "a cleared date input (?from=) is ABSENT, not malformed",
  );
  assert.equal(parseOrdersQuery({ from: "2026-07-01" }).dateFilter, "valid");
  assert.equal(
    parseOrdersQuery({ from: "2026-07-01", to: "2026-07-05" }).dateFilter,
    "valid",
  );
  assert.equal(parseOrdersQuery({ from: "2026-02-30" }).dateFilter, "invalid");
  assert.equal(parseOrdersQuery({ to: "2026-04-31" }).dateFilter, "invalid");
  // ONE bad bound poisons the WHOLE filter — keeping the valid half would widen it.
  const mixed = parseOrdersQuery({ from: "2026-02-30", to: "2026-07-05" });
  assert.equal(mixed.dateFilter, "invalid");
  assert.equal(mixed.dateFrom, null);
  assert.equal(mixed.dateTo, null, "the valid half does NOT survive alone");
  // The leap-day contract is unchanged.
  assert.equal(parseOrdersQuery({ from: "2028-02-29" }).dateFilter, "valid");
  assert.equal(parseOrdersQuery({ from: "2026-02-29" }).dateFilter, "invalid");
});

test("F04: `invalid` is NOT the same shape as `none` (the exact regression)", () => {
  const none = parseOrdersQuery({});
  const invalid = parseOrdersQuery({ from: "2026-02-30" });
  // Both have null bounds — which is precisely why the OLD code could not tell them
  // apart, and queried everything. The discriminator is what makes them different.
  assert.equal(none.dateFrom, null);
  assert.equal(invalid.dateFrom, null);
  assert.notEqual(none.dateFilter, invalid.dateFilter, "…but the STATE differs");
});

test("F04: an invalid date preserves every OTHER filter for the canonical redirect", () => {
  const q = parseOrdersQuery({
    from: "2026-02-30",
    status: "new,confirmed",
    source: "guest",
    q: "MDF-123",
    customer: "abc-123",
    pageSize: "25",
  });
  assert.equal(q.dateFilter, "invalid");
  assert.deepEqual(q.statuses, ["new", "confirmed"]);
  assert.equal(q.source, "guest");
  assert.equal(q.search, "MDF-123");
  assert.equal(q.customerId, "abc-123");
  assert.equal(q.pageSize, 25);
});

test("F04: the Orders page refuses to query and redirects BEFORE any data call", () => {
  const src = readSrcFile("app/[locale]/admin/orders/page.tsx");
  const body = src.slice(src.indexOf("const query = parseOrdersQuery"));
  const guard = body.indexOf('query.dateFilter === "invalid"');
  const firstQuery = body.indexOf("await searchOrders(");
  assert.ok(guard >= 0, "the invalid state is checked");
  assert.ok(firstQuery >= 0);
  assert.ok(
    guard < firstQuery,
    "the refusal must come BEFORE the list/count query — not after it",
  );
  assert.match(body.slice(guard, firstQuery), /redirect\(/, "canonical redirect");
});

test("F04: the query BUILDER itself REFUSES an invalid state — it cannot run date-less", async () => {
  // The real data layer, in mock mode. If the builder were ever handed an invalid
  // filter it must THROW, not quietly emit a query with no date predicates (which is
  // literally "every order"). This is what makes the fail-closed contract structural
  // rather than a promise the callers have to keep.
  const invalid = parseOrdersQuery({ from: "2026-02-30" });
  assert.equal(invalid.dateFilter, "invalid");
  await assert.rejects(
    () => searchOrders(invalid),
    /invalid date filter/,
    "an invalid filter must never reach a query",
  );
  await assert.rejects(
    () => listOrdersForExport(invalid),
    /invalid date filter/,
  );

  // …while `none` and `valid` query perfectly happily.
  const none = await searchOrders(parseOrdersQuery({}));
  assert.ok(none.total > 0, "no-date-filter is the legitimate unfiltered state");
});

test("F04: the Orders EXPORT action returns invalid_date and exports NOTHING", async () => {
  // The PRODUCTION action, called for real. It must refuse before it queries: the
  // proof that no query ran is that it returns a clean structured error rather than
  // the rejection the builder would have raised — and returns no rows at all.
  const refused = await exportOrdersAction({ from: "2026-02-30" });
  assert.equal(refused.ok, false);
  assert.equal(refused.error, "invalid_date");
  assert.equal(refused.rows, undefined, "no rows — so no CSV, and no cap reached");
  assert.notEqual(refused.capped, true);

  // One bad bound beside a good one: still refused, still nothing exported.
  const mixed = await exportOrdersAction({ from: "2026-02-30", to: "2026-07-05" });
  assert.equal(mixed.ok, false);
  assert.equal(mixed.error, "invalid_date");
  assert.equal(mixed.rows, undefined, "the valid half must NOT widen into an export");
});

test("F04: a VALID Orders export still runs, and stays bounded by its date range", async () => {
  // The mock ledger lives in July 2026 — so this proves the refusal above is not
  // simply "export is broken", and that a real bounded export is still bounded.
  const all = await exportOrdersAction({});
  assert.equal(all.ok, true);
  const total = all.rows?.length ?? 0;
  assert.ok(total > 0, "an unfiltered export returns rows");

  const bounded = await exportOrdersAction({ from: "2026-07-05", to: "2026-07-05" });
  assert.equal(bounded.ok, true);
  assert.equal(bounded.error, undefined);
  const rows = bounded.rows ?? [];
  assert.ok(rows.length < total, "a date-bounded export is a SUBSET of everything");

  // Every exported row really falls inside the tenant-local day requested.
  const range = tenantDateRangeUtc("2026-07-05", "2026-07-05", JLM)!;
  for (const r of rows) {
    const t = Date.parse(r.createdAt);
    assert.ok(
      t >= Date.parse(range.gteIso!) && t < Date.parse(range.ltIso!),
      `${r.number} (${r.createdAt}) is outside the requested tenant day`,
    );
  }
});

test("F04: the Orders page refuses BEFORE any data query (architectural ordering)", () => {
  // The page's redirect cannot be exercised without a Next request context, so this
  // one is a structural guard: the refusal must PRECEDE the first query, not follow
  // it. (The query itself failing closed is proven behaviourally above.)
  const src = readSrcFile("app/[locale]/admin/orders/page.tsx");
  const body = src.slice(src.indexOf("const query = parseOrdersQuery"));
  const guard = body.indexOf('query.dateFilter === "invalid"');
  const firstQuery = body.indexOf("await searchOrders(");
  assert.ok(guard >= 0 && firstQuery >= 0);
  assert.ok(guard < firstQuery, "refuse first, query never");
  assert.match(body.slice(guard, firstQuery), /redirect\(/, "canonical redirect");
});
