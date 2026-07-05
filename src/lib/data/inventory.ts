/**
 * Inventory data access. Mock by default; Supabase branch is server-only
 * local dev (see ./supabase-reads for the access model).
 *
 * Mapping: stockPackages ← quantity_available, location ←
 * warehouse_location, nearestExpiry ← expiry_date. The per-row
 * low_stock_threshold stays DB-side for now — the UI's low-stock logic
 * uses the demo constant in src/lib/catalog-helpers.ts.
 */
import { inventory, inventoryByProductId } from "@/lib/mock";
import type { InventoryItem } from "@/lib/types";

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
