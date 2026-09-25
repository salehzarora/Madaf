/** Mounted Phase B integration using the real catalog, cart and order panel.
 * jsdom has no modal top layer/layout: ONLY native showModal/close, media-query
 * events, scroll APIs and explicit focus-target rectangles are supplied here.
 * Browser QA must separately verify native focus trapping, inert background,
 * physical visibility, scrolling and touch/orientation behavior.
 */
import { dom } from "@/test-support/jsdom-env";

import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import React, { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { CatalogView } from "@/components/catalog-view";
import { getDictionary, interpolate } from "@/i18n/dictionaries";
import { dirFor, type Locale } from "@/i18n/config";
import { CartProvider, useCart } from "@/lib/cart-context";
import { formatCurrency } from "@/lib/format";
import { ShopDataProvider } from "@/lib/shop-data-context";
import type { Category, Customer, Product } from "@/lib/types";

const product: Product = {
  id: "review-product", sku: "REVIEW-1", categoryId: "review-category", manufacturerId: "review-brand",
  translations: { en: { name: "Test package" }, ar: { name: "عبوة اختبار" }, he: { name: "אריזת בדיקה" } },
  packageType: "carton", unitsPerPackage: 12, baseUnit: "bottles", wholesalePrice: 24, availability: "inStock",
};
const category: Category = { id: "review-category", name: { en: "Drinks", ar: "مشروبات", he: "משקאות" }, icon: "🥤", hue: 180 };
const customers: Customer[] = [
  { id: "review-shop-a", name: "Review Shop A", city: { en: "Haifa", ar: "حيفا", he: "חיפה" }, phone: "0501111111", contactName: "A", type: "grocery" },
  { id: "review-shop-b", name: "Review Shop B", city: { en: "Haifa", ar: "حيفا", he: "חיפה" }, phone: "0502222222", contactName: "B", type: "grocery" },
];
const KEY = "11110000-0000-4000-8000-000000000003";
const PANEL_QUERY = "(min-width: 1024px) and (min-height: 650px)";
const cleanups: (() => void)[] = [];
const originalMatchMedia = window.matchMedia;
const originalScrollTo = window.scrollTo;
const originalScrollX = Object.getOwnPropertyDescriptor(window, "scrollX");
const originalScrollY = Object.getOwnPropertyDescriptor(window, "scrollY");
const dialogPrototype = dom.window.HTMLDialogElement.prototype;
const originalShowModal = Object.getOwnPropertyDescriptor(dialogPrototype, "showModal");
const originalClose = Object.getOwnPropertyDescriptor(dialogPrototype, "close");
const mediaListeners = new Set<(event: MediaQueryListEvent) => void>();
let matchesPanel = false;
let modalCalls = 0;
let closeCalls = 0;
let scrollCalls: unknown[][] = [];

beforeEach(() => {
  matchesPanel = false;
  modalCalls = 0;
  closeCalls = 0;
  scrollCalls = [];
  Object.defineProperty(window, "scrollX", { configurable: true, value: 12 });
  Object.defineProperty(window, "scrollY", { configurable: true, value: 240 });
  mediaListeners.clear();
  Object.defineProperty(dialogPrototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) { modalCalls += 1; this.open = true; },
  });
  Object.defineProperty(dialogPrototype, "close", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      closeCalls += 1;
      this.open = false;
      this.dispatchEvent(new dom.window.Event("close"));
    },
  });
  window.matchMedia = ((query: string) => {
    assert.equal(query, PANEL_QUERY, "responsive policy includes width AND usable height");
    return {
      media: query,
      get matches() { return matchesPanel; },
      addEventListener: (_event: string, listener: (event: MediaQueryListEvent) => void) => mediaListeners.add(listener),
      removeEventListener: (_event: string, listener: (event: MediaQueryListEvent) => void) => mediaListeners.delete(listener),
    } as unknown as MediaQueryList;
  }) as typeof window.matchMedia;
  window.scrollTo = ((...args: unknown[]) => { scrollCalls.push(args); }) as typeof window.scrollTo;
});

afterEach(() => {
  cleanups.splice(0).reverse().forEach((cleanup) => cleanup());
  window.matchMedia = originalMatchMedia;
  window.scrollTo = originalScrollTo;
  if (originalScrollX) Object.defineProperty(window, "scrollX", originalScrollX);
  if (originalScrollY) Object.defineProperty(window, "scrollY", originalScrollY);
  if (originalShowModal) Object.defineProperty(dialogPrototype, "showModal", originalShowModal);
  else Reflect.deleteProperty(dialogPrototype, "showModal");
  if (originalClose) Object.defineProperty(dialogPrototype, "close", originalClose);
  else Reflect.deleteProperty(dialogPrototype, "close");
  document.body.removeAttribute("style");
  document.documentElement.removeAttribute("style");
  dom.window.localStorage.clear();
});

function mount(locale: Locale = "en") {
  dom.window.localStorage.setItem("madaf.cart.v1", JSON.stringify({
    items: [{ productId: product.id, quantity: 2 }], customerId: customers[0].id, submissionKey: KEY,
  }));
  const dict = getDictionary(locale);
  const container = document.createElement("div");
  container.dir = dirFor(locale);
  document.body.append(container);
  const root = createRoot(container);
  let disposed = false;
  const captured: { current: ReturnType<typeof useCart> | null } = { current: null };
  function Probe() {
    const cart = useCart();
    useEffect(() => { captured.current = cart; });
    return null;
  }
  act(() => root.render(
    <ShopDataProvider products={[product]} categories={[category]} manufacturers={[]} customers={customers}>
      <CartProvider>
        <Probe />
        <CatalogView locale={locale} dict={dict} supplier={{ name: "Review supplier" }} />
      </CartProvider>
    </ShopDataProvider>,
  ));
  function unmount() {
    if (disposed) return;
    disposed = true;
    act(() => root.unmount());
    container.remove();
  }
  cleanups.push(unmount);
  return { container, dict, locale, unmount, cart: () => { assert.ok(captured.current); return captured.current; } };
}
type Harness = ReturnType<typeof mount>;

function labelledButton(root: ParentNode, label: string) {
  const button = Array.from(root.querySelectorAll("button")).find((b) => (b.getAttribute("aria-label") ?? b.textContent?.trim()) === label);
  assert.ok(button, `button labelled ${label}`);
  return button;
}
function click(button: HTMLButtonElement) {
  assert.equal(button.disabled, false);
  act(() => button.click());
}
function visibleForFocus(element: HTMLElement, visible = true) {
  element.getClientRects = () => (visible ? [{ width: 44, height: 44 }] : []) as unknown as DOMRectList;
}
function open(h: Harness) {
  const trigger = labelledButton(h.container, h.dict.catalog.reviewCart);
  visibleForFocus(trigger);
  act(() => trigger.focus());
  click(trigger);
  const dialog = h.container.querySelector("dialog");
  assert.ok(dialog);
  assert.equal(dialog.open, true);
  assert.equal(trigger.getAttribute("aria-haspopup"), "dialog");
  assert.equal(trigger.getAttribute("aria-expanded"), "true");
  assert.equal(trigger.getAttribute("aria-controls"), dialog.id);
  return { trigger, dialog };
}
function quantity(h: Harness, root: ParentNode, direction: "increase" | "decrease") {
  return labelledButton(root, interpolate(direction === "increase" ? h.dict.catalog.increaseQuantity : h.dict.catalog.decreaseQuantity, { product: product.translations[h.locale].name }));
}
async function setPanel(matches: boolean) {
  matchesPanel = matches;
  await act(async () => {
    const event = { matches, media: PANEL_QUERY } as MediaQueryListEvent;
    for (const listener of mediaListeners) listener(event);
  });
}

for (const locale of ["ar", "he", "en"] as const) {
  test(`${locale}: review has a name, explicit initial focus, cart-only continuation and close restores focus/styles`, async () => {
    document.body.style.position = "relative";
    document.body.style.top = "3px";
    document.documentElement.style.overflow = "clip";
    const oldBody = document.body.getAttribute("style");
    const oldHtml = document.documentElement.getAttribute("style");
    const h = mount(locale);
    const { trigger, dialog } = open(h);
    assert.equal(modalCalls, 1, "uses native modal presentation");
    const headingId = dialog.getAttribute("aria-labelledby");
    assert.ok(headingId);
    assert.equal(document.getElementById(headingId)?.textContent, h.dict.cart.orderSummary);
    assert.equal(dialog.getAttribute("dir"), dirFor(locale));
    const closeButton = labelledButton(dialog, h.dict.common.close);
    assert.equal(document.activeElement, closeButton);
    assert.equal(document.body.style.position, "fixed");
    assert.equal(document.documentElement.style.overflow, "hidden");
    const links = Array.from(dialog.querySelectorAll("a"));
    assert.equal(links.length, 1);
    assert.equal(links[0].getAttribute("href"), `/${locale}/cart`);
    assert.equal(dialog.querySelector("form, button[type='submit']"), null, "review is not a second order-submission surface");
    await act(async () => closeButton.click());
    assert.equal(dialog.open, false);
    assert.equal(dialog.querySelector("aside"), null);
    assert.equal(trigger.getAttribute("aria-expanded"), "false");
    assert.equal(document.activeElement, trigger);
    assert.equal(document.body.getAttribute("style"), oldBody);
    assert.equal(document.documentElement.getAttribute("style"), oldHtml);
    assert.equal(closeCalls, 1);
    assert.equal(scrollCalls.length, 1, "restores scroll once");
    assert.deepEqual(scrollCalls[0], [12, 240], "restores the captured scroll offset");
  });
}

test("Tab and Shift+Tab wrap between visible modal controls", () => {
  const h = mount();
  const { dialog } = open(h);
  const first = labelledButton(dialog, h.dict.common.close);
  const last = dialog.querySelector<HTMLAnchorElement>('a[href="/en/cart"]');
  assert.ok(last);
  for (const control of dialog.querySelectorAll<HTMLElement>("button, a, input")) visibleForFocus(control);
  const backward = new dom.window.KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true });
  act(() => { first.focus(); first.dispatchEvent(backward); });
  assert.equal(backward.defaultPrevented, true);
  assert.equal(document.activeElement, last);
  const forward = new dom.window.KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
  act(() => last.dispatchEvent(forward));
  assert.equal(forward.defaultPrevented, true);
  assert.equal(document.activeElement, first);
});

test("review edits update card, desktop pad, summary and customer through the same persisted cart", () => {
  const h = mount();
  const { dialog } = open(h);
  const card = h.container.querySelector("article");
  const desktop = h.container.querySelector(".catalog-side-panel");
  assert.ok(card && desktop);
  click(quantity(h, dialog, "increase"));
  assert.equal(h.cart().quantityOf(product.id), 3);
  assert.equal(h.cart().subtotal, 72);
  assert.ok(card.textContent?.includes(formatCurrency(72, "en")));
  assert.ok(desktop.textContent?.includes(formatCurrency(72, "en")));
  assert.ok(dialog.textContent?.includes(formatCurrency(72, "en")));
  click(quantity(h, desktop, "decrease"));
  assert.equal(h.cart().quantityOf(product.id), 2);
  assert.ok(dialog.textContent?.includes(formatCurrency(48, "en")));
  click(labelledButton(dialog, `${h.dict.catalog.changeShop}: Review Shop A`));
  const popup = dialog.querySelector("[role='dialog']");
  assert.ok(popup);
  const shopB = Array.from(popup.querySelectorAll("button")).find((b) => b.textContent?.includes("Review Shop B"));
  assert.ok(shopB);
  click(shopB);
  assert.equal(h.cart().customerId, customers[1].id);
  assert.ok(desktop.textContent?.includes("Review Shop B"));
  assert.ok(dialog.textContent?.includes("Review Shop B"));
  assert.equal(h.cart().submissionKey, KEY);
  const persisted = JSON.parse(dom.window.localStorage.getItem("madaf.cart.v1")!);
  assert.equal(persisted.customerId, customers[1].id);
  assert.equal(persisted.items[0].quantity, 2);
  assert.equal(persisted.submissionKey, KEY);
});

test("native cancel closes review and returns focus without losing cart", async () => {
  const h = mount();
  const { trigger, dialog } = open(h);
  const cancel = new dom.window.Event("cancel", { cancelable: true });
  await act(async () => { dialog.dispatchEvent(cancel); });
  assert.equal(cancel.defaultPrevented, true, "React coordinates native Escape cancellation");
  assert.equal(dialog.open, false);
  assert.equal(document.activeElement, trigger);
  assert.equal(h.cart().quantityOf(product.id), 2);
  assert.equal(h.cart().submissionKey, KEY);
});

test("Escape in the customer popup closes only that popup and keeps review open", () => {
  const h = mount();
  const { dialog } = open(h);
  const customerTrigger = labelledButton(dialog, `${h.dict.catalog.changeShop}: Review Shop A`);
  click(customerTrigger);
  const input = dialog.querySelector("[role='dialog'] input");
  assert.ok(input);
  act(() => input.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
  assert.equal(dialog.querySelector("[role='dialog']"), null);
  assert.equal(dialog.open, true);
  assert.equal(document.activeElement, customerTrigger);
  assert.equal(h.cart().customerId, customers[0].id);
});

test("removing the last line keeps review open and closing restores focus to an available fallback", async () => {
  const h = mount();
  const { dialog } = open(h);
  const search = h.container.querySelector<HTMLInputElement>(".catalog-search input");
  assert.ok(search);
  visibleForFocus(search);
  click(labelledButton(dialog, h.dict.common.remove));
  assert.equal(h.cart().items.length, 0);
  assert.equal(dialog.open, true);
  assert.ok(dialog.textContent?.includes(h.dict.cart.empty));
  assert.equal(h.container.querySelector(".catalog-cart-bar"), null);
  await act(async () => labelledButton(dialog, h.dict.common.close).click());
  assert.equal(dialog.open, false);
  assert.equal(document.activeElement, search);
  assert.equal(h.cart().submissionKey, KEY, "removing lines does not rotate the submission key");
});

test("switching to a usable side-panel viewport closes review and focuses the visible desktop customer control", async () => {
  const h = mount();
  const { trigger, dialog } = open(h);
  visibleForFocus(trigger, false);
  const desktopPicker = h.container.querySelector<HTMLButtonElement>(".catalog-side-panel button[aria-haspopup='dialog']");
  assert.ok(desktopPicker);
  visibleForFocus(desktopPicker);
  await setPanel(true);
  assert.equal(dialog.open, false);
  assert.equal(document.activeElement, desktopPicker);
  assert.equal(document.body.style.position, "");
  assert.equal(document.documentElement.style.overflow, "");
  assert.equal(h.cart().quantityOf(product.id), 2);
});

test("unmounting open review restores scroll styles and releases media listeners", () => {
  document.body.style.overflow = "auto";
  document.documentElement.style.scrollbarGutter = "stable both-edges";
  const bodyStyle = document.body.getAttribute("style");
  const htmlStyle = document.documentElement.getAttribute("style");
  const h = mount();
  open(h);
  assert.ok(mediaListeners.size > 0);
  h.unmount();
  assert.equal(mediaListeners.size, 0);
  assert.equal(document.body.getAttribute("style"), bodyStyle);
  assert.equal(document.documentElement.getAttribute("style"), htmlStyle);
  assert.equal(scrollCalls.length, 1);
});
