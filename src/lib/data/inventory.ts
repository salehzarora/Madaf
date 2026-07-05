/**
 * Inventory data access.
 *
 * M1: mock-backed. M2 mapping:
 * - InventoryItem.stockPackages ← inventory_items.quantity_available
 * - InventoryItem.location      ← inventory_items.warehouse_location
 * - InventoryItem.nearestExpiry ← inventory_items.expiry_date
 * - LOW_STOCK_THRESHOLD         ← per-row inventory_items.low_stock_threshold
 *   (the mock's global constant becomes a per-item column)
 */
import { inventory, inventoryByProductId } from "@/lib/mock";
import type { InventoryItem } from "@/lib/types";

import { getDataMode, supabaseNotWiredYet } from "./mode";

export async function listInventory(): Promise<InventoryItem[]> {
  if (getDataMode() === "supabase") supabaseNotWiredYet("listInventory");
  return inventory;
}

export async function getInventoryForProduct(
  productId: string,
): Promise<InventoryItem | undefined> {
  if (getDataMode() === "supabase") {
    supabaseNotWiredYet("getInventoryForProduct");
  }
  return inventoryByProductId.get(productId);
}
