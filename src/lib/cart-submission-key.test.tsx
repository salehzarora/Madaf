/**
 * PILOT-OPS-AUDIT-008-FIX1 — cart-context submission-key lifecycle (mounted).
 *
 * The DATABASE is the authoritative idempotency gate (proven by pgTAP + the live
 * probes); this proves the CLIENT transports one stable key per logical order:
 *   • ensureSubmissionKey generates a UUID once and returns the SAME key on retry;
 *   • a rerender / cart change does NOT mint a second key;
 *   • the key persists to localStorage and survives a refresh (remount) — so an
 *     ambiguous-failure retry reuses it;
 *   • resetSubmissionKey (an explicit new attempt) and clear() (a successful
 *     submit) BOTH rotate the key so the next order is a fresh logical one.
 *
 * Runner: `npm run test:cart-submission-key` (plain tsx — needs React hooks).
 */
// FIRST: the DOM globals must exist before react-dom/client is evaluated.
import { dom } from "@/test-support/jsdom-env";

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import React, { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";

import { CartProvider, useCart } from "@/lib/cart-context";
import { ShopDataProvider } from "@/lib/shop-data-context";
import type { Category, Customer, Manufacturer, Product } from "@/lib/types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Capture the live cart context in an EFFECT (never reassigned during render),
// so the tests can drive its methods after each act() flush.
type CartCtx = ReturnType<typeof useCart>;
const sink: { current: CartCtx | null } = { current: null };
function Probe() {
  const c = useCart();
  useEffect(() => {
    sink.current = c;
  });
  return null;
}

const EMPTY = {
  products: [] as Product[],
  categories: [] as Category[],
  manufacturers: [] as Manufacturer[],
  customers: [] as Customer[],
};

const roots: Root[] = [];
function mount(data: Partial<typeof EMPTY> = {}): void {
  const container = dom.window.document.createElement("div");
  dom.window.document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => {
    root.render(
      <ShopDataProvider {...EMPTY} {...data}>
        <CartProvider>
          <Probe />
        </CartProvider>
      </ShopDataProvider>,
    );
  });
}
function unmountAll(): void {
  for (const r of roots.splice(0)) act(() => r.unmount());
}
const cart = (): CartCtx => {
  assert.ok(sink.current, "cart context captured");
  return sink.current;
};

afterEach(() => {
  unmountAll();
  sink.current = null;
  dom.window.localStorage.clear();
});

test("ensureSubmissionKey generates a UUID and is STABLE across calls (retry reuse)", () => {
  mount();
  let k1 = "";
  let k2 = "";
  act(() => {
    k1 = cart().ensureSubmissionKey();
  });
  act(() => {
    k2 = cart().ensureSubmissionKey();
  });
  assert.match(k1, UUID);
  assert.equal(k2, k1, "a second call (a retry of the same submission) returns the SAME key");
});

test("a rerender / cart change does NOT mint a second key", () => {
  mount();
  let k1 = "";
  let k2 = "";
  act(() => {
    k1 = cart().ensureSubmissionKey();
  });
  act(() => cart().addItem("p1", 1)); // forces a rerender + a state write
  act(() => {
    k2 = cart().ensureSubmissionKey();
  });
  assert.equal(k2, k1, "the key survives a rerender and a cart mutation");
});

test("the key persists to localStorage and survives a refresh (remount)", () => {
  mount();
  let k1 = "";
  act(() => {
    k1 = cart().ensureSubmissionKey();
  });
  const raw = dom.window.localStorage.getItem("madaf.cart.v1");
  assert.ok(raw && raw.includes(k1), "the key is written into the persisted cart");
  // A refresh: unmount + remount reads the persisted key (mid-retry survival).
  unmountAll();
  mount();
  let k2 = "";
  act(() => {
    k2 = cart().ensureSubmissionKey();
  });
  assert.equal(k2, k1, "a refresh reuses the persisted key — an ambiguous-failure retry is idempotent");
});

test("resetSubmissionKey rotates the key (explicit new attempt after a conflict)", () => {
  mount();
  let k1 = "";
  let k2 = "";
  act(() => {
    k1 = cart().ensureSubmissionKey();
  });
  act(() => cart().resetSubmissionKey());
  act(() => {
    k2 = cart().ensureSubmissionKey();
  });
  assert.match(k2, UUID);
  assert.notEqual(k2, k1, "after an explicit reset the next submit gets a fresh key");
});

test("clear() (a successful submit) rotates the key for the next order", () => {
  mount();
  let k1 = "";
  let k2 = "";
  act(() => {
    k1 = cart().ensureSubmissionKey();
  });
  act(() => cart().clear());
  act(() => {
    k2 = cart().ensureSubmissionKey();
  });
  assert.notEqual(k2, k1, "a new logical cart gets a fresh key after a successful submit");
});

const product: Product = {
  id: "current-product", sku: "CURRENT", categoryId: "category", manufacturerId: "",
  translations: { ar: { name: "منتج" }, he: { name: "מוצר" }, en: { name: "Product" } },
  packageType: "carton", unitsPerPackage: 6, baseUnit: "bottles",
  wholesalePrice: 18, availability: "inStock",
};
const customer: Customer = {
  id: "current-customer", name: "Current shop", type: "grocery",
  city: { ar: "", he: "", en: "" }, phone: "", contactName: "",
};

test("stale customer hydration clears its key, retains current items and persists the sanitized cart", () => {
  const staleKey = crypto.randomUUID();
  dom.window.localStorage.setItem("madaf.cart.v1", JSON.stringify({
    items: [{ productId: product.id, quantity: 3 }], customerId: "other-context-customer", submissionKey: staleKey,
  }));
  mount({ products: [product], customers: [] });
  assert.equal(cart().customerId, null);
  assert.equal(cart().submissionKey, null);
  assert.deepEqual(cart().items, [{ productId: product.id, quantity: 3 }]);
  const sanitized = JSON.parse(dom.window.localStorage.getItem("madaf.cart.v1")!);
  assert.equal(sanitized.customerId, null);
  assert.equal(sanitized.submissionKey, null);
  unmountAll();
  mount({ products: [product], customers: [] });
  let freshKey = "";
  act(() => { freshKey = cart().ensureSubmissionKey(); });
  assert.match(freshKey, UUID);
  assert.notEqual(freshKey, staleKey);
});

test("rejected product items drop the stored submission key even when the customer remains current", () => {
  const staleKey = crypto.randomUUID();
  dom.window.localStorage.setItem("madaf.cart.v1", JSON.stringify({
    items: [{ productId: product.id, quantity: 2 }, { productId: "removed-product", quantity: 1 }],
    customerId: customer.id, submissionKey: staleKey,
  }));
  mount({ products: [product], customers: [customer] });
  assert.equal(cart().customerId, customer.id);
  assert.deepEqual(cart().items, [{ productId: product.id, quantity: 2 }]);
  assert.equal(cart().submissionKey, null);
  let freshKey = "";
  act(() => { freshKey = cart().ensureSubmissionKey(); });
  assert.notEqual(freshKey, staleKey);
});

for (const customerId of [null, customer.id]) {
  test(`same-context refresh preserves exact ambiguous-retry key with customer ${customerId ?? "null"}`, () => {
    const key = crypto.randomUUID();
    const items = [{ productId: product.id, quantity: 3 }];
    dom.window.localStorage.setItem("madaf.cart.v1", JSON.stringify({ items, customerId, submissionKey: key }));
    mount({ products: [product], customers: [customer] });
    assert.equal(cart().customerId, customerId);
    assert.deepEqual(cart().items, items);
    assert.equal(cart().submissionKey, key);
    unmountAll();
    mount({ products: [product], customers: [customer] });
    let retryKey = "";
    act(() => { retryKey = cart().ensureSubmissionKey(); });
    assert.equal(retryKey, key);
    assert.equal(cart().customerId, customerId);
    assert.deepEqual(cart().items, items);
  });
}
