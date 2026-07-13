/**
 * The Inventory-Movements FILTER SESSION (M8H.2) — the production state machine.
 *
 * A "session" is one resolved result set: a canonical filter snapshot, a CLOSED
 * tenant-local date range, the tenant timezone the server resolved it under, the
 * rows fetched so far, and whether more exist. Everything the ledger shows,
 * paginates and exports belongs to exactly one session.
 *
 * ── Why this is a state machine and not a handful of useStates ────────────
 * The ledger pages by OFFSET, and its requests are async. Three things then go
 * wrong unless the session is atomic:
 *
 *  1. FILTER CHANGE. Clearing only the anchors left the OLD rows on screen, the OLD
 *     `hasMore`, and an offset derived from those old rows — while Export stayed
 *     enabled. An export fired in that window mixed the NEW non-date filters with
 *     the OLD visible result set: the file did not match the screen.
 *  2. STALE RESPONSES. A slow page-0 request for filter A can land after filter B
 *     has been applied. It must not resurrect A's rows, anchors, `hasMore`, or
 *     Export-readiness. Every response is therefore tagged with the GENERATION it
 *     was issued for and dropped if that generation is no longer current.
 *  3. TIMEZONE CHANGE. The dates are tenant-LOCAL, so their UTC bounds depend on the
 *     tenant timezone. If an owner changes it in another tab mid-session, the same
 *     anchors would silently mean a different window. The server refuses instead
 *     (`timezone_changed`), and the session goes STALE rather than reinterpreting.
 *
 * Pure, synchronous, dependency-free and client-safe: the component owns the I/O,
 * this owns every transition. That is what makes it directly testable — the tests
 * drive THIS reducer, not a copy of it.
 */
import type { InventoryMovement, MovementDatePreset } from "@/lib/types";

/** Rows per page — mirrors MOVEMENTS_PAGE in the Server Action. */
export const MOVEMENT_PAGE_SIZE = 50;

/**
 * The canonical filter snapshot. This — not the loose component state — is what a
 * session is identified by, what its rows came from, and what its export re-sends.
 */
/** "all" = no direction filter; the rest mirror the data layer's predicates. */
export type MovementDirection = "all" | "in" | "out" | "manual";

export interface MovementFilters {
  preset: MovementDatePreset;
  /** Only meaningful for "custom"; the presets resolve their own dates server-side. */
  customFrom: string;
  customTo: string;
  reason: string;
  direction: MovementDirection;
  /** undefined = no product filter; [] = the search matched nothing → zero rows. */
  productIds: string[] | undefined;
}

export type MovementSessionStatus =
  /** Nothing filtered yet — the SSR'd first page. */
  | "ready"
  /** A filter was applied; its first page is in flight. Nothing may be exported. */
  | "resolving"
  /** A later page is in flight for the active session. */
  | "paging"
  /** The initial resolution failed. No rows, nothing to export. */
  | "failed"
  /** The tenant timezone changed under us: the anchors no longer mean what they did. */
  | "stale";

export interface MovementSession {
  status: MovementSessionStatus;
  /** Monotonic. Every filter change bumps it; responses carrying an older one are
   * dropped. This is what makes a slow reply harmless instead of corrupting. */
  generation: number;
  /** The filters these rows came from — re-sent verbatim by load-more and export. */
  filters: MovementFilters;
  /** The CLOSED tenant-local range the server resolved. Both null only for "all". */
  from: string | null;
  to: string | null;
  /** The tenant timezone the server resolved the range UNDER. Comparison-only: the
   * client echoes it so the server can detect a change. It never authorizes. */
  timeZone: string | null;
  rows: InventoryMovement[];
  hasMore: boolean;
  /** A later page failed — the session survives and the button offers a retry. */
  pageFailed: boolean;
}

export const DEFAULT_MOVEMENT_FILTERS: MovementFilters = {
  preset: "all",
  customFrom: "",
  customTo: "",
  reason: "all",
  direction: "all",
  productIds: undefined,
};

/**
 * The SSR'd first page IS a resolved session: the server rendered those rows, and
 * the page hands down the authoritative tenant timezone alongside them. So Export is
 * legitimately available immediately, without a second round trip — the visible rows
 * and the export query provably come from the same server-resolved snapshot.
 */
export function initialMovementSession(
  rows: InventoryMovement[],
  timeZone: string,
): MovementSession {
  return {
    status: "ready",
    generation: 0,
    filters: DEFAULT_MOVEMENT_FILTERS,
    from: null,
    to: null,
    timeZone,
    rows,
    hasMore: rows.length >= MOVEMENT_PAGE_SIZE,
    pageFailed: false,
  };
}

export type MovementSessionAction =
  /**
   * A filter control changed → SYNCHRONOUSLY invalidate everything and start
   * resolving a new session. The `patch` is merged into the reducer's OWN current
   * filters (never into a snapshot captured by a stale closure — the debounced
   * product search fires 300ms later, by which time `reason` may have changed too).
   * `generation` is supplied by the caller so the component and the reducer can
   * never disagree about which request belongs to which session.
   */
  | {
      type: "filters_changed";
      generation: number;
      patch: Partial<MovementFilters>;
    }
  /** Retry a failed resolution / re-apply a stale one. Same filters, NEW session:
   * offset zero, no rows, no anchors, no timezone binding carried over. */
  | { type: "retry"; generation: number }
  /** The first page of `generation` arrived. */
  | {
      type: "resolved";
      generation: number;
      rows: InventoryMovement[];
      hasMore: boolean;
      from: string | null;
      to: string | null;
      timeZone: string;
    }
  /** The first page of `generation` failed. */
  | { type: "resolve_failed"; generation: number }
  /** A later page for `generation` is in flight. */
  | { type: "page_requested"; generation: number }
  /** A later page for `generation` arrived. */
  | {
      type: "page_loaded";
      generation: number;
      rows: InventoryMovement[];
      hasMore: boolean;
    }
  /** A later page for `generation` failed — keep the session, offer a retry. */
  | { type: "page_failed"; generation: number }
  /** The server refused: the tenant timezone is no longer the one we resolved under. */
  | { type: "session_stale"; generation: number };

/** Is this response still relevant, or did a newer filter supersede it? */
function isCurrent(state: MovementSession, generation: number): boolean {
  return generation === state.generation;
}

function sameProductIds(
  a: string[] | undefined,
  b: string[] | undefined,
): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

/** Two filter snapshots that would produce the identical query. */
function sameFilters(a: MovementFilters, b: MovementFilters): boolean {
  return (
    a.preset === b.preset &&
    a.customFrom === b.customFrom &&
    a.customTo === b.customTo &&
    a.reason === b.reason &&
    a.direction === b.direction &&
    sameProductIds(a.productIds, b.productIds)
  );
}

export function movementSessionReducer(
  state: MovementSession,
  action: MovementSessionAction,
): MovementSession {
  switch (action.type) {
    case "filters_changed": {
      const next = { ...state.filters, ...action.patch };
      // A patch that changes nothing must not destroy a healthy session — typing in
      // the search box that does not alter the matched product set is a no-op, and
      // tearing the session down for it would refetch page 1 for no reason.
      if (sameFilters(next, state.filters)) return state;
      // ATOMIC INVALIDATION, in the SAME transition that changes the control. The
      // new filter value and the death of the old session are one state update, so
      // no committed render can ever show the new filters beside the old rows, the
      // old hasMore, the old anchors, the old timezone binding — or an enabled
      // Export for a result set that no longer matches what is selected.
      // Offset is implicitly zero because `rows` is empty.
      return {
        status: "resolving",
        generation: action.generation,
        filters: next,
        from: null,
        to: null,
        timeZone: null,
        rows: [],
        hasMore: false,
        pageFailed: false,
      };
    }

    case "retry":
      // The SAME selected filters, a brand-new session. Nothing from the failed or
      // stale one is carried over: no rows, no anchors, no timezone binding, and the
      // offset is zero. This is what makes Retry and Re-apply safe to press twice.
      return {
        status: "resolving",
        generation: action.generation,
        filters: state.filters,
        from: null,
        to: null,
        timeZone: null,
        rows: [],
        hasMore: false,
        pageFailed: false,
      };

    case "resolved":
      if (!isCurrent(state, action.generation)) return state; // a superseded reply
      return {
        ...state,
        status: "ready",
        rows: action.rows,
        hasMore: action.hasMore,
        from: action.from,
        to: action.to,
        timeZone: action.timeZone,
        pageFailed: false,
      };

    case "resolve_failed":
      if (!isCurrent(state, action.generation)) return state;
      // No session exists. Show nothing rather than something stale, and keep
      // Export disabled — a retry will resolve a NEW session from offset zero.
      return {
        ...state,
        status: "failed",
        rows: [],
        hasMore: false,
        from: null,
        to: null,
        timeZone: null,
        pageFailed: false,
      };

    case "page_requested":
      if (!isCurrent(state, action.generation) || state.status !== "ready") {
        return state;
      }
      return { ...state, status: "paging", pageFailed: false };

    case "page_loaded": {
      if (!isCurrent(state, action.generation)) return state;
      // De-dup defensively. With a CLOSED range no new row can enter the window, so
      // this should never actually drop anything — it is a belt-and-braces guard,
      // not the mechanism that makes pagination correct.
      const seen = new Set(state.rows.map((m) => m.id));
      const fresh = action.rows.filter((m) => !seen.has(m.id));
      return {
        ...state,
        status: "ready",
        rows: [...state.rows, ...fresh],
        // A short page means the end. (An exactly-full final page still costs one
        // harmless empty follow-up request — the long-standing, documented
        // behaviour of this list, preserved deliberately.)
        hasMore: action.hasMore && action.rows.length > 0,
        pageFailed: false,
      };
    }

    case "page_failed":
      if (!isCurrent(state, action.generation)) return state;
      // The SESSION survives, anchors and all: a retry must page the SAME range,
      // not re-resolve "today" against a clock that may have rolled over.
      return { ...state, status: "ready", pageFailed: true };

    case "session_stale":
      if (!isCurrent(state, action.generation)) return state;
      // The tenant timezone changed, so these anchors no longer denote the window
      // they were resolved for. Drop the rows rather than mix two interpretations.
      return {
        ...state,
        status: "stale",
        rows: [],
        hasMore: false,
        from: null,
        to: null,
        timeZone: null,
        pageFailed: false,
      };

    default:
      return state;
  }
}

// ── Selectors: the component asks these, never re-derives them ────────────

/**
 * Export is allowed ONLY against a fully resolved session. While a filter is
 * resolving, after a failure, or once the session has gone stale, the visible rows
 * and the filters do not provably agree — and an export in that window produced a
 * file that did not match the screen.
 */
export function canExportSession(s: MovementSession): boolean {
  return s.status === "ready" || s.status === "paging";
}

/** Load-more needs a resolved session with more rows behind it. */
export function canLoadMoreSession(s: MovementSession): boolean {
  return s.hasMore && (s.status === "ready" || s.status === "paging");
}

/**
 * The timezone a session's rows MUST be rendered and exported in — the one the
 * server resolved them under, never the page's bootstrap prop.
 *
 * They are the same thing on first paint (the SSR page rendered those rows under
 * that zone, so it IS that session's zone). They diverge the moment a zone change
 * forces a new session: the rows now come from a query the server ran under the NEW
 * zone, and formatting them with the page's original prop would print one
 * interpretation over another's data. Null exactly when there are no rows.
 */
export function sessionTimeZone(s: MovementSession): string | null {
  return s.timeZone;
}

/** Retry (failed) / Re-apply (stale) — the session needs an explicit restart. */
export function needsRestart(s: MovementSession): boolean {
  return s.status === "failed" || s.status === "stale";
}

/** The next page's offset — always derived from the ACTIVE session's own rows. */
export function nextOffset(s: MovementSession): number {
  return s.rows.length;
}

/**
 * The request payload for a session. Load-more, retry and export all send THIS —
 * the same filters, the same concrete dates, and the same `expectedTimeZone` the
 * server issued, so the server can refuse if the tenant's zone has since changed.
 *
 * `resolving` sends no dates and no expected zone: that IS the request that asks the
 * server to resolve the preset and tell us both.
 */
export function sessionRequest(
  s: MovementSession,
  offset: number,
): {
  preset: MovementDatePreset;
  dateFrom?: string;
  dateTo?: string;
  expectedTimeZone?: string;
  reason?: string;
  direction?: Exclude<MovementDirection, "all">;
  productIds?: string[];
  offset: number;
} {
  const f = s.filters;
  const resolved = s.timeZone !== null;

  // Resolved → the session's concrete anchors. Not yet → "custom" already carries
  // the operator's typed dates; a relative preset carries nothing and the server
  // resolves it once.
  const dates = resolved
    ? { from: s.from ?? undefined, to: s.to ?? undefined }
    : f.preset === "custom"
      ? { from: f.customFrom || undefined, to: f.customTo || undefined }
      : { from: undefined, to: undefined };

  return {
    preset: f.preset,
    dateFrom: dates.from,
    dateTo: dates.to,
    // Comparison-only. The server ALWAYS reads the authoritative zone from the
    // authenticated context; this just tells it which one we were resolved under.
    expectedTimeZone: resolved ? (s.timeZone ?? undefined) : undefined,
    reason: f.reason === "all" ? undefined : f.reason,
    direction: f.direction === "all" ? undefined : f.direction,
    productIds: f.productIds,
    offset,
  };
}
