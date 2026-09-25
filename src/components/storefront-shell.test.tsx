/** Mounted shared-header and customer-picker contracts; native top-layer layout
 * and touch sizing are also exercised in browser QA, not class snapshots. */
import { dom } from "@/test-support/jsdom-env";

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import React, { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { PathnameContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { AppShell } from "@/components/app-shell";
import { CustomerPicker } from "@/components/customer-picker";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { dirFor, localeNames, locales, type Locale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { CartProvider, useCart } from "@/lib/cart-context";
import { ShopDataProvider } from "@/lib/shop-data-context";
import type { Customer, Product } from "@/lib/types";

const products: Product[] = [{
  id: "product", sku: "TEST-1", categoryId: "category", manufacturerId: "manufacturer",
  translations: { en: { name: "Product" }, ar: { name: "منتج" }, he: { name: "מוצר" } },
  packageType: "carton", unitsPerPackage: 12, baseUnit: "bottles", wholesalePrice: 36,
  availability: "inStock",
}];
const customers: Customer[] = [
  { id: "a", name: "Shop A", city: { en: "Haifa", ar: "حيفا", he: "חיפה" }, type: "grocery", phone: "0501111111", contactName: "Alex" },
  { id: "b", name: "Shop B", city: { en: "Nazareth", ar: "الناصرة", he: "נצרת" }, type: "kiosk", phone: "0502222222", contactName: "Sam" },
  { id: "inactive", name: "Inactive", city: { en: "Haifa", ar: "حيفا", he: "חיפה" }, type: "grocery", phone: "0503333333", contactName: "Taylor", isActive: false },
];
const KEY = "11110000-0000-4000-8000-000000000001";
const cleanups: (() => void)[] = [];
type Cart = ReturnType<typeof useCart>;

function mount(locale: Locale = "en", path = `/${locale}/catalog`, picker = false) {
  const container = document.createElement("div");
  container.dir = dirFor(locale);
  document.body.append(container);
  const root = createRoot(container);
  const dict = getDictionary(locale);
  const captured: { current: Cart | null } = { current: null };
  function Probe() {
    const cart = useCart();
    useEffect(() => { captured.current = cart; });
    return null;
  }
  act(() => root.render(
    <PathnameContext.Provider value={path}>
      <ShopDataProvider products={products} categories={[]} manufacturers={[]} customers={customers}>
        <CartProvider>
          <Probe />
          <AppShell locale={locale} dict={dict}>
            <p data-testid="route-content">{path}</p>
            {picker ? <CustomerPicker locale={locale} dict={dict} /> : null}
          </AppShell>
        </CartProvider>
      </ShopDataProvider>
    </PathnameContext.Provider>,
  ));
  cleanups.push(() => { act(() => root.unmount()); container.remove(); });
  return {
    container, dict,
    cart: () => { assert.ok(captured.current); return captured.current; },
  };
}

afterEach(() => {
  cleanups.splice(0).reverse().forEach((cleanup) => cleanup());
  dom.window.localStorage.clear();
  dom.window.history.replaceState(null, "", "/");
});

function seed() {
  dom.window.localStorage.setItem("madaf.cart.v1", JSON.stringify({
    customerId: "a", items: [{ productId: "product", quantity: 2 }], submissionKey: KEY,
  }));
}
function click(button: HTMLButtonElement) { act(() => button.click()); }
function button(root: ParentNode, label: string) {
  const element = Array.from(root.querySelectorAll("button")).find((b) => b.getAttribute("aria-label") === label);
  assert.ok(element, `button labelled ${label}`);
  return element;
}
function escape(element: HTMLElement) {
  const event = new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  act(() => element.dispatchEvent(event));
  return event;
}

for (const locale of locales) {
  test(`${locale}: shared header retains navigation and children across catalog/product/cart/checkout paths`, () => {
    for (const suffix of ["catalog", "product/product", "cart", "checkout"]) {
      const path = `/${locale}/${suffix}`;
      const { container, dict } = mount(locale, path);
      const header = container.querySelector("header");
      assert.ok(header);
      const catalog = header.querySelector(`a[href='/${locale}/catalog']`);
      assert.ok(catalog);
      assert.equal(catalog.getAttribute("aria-current"), suffix === "catalog" ? "page" : null);
      assert.equal(header.querySelector(`a[aria-label='${dict.nav.cart}']`)?.getAttribute("href"), `/${locale}/cart`);
      assert.equal(header.querySelector(`a[aria-label='${dict.nav.admin}']`)?.getAttribute("href"), `/${locale}/admin`);
      assert.equal(container.querySelector("main [data-testid='route-content']")?.textContent, path);
      assert.ok(button(header, `${dict.common.language}: ${localeNames[locale]}`));
    }
  });

  test(`${locale}: compact locale disclosure preserves path, drops query and returns focus on Escape`, () => {
    dom.window.history.replaceState(null, "", `/${locale}/cart?customer=b`);
    const { container, dict } = mount(locale, `/${locale}/cart`);
    const trigger = button(container, `${dict.common.language}: ${localeNames[locale]}`);
    assert.equal(trigger.getAttribute("aria-expanded"), "false");
    act(() => trigger.focus());
    click(trigger);
    const panel = document.getElementById(trigger.getAttribute("aria-controls")!);
    assert.ok(panel);
    assert.equal(trigger.getAttribute("aria-expanded"), "true");
    assert.equal(document.activeElement, panel.querySelector("a[aria-current='true']"));
    for (const target of locales) {
      const link: HTMLAnchorElement | null = panel.querySelector<HTMLAnchorElement>(`a[lang='${target}']`);
      assert.equal(link?.getAttribute("href"), `/${target}/cart`);
      assert.equal(link?.textContent, localeNames[target]);
    }
    const event = escape(document.activeElement as HTMLElement);
    assert.equal(event.defaultPrevented, true);
    assert.equal(trigger.getAttribute("aria-expanded"), "false");
    assert.equal(document.activeElement, trigger);
  });
}

test("default locale switcher remains segmented for existing admin/private-shop/showcase consumers", () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  cleanups.push(() => { act(() => root.unmount()); container.remove(); });
  for (const path of ["/en/admin", "/en/shop/token", "/en/showcase/token"]) {
    act(() => root.render(
      <PathnameContext.Provider value={path}><LocaleSwitcher current="en" /></PathnameContext.Provider>,
    ));
    assert.equal(container.querySelectorAll("nav a").length, 3);
    assert.equal(container.querySelector("button"), null);
    assert.equal(container.querySelector("a[aria-current='true']")?.getAttribute("href"), path);
  }
});

test("header badge follows the same hydrated cart through quantity changes and removal", () => {
  seed();
  const h = mount();
  const cartLink = h.container.querySelector(`header a[aria-label='${h.dict.nav.cart}']`);
  assert.ok(cartLink);
  assert.equal(cartLink.querySelector("span[dir='ltr']")?.textContent, "2");
  act(() => h.cart().setQuantity("product", 5));
  assert.equal(cartLink.querySelector("span[dir='ltr']")?.textContent, "5");
  act(() => h.cart().removeItem("product"));
  assert.equal(cartLink.querySelector("span[dir='ltr']"), null);
  assert.equal(h.cart().submissionKey, KEY);
});

test("change-shop opens directly, preserves current selection and key, and explicit Clear stays separate", () => {
  seed();
  const h = mount("en", "/en/cart", true);
  const trigger = button(h.container, `${h.dict.catalog.changeShop}: Shop A`);
  click(trigger);
  assert.equal(h.cart().customerId, "a", "opening the picker never clears selection");
  assert.equal(h.cart().submissionKey, KEY);
  assert.deepEqual(h.cart().items, [{ productId: "product", quantity: 2 }]);
  const popup = h.container.querySelector("[popover]");
  assert.ok(popup);
  const inactive = Array.from(popup.querySelectorAll("button")).find((b) => b.textContent?.includes("Inactive"));
  assert.equal(inactive?.disabled, true);
  const shopB = Array.from(popup.querySelectorAll("button")).find((b) => b.textContent?.includes("Shop B"));
  assert.ok(shopB);
  click(shopB);
  assert.equal(h.cart().customerId, "b");
  assert.equal(document.activeElement, trigger);
  assert.equal(h.cart().submissionKey, KEY);
  click(trigger);
  const clear = Array.from(h.container.querySelectorAll<HTMLButtonElement>("[popover] button")).find((b) => b.textContent?.trim() === h.dict.common.clear);
  assert.ok(clear);
  click(clear);
  assert.equal(h.cart().customerId, null);
  assert.equal(h.cart().submissionKey, KEY);
  assert.deepEqual(h.cart().items, [{ productId: "product", quantity: 2 }]);
});

test("picker Escape is consumed before an enclosing review and restores trigger focus", () => {
  seed();
  const h = mount("he", "/he/catalog", true);
  let escapedToParent = false;
  function parentKeydown(event: KeyboardEvent) { if (event.key === "Escape") escapedToParent = true; }
  document.addEventListener("keydown", parentKeydown);
  cleanups.push(() => document.removeEventListener("keydown", parentKeydown));
  const trigger = button(h.container, `${h.dict.catalog.changeShop}: Shop A`);
  click(trigger);
  const search = h.container.querySelector<HTMLInputElement>("[popover] input");
  assert.ok(search);
  assert.equal(document.activeElement, search);
  const event = escape(search);
  assert.equal(event.defaultPrevented, true);
  assert.equal(escapedToParent, false);
  assert.equal(h.container.querySelector("[popover]"), null);
  assert.equal(document.activeElement, trigger);
  assert.equal(h.cart().customerId, "a");
});

test("picker uses available viewport space above a low trigger and repositions on resize", () => {
  const h = mount("ar", "/ar/catalog", true);
  const trigger = button(h.container, h.dict.catalog.selectShop);
  trigger.getBoundingClientRect = () => ({
    top: window.innerHeight - 54, bottom: window.innerHeight - 10,
    left: window.innerWidth - 288, right: window.innerWidth, width: 288, height: 44,
    x: window.innerWidth - 288, y: window.innerHeight - 54, toJSON() {},
  });
  click(trigger);
  const popup = h.container.querySelector<HTMLElement>("[popover]");
  assert.ok(popup);
  assert.equal(popup.dir, "rtl");
  assert.equal(popup.style.insetBlockStart, "auto", "opens above when there is no space below");
  assert.ok(parseFloat(popup.style.insetInlineStart) >= 8);
  assert.ok(parseFloat(popup.style.width) <= window.innerWidth - 16);
  trigger.getBoundingClientRect = () => ({ top: 80, bottom: 124, left: 8, right: 296, width: 288, height: 44, x: 8, y: 80, toJSON() {} });
  act(() => window.dispatchEvent(new dom.window.Event("resize")));
  assert.equal(popup.style.insetBlockEnd, "auto", "repositions below after orientation/viewport changes");
  assert.ok(parseFloat(popup.style.maxHeight) <= window.innerHeight - 124 - 14);
});

test("RTL picker keeps its viewport gutter when a scrollbar reduces the layout width", () => {
  const page = document.documentElement;
  const previousWidth = Object.getOwnPropertyDescriptor(page, "clientWidth");
  const layoutWidth = window.innerWidth - 15;
  Object.defineProperty(page, "clientWidth", { configurable: true, value: layoutWidth });
  cleanups.push(() => {
    if (previousWidth) Object.defineProperty(page, "clientWidth", previousWidth);
    else Reflect.deleteProperty(page, "clientWidth");
  });
  const h = mount("ar", "/ar/catalog", true);
  const trigger = button(h.container, h.dict.catalog.selectShop);
  trigger.getBoundingClientRect = () => ({
    top: 80, bottom: 124, left: 8, right: 296, width: 288, height: 44,
    x: 8, y: 80, toJSON() {},
  });
  click(trigger);
  const popup = h.container.querySelector<HTMLElement>("[popover]");
  assert.ok(popup);
  // Fixed RTL inset-inline-start is measured from the layout viewport's right
  // edge, which excludes the scrollbar. jsdom does not perform that layout.
  const positionedLeft = layoutWidth - parseFloat(popup.style.insetInlineStart) - parseFloat(popup.style.width);
  assert.equal(positionedLeft, 8, "the popup must retain its 8px gutter, not shift under the scrollbar");
});
