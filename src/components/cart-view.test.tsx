import { dom } from "@/test-support/jsdom-env";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import React, { act, useEffect } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { CartView } from "@/components/cart-view";
import { locales, type Locale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { CartProvider, useCart } from "@/lib/cart-context";
import { formatCurrency } from "@/lib/format";
import { ShopDataProvider } from "@/lib/shop-data-context";
import type { CartItem, Customer, Product } from "@/lib/types";

const key = "11110000-0000-4000-8000-00000000004c";
const product: Product = {
  id: "first", sku: "CART-004C", categoryId: "missing-category", manufacturerId: "",
  translations: { ar: { name: "اسم منتج طويل ".repeat(12) }, he: { name: "שם מוצר ארוך ".repeat(12) }, en: { name: "LongProductWithoutBreaks".repeat(12) } },
  packageType: "carton", unitsPerPackage: 12, baseUnit: "bottles", unitSize: "330ml",
  wholesalePrice: 36.5, availability: "inStock",
};
const sold: Product = { ...product, id: "sold", wholesalePrice: 10, availability: "outOfStock" };
const customers: Customer[] = ["Alpha", "Beta"].map((name) => ({
  id: name, name, type: "grocery", city: { ar: "مدينة", he: "עיר", en: "City" }, phone: "", contactName: "",
}));
const initialItems = [{ productId: product.id, quantity: 2 }, { productId: sold.id, quantity: 3 }];
const cleanups: (() => void)[] = [];
type Cart = ReturnType<typeof useCart>;

function setup(locale: Locale, items: CartItem[] = initialItems, hydrate = false, products = [product, sold]) {
  localStorageSeed(items);
  const container = document.createElement("div");
  document.body.append(container);
  const captured: { current: Cart | null } = { current: null };
  function Probe() { const cart = useCart(); useEffect(() => { captured.current = cart; }); return null; }
  const dict = getDictionary(locale);
  const tree = <ShopDataProvider products={products} categories={[]} manufacturers={[]} customers={customers}>
    <CartProvider><Probe /><CartView locale={locale} dict={dict} /></CartProvider>
  </ShopDataProvider>;
  const errors: unknown[] = [];
  let root: ReturnType<typeof createRoot>;
  if (hydrate) {
    container.innerHTML = renderToString(tree);
    assert.equal(container.textContent?.trim(), "…");
    assert.equal(container.querySelector("a, textarea, button"), null);
    act(() => { root = hydrateRoot(container, tree, { onRecoverableError: (e) => errors.push(e) }); });
  } else {
    root = createRoot(container);
    act(() => root.render(tree));
  }
  cleanups.push(() => { act(() => root.unmount()); container.remove(); });
  return { container, dict, errors, cart: () => { assert.ok(captured.current); return captured.current; } };
}
function localStorageSeed(items: CartItem[]) {
  dom.window.localStorage.setItem("madaf.cart.v1", JSON.stringify({ items, customerId: "Alpha", submissionKey: key }));
}
function stored() { return JSON.parse(dom.window.localStorage.getItem("madaf.cart.v1")!); }
function line(container: HTMLElement, id: string) {
  let element = container.querySelector(`a[href$='/product/${id}']`)?.parentElement;
  while (element && !element.querySelector("button[aria-label='+']")) element = element.parentElement;
  assert.ok(element);
  return element;
}
function button(container: Element, label: string) {
  const element = Array.from(container.querySelectorAll("button")).find((b) => b.getAttribute("aria-label") === label || b.textContent?.trim() === label);
  assert.ok(element, `button ${label} exists`);
  return element;
}
function click(element: HTMLButtonElement) { act(() => element.click()); }
function assertIdentity(cart: Cart) {
  assert.equal(cart.submissionKey, key);
  assert.equal(stored().submissionKey, key);
  assert.equal(cart.customerId, "Alpha");
}
afterEach(() => { cleanups.splice(0).reverse().forEach((cleanup) => cleanup()); dom.window.localStorage.clear(); });

for (const locale of locales) {
  test(`${locale}: safe server loading hydrates existing lines, customer and key without mismatch`, () => {
    const h = setup(locale, initialItems, true);
    assert.deepEqual(h.errors, []);
    assert.equal(h.cart().hydrated, true);
    assert.equal(h.container.querySelectorAll("a[href*='/product/']").length, 2);
    assert.ok(h.container.querySelector("button[aria-expanded]")?.textContent?.includes("Alpha"));
    assertIdentity(h.cart());
  });
  test(`${locale}: empty cart retains localized browse destination`, () => {
    const h = setup(locale, []);
    assert.ok(h.container.textContent?.includes(h.dict.cart.empty));
    assert.equal(h.container.querySelector("a")?.getAttribute("href"), `/${locale}/catalog`);
    assert.equal(h.container.querySelector("a")?.textContent?.trim(), h.dict.cart.browseCatalog);
    assert.equal(h.container.querySelector("textarea"), null);
    assertIdentity(h.cart());
  });
  test(`${locale}: multiple lines, long names and absent categories preserve price and route contracts`, () => {
    const h = setup(locale);
    assert.equal(h.container.querySelector(`a[href='/${locale}/product/first']`)?.textContent, product.translations[locale].name);
    assert.ok(line(h.container, "first").textContent?.includes(formatCurrency(73, locale)));
    assert.equal(h.cart().subtotal, 103);
    assert.equal(h.cart().totalPackages, 5);
    assert.ok(h.container.textContent?.includes(formatCurrency(103, locale)));
    assert.ok(h.container.textContent?.includes(`5 ${h.dict.common.packages}`));
    assert.equal(h.container.querySelector(`a[href='/${locale}/checkout']`)?.textContent?.trim(), h.dict.cart.proceedCheckout);
    assert.equal(h.container.querySelector(`a[href='/${locale}/catalog']`)?.textContent?.trim(), h.dict.cart.continueShopping);
    assertIdentity(h.cart());
  });
  test(`${locale}: increase, decrease and remove update totals without rotating the key`, () => {
    const h = setup(locale);
    click(button(line(h.container, "first"), "+"));
    assert.equal(h.cart().subtotal, 139.5);
    assert.equal(h.cart().totalPackages, 6);
    click(button(line(h.container, "first"), "−"));
    assert.equal(h.cart().subtotal, 103);
    click(button(line(h.container, "first"), h.dict.common.remove));
    assert.equal(h.cart().subtotal, 30);
    assert.equal(h.container.querySelector("a[href$='/product/first']"), null);
    assert.equal(button(line(h.container, "sold"), "+").disabled, true);
    click(button(line(h.container, "sold"), "+"));
    assert.equal(h.cart().quantityOf("sold"), 3);
    for (let i = 0; i < 3; i++) click(button(line(h.container, "sold"), "−"));
    assert.ok(h.container.textContent?.includes(h.dict.cart.empty));
    assert.deepEqual(stored().items, []);
    assertIdentity(h.cart());
  });
  test(`${locale}: changing customer preserves lines/key and Escape restores picker focus`, () => {
    const h = setup(locale);
    const trigger = h.container.querySelector<HTMLButtonElement>("button[aria-expanded]")!;
    click(trigger);
    const choice = Array.from(h.container.querySelectorAll("[role=dialog] button")).find((b) => b.textContent?.includes("Beta")) as HTMLButtonElement;
    assert.ok(choice);
    click(choice);
    assert.equal(h.cart().customerId, "Beta");
    assert.equal(stored().customerId, "Beta");
    assert.deepEqual(stored().items, initialItems);
    assert.equal(stored().submissionKey, key);
    click(trigger);
    const search = h.container.querySelector("input[type=search]")!;
    assert.equal(document.activeElement, search);
    act(() => search.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    assert.equal(h.container.querySelector("[role=dialog]"), null);
    assert.equal(document.activeElement, trigger);
  });
}
test("stale persisted products are pruned; runtime missing products are safely skipped", () => {
  const h = setup("en", [...initialItems, { productId: "unknown", quantity: 50 }]);
  assert.deepEqual(h.cart().items, initialItems);
  act(() => h.cart().addItem("unknown", 5));
  assert.equal(h.container.querySelectorAll("a[href*='/product/']").length, 2);
  assert.equal(h.cart().subtotal, 103);
  assert.equal(h.cart().totalPackages, 5);
  assertIdentity(h.cart());
});
test("notes remain uncontrolled and do not enter cart persistence or submission state", () => {
  const h = setup("en");
  const before = stored();
  const notes = h.container.querySelector("textarea")!;
  assert.ok(notes);
  assert.equal(notes.name, "");
  notes.value = "Synthetic order note";
  act(() => notes.dispatchEvent(new dom.window.Event("input", { bubbles: true })));
  click(button(line(h.container, "first"), "+"));
  assert.equal(notes.value, "Synthetic order note");
  assert.deepEqual(Object.keys(stored()).sort(), Object.keys(before).sort());
  assert.ok(!JSON.stringify(stored()).includes(notes.value));
  assertIdentity(h.cart());
});
test("cart thumbnails opt into shared media, preserve real sources and fall back after failure", () => {
  const imageUrl = "https://example.test/opaque-package.jpg";
  const h = setup("en", initialItems, false, [{ ...product, imageUrl }, sold]);
  const photo = line(h.container, "first").querySelector("img")!;
  assert.ok(photo);
  assert.equal(photo.getAttribute("src"), imageUrl);
  assert.equal(photo.alt, "");
  assert.equal(photo.className, "storefront-media-photo");
  assert.ok(photo.parentElement?.hasAttribute("aria-hidden"));
  assert.equal(h.container.querySelector(".storefront-media-size"), null);
  assert.ok(line(h.container, "sold").querySelector(".storefront-placeholder"));
  act(() => photo.dispatchEvent(new dom.window.Event("error")));
  assert.equal(line(h.container, "first").querySelector("img"), null);
  assert.ok(line(h.container, "first").querySelector(".storefront-placeholder"));
});
test("clearing a selected customer preserves quantities, key and checkout navigation", () => {
  const h = setup("en");
  click(h.container.querySelector<HTMLButtonElement>("button[aria-expanded]")!);
  click(button(h.container.querySelector("[role=dialog]")!, h.dict.common.clear));
  assert.equal(h.cart().customerId, null);
  assert.equal(stored().customerId, null);
  assert.deepEqual(stored().items, initialItems);
  assert.equal(stored().submissionKey, key);
  assert.ok(h.container.querySelector("a[href='/en/checkout']"));
});
