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

export interface MovementSearchResult {
  ok: boolean;
  movements?: InventoryMovement[];
  /** True when a full page came back — more pages may exist. */
  hasMore?: boolean;
}

/**
 * M8D — server-side movement search + pagination. Filters run in the DB
 * query (RLS owner/admin); everything here is re-validated. `productIds` is
 * resolved from the search term by the caller (from the loaded catalog);
 * `[]` means "search matched no product" → zero rows.
 */
export async function searchMovementsAction(input: {
  from?: string;
  to?: string;
  reason?: string;
  direction?: "in" | "out" | "manual";
  productIds?: string[];
  offset?: number;
}): Promise<MovementSearchResult> {
  try {
    const offset = Number.isInteger(input.offset) ? (input.offset as number) : 0;
    if (offset < 0 || offset > 5_000_000) return { ok: false };

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
      const ids = input.productIds.filter(isPlausibleId).slice(0, MAX_PRODUCT_IDS);
      // Preserve the "matched nothing" signal ([] → zero rows), but reject a
      // malformed non-empty list that validated down to empty.
      query.productIds = ids;
    }

    const movements = await searchInventoryMovements(
      query,
      offset,
      MOVEMENTS_PAGE,
    );
    return { ok: true, movements, hasMore: movements.length >= MOVEMENTS_PAGE };
  } catch (error) {
    console.error("[madaf/actions] searchMovementsAction failed:", error);
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
