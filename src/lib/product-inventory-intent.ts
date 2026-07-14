/**
 * When should the product form persist inventory? (PILOT-READINESS-BATCH-B · B2)
 *
 * Availability is DERIVED from `inventory_items`: a product with NO row is
 * "inStock" (untracked/available); a row at quantity 0 is "outOfStock". The
 * shared product form always renders the inventory section and defaults an
 * inventory-LESS product's quantity to 0. The ORIGINAL bug was that the form
 * ALWAYS submitted inventory on edit, so an unrelated metadata edit (name,
 * price, image, …) silently INSERTed a 0-stock row and flipped availability to
 * Out-of-stock.
 *
 * The FIRST fix inferred intent from the field values (quantity > 0 || location
 * || expiry). That silently discarded legitimate intent: an owner who set
 * quantity 0 to mark a product out of stock, or configured only a low-stock
 * threshold, had their input ignored — an intentional zero is indistinguishable
 * from the untouched default by value alone.
 *
 * This version makes intent EXPLICIT. For a product with no inventory row, the
 * edit form shows a "Track inventory for this product" toggle (default OFF).
 * Only that toggle decides whether inventory is submitted — never the numeric
 * values. So quantity 0, threshold-only, location-only and expiry-only are all
 * honoured once tracking is turned on, and a metadata-only edit with tracking
 * off never creates a row.
 *
 * The persisted state is still binary — an inventory row exists or it does not.
 * The toggle is request-shaping/UX only; it is NOT an authorization signal (the
 * RPCs re-verify role/tenant/product and validate every inventory value).
 *
 * Rules:
 *   - CREATE always seeds inventory (unchanged — a new product gets its row).
 *   - EDIT of a product that ALREADY tracks stock always re-submits inventory,
 *     so intentional stock edits (incl. quantity 0) and threshold changes are
 *     preserved.
 *   - EDIT of a product with NO inventory row submits inventory ONLY when the
 *     user explicitly enabled tracking. Off (the default) → no row is created
 *     and the product stays In-stock/untracked.
 */

/**
 * Should the product form include inventory in this submission?
 *
 * @param isEdit               editing an existing product (vs. creating).
 * @param hasExistingInventory the edited product already has an inventory row.
 * @param trackingEnabled      the explicit "Track inventory" toggle. Only
 *                             meaningful when editing an inventory-less product;
 *                             ignored for create and for a product that already
 *                             has a row (both always submit).
 */
export function shouldSubmitInventory(input: {
  isEdit: boolean;
  hasExistingInventory: boolean;
  trackingEnabled: boolean;
}): boolean {
  // Create always seeds inventory (unchanged behaviour).
  if (!input.isEdit) return true;
  // A product that already tracks stock keeps re-submitting, so an intentional
  // stock change (including setting quantity to 0) or a threshold-only edit is
  // never dropped.
  if (input.hasExistingInventory) return true;
  // Inventory-less product: create a row ONLY when the user explicitly turned
  // tracking on. An unrelated metadata edit (toggle off) never flips it
  // Out-of-stock; an intentional zero / threshold-only edit (toggle on) is
  // honoured.
  return input.trackingEnabled;
}
