/**
 * When should the product form persist inventory? (PILOT-READINESS-BATCH-B · B2)
 *
 * Availability is DERIVED from `inventory_items` (see `deriveAvailability`):
 * a product with NO row is "inStock" (untracked/available); a row at quantity 0
 * is "outOfStock". The shared product form always renders the inventory section
 * and defaults an inventory-LESS product's quantity to 0. Because the old form
 * ALWAYS submitted inventory on edit, an unrelated metadata edit (name, price,
 * image, …) silently INSERTed a 0-stock row via `upsert_inventory_item`,
 * flipping availability from In-stock to Out-of-stock and disabling ordering.
 *
 * The RPCs already skip the inventory upsert when `p_inventory` is null, so the
 * fix is purely to decide — on the client, before calling the action — whether
 * to send inventory at all. This module is that decision, kept pure so it can be
 * unit-tested in mock mode with zero config.
 *
 * Rules:
 *   - CREATE always seeds inventory (unchanged — a new product gets its row).
 *   - EDIT of a product that ALREADY tracks stock always re-submits inventory,
 *     so intentional stock edits and legitimate zero-stock rows are preserved.
 *   - EDIT of a product with NO inventory row submits inventory ONLY when the
 *     user actually entered stock data here (a positive quantity, a warehouse
 *     location, or an expiry date). Left at the untouched defaults, no row is
 *     created and the product stays In-stock/untracked.
 */

/** Raw inventory-field strings as read from the form (FormData values). */
export interface InventoryFieldValues {
  /** `quantityAvailable` input — a numeric string (defaults to "0"). */
  quantityAvailable: string;
  warehouseLocation: string;
  /** `YYYY-MM-DD` from the date input, or "". */
  expiryDate: string;
}

/**
 * True when the inventory fields carry a real stock signal for a product that
 * has no inventory row yet. A quantity of 0 (the untouched default) with no
 * location and no expiry is treated as "nothing entered". A positive quantity,
 * a warehouse location, or an expiry date each count as engagement — the user
 * is starting to track stock and the row should be created.
 */
export function inventoryFieldsEngaged(values: InventoryFieldValues): boolean {
  const quantity = Number(values.quantityAvailable.trim());
  const hasQuantity = Number.isFinite(quantity) && quantity > 0;
  const hasLocation = values.warehouseLocation.trim() !== "";
  const hasExpiry = values.expiryDate.trim() !== "";
  return hasQuantity || hasLocation || hasExpiry;
}

/**
 * Should the product form include inventory in this submission?
 *
 * @param isEdit               editing an existing product (vs. creating).
 * @param hasExistingInventory the edited product already has an inventory row.
 * @param fields               the raw inventory-field strings from the form.
 */
export function shouldSubmitInventory(input: {
  isEdit: boolean;
  hasExistingInventory: boolean;
  fields: InventoryFieldValues;
}): boolean {
  // Create always seeds inventory (unchanged behaviour).
  if (!input.isEdit) return true;
  // A product that already tracks stock keeps re-submitting, so an intentional
  // stock change (including setting quantity to 0) is never dropped.
  if (input.hasExistingInventory) return true;
  // Inventory-less product: only create a row when the user actually engaged
  // the inventory fields — an unrelated metadata edit must not flip it
  // Out-of-stock.
  return inventoryFieldsEngaged(input.fields);
}
