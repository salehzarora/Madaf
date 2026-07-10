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

import { adjustInventoryStock } from "@/lib/data";

const MAX_ID_LENGTH = 64;
const MAX_NOTE = 500;
const MAX_ABS_DELTA = 100000;

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
