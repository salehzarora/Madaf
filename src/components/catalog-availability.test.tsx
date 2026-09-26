/** Mounted C4 coverage: sold-out lines remain editable downwards on every
 * authenticated ordering surface, without mutating cart/submission semantics. */
import { dom } from "@/test-support/jsdom-env";

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import React, { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { CartView } from "@/components/cart-view";
import { OrderPad } from "@/components/order-pad";
import { ProductCard } from "@/components/product-card";
import { ProductDetailActions } from "@/components/product-detail-actions";
import { QuantityStepper } from "@/components/quantity-stepper";
import { getDictionary, interpolate } from "@/i18n/dictionaries";
import { CartProvider, useCart } from "@/lib/cart-context";
import { ShopDataProvider } from "@/lib/shop-data-context";
import type { Availability, Category, Product } from "@/lib/types";

const dict = getDictionary("en");
const STORAGE_KEY = "madaf.cart.v1";
const SUBMISSION_KEY = "11110000-0000-4000-8000-000000000001";
const category: Category = {
  id: "category", name: { en: "Products", ar: "منتجات", he: "מוצרים" }, icon: "📦", hue: 0,
};
const product: Product = {
  id: "product", sku: "TEST-AVAILABILITY", categoryId: category.id, manufacturerId: "brand",
  translations: { en: { name: "Test package" }, ar: { name: "عبوة اختبار" }, he: { name: "אריזת בדיקה" } },
  packageType: "carton", unitsPerPackage: 12, baseUnit: "bottles",
  wholesalePrice: 36, availability: "outOfStock",
};
const surfaces = ["card", "order panel", "review panel", "cart", "product detail"] as const;
type Surface = typeof surfaces[number];
type Cart = ReturnType<typeof useCart>;
const cleanups: (() => void)[] = [];

function mount(surface: Surface, initialAvailability: Availability = "outOfStock", quantity = 2) {
  dom.window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
    items: quantity > 0 ? [{ productId: product.id, quantity }] : [],
    customerId: "selected-shop",
    submissionKey: SUBMISSION_KEY,
  }));
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const captured: { current: Cart | null } = { current: null };
  function Probe() {
    const cart = useCart();
    useEffect(() => { captured.current = cart; });
    return null;
  }
  function render(availability: Availability) {
    const currentProduct = { ...product, availability };
    const content = surface === "card" ? (
      <ProductCard product={currentProduct} category={category} locale="en" dict={dict} />
    ) : surface === "product detail" ? (
      <ProductDetailActions product={currentProduct} locale="en" dict={dict} />
    ) : surface === "cart" ? (
      <CartView locale="en" dict={dict} />
    ) : (
      // The modal reuses these exact lines and controls; no separate cart copy.
      <OrderPad locale="en" dict={dict} onClose={surface === "review panel" ? () => {} : undefined} />
    );
    act(() => root.render(
      <ShopDataProvider products={[currentProduct]} categories={[category]} manufacturers={[]} customers={[]}>
        <CartProvider><Probe />{content}</CartProvider>
      </ShopDataProvider>,
    ));
  }
  render(initialAvailability);
  cleanups.push(() => { act(() => root.unmount()); container.remove(); });
  return {
    container, render,
    cart: () => { assert.ok(captured.current); return captured.current; },
  };
}
type Harness = ReturnType<typeof mount>;

afterEach(() => {
  cleanups.splice(0).reverse().forEach((cleanup) => cleanup());
  dom.window.localStorage.clear();
});

function quantityButton(h: Harness, direction: "increase" | "decrease") {
  const labels = [
    direction === "increase" ? "+" : "−",
    interpolate(dict.catalog[direction === "increase" ? "increaseQuantity" : "decreaseQuantity"], { product: product.translations.en.name }),
  ];
  const button = Array.from(h.container.querySelectorAll("button")).find((element) => labels.includes(element.getAttribute("aria-label") ?? ""));
  assert.ok(button, `${direction} control exists`);
  return button;
}
function click(button: HTMLButtonElement) { act(() => button.click()); }
function assertCart(h: Harness, quantity: number) {
  assert.equal(h.cart().quantityOf(product.id), quantity);
  assert.equal(h.cart().totalPackages, quantity);
  assert.equal(h.cart().subtotal, quantity * product.wholesalePrice);
  assert.equal(h.cart().customerId, "selected-shop");
  assert.equal(h.cart().submissionKey, SUBMISSION_KEY);
  const persisted = JSON.parse(dom.window.localStorage.getItem(STORAGE_KEY)!);
  assert.deepEqual(persisted.items, quantity > 0 ? [{ productId: product.id, quantity }] : []);
  assert.equal(persisted.customerId, "selected-shop");
  assert.equal(persisted.submissionKey, SUBMISSION_KEY);
}
function initialAdd(h: Harness) {
  const button = Array.from(h.container.querySelectorAll("button")).find((element) =>
    element.getAttribute("aria-label") === dict.catalog.addToCart ||
    element.textContent?.trim() === dict.availability.outOfStock ||
    element.textContent?.trim() === dict.product.addToCart,
  );
  assert.ok(button, "initial add control exists");
  return button;
}

for (const surface of surfaces) {
  test(`${surface}: a persisted sold-out line cannot increase, can decrease to removal, and keeps the submission key`, () => {
    const h = mount(surface);
    assertCart(h, 2);
    const plus = quantityButton(h, "increase");
    assert.equal(plus.disabled, true, "sold-out increments are unavailable");
    click(plus);
    assertCart(h, 2);
    const minus = quantityButton(h, "decrease");
    assert.equal(minus.disabled, false, "existing stock is never trapped in the cart");
    click(minus);
    assertCart(h, 1);
    assert.equal(quantityButton(h, "increase").disabled, true);
    click(quantityButton(h, "decrease"));
    assertCart(h, 0);
    if (surface === "card" || surface === "product detail") {
      assert.equal(initialAdd(h).disabled, true, "removing a sold-out item never enables re-add");
      click(initialAdd(h));
      assertCart(h, 0);
    } else {
      assert.ok(h.container.textContent?.includes(dict.cart.empty));
    }
  });

  test(`${surface}: becoming sold out retains quantity; low stock and restocking re-enable increases`, () => {
    const h = mount(surface, "inStock");
    click(quantityButton(h, "increase"));
    assertCart(h, 3);
    h.render("outOfStock");
    assertCart(h, 3);
    assert.equal(quantityButton(h, "increase").disabled, true);
    click(quantityButton(h, "increase"));
    assertCart(h, 3);
    h.render("lowStock");
    assert.equal(quantityButton(h, "increase").disabled, false, "low stock remains orderable");
    click(quantityButton(h, "increase"));
    assertCart(h, 4);
    h.render("inStock");
    click(quantityButton(h, "increase"));
    assertCart(h, 5);
  });
}

for (const surface of ["order panel", "review panel", "cart"] as const) {
  test(`${surface}: explicit removal remains enabled for sold-out lines`, () => {
    const h = mount(surface);
    const remove = Array.from(h.container.querySelectorAll("button")).find((button) =>
      button.getAttribute("aria-label") === dict.common.remove || button.textContent?.trim() === dict.common.remove,
    );
    assert.ok(remove);
    assert.equal(remove.disabled, false);
    click(remove);
    assertCart(h, 0);
  });
}

for (const surface of ["card", "product detail"] as const) {
  test(`${surface}: a sold-out product cannot be initially added`, () => {
    const h = mount(surface, "outOfStock", 0);
    assert.equal(initialAdd(h).disabled, true);
    click(initialAdd(h));
    assertCart(h, 0);
  });
}

test("the default shared stepper still allows increases and honors max for unchanged consumers", () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  cleanups.push(() => { act(() => root.unmount()); container.remove(); });
  const changes: number[] = [];
  act(() => root.render(<QuantityStepper value={2} onChange={(value) => changes.push(value)} max={3} />));
  const plus = container.querySelector<HTMLButtonElement>("button[aria-label='+']");
  assert.ok(plus);
  assert.equal(plus.disabled, false);
  click(plus);
  assert.deepEqual(changes, [3]);
  act(() => root.render(<QuantityStepper value={3} onChange={(value) => changes.push(value)} max={3} />));
  assert.equal(plus.disabled, true);
  click(plus);
  assert.deepEqual(changes, [3]);
});
