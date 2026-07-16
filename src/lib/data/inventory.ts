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
import type {
  InventoryItem,
  InventoryMovement,
  MovementQuery,
} from "@/lib/types";

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

/** M8D — server-side filtered movement search (Supabase-only). Mock has no
 * ledger → empty. */
export async function searchInventoryMovements(
  query: MovementQuery,
  offset = 0,
  limit = 50,
): Promise<InventoryMovement[]> {
  if (getDataMode() === "supabase") {
    return (await import("./supabase-reads")).sbSearchInventoryMovements(
      query,
      offset,
      limit,
    );
  }
  return [];
}

/**
 * M8I.2 — page-scoped movement actor labels (owner/admin only). Resolves the
 * DISTINCT created_by ids on the given movements to safe display labels via the
 * bounded timeline actor-label RPC (no N+1, no full roster). Mock has no ledger
 * → {}. A missing/deleted actor has no entry (the UI shows a safe fallback). Used
 * by the movements UI reads ONLY — never by the CSV export, which is unchanged.
 */
export async function getMovementActorLabels(
  movements: InventoryMovement[],
): Promise<Record<string, string>> {
  if (getDataMode() !== "supabase" || movements.length === 0) return {};
  return (await import("./supabase-reads")).sbGetMovementActorLabels(movements);
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
