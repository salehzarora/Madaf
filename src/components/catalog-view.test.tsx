/** Mounted catalog characterization: real controls, reference data and cart.
 * No database/server-action mocks or CSS snapshots; layout is verified in-browser.
 * Run with plain tsx (not --conditions=react-server, since these use React hooks).
 */
import { dom } from "@/test-support/jsdom-env";

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import React, { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { CatalogView } from "@/components/catalog-view";
import { CartLink } from "@/components/cart-link";
import { ProductImage } from "@/components/product-image";
import { getDictionary, interpolate } from "@/i18n/dictionaries";
import { dirFor, type Locale } from "@/i18n/config";
import { CartProvider, useCart } from "@/lib/cart-context";
import { packageLabel } from "@/lib/catalog-helpers";
import { formatCurrency } from "@/lib/format";
import { ShopDataProvider } from "@/lib/shop-data-context";
import type { Category, Customer, Manufacturer, Product } from "@/lib/types";

const categories: Category[] = [
  { id: "drinks-test", name: { en: "Drinks", ar: "مشروبات", he: "משקאות" }, icon: "🥤", hue: 190 },
  { id: "pantry-test", name: { en: "Pantry", ar: "مؤن", he: "מזווה" }, icon: "unknown-icon", hue: 30 },
];
const manufacturers: Manufacturer[] = [
  { id: "brand-a", name: { en: "Alpha brand", ar: "العلامة ألف", he: "מותג אלף" } },
  { id: "brand-b", name: { en: "Beta brand", ar: "العلامة بيت", he: "מותג בית" } },
];
const products: Product[] = [
  {
    id: "juice", sku: "SKU-JUICE", categoryId: "drinks-test", manufacturerId: "brand-a",
    translations: { en: { name: "Zest juice" }, ar: { name: "عصير الليمون" }, he: { name: "מיץ לימון" } },
    packageType: "carton", unitsPerPackage: 12, baseUnit: "bottles", unitSize: "330ml",
    wholesalePrice: 36, availability: "inStock", imageUrl: "https://example.test/juice.jpg",
  },
  {
    id: "beans", sku: "SKU-BEANS", categoryId: "pantry-test", manufacturerId: "brand-b",
    translations: { en: { name: "Alpha beans" }, ar: { name: "فاصوليا" }, he: { name: "שעועית" } },
    packageType: "pack", unitsPerPackage: 6, baseUnit: "cans", wholesalePrice: 18,
    availability: "lowStock", trackExpiry: true,
  },
  {
    id: "tea", sku: "SKU-TEA", categoryId: "drinks-test", manufacturerId: "brand-b",
    translations: { en: { name: "Mint tea" }, ar: { name: "شاي نعناع" }, he: { name: "תה נענע" } },
    packageType: "carton", unitsPerPackage: 10, baseUnit: "packs", wholesalePrice: 50,
    availability: "outOfStock",
  },
];
const customers: Customer[] = [
  { id: "shop-a", name: "Shop A", city: { en: "Haifa", ar: "حيفا", he: "חיפה" }, phone: "0501111111", contactName: "Alex", type: "grocery" },
  { id: "shop-b", name: "Shop B", city: { en: "Nazareth", ar: "الناصرة", he: "נצרת" }, phone: "0502222222", contactName: "Sam", address: "Test street", type: "kiosk" },
  { id: "shop-inactive", name: "Inactive shop", city: { en: "Haifa", ar: "حيفا", he: "חיפה" }, phone: "0503333333", contactName: "Taylor", type: "grocery", isActive: false },
];
const STORAGE_KEY = "madaf.cart.v1";
const SUBMISSION_KEY = "11110000-0000-4000-8000-000000000001";
type Cart = ReturnType<typeof useCart>;
const cleanups: (() => void)[] = [];

function mount(options: { locale?: Locale; initialCustomerId?: string; products?: Product[] } = {}) {
  const locale = options.locale ?? "en";
  const dict = getDictionary(locale);
  const container = document.createElement("div");
  container.dir = dirFor(locale);
  document.body.append(container);
  const root = createRoot(container);
  const captured: { current: Cart | null } = { current: null };
  function Probe() {
    const cart = useCart();
    useEffect(() => { captured.current = cart; });
    return null;
  }
  act(() => root.render(
    <ShopDataProvider products={options.products ?? products} categories={categories} manufacturers={manufacturers} customers={customers}>
      <CartProvider>
        <Probe />
        <nav aria-label="Test header"><CartLink locale={locale} label={dict.nav.cart} /></nav>
        <CatalogView locale={locale} dict={dict} supplier={{ name: "Test supplier" }} initialCustomerId={options.initialCustomerId} />
      </CartProvider>
    </ShopDataProvider>,
  ));
  cleanups.push(() => { act(() => root.unmount()); container.remove(); });
  return {
    container, locale, dict,
    cart: () => { assert.ok(captured.current); return captured.current; },
  };
}
type Harness = ReturnType<typeof mount>;

afterEach(() => {
  cleanups.splice(0).reverse().forEach((cleanup) => cleanup());
  dom.window.localStorage.clear();
});

function click(button: HTMLButtonElement) {
  assert.equal(button.disabled, false, "the exercised control must be enabled");
  act(() => button.click());
}
function buttonWithText(root: ParentNode, text: string) {
  const button = Array.from(root.querySelectorAll("button")).find((b) => b.textContent?.trim() === text);
  assert.ok(button, `button: ${text}`);
  return button;
}
function labelledButton(root: ParentNode, label: string) {
  const button = Array.from(root.querySelectorAll("button")).find((b) => b.getAttribute("aria-label") === label);
  assert.ok(button, `button labelled: ${label}`);
  return button;
}
function quantityButton(h: Harness, root: ParentNode, direction: "increase" | "decrease", productId: string) {
  const product = products.find((p) => p.id === productId);
  assert.ok(product);
  return labelledButton(root, interpolate(
    direction === "increase" ? h.dict.catalog.increaseQuantity : h.dict.catalog.decreaseQuantity,
    { product: product.translations[h.locale].name },
  ));
}
function manufacturerDisclosure(h: Harness) {
  const details = h.container.querySelector("details");
  assert.ok(details, "manufacturer disclosure");
  const summary = details.querySelector("summary");
  assert.ok(summary);
  return { details, summary };
}
function openManufacturers(h: Harness) {
  const { details, summary } = manufacturerDisclosure(h);
  assert.equal(details.open, false, "secondary filters initially collapsed");
  act(() => summary.click());
  assert.equal(details.open, true);
  return details;
}
function inputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")?.set;
  assert.ok(setter);
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
}
function search(h: Harness, value: string) {
  const input = Array.from(h.container.querySelectorAll("input")).find((i) => i.getAttribute("aria-label") === h.dict.common.search);
  assert.ok(input, "catalog search");
  inputValue(input, value);
}
function names(h: Harness) {
  return Array.from(h.container.querySelectorAll("h3")).map((heading) => heading.textContent);
}
function card(h: Harness, id: string) {
  const link = h.container.querySelector<HTMLAnchorElement>(`a[href="/${h.locale}/product/${id}"]`);
  assert.ok(link, `product detail link for ${id}`);
  const element = link.closest("article") ?? link.parentElement;
  assert.ok(element);
  return element;
}
function orderPad(h: Harness) {
  const pad = h.container.querySelector("aside");
  assert.ok(pad, "order summary exists");
  return pad;
}
function assertSummary(h: Harness, packages: number, subtotal: number) {
  assert.equal(h.cart().totalPackages, packages);
  assert.equal(h.cart().subtotal, subtotal);
  assert.ok(orderPad(h).textContent?.includes(formatCurrency(subtotal, h.locale)), "order pad subtotal is synchronized");
  const badge = h.container.querySelector("nav a span[dir='ltr']");
  assert.equal(badge?.textContent ?? null, packages > 0 ? String(packages) : null, "header package badge is synchronized");
  const mobileBar = h.container.querySelector(".catalog-cart-bar");
  const mobileCart = Array.from(mobileBar?.querySelectorAll("button") ?? []).find((b) => (b.getAttribute("aria-label") ?? b.textContent?.trim()) === h.dict.catalog.reviewCart);
  assert.equal(Boolean(mobileCart), packages > 0, "compact cart access follows the same cart");
  if (mobileCart) {
    assert.equal(mobileCart.getAttribute("aria-haspopup"), "dialog");
    assert.ok(mobileCart.parentElement?.textContent?.includes(formatCurrency(subtotal, h.locale)));
  }
}

for (const locale of ["ar", "he", "en"] as const) {
  test(`${locale}: renders localized catalog, package pricing, detail routes and empty summary`, () => {
    const h = mount({ locale });
    assert.equal(h.container.querySelectorAll("h1").length, 1);
    assert.deepEqual(names(h), products.map((p) => p.translations[locale].name));
    assert.ok(h.container.textContent?.includes(interpolate(h.dict.catalog.resultsCount, { count: 3 })));
    assert.ok(card(h, "juice").textContent?.includes(packageLabel(products[0], h.dict)));
    assert.ok(card(h, "juice").textContent?.includes(formatCurrency(36, locale)));
    assert.ok(card(h, "juice").textContent?.includes(formatCurrency(3, locale)));
    assert.ok(orderPad(h).textContent?.includes(h.dict.cart.empty));
    assertSummary(h, 0, 0);
  });
}

test("deep-linked customer wins after persisted cart hydration without losing lines or submission key", () => {
  localStorageSeed({ customerId: "shop-a", items: [{ productId: "juice", quantity: 2 }], submissionKey: SUBMISSION_KEY });
  const h = mount({ initialCustomerId: "shop-b" });
  assert.equal(h.cart().hydrated, true);
  assert.equal(h.cart().customerId, "shop-b");
  assert.equal(h.cart().submissionKey, SUBMISSION_KEY);
  assert.ok(orderPad(h).textContent?.includes("Shop B"));
  assertSummary(h, 2, 72);
  const persisted = JSON.parse(dom.window.localStorage.getItem(STORAGE_KEY)!);
  assert.equal(persisted.customerId, "shop-b");
  assert.equal(persisted.submissionKey, SUBMISSION_KEY);
});

function localStorageSeed(value: { customerId: string | null; items: { productId: string; quantity: number }[]; submissionKey: string | null }) {
  dom.window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
}

test("without a deep link the persisted customer is retained and removed catalog products are dropped", () => {
  localStorageSeed({ customerId: "shop-a", items: [{ productId: "beans", quantity: 3 }, { productId: "deleted-product", quantity: 2 }], submissionKey: SUBMISSION_KEY });
  const h = mount();
  assert.equal(h.cart().customerId, "shop-a");
  assert.equal(h.cart().submissionKey, SUBMISSION_KEY);
  assert.deepEqual(h.cart().items, [{ productId: "beans", quantity: 3 }]);
  assertSummary(h, 3, 54);
});

test("customer picker searches authorized reference rows, disables inactive shops and preserves cart on selection", () => {
  localStorageSeed({ customerId: null, items: [{ productId: "juice", quantity: 1 }], submissionKey: SUBMISSION_KEY });
  const h = mount();
  click(buttonWithText(orderPad(h), h.dict.catalog.selectShop));
  const inactive = Array.from(orderPad(h).querySelectorAll("button")).find((b) => b.textContent?.includes("Inactive shop"));
  assert.ok(inactive);
  assert.equal(inactive.disabled, true);
  const searchInput = orderPad(h).querySelector<HTMLInputElement>("input[type='search']");
  assert.ok(searchInput);
  assert.equal(document.activeElement, searchInput);
  for (const term of ["0502222222", "Sam", "Test street", "נצרת"]) {
    inputValue(searchInput, term);
    assert.equal(orderPad(h).querySelectorAll("li").length, 2, "one matching shop plus existing order line");
    assert.ok(orderPad(h).textContent?.includes("Shop B"));
    assert.ok(!orderPad(h).textContent?.includes("Shop A"));
  }
  const selected = Array.from(orderPad(h).querySelectorAll("button")).find((b) => b.textContent?.includes("Shop B"));
  assert.ok(selected);
  click(selected);
  assert.equal(h.cart().customerId, "shop-b");
  assert.equal(h.cart().submissionKey, SUBMISSION_KEY);
  assertSummary(h, 1, 36);
});

test("change-shop opens selection without clearing customer and Escape restores focus without cart mutation", () => {
  localStorageSeed({ customerId: "shop-a", items: [{ productId: "juice", quantity: 2 }], submissionKey: SUBMISSION_KEY });
  const h = mount();
  const trigger = labelledButton(orderPad(h), `${h.dict.catalog.changeShop}: Shop A`);
  click(trigger);
  assert.equal(trigger.getAttribute("aria-expanded"), "true");
  assert.equal(h.cart().customerId, "shop-a", "opening change is not clearing selection");
  const popup = orderPad(h).querySelector("[role='dialog']");
  assert.ok(popup);
  assert.equal(trigger.getAttribute("aria-controls"), popup.id);
  const searchInput = popup.querySelector("input");
  assert.ok(searchInput);
  assert.equal(document.activeElement, searchInput);
  act(() => searchInput.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  assert.equal(trigger.getAttribute("aria-expanded"), "false");
  assert.equal(orderPad(h).querySelector("[role='dialog']"), null);
  assert.equal(document.activeElement, trigger);
  assert.equal(h.cart().customerId, "shop-a");
  assert.equal(h.cart().submissionKey, SUBMISSION_KEY);
  assertSummary(h, 2, 72);
});

test("search matches all product languages, SKU and manufacturer languages and reports no results", () => {
  const h = mount();
  for (const term of ["  zest JUICE  ", "عصير الليمون", "מיץ לימון", "SKU-JUICE", "العلامة ألف", "מותג אלף"]) {
    search(h, term);
    assert.deepEqual(names(h), ["Zest juice"], term);
  }
  search(h, "nothing matches this");
  assert.deepEqual(names(h), []);
  assert.ok(h.container.textContent?.includes(h.dict.catalog.noResults));
  click(buttonWithText(h.container, h.dict.catalog.clearFilters));
  assert.deepEqual(names(h), ["Zest juice", "Alpha beans", "Mint tea"]);
});

test("category and multiple manufacturer filters combine and clear restores all products", () => {
  const h = mount();
  click(buttonWithText(h.container, "Drinks"));
  assert.deepEqual(names(h), ["Zest juice", "Mint tea"]);
  assert.equal(buttonWithText(h.container, "Drinks").getAttribute("aria-pressed"), "true");
  openManufacturers(h);
  click(buttonWithText(h.container, "Beta brand"));
  assert.deepEqual(names(h), ["Mint tea"]);
  click(buttonWithText(h.container, "Alpha brand"));
  assert.deepEqual(names(h), ["Zest juice", "Mint tea"], "manufacturers are multi-select OR within the category");
  search(h, "juice");
  assert.deepEqual(names(h), ["Zest juice"]);
  click(buttonWithText(h.container, h.dict.catalog.clearFilters));
  assert.deepEqual(names(h), ["Zest juice", "Alpha beans", "Mint tea"]);
  assert.equal(buttonWithText(h.container, h.dict.common.all).getAttribute("aria-pressed"), "true");
  assert.equal(buttonWithText(h.container, "Beta brand").getAttribute("aria-pressed"), "false");
});

test("price/name/default sorting changes displayed order without changing catalog or cart", () => {
  const h = mount();
  const select = h.container.querySelector("select");
  assert.ok(select);
  const expected = {
    priceAsc: ["Alpha beans", "Zest juice", "Mint tea"],
    priceDesc: ["Mint tea", "Zest juice", "Alpha beans"],
    name: ["Alpha beans", "Mint tea", "Zest juice"],
    featured: ["Zest juice", "Alpha beans", "Mint tea"],
  };
  for (const [value, orderedNames] of Object.entries(expected)) {
    act(() => { select.value = value; select.dispatchEvent(new dom.window.Event("change", { bubbles: true })); });
    assert.deepEqual(names(h), orderedNames);
  }
  assertSummary(h, 0, 0);
});

test("manufacturer disclosure exposes active count, independent reset and keyboard/outside dismissal", () => {
  const h = mount();
  const details = openManufacturers(h);
  const { summary } = manufacturerDisclosure(h);
  click(buttonWithText(details, "Beta brand"));
  assert.deepEqual(names(h), ["Alpha beans", "Mint tea"]);
  assert.equal(summary.querySelector("[dir='ltr']")?.textContent, "1");
  click(buttonWithText(details, "Alpha brand"));
  assert.equal(summary.querySelector("[dir='ltr']")?.textContent, "2");
  assert.equal(buttonWithText(details, "Beta brand").getAttribute("aria-pressed"), "true");
  act(() => details.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  assert.equal(details.open, false);
  assert.equal(document.activeElement, summary, "Escape restores the disclosure trigger");
  assert.equal(summary.querySelector("[dir='ltr']")?.textContent, "2", "closing the panel retains filters");
  act(() => summary.click());
  assert.equal(details.open, true);
  act(() => h.container.dispatchEvent(new dom.window.Event("pointerdown", { bubbles: true })));
  assert.equal(details.open, false, "outside pointer closes the disclosure");
  click(buttonWithText(h.container, "Drinks"));
  click(labelledButton(h.container, `${h.dict.common.clear}: ${h.dict.catalog.manufacturers}`));
  assert.equal(summary.querySelector("[dir='ltr']"), null);
  assert.deepEqual(names(h), ["Zest juice", "Mint tea"], "manufacturer reset preserves category selection");
});

for (const locale of ["ar", "he", "en"] as const) {
  test(`${locale}: package and per-unit prices remain visible after add and quantity changes`, () => {
    const h = mount({ locale });
    const product = card(h, "juice");
    function assertPrices() {
      const paragraphs = Array.from(product.querySelectorAll("p"));
      assert.ok(paragraphs.some((p) => p.querySelector("bdi")?.textContent === formatCurrency(36, locale) && p.textContent?.includes(h.dict.packaging.carton)), "one-package price remains its own bidi-safe value with package context");
      assert.ok(paragraphs.some((p) => p.textContent?.includes(formatCurrency(3, locale)) && p.textContent.includes(h.dict.units.bottles)), "per-unit price remains visible with its unit");
      assert.ok(product.textContent?.includes(packageLabel(products[0], h.dict)), "package description remains visible");
    }
    assertPrices();
    click(labelledButton(product, h.dict.catalog.addToCart));
    assertPrices();
    click(quantityButton(h, product, "increase", "juice"));
    assertPrices();
    assert.ok(product.textContent?.includes(formatCurrency(72, locale)), "two-package line total is secondary information");
    assertSummary(h, 2, 72);
    click(quantityButton(h, product, "decrease", "juice"));
    assertPrices();
    assertSummary(h, 1, 36);
  });
}

test("card and order-pad quantities, removal, subtotal and responsive cart access share one state", () => {
  const h = mount();
  click(labelledButton(card(h, "juice"), h.dict.catalog.addToCart));
  assertSummary(h, 1, 36);
  click(quantityButton(h, card(h, "juice"), "increase", "juice"));
  assertSummary(h, 2, 72);
  click(quantityButton(h, orderPad(h), "increase", "juice"));
  assertSummary(h, 3, 108);
  click(quantityButton(h, orderPad(h), "decrease", "juice"));
  assertSummary(h, 2, 72);
  click(labelledButton(card(h, "beans"), h.dict.catalog.addToCart));
  assertSummary(h, 3, 90);
  assert.equal(h.cart().items.length, 2, "package count is distinct from line count");
  click(labelledButton(orderPad(h), h.dict.common.remove));
  assertSummary(h, 1, 18);
  click(quantityButton(h, orderPad(h), "decrease", "beans"));
  assertSummary(h, 0, 0);
  assert.deepEqual(h.cart().items, []);
});

test("low stock and expiry tracking remain truthful and orderable; sold-out initial add is blocked", () => {
  const h = mount();
  assert.ok(card(h, "beans").textContent?.includes(h.dict.availability.lowStock));
  assert.ok(card(h, "beans").textContent?.includes(h.dict.catalog.expiryTracked));
  click(labelledButton(card(h, "beans"), h.dict.catalog.addToCart));
  assertSummary(h, 1, 18);
  const soldOut = card(h, "tea");
  assert.ok(soldOut.textContent?.includes(h.dict.availability.outOfStock));
  const possibleAdd = Array.from(soldOut.querySelectorAll("button")).find((b) => b.getAttribute("aria-label") === h.dict.catalog.addToCart);
  assert.ok(!possibleAdd || possibleAdd.disabled, "no enabled initial add for a sold-out product");
  assert.equal(h.cart().quantityOf("tea"), 0);
});

test("product detail links do not contain cart buttons and quantity actions never activate navigation", () => {
  const h = mount();
  const product = card(h, "juice");
  const link = product.querySelector("a");
  assert.ok(link);
  assert.equal(link.getAttribute("href"), "/en/product/juice");
  assert.equal(link.querySelector("button"), null);
  let navigations = 0;
  link.addEventListener("click", (event) => { event.preventDefault(); navigations += 1; });
  click(labelledButton(product, h.dict.catalog.addToCart));
  click(quantityButton(h, product, "increase", "juice"));
  assert.equal(navigations, 0);
  act(() => link.click());
  assert.equal(navigations, 1, "detail navigation remains a separate reachable action");
});

for (const locale of ["ar", "he", "en"] as const) {
  test(`${locale}: long localized names and missing category/manufacturer/image still render and order safely`, () => {
    const unusual: Product = {
      ...products[0], id: "long-product", categoryId: "deleted-category", manufacturerId: "deleted-brand", imageUrl: undefined,
      translations: {
        ar: { name: "اسم منتج طويل للاختبار مع تفاصيل العبوة والحجم والتعبئة للمحلات التجارية" },
        he: { name: "שם מוצר ארוך במיוחד לבדיקת אריזה וגודל וכמות עבור חנויות וספקים" },
        en: { name: "A deliberately long wholesale product name with pack and size information" },
      },
    };
    const h = mount({ locale, products: [unusual] });
    assert.deepEqual(names(h), [unusual.translations[locale].name]);
    assert.equal(card(h, unusual.id).querySelector("img"), null);
    assert.equal(card(h, unusual.id).querySelector(".catalog-product-brand"), null, "missing manufacturer does not reserve an empty identity row");
    assert.ok(!h.container.textContent?.includes("undefined"));
    click(labelledButton(card(h, unusual.id), h.dict.catalog.addToCart));
    assertSummary(h, 1, 36);
  });
}

test("failed product images fall back safely and an empty catalog keeps cart discovery usable", () => {
  const h = mount();
  const product = card(h, "juice");
  const img = product.querySelector("img");
  assert.ok(img);
  act(() => img.dispatchEvent(new dom.window.Event("error")));
  assert.equal(product.querySelector("img"), null);
  click(labelledButton(product, h.dict.catalog.addToCart));
  assertSummary(h, 1, 36);
  dom.window.localStorage.clear();
  const empty = mount({ products: [] });
  assert.deepEqual(names(empty), []);
  assert.ok(empty.container.textContent?.includes(empty.dict.catalog.noResults));
  assert.ok(orderPad(empty).textContent?.includes(empty.dict.cart.empty));
});

test("V3 media is limited to product cards while hero and order thumbnails retain their existing presentation", () => {
  const h = mount();
  assert.equal(h.container.querySelectorAll(".catalog-product .catalog-card-media").length, products.length);
  assert.equal(h.container.querySelector(".catalog-hero .catalog-card-media"), null);
  assert.ok(h.container.querySelector(".catalog-hero .catalog-product-media"));
  click(labelledButton(card(h, "juice"), h.dict.catalog.addToCart));
  assert.ok(orderPad(h).querySelector(".catalog-product-media"));
  assert.equal(orderPad(h).querySelector(".catalog-card-media"), null);
});

test("shared default and legacy catalog images keep their photo/fallback contracts when card media is opted in", () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  cleanups.push(() => { act(() => root.unmount()); container.remove(); });
  const modes = ["default", "catalog", "catalog-card"] as const;
  for (const hasPhoto of [false, true]) {
    act(() => root.render(<>{modes.map((presentation) => (
      <ProductImage key={`${presentation}-${hasPhoto}`} product={{ ...products[0], imageUrl: hasPhoto ? products[0].imageUrl : undefined }} presentation={presentation} showSizeTag={false} />
    ))}</>));
    const [plain, legacy, cardMedia] = Array.from(container.children);
    for (const media of [plain, legacy, cardMedia]) assert.equal(media.getAttribute("aria-hidden"), "true");
    assert.equal(plain.classList.contains("catalog-card-media"), false);
    assert.equal(legacy.classList.contains("catalog-card-media"), false);
    assert.equal(cardMedia.classList.contains("catalog-card-media"), true);
    assert.equal(container.querySelector("[dir='ltr']"), null, "size tags remain optional in every presentation");
    if (hasPhoto) {
      assert.equal(plain.querySelector("img")?.className, "size-full object-cover");
      assert.equal(legacy.querySelector("img")?.className, "catalog-media-photo");
      assert.equal(cardMedia.querySelector("img")?.className, "catalog-card-media-photo");
      act(() => container.querySelectorAll("img").forEach((img) => img.dispatchEvent(new dom.window.Event("error"))));
      assert.equal(container.querySelector("img"), null);
    }
    assert.ok(container.children[0].querySelector("svg"));
    assert.ok(container.children[1].classList.contains("catalog-product-media--placeholder"));
    assert.ok(container.children[2].classList.contains("catalog-card-media--placeholder"));
  }
});
