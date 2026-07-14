/**
 * PILOT-READINESS-BATCH-B · B2 — the product-form inventory-submission gate,
 * now driven by an EXPLICIT "Track inventory" opt-in (P2 correction).
 *
 * Availability is derived from `inventory_items`: NO row → In-stock (untracked,
 * orderable); a row at quantity 0 → Out-of-stock. The form always renders the
 * inventory section and defaults an inventory-less product's quantity to 0. The
 * original bug always submitted inventory on edit (a metadata edit created a
 * 0-stock row); the first fix inferred intent from the field values, which
 * silently discarded an intentional quantity 0 or a threshold-only edit.
 *
 * `shouldSubmitInventory` now decides purely from (isEdit, hasExistingInventory,
 * trackingEnabled) — never from the numeric values — so intent is unambiguous:
 *   • create always seeds inventory;
 *   • a product that already tracks stock always re-submits (intentional zero
 *     and threshold-only edits preserved);
 *   • an inventory-less product submits ONLY when the owner explicitly enabled
 *     tracking. Off (the default) → no row is created and it stays In-stock.
 *
 * The field values (quantity 0, threshold-only, location-only, expiry-only) no
 * longer affect the decision; that they produce/persist the intended row is
 * proven at the RPC layer (supabase/tests/product_write_rpcs.test.sql) and the
 * availability outcome in src/lib/data/product-availability.live.test.ts.
 *
 * Runner: `npm run test:product-inventory-intent`.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { shouldSubmitInventory } from "./product-inventory-intent";

const stripComments = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const productFormSrc = (): string =>
  stripComments(
    readFileSync(
      join(process.cwd(), "src", "components/admin/product-form.tsx"),
      "utf8",
    ),
  );

// ══ CREATE — always seeds inventory (unchanged) ══════════════════════════════

test("create always submits inventory (tracking flag is irrelevant)", () => {
  assert.equal(
    shouldSubmitInventory({
      isEdit: false,
      hasExistingInventory: false,
      trackingEnabled: false,
    }),
    true,
  );
  assert.equal(
    shouldSubmitInventory({
      isEdit: false,
      hasExistingInventory: false,
      trackingEnabled: true,
    }),
    true,
  );
});

// ══ EXISTING inventory row — always re-submits (preserve) ════════════════════

test("edit of an already-tracked product always submits — metadata-only", () => {
  // Preserves the existing row (incl. a legitimate zero) on an unrelated edit.
  assert.equal(
    shouldSubmitInventory({
      isEdit: true,
      hasExistingInventory: true,
      trackingEnabled: false,
    }),
    true,
  );
});

test("edit of an already-tracked product always submits — intentional zero / threshold", () => {
  assert.equal(
    shouldSubmitInventory({
      isEdit: true,
      hasExistingInventory: true,
      trackingEnabled: true,
    }),
    true,
  );
});

// ══ INVENTORY-LESS product — the explicit toggle is the ONLY signal ══════════

test("THE FIX: inventory-less edit with tracking OFF never submits (metadata/price/description edit)", () => {
  // The decision is field-agnostic: ANY metadata edit (name, price, image,
  // description) with tracking off omits inventory — no 0-stock row, stays
  // In-stock/orderable.
  assert.equal(
    shouldSubmitInventory({
      isEdit: true,
      hasExistingInventory: false,
      trackingEnabled: false,
    }),
    false,
  );
});

test("inventory-less edit with tracking ON submits (explicit opt-in)", () => {
  // Turning tracking on is the intent — the field values (0 quantity,
  // threshold-only, location-only, expiry-only) no longer gate this; they are
  // exercised at the RPC/live layer.
  assert.equal(
    shouldSubmitInventory({
      isEdit: true,
      hasExistingInventory: false,
      trackingEnabled: true,
    }),
    true,
  );
});

test("intent no longer depends on numeric value: OFF stays OFF, ON stays ON", () => {
  // The ambiguity the P2 flagged — an intentional 0 was indistinguishable from
  // the default 0 — is gone: only the explicit boolean decides.
  const base = { isEdit: true, hasExistingInventory: false } as const;
  assert.equal(shouldSubmitInventory({ ...base, trackingEnabled: false }), false);
  assert.equal(shouldSubmitInventory({ ...base, trackingEnabled: true }), true);
});

// ══ Wiring guard — the product form must USE the explicit toggle ═════════════
// The unit tests above prove the decision; pgTAP proves the RPC creates/omits
// the row; the live test proves the availability outcome. This guard proves the
// form closes the loop: it shows the opt-in for an inventory-less edit, gates
// the fields on it, and feeds the toggle (not the values) into the decision.

test("guard: form derives hasExistingInventory + the inventory-less toggle condition", () => {
  const src = productFormSrc();
  assert.match(
    src,
    /hasExistingInventory = Boolean\(inventory\)/,
    "must know whether a row already exists (from the inventory prop)",
  );
  assert.match(
    src,
    /showInventoryToggle = isEdit && !hasExistingInventory/,
    "the opt-in appears ONLY when editing an inventory-less product",
  );
});

test("guard: form feeds the explicit toggle (not field values) into the decision", () => {
  const src = productFormSrc();
  assert.match(
    src,
    /shouldSubmitInventory\(\{/,
    "must call the shared decision",
  );
  assert.match(
    src,
    /trackingEnabled: trackInventory/,
    "the decision must be driven by the explicit toggle state",
  );
  // No inference from the numeric fields any more.
  assert.doesNotMatch(
    src,
    /inventoryFieldsEngaged/,
    "must NOT infer intent from field values (the discarded-intent P2)",
  );
  assert.match(
    src,
    /\.\.\.\(submitInventory \? \{ inventory: inventoryInput \} : \{\}\)/,
    "updateProductAction must receive inventory only when submitInventory is true",
  );
});

test("guard: form renders the localized toggle and disables the fields when off", () => {
  const src = productFormSrc();
  assert.match(
    src,
    /showInventoryToggle \? \(/,
    "the toggle is rendered conditionally for the inventory-less edit",
  );
  assert.match(
    src,
    /t\.trackInventory\b/,
    "the toggle uses the localized label",
  );
  assert.match(
    src,
    /checked=\{trackInventory\}/,
    "the toggle is a controlled checkbox bound to the tracking state",
  );
  assert.match(
    src,
    /disabled=\{showInventoryToggle && !trackInventory\}/,
    "inventory inputs are disabled until tracking is enabled",
  );
});
