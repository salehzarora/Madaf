/**
 * Behavioural tests for the Product write actions' isActive parsing boundary
 * (PILOT-OPS-AUDIT-001 correction, Codex P2-2).
 *
 * Codex confirmed that an otherwise-valid UPDATE payload omitting isActive was
 * normalized to true, which could silently reactivate an inactive product. These
 * mount the REAL actions with the data layer mocked, so the ACTION's parsing
 * boundary is what is exercised (the DB event cardinality + RLS are covered by
 * the product_audit pgTAP + product-audit unit suite):
 *   • UPDATE omitting isActive ⇒ rejected safely BEFORE the RPC ({ ok:false }),
 *     updateProduct NOT called (no mutation, no audit);
 *   • UPDATE with a malformed isActive ⇒ likewise rejected;
 *   • UPDATE with explicit false / true ⇒ updateProduct called with that value;
 *   • CREATE keeps the historical default (omitted ⇒ active), and an explicit
 *     false is honoured.
 *
 * Runner: `npm run test:product-action` (needs --experimental-test-module-mocks).
 */
import assert from "node:assert/strict";
import { mock, test } from "node:test";

type ProductArg = Record<string, unknown>;
const createCalls: { product: ProductArg }[] = [];
const updateCalls: { id: string; product: ProductArg }[] = [];

function reset() {
  createCalls.length = 0;
  updateCalls.length = 0;
}

// Silence the actions' intentional server-side error logging on failure paths.
mock.method(console, "error", () => {});

mock.module("next/cache", { namedExports: { revalidatePath: () => {} } });
// getSessionContext is only used by exportProductsAction (not exercised here);
// stub it so importing the action never loads the real auth/supabase machinery.
mock.module("@/lib/auth/session", {
  namedExports: { getSessionContext: async () => ({ membership: null }) },
});
mock.module("@/lib/data", {
  namedExports: {
    createProduct: async (product: ProductArg) => {
      createCalls.push({ product });
      return { productId: "p-new" };
    },
    updateProduct: async (id: string, product: ProductArg) => {
      updateCalls.push({ id, product });
      return { productId: id };
    },
  },
});

const { createProductAction, updateProductAction } = await import(
  "@/lib/actions/products"
);

/** A valid product payload (as the form's productInput object) minus isActive. */
function product(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    nameAr: "منتج",
    nameHe: "מוצר",
    nameEn: "Product",
    categoryId: "cat-1",
    wholesalePrice: 5,
    packageUnit: "carton",
    baseUnit: "units",
    packageQuantity: 1,
    ...extra,
  };
}

const PID = "prod-1";

// ── UPDATE: omitted isActive is REJECTED before the RPC (no reactivation) ──
test("update omitting isActive → rejected, updateProduct NOT called", async () => {
  reset();
  const res = await updateProductAction({
    productId: PID,
    product: product(), // no isActive key
    locale: "en",
  });
  assert.deepEqual(res, { ok: false });
  assert.equal(updateCalls.length, 0, "no mutation was attempted");
});

test("update with a MALFORMED isActive → rejected, updateProduct NOT called", async () => {
  reset();
  for (const bad of ["yes", 1, "true", null]) {
    const res = await updateProductAction({
      productId: PID,
      product: product({ isActive: bad }),
      locale: "en",
    });
    assert.deepEqual(res, { ok: false }, `isActive=${JSON.stringify(bad)}`);
  }
  assert.equal(updateCalls.length, 0, "no mutation for any malformed value");
});

// ── UPDATE: explicit booleans flow through unchanged ──────────────────────
test("update with explicit isActive=false → updateProduct called with false", async () => {
  reset();
  const res = await updateProductAction({
    productId: PID,
    product: product({ isActive: false }),
    locale: "en",
  });
  assert.deepEqual(res, { ok: true, productId: PID });
  assert.equal(updateCalls.length, 1);
  assert.equal(updateCalls[0].product.isActive, false);
});

test("update with explicit isActive=true → updateProduct called with true", async () => {
  reset();
  const res = await updateProductAction({
    productId: PID,
    product: product({ isActive: true }),
    locale: "en",
  });
  assert.deepEqual(res, { ok: true, productId: PID });
  assert.equal(updateCalls.length, 1);
  assert.equal(updateCalls[0].product.isActive, true);
});

// ── CREATE: historical default preserved (omitted ⇒ active) ───────────────
test("create omitting isActive → createProduct called with isActive=true (default)", async () => {
  reset();
  const res = await createProductAction({ product: product(), locale: "en" });
  assert.equal(res.ok, true);
  assert.equal(createCalls.length, 1);
  assert.equal(createCalls[0].product.isActive, true);
});

test("create with explicit isActive=false → createProduct called with false", async () => {
  reset();
  const res = await createProductAction({
    product: product({ isActive: false }),
    locale: "en",
  });
  assert.equal(res.ok, true);
  assert.equal(createCalls.length, 1);
  assert.equal(createCalls[0].product.isActive, false);
});

// ── An invalid product (bad required field) is rejected in BOTH modes ─────
test("a structurally invalid update payload is rejected before the RPC", async () => {
  reset();
  const res = await updateProductAction({
    productId: PID,
    product: product({ isActive: true, nameEn: "" }), // blank required name
    locale: "en",
  });
  assert.deepEqual(res, { ok: false });
  assert.equal(updateCalls.length, 0);
});
