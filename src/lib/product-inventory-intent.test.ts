/**
 * PILOT-READINESS-BATCH-B · B2 — the product-form inventory-submission gate.
 *
 * Availability is DERIVED from `inventory_items`: NO row → In-stock (untracked),
 * a row at quantity 0 → Out-of-stock. The shared product form always renders the
 * inventory section and defaults an inventory-less product's quantity to 0. The
 * old form ALWAYS submitted inventory on edit, so an unrelated metadata edit
 * (name/price/image) INSERTed a 0-stock row and silently flipped a product from
 * In-stock to Out-of-stock, disabling ordering.
 *
 * `shouldSubmitInventory` is the pure decision the form now makes before calling
 * the action. This suite pins the contract:
 *   • create always seeds inventory;
 *   • a product that already tracks stock always re-submits (intentional edits
 *     and legitimate zero-stock rows are preserved);
 *   • an inventory-LESS product submits inventory ONLY when the user actually
 *     entered stock data — otherwise no row is created and it stays In-stock.
 *
 * Runner: `npm run test:product-inventory-intent`.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  inventoryFieldsEngaged,
  shouldSubmitInventory,
  type InventoryFieldValues,
} from "./product-inventory-intent";

const stripComments = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const productFormSrc = (): string =>
  stripComments(
    readFileSync(
      join(process.cwd(), "src", "components/admin/product-form.tsx"),
      "utf8",
    ),
  );

/** The untouched defaults an inventory-LESS product's form renders. */
const UNTOUCHED: InventoryFieldValues = {
  quantityAvailable: "0",
  warehouseLocation: "",
  expiryDate: "",
};

// ══ inventoryFieldsEngaged — the "did the user enter stock data?" signal ═════

test("engaged: untouched defaults (qty 0, no location, no expiry) are NOT engaged", () => {
  assert.equal(inventoryFieldsEngaged(UNTOUCHED), false);
});

test("engaged: an empty quantity string is treated as untouched", () => {
  assert.equal(
    inventoryFieldsEngaged({ ...UNTOUCHED, quantityAvailable: "" }),
    false,
  );
});

test("engaged: a non-numeric quantity is not a positive quantity", () => {
  assert.equal(
    inventoryFieldsEngaged({ ...UNTOUCHED, quantityAvailable: "abc" }),
    false,
  );
});

test("engaged: an explicit quantity of 0 alone is NOT engagement", () => {
  // The exact ambiguous case: 0 is indistinguishable from the default, so it
  // must not, on its own, create a row for an inventory-less product.
  assert.equal(
    inventoryFieldsEngaged({ ...UNTOUCHED, quantityAvailable: "0" }),
    false,
  );
});

test("engaged: a positive quantity IS engagement", () => {
  assert.equal(
    inventoryFieldsEngaged({ ...UNTOUCHED, quantityAvailable: "5" }),
    true,
  );
  assert.equal(
    inventoryFieldsEngaged({ ...UNTOUCHED, quantityAvailable: " 12 " }),
    true,
  );
});

test("engaged: a warehouse location alone IS engagement (qty still 0)", () => {
  assert.equal(
    inventoryFieldsEngaged({ ...UNTOUCHED, warehouseLocation: "A-3" }),
    true,
  );
});

test("engaged: a whitespace-only location is NOT engagement", () => {
  assert.equal(
    inventoryFieldsEngaged({ ...UNTOUCHED, warehouseLocation: "   " }),
    false,
  );
});

test("engaged: an expiry date alone IS engagement (qty still 0)", () => {
  assert.equal(
    inventoryFieldsEngaged({ ...UNTOUCHED, expiryDate: "2026-12-31" }),
    true,
  );
});

// ══ shouldSubmitInventory — the full create/edit decision ════════════════════

test("create ALWAYS submits inventory (even at the qty-0 default)", () => {
  assert.equal(
    shouldSubmitInventory({
      isEdit: false,
      hasExistingInventory: false,
      fields: UNTOUCHED,
    }),
    true,
  );
});

test("edit of a product that ALREADY tracks stock always submits — untouched", () => {
  // A legitimate zero-stock row must be preserved (re-submitted), not dropped.
  assert.equal(
    shouldSubmitInventory({
      isEdit: true,
      hasExistingInventory: true,
      fields: UNTOUCHED,
    }),
    true,
  );
});

test("edit of a product that ALREADY tracks stock always submits — qty 0 kept", () => {
  assert.equal(
    shouldSubmitInventory({
      isEdit: true,
      hasExistingInventory: true,
      fields: { ...UNTOUCHED, quantityAvailable: "0" },
    }),
    true,
  );
});

test("THE BUG: edit of an inventory-LESS product with untouched fields OMITS inventory", () => {
  // This is the exact regression B2 fixes: an unrelated metadata edit must not
  // create a 0-stock row and flip availability Out-of-stock.
  assert.equal(
    shouldSubmitInventory({
      isEdit: true,
      hasExistingInventory: false,
      fields: UNTOUCHED,
    }),
    false,
  );
});

test("edit of an inventory-LESS product submits when a positive quantity is entered", () => {
  assert.equal(
    shouldSubmitInventory({
      isEdit: true,
      hasExistingInventory: false,
      fields: { ...UNTOUCHED, quantityAvailable: "20" },
    }),
    true,
  );
});

test("edit of an inventory-LESS product submits when a location is entered", () => {
  assert.equal(
    shouldSubmitInventory({
      isEdit: true,
      hasExistingInventory: false,
      fields: { ...UNTOUCHED, warehouseLocation: "Cold-1" },
    }),
    true,
  );
});

test("edit of an inventory-LESS product submits when an expiry is entered", () => {
  assert.equal(
    shouldSubmitInventory({
      isEdit: true,
      hasExistingInventory: false,
      fields: { ...UNTOUCHED, expiryDate: "2027-01-15" },
    }),
    true,
  );
});

// ══ Wiring guard — the product form must actually USE the decision ═══════════
// The unit tests above prove the decision; the pgTAP suite proves the RPC skips
// the inventory upsert when p_inventory is null. This guard proves the form
// closes the loop: it gates the inventory arg on shouldSubmitInventory rather
// than sending inventory unconditionally on edit (the original bug).

test("guard: product form derives hasExistingInventory from the inventory prop", () => {
  assert.match(
    productFormSrc(),
    /hasExistingInventory = Boolean\(inventory\)/,
    "the form must know whether a row already exists (from the inventory prop)",
  );
});

test("guard: product form gates the inventory arg on shouldSubmitInventory", () => {
  const src = productFormSrc();
  assert.match(
    src,
    /shouldSubmitInventory\(\{/,
    "the form must call the shared decision, not always send inventory on edit",
  );
  // The update call must SPREAD inventory conditionally — never an unconditional
  // `inventory: inventoryInput` on the edit path.
  assert.match(
    src,
    /\.\.\.\(submitInventory \? \{ inventory: inventoryInput \} : \{\}\)/,
    "updateProductAction must receive inventory only when submitInventory is true",
  );
});
