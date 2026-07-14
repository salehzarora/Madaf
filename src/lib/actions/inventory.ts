"use server";

/**
 * Inventory write Server Actions (M8B.2). The only bridge between admin
 * client components and the manual-adjustment side of the data layer.
 * Server Actions are public endpoints, so inputs are re-validated here AND
 * again by adjust_inventory_stock — the real gate (owner/admin via
 * authorize_tenant, tenant-scoped product, row lock, negative result
 * blocked, allowlisted reason, ledger row). No client tenant_id is trusted.
 */
import { revalidatePath } from "next/cache";

import {
  adjustInventoryStock,
  getTenantTimeZone,
  searchInventoryMovements,
} from "@/lib/data";
import {
  resolveMovementAnchors,
  type MovementAnchors,
} from "@/lib/tenant-day";
import { parseDateOnlyStrict } from "@/lib/time";
import {
  INVENTORY_MOVEMENT_REASONS,
  MOVEMENT_DATE_PRESETS,
  type InventoryMovement,
  type MovementDatePreset,
  type MovementQuery,
} from "@/lib/types";

const MAX_ID_LENGTH = 64;
const MAX_NOTE = 500;
const MAX_ABS_DELTA = 100000;
/** Movement search page size + max product ids in one .in() clause. */
const MOVEMENTS_PAGE = 50;
const MAX_PRODUCT_IDS = 1000;
/** Export ceiling (M8E.1): a filtered export streams at most this many rows
 * server-side; past it the UI asks the operator to narrow the filters. Chosen
 * high enough to cover any realistic warehouse ledger, low enough to bound the
 * response. Fetched in batches of MOVEMENTS_EXPORT_PAGE. */
const MOVEMENTS_EXPORT_CAP = 10000;
const MOVEMENTS_EXPORT_PAGE = 500;

/** Mirrors the RPC's allowlist — anything else is rejected in both layers. */
const ADJUST_REASONS = [
  "manual_stock_count",
  "manual_damaged_goods",
  "manual_returned_goods",
  "manual_supplier_delivery",
  "manual_correction",
  "manual_other",
] as const;
export type AdjustReason = (typeof ADJUST_REASONS)[number];

function isPlausibleId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_ID_LENGTH &&
    /^[A-Za-z0-9-]+$/.test(value)
  );
}

/**
 * A tenant-local CALENDAR DATE (YYYY-MM-DD) — what an `<input type="date">`
 * yields. Deliberately NOT an instant: the client must not be able to hand the
 * ledger a UTC bound it computed off its own clock (M8H.2). The server turns
 * these into UTC bounds in the TENANT's timezone.
 */
function isMovementPreset(v: unknown): v is MovementDatePreset {
  return (
    typeof v === "string" &&
    (MOVEMENT_DATE_PRESETS as readonly string[]).includes(v)
  );
}

export interface MovementSearchInput {
  /** Which range to show. Resolved ONCE, server-side, against the TENANT's clock —
   * and only when no concrete anchor is supplied below. */
  preset?: MovementDatePreset;
  /**
   * The filter session's CONCRETE tenant-local calendar dates (YYYY-MM-DD), never
   * instants. The client echoes back whatever `resolvedFrom`/`resolvedTo` the first
   * request returned, so load-more / retry / export all page against the SAME range
   * the first page came from — even if the tenant's midnight passes mid-session.
   */
  dateFrom?: string;
  dateTo?: string;
  /**
   * The tenant timezone the ACTIVE session was resolved under, echoed back by the
   * client. **Comparison only** — it never selects or authorizes anything. The
   * server always reads the authoritative zone from the authenticated context; this
   * only lets it notice that the two no longer agree.
   *
   * Why it must: `dateFrom`/`dateTo` are tenant-LOCAL, so their UTC bounds depend on
   * the tenant's zone. If an owner changes the zone in another tab mid-session, the
   * very same anchors would silently denote a DIFFERENT window — the visible rows
   * and the next page would be answering different questions. So the server refuses.
   */
  expectedTimeZone?: string;
  reason?: string;
  direction?: "in" | "out" | "manual";
  productIds?: string[];
  offset?: number;
}

/** Why a movements request was refused. */
export type MovementError =
  /** An impossible calendar date (2026-02-30) — the request is refused outright. */
  | "invalid_date"
  /** The tenant timezone changed since this session was resolved; its anchors no
   * longer mean what they meant. The session must be restarted, not reinterpreted. */
  | "timezone_changed"
  | "failed";

/**
 * A movements page. DISCRIMINATED, so a SUCCESS cannot omit the timezone it was
 * resolved under.
 *
 * It used to be one optional-everything shape, which let a type-valid `ok: true`
 * arrive with no `resolvedTimeZone` — and the client then fell back to the page's
 * bootstrap zone, printing a UTC-resolved session in Asia/Jerusalem. There is now no
 * shape in which a success can fail to name its zone.
 */
export type MovementSearchResult =
  | {
      ok: true;
      movements: InventoryMovement[];
      /** True when a full page came back — more pages may exist WITHIN THE ANCHORS. */
      hasMore: boolean;
      /** The CLOSED concrete tenant-local range this result was computed against… */
      resolvedFrom: string | null;
      resolvedTo: string | null;
      /** …and the AUTHORITATIVE tenant timezone it was resolved under. REQUIRED: the
       * client binds the session to it and re-sends it on every later request. */
      resolvedTimeZone: string;
      error?: undefined;
    }
  | {
      ok: false;
      error: MovementError;
      movements?: undefined;
      hasMore?: undefined;
      resolvedFrom?: undefined;
      resolvedTo?: undefined;
      resolvedTimeZone?: undefined;
    };

/** A filter payload the server has fully validated + anchored. */
interface ResolvedMovementFilter {
  query: MovementQuery;
  anchors: MovementAnchors;
  /** The AUTHORITATIVE tenant zone (from the cached session context), not the
   * client's echo. */
  timeZone: string;
}

/**
 * Re-validate the client payload, then ANCHOR its date range to concrete
 * tenant-local calendar dates. Shared by search + export, so a CSV can never cover
 * a different range than the rows on screen.
 *
 * Dates are parsed STRICTLY. `2026-02-30` is shaped like a date but is not one; a
 * shape-only check would let it through, the converter would then reject it and
 * hand back `null`, and a BOUNDED filter would quietly become an UNBOUNDED export
 * of the whole ledger. So an impossible date fails the request outright — it never
 * degrades into "no filter".
 */
async function resolveMovementFilter(
  input: MovementSearchInput,
): Promise<ResolvedMovementFilter | MovementError> {
  // Strict Gregorian validation — reject, never balance, never drop one side.
  const rawFrom = input.dateFrom;
  const rawTo = input.dateTo;
  const from = rawFrom === undefined ? undefined : parseDateOnlyStrict(rawFrom);
  const to = rawTo === undefined ? undefined : parseDateOnlyStrict(rawTo);
  if (from === null || to === null) return "invalid_date"; // supplied but impossible

  // The AUTHORITATIVE tenant zone, from the cached session context (no extra query).
  // The client's `expectedTimeZone` is never used to convert anything.
  const timeZone = await getTenantTimeZone();

  // SESSION BINDING. The anchors are tenant-LOCAL dates, so the window they denote
  // depends on the zone they were resolved under. If the tenant's zone has changed
  // since, the honest answer is "this session is stale" — NOT to silently
  // re-interpret the same dates under a new zone and hand back a different result
  // set under the same visible filter.
  if (
    typeof input.expectedTimeZone === "string" &&
    input.expectedTimeZone !== timeZone
  ) {
    return "timezone_changed";
  }

  const anchors = resolveMovementAnchors(
    isMovementPreset(input.preset) ? input.preset : undefined,
    from ?? undefined,
    to ?? undefined,
    timeZone,
  );

  const query: MovementQuery = {};
  if (anchors.from) query.dateFrom = anchors.from;
  if (anchors.to) query.dateTo = anchors.to;
  if (
    typeof input.reason === "string" &&
    (INVENTORY_MOVEMENT_REASONS as readonly string[]).includes(input.reason)
  ) {
    query.reason = input.reason;
  }
  if (
    input.direction === "in" ||
    input.direction === "out" ||
    input.direction === "manual"
  ) {
    query.direction = input.direction;
  }
  if (Array.isArray(input.productIds)) {
    query.productIds = input.productIds
      .filter(isPlausibleId)
      .slice(0, MAX_PRODUCT_IDS);
  }
  return { query, anchors, timeZone };
}

/**
 * M8D — server-side movement search + pagination. Filters run in the DB
 * query (RLS owner/admin); everything here is re-validated. `productIds` is
 * resolved from the search term by the caller (from the loaded catalog);
 * `[]` means "search matched no product" → zero rows.
 */
export async function searchMovementsAction(
  input: MovementSearchInput,
): Promise<MovementSearchResult> {
  try {
    const offset = Number.isInteger(input.offset) ? (input.offset as number) : 0;
    if (offset < 0 || offset > 5_000_000) return { ok: false, error: "failed" };

    const resolved = await resolveMovementFilter(input);
    // FAIL CLOSED, without querying:
    //  • an impossible calendar date must never fall through to an unbounded read —
    //    that is how "2026-02-30" would have returned the entire ledger;
    //  • a changed tenant timezone must never be papered over by re-interpreting
    //    the session's anchors under the new zone.
    if (typeof resolved === "string") return { ok: false, error: resolved };

    const movements = await searchInventoryMovements(
      resolved.query,
      offset,
      MOVEMENTS_PAGE,
    );
    return {
      ok: true,
      movements,
      hasMore: movements.length >= MOVEMENTS_PAGE,
      // The CLOSED range this page was computed against, and the zone it was
      // resolved under. The client pins all three to the session and echoes them
      // back, so pagination cannot drift and a zone change cannot go unnoticed.
      resolvedFrom: resolved.anchors.from,
      resolvedTo: resolved.anchors.to,
      resolvedTimeZone: resolved.timeZone,
    };
  } catch (error) {
    console.error("[madaf/actions] searchMovementsAction failed:", error);
    return { ok: false, error: "failed" };
  }
}

/** An export. Discriminated for the same reason: a success is a success, an error is
 * an error, and neither can masquerade as the other by omitting a field. A success
 * MUST carry the `resolvedTimeZone` the rows were resolved under — the client
 * verifies it against the active session's zone BEFORE reading any row, and
 * refuses to build a CSV if it is missing or disagrees (the server had already
 * refused the query outright if the tenant's zone had changed: expectedTimeZone). */
export type MovementExportResult =
  | {
      ok: true;
      movements: InventoryMovement[];
      /** True when the cap was hit and MORE matching rows exist beyond it. */
      capped: boolean;
      /**
       * The AUTHORITATIVE tenant timezone this export was actually run under.
       * REQUIRED — every successful movements response must be able to name its own
       * zone, exactly like a search page.
       *
       * The server already refuses a mismatched `expectedTimeZone` before it queries,
       * so this is not what keeps the export authorized. It is what makes the reply
       * SELF-DESCRIBING: without it the client had to *assume* the file it was about to
       * build belonged to the session on screen, purely because it had asked nicely.
       * Now it can check, and refuse to write a CSV it cannot vouch for.
       */
      resolvedTimeZone: string;
      error?: undefined;
    }
  | {
      ok: false;
      error: MovementError;
      movements?: undefined;
      capped?: undefined;
      resolvedTimeZone?: undefined;
    };

/**
 * M8E.1 — export ALL rows matching the current filters, not just the loaded
 * page. Pages through the same RLS-scoped, DB-side filtered query (owner/admin)
 * in server-side batches up to MOVEMENTS_EXPORT_CAP. If the cap is reached and
 * more rows remain, `capped` is set so the UI can tell the operator to narrow
 * the filters. The client builds the CSV (it has the catalog for localized
 * product names + headers); admin-only, tenant-scoped, no secrets.
 */
export async function exportMovementsAction(
  input: MovementSearchInput,
): Promise<MovementExportResult> {
  try {
    const resolved = await resolveMovementFilter(input);
    // Fail closed, WITHOUT exporting a single row: an impossible date must never
    // export the whole ledger, and a changed tenant timezone must not produce a file
    // covering days the operator never saw on screen.
    if (typeof resolved === "string") return { ok: false, error: resolved };
    const query = resolved.query;
    // The AUTHORITATIVE zone this export is actually running under — from the
    // authenticated tenant context, never the client's echo. EVERY success below
    // reports it, so the reply describes itself and the client can verify that the
    // file it is about to write belongs to the session on screen.
    const resolvedTimeZone = resolved.timeZone;
    const all: InventoryMovement[] = [];
    for (
      let offset = 0;
      offset < MOVEMENTS_EXPORT_CAP;
      offset += MOVEMENTS_EXPORT_PAGE
    ) {
      const want = Math.min(MOVEMENTS_EXPORT_PAGE, MOVEMENTS_EXPORT_CAP - all.length);
      const page = await searchInventoryMovements(query, offset, want);
      all.push(...page);
      if (page.length < want) {
        return { ok: true, movements: all, capped: false, resolvedTimeZone };
      }
    }
    // Filled to the cap — probe one past it to report whether more exist.
    const probe = await searchInventoryMovements(query, MOVEMENTS_EXPORT_CAP, 1);
    return {
      ok: true,
      movements: all,
      capped: probe.length > 0,
      resolvedTimeZone,
    };
  } catch (error) {
    console.error("[madaf/actions] exportMovementsAction failed:", error);
    return { ok: false, error: "failed" };
  }
}

export interface AdjustStockResult {
  ok: boolean;
  newQuantity?: number;
  /** "negative" = the correction would take stock below zero. */
  reason?: "negative";
}

export async function adjustStockAction(input: {
  productId: string;
  delta: number;
  reason: string;
  note?: string;
  locale: string;
}): Promise<AdjustStockResult> {
  try {
    if (
      !isPlausibleId(input.productId) ||
      !Number.isInteger(input.delta) ||
      input.delta === 0 ||
      Math.abs(input.delta) > MAX_ABS_DELTA ||
      !ADJUST_REASONS.includes(input.reason as AdjustReason)
    ) {
      return { ok: false };
    }
    const note =
      typeof input.note === "string"
        ? input.note.trim().slice(0, MAX_NOTE) || undefined
        : undefined;

    const result = await adjustInventoryStock(
      input.productId,
      input.delta,
      input.reason,
      note,
    );

    if (typeof input.locale === "string" && /^[a-z]{2}$/.test(input.locale)) {
      revalidatePath(`/${input.locale}/admin/inventory`);
      revalidatePath(`/${input.locale}/admin/inventory/movements`);
      revalidatePath(`/${input.locale}/admin`);
      // Stock feeds availability badges across the storefront.
      revalidatePath(`/${input.locale}`, "layout");
    }
    return { ok: true, newQuantity: result.newQuantity };
  } catch (error) {
    if (error instanceof Error && error.message.includes("below zero")) {
      return { ok: false, reason: "negative" };
    }
    console.error("[madaf/actions] adjustStockAction failed:", error);
    return { ok: false };
  }
}
