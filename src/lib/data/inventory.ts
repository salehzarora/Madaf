/**
 * Inventory data access. Mock by default; Supabase branch is server-only
 * local dev (see ./supabase-reads for the access model).
 *
 * Mapping: stockPackages ← quantity_available, location ←
 * warehouse_location, nearestExpiry ← expiry_date. M8B adds the stock-
 * movement ledger (read) and manual adjustments (write) — both
 * Supabase-only (mock has no ledger and persists nothing).
 */
import { inventory, inventoryByProductId } from "@/lib/mock";
import type { InventoryItem, InventoryMovement } from "@/lib/types";

import { getDataMode } from "./mode";

export async function listInventory(): Promise<InventoryItem[]> {
  if (getDataMode() === "supabase") {
    return (await import("./supabase-reads")).sbListInventory();
  }
  return inventory;
}

export async function getInventoryForProduct(
  productId: string,
): Promise<InventoryItem | undefined> {
  if (getDataMode() === "supabase") {
    return (await import("./supabase-reads")).sbGetInventoryForProduct(
      productId,
    );
  }
  return inventoryByProductId.get(productId);
}

/** M8B — stock-movement ledger history (owner/admin via RLS; newest first).
 * Mock mode has no ledger → empty (the page shows its empty state). */
export async function listInventoryMovements(
  offset = 0,
): Promise<InventoryMovement[]> {
  if (getDataMode() === "supabase") {
    return (await import("./supabase-reads")).sbListInventoryMovements(offset);
  }
  return [];
}

/** M8B.2 — owner/admin manual stock correction. Supabase-only write. */
export async function adjustInventoryStock(
  productId: string,
  delta: number,
  reason: string,
  note?: string,
): Promise<{ newQuantity: number }> {
  if (getDataMode() !== "supabase") {
    throw new Error("[madaf/data] adjustInventoryStock is a Supabase-only write.");
  }
  return (await import("./supabase-writes")).sbAdjustInventoryStock(
    productId,
    delta,
    reason,
    note,
  );
}
