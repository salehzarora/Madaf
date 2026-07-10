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

import { adjustInventoryStock, searchInventoryMovements } from "@/lib/data";
import {
  INVENTORY_MOVEMENT_REASONS,
  type InventoryMovement,
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

/** ISO-ish date-time string (from Date.toISOString or a <input type=date>). */
function isIsoish(v: unknown): v is string {
  return (
    typeof v === "string" &&
    v.length <= 40 &&
    !Number.isNaN(Date.parse(v))
  );
}

export interface MovementSearchInput {
  from?: string;
  to?: string;
  reason?: string;
  direction?: "in" | "out" | "manual";
  productIds?: string[];
  offset?: number;
}

export interface MovementSearchResult {
  ok: boolean;
  movements?: InventoryMovement[];
  /** True when a full page came back — more pages may exist. */
  hasMore?: boolean;
}

/**
 * Re-validate + normalize the filter payload from the client into a
 * MovementQuery the data layer trusts. Shared by search + export so both
 * apply the SAME server-side filters. `productIds` keeps its "matched
 * nothing" signal ([] → zero rows); `undefined` means no product filter.
 */
function normalizeMovementQuery(input: MovementSearchInput): MovementQuery {
  const query: MovementQuery = {};
  if (isIsoish(input.from)) query.from = input.from;
  if (isIsoish(input.to)) query.to = input.to;
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
  return query;
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
    if (offset < 0 || offset > 5_000_000) return { ok: false };

    const movements = await searchInventoryMovements(
      normalizeMovementQuery(input),
      offset,
      MOVEMENTS_PAGE,
    );
    return { ok: true, movements, hasMore: movements.length >= MOVEMENTS_PAGE };
  } catch (error) {
    console.error("[madaf/actions] searchMovementsAction failed:", error);
    return { ok: false };
  }
}

export interface MovementExportResult {
  ok: boolean;
  movements?: InventoryMovement[];
  /** True when the cap was hit and MORE matching rows exist beyond it. */
  capped?: boolean;
}

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
    const query = normalizeMovementQuery(input);
    const all: InventoryMovement[] = [];
    for (
      let offset = 0;
      offset < MOVEMENTS_EXPORT_CAP;
      offset += MOVEMENTS_EXPORT_PAGE
    ) {
      const want = Math.min(MOVEMENTS_EXPORT_PAGE, MOVEMENTS_EXPORT_CAP - all.length);
      const page = await searchInventoryMovements(query, offset, want);
      all.push(...page);
      if (page.length < want) return { ok: true, movements: all, capped: false };
    }
    // Filled to the cap — probe one past it to report whether more exist.
    const probe = await searchInventoryMovements(query, MOVEMENTS_EXPORT_CAP, 1);
    return { ok: true, movements: all, capped: probe.length > 0 };
  } catch (error) {
    console.error("[madaf/actions] exportMovementsAction failed:", error);
    return { ok: false };
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
