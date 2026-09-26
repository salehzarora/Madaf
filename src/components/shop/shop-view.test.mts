/**
 * PILOT-OPS-AUDIT-008-FIX2 — MOUNTED ShopView token-order retry persistence.
 *
 * Mounts the REAL ShopView with the server action module-mocked to CAPTURE the
 * submission key it sends. Proves the component now sources the key from the
 * PERSISTED sessionStorage helper (not volatile state): the SAME key is sent
 * across a remount (a refresh) and across an ambiguous-failure retry; a confirmed
 * success clears it (a new order gets a new key); a different token gets a
 * different key; and when browser storage is unavailable the order action is NOT
 * called (fail closed) — the key never appears in the DOM and the raw token is
 * never persisted.
 *
 * Runner: `npm run test:shop-view` (needs --experimental-test-module-mocks; plain
 * tsx so React keeps its client hooks).
 */
// FIRST: DOM globals must exist before react-dom/client is evaluated.
import { dom } from "@/test-support/jsdom-env";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, mock, test } from "node:test";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { getDictionary } from "@/i18n/dictionaries";
import { locales, type Locale } from "@/i18n/config";
import { formatCurrency } from "@/lib/format";
import type { TokenCatalog } from "@/lib/data/token";
import { categories, manufacturers, products } from "@/lib/mock";

// ── Capture the action's submission key; control its result per-test ──────────
interface ActionCall {
  token: string;
  submissionKey: string;
  items: { productId: string; quantity: number }[];
  notes?: string;
}
const calls: ActionCall[] = [];
let actionImpl: (input: ActionCall) => Promise<{ ok: boolean; publicRef?: string; reason?: "conflict" }> = async () => ({
  ok: false, // default: a plain failure that RETAINS the key
});
mock.module("@/lib/actions/shop", {
  namedExports: {
    submitShopOrderAction: async (input: ActionCall) => {
      calls.push(structuredClone(input));
      return actionImpl(input);
    },
  },
});
// LocaleSwitcher reads usePathname(); provide a router-free stub for the mount.
mock.module("next/navigation", {
  namedExports: {
    usePathname: () => "/en/shop/token",
    useRouter: () => ({
      push() {},
      replace() {},
      refresh() {},
      back() {},
      forward() {},
      prefetch() {},
    }),
    useSearchParams: () => new URLSearchParams(),
    useParams: () => ({}),
  },
});

const { ShopView } = await import("@/components/shop/shop-view");

const dict = getDictionary("en");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = "shoptoken-fixture-cccccccccccccccc";
const TOKEN2 = "shoptoken-fixture-dddddddddddddddd";
const inStockProduct = { ...products[0], availability: "inStock" as const };

function catalog(): TokenCatalog {
  return {
    tenantName: { ar: "متجر", he: "חנות", en: "Shop" },
    customer: { name: "Shop", city: { ar: "", he: "", en: "" } },
    products: [inStockProduct],
    categories,
    manufacturers,
  };
}

const mounted: { root: Root; container: HTMLElement }[] = [];
function mount(token = TOKEN, data = catalog(), locale: Locale = "en"): HTMLElement {
  const container = dom.window.document.createElement("div");
  dom.window.document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  act(() => {
    root.render(React.createElement(ShopView, { locale, dict: getDictionary(locale), token, catalog: data }));
  });
  return container;
}
function unmountAll(): void {
  for (const m of mounted.splice(0)) {
    act(() => m.root.unmount());
    m.container.remove();
  }
}

afterEach(() => {
  unmountAll();
  calls.length = 0;
  actionImpl = async () => ({ ok: false });
  dom.window.sessionStorage.clear();
});

function buttonByText(container: HTMLElement, text: string): HTMLButtonElement | null {
  return (
    ([...container.querySelectorAll("button")] as HTMLButtonElement[]).find((b) =>
      (b.textContent ?? "").includes(text),
    ) ?? null
  );
}
async function click(el: Element): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });
}
async function waitFor(cond: () => boolean, label: string, tries = 40): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (cond()) return;
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
  }
  throw new Error(`waitFor timed out: ${label}`);
}

/** Add the one product to the cart, then click submit; resolve when the action is
 * called (or a preparation error is shown). Returns the count before submit. */
async function addAndSubmit(container: HTMLElement): Promise<number> {
  // Add the product only if it isn't already in the cart (a retry keeps the cart,
  // so the add button is replaced by the quantity stepper).
  const add = buttonByText(container, dict.catalog.addToCart);
  if (add) await click(add);
  const submit = buttonByText(container, dict.access.shop.submit);
  assert.ok(submit, "submit button present");
  const before = calls.length;
  await click(submit);
  await waitFor(
    () => calls.length > before || (container.textContent ?? "").includes(dict.access.shop.prepError),
    "submit resolves (action called or prep error shown)",
  );
  return before;
}

test("first submit sends a persisted UUID key; a refresh (remount) sends the SAME key", async () => {
  const c1 = mount();
  await addAndSubmit(c1);
  assert.equal(calls.length, 1);
  const key1 = calls[0].submissionKey;
  assert.match(key1, UUID);
  assert.equal(calls[0].token, TOKEN, "the raw token still flows to the action");

  // A refresh: unmount + remount (same token, same sessionStorage) → same key.
  unmountAll();
  const c2 = mount();
  await addAndSubmit(c2);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].submissionKey, key1, "the remount reused the persisted key (not volatile)");
});

test("an ambiguous failure retains the key; the retry reuses it", async () => {
  actionImpl = async () => {
    throw new Error("network lost after commit"); // ambiguous
  };
  const c = mount();
  await addAndSubmit(c);
  const key1 = calls[0].submissionKey;
  // Retry in the SAME mount (component stays mounted after the error).
  await addAndSubmit(c);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].submissionKey, key1, "the retry sent the same key");
});

test("a confirmed success clears the key; the next order gets a DIFFERENT key", async () => {
  actionImpl = async () => ({ ok: true, publicRef: "MDF-AAAAAAAA" });
  const c1 = mount();
  await addAndSubmit(c1);
  const key1 = calls[0].submissionKey;
  // Success renders the terminal screen; a brand-new order (remount) must differ.
  unmountAll();
  actionImpl = async () => ({ ok: false });
  const c2 = mount();
  await addAndSubmit(c2);
  assert.notEqual(calls[1].submissionKey, key1, "a new logical order after success gets a fresh key");
});

test("a different token gets a different key", async () => {
  const c1 = mount(TOKEN);
  await addAndSubmit(c1);
  unmountAll();
  const c2 = mount(TOKEN2);
  await addAndSubmit(c2);
  assert.notEqual(calls[1].submissionKey, calls[0].submissionKey, "distinct token → distinct key");
});

test("storage unavailable → the order action is NOT called and a prep error shows", async () => {
  const realDesc = Object.getOwnPropertyDescriptor(dom.window, "sessionStorage")!;
  Object.defineProperty(dom.window, "sessionStorage", { value: undefined, configurable: true });
  try {
    const c = mount();
    const add = buttonByText(c, dict.catalog.addToCart);
    await click(add!);
    const submit = buttonByText(c, dict.access.shop.submit);
    await click(submit!);
    await waitFor(() => (c.textContent ?? "").includes(dict.access.shop.prepError), "prep error shown");
    assert.equal(calls.length, 0, "no order was submitted (fail closed)");
  } finally {
    Object.defineProperty(dom.window, "sessionStorage", realDesc);
  }
});

test("the submission key never appears in the rendered DOM, and the raw token is never persisted", async () => {
  const c = mount();
  await addAndSubmit(c);
  const key = calls[0].submissionKey;
  assert.ok(!(dom.window.document.body.textContent ?? "").includes(key), "key not rendered anywhere");
  // Inspect every sessionStorage entry.
  const ss = dom.window.sessionStorage;
  for (let i = 0; i < ss.length; i++) {
    const k = ss.key(i)!;
    assert.ok(!k.includes(TOKEN), "raw token not in a storage key");
    assert.ok(!(ss.getItem(k) ?? "").includes(TOKEN), "raw token not in a storage value");
  }
});

test("sold-out initial Add remains disabled", async () => {
  const data = catalog();
  data.products = [{ ...inStockProduct, availability: "outOfStock" }];
  const container = mount(TOKEN, data);
  const add = buttonByText(container, dict.availability.outOfStock);
  assert.ok(add?.disabled);
  await click(add);
  assert.equal(container.querySelector('button[aria-label="+"]'), null);
  assert.equal(buttonByText(container, dict.access.shop.submit), null);
});

test("a selected product becoming sold out preserves quantity, blocks increment and allows decrement/removal", async () => {
  const container = mount();
  await click(buttonByText(container, dict.catalog.addToCart)!);
  const increase = () => container.querySelector<HTMLButtonElement>('button[aria-label="+"]')!;
  const decrease = () => container.querySelector<HTMLButtonElement>('button[aria-label="−"]')!;
  const quantity = () => increase().parentElement?.querySelector('[dir="ltr"]')?.textContent;
  assert.equal(increase().disabled, false);
  await click(increase());
  assert.equal(quantity(), "2");

  const data = catalog();
  data.products = [{ ...inStockProduct, availability: "outOfStock" }];
  act(() => mounted[0].root.render(React.createElement(ShopView, { locale: "en", dict, token: TOKEN, catalog: data })));
  assert.equal(quantity(), "2", "an availability change must not silently remove selected packages");
  assert.equal(increase().disabled, true);
  assert.equal(decrease().disabled, false);
  await click(increase());
  assert.equal(quantity(), "2");
  await click(decrease());
  assert.equal(quantity(), "1");
  assert.equal(increase().disabled, true);
  await click(decrease());
  assert.equal(container.querySelector('button[aria-label="+"]'), null);
  assert.ok(buttonByText(container, dict.availability.outOfStock)?.disabled);
  assert.equal(buttonByText(container, dict.access.shop.submit), null);
  assert.equal(calls.length, 0);
});

async function fill(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = el.tagName === "TEXTAREA" ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
}
function multiCatalog(): TokenCatalog {
  return {
    ...catalog(),
    customer: { name: "Fixed synthetic shop", city: { ar: "مدينة", he: "עיר", en: "City" } },
    categories: [
      { id: "first", name: { ar: "الأول", he: "ראשון", en: "First" }, icon: "📦", hue: 1 },
      { id: "second", name: { ar: "الثاني", he: "שני", en: "Second" }, icon: "🥤", hue: 2 },
    ],
    manufacturers: [
      { id: "maker-a", name: { ar: "المصنع أ", he: "יצרן א", en: "Maker A" } },
      { id: "maker-b", name: { ar: "المصنع ب", he: "יצרן ב", en: "Maker B" } },
    ],
    products: ["Alpha", "Beta", "Gamma"].map((name, i) => ({
      ...inStockProduct, id: `private-${i}`, sku: `PRIVATE-${i}`, categoryId: i === 1 ? "second" : "first",
      manufacturerId: i === 2 ? "maker-b" : "maker-a", wholesalePrice: [30, 10, 20][i], availability: i === 2 ? "outOfStock" : "inStock",
      translations: { ar: { name: `منتج ${i}` }, he: { name: `מוצר ${i}` }, en: { name } },
    })),
  };
}
function cards(container: HTMLElement) { return [...container.querySelectorAll<HTMLElement>(".private-shop-product")]; }
function addButton(card: Element) { return card.querySelector<HTMLButtonElement>(".private-shop-add")!; }
function keyEntries() { return Object.keys(dom.window.sessionStorage).filter((k) => k.startsWith("madaf:order-submission:")); }

test("only presentation is shared: no authenticated providers, picker, product links or cart imports", () => {
  const source = readFileSync(new URL("./shop-view.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\b(?:AppShell|CartProvider|ShopDataProvider|ProductCard|CustomerPicker|useCart)\b|href=.*product\//);
  assert.match(source, /getOrCreateTokenSubmissionKey\("shop_token", token\)/);
  assert.match(source, /clearTokenSubmissionKey\("shop_token", token\)/);
  assert.match(source, /rotateTokenSubmissionKey\("shop_token", token\)/);
});
for (const locale of locales) {
  test(`${locale}: fixed identity, supplier logo, localized cards and safe local controls`, () => {
    const data = multiCatalog();
    data.tenantLogoUrl = "https://example.test/supplier.png";
    const container = mount(TOKEN, data, locale);
    assert.equal(container.querySelector("h1")?.textContent, data.tenantName[locale]);
    assert.equal(container.querySelector(".private-shop-supplier-logo")?.getAttribute("src"), data.tenantLogoUrl);
    assert.equal(container.querySelector(".private-shop-customer-name")?.textContent, data.customer.name);
    assert.ok(container.querySelector(".private-shop-context")?.textContent?.includes(data.customer.city[locale]));
    assert.ok(container.querySelector(".private-shop-context .lucide-lock"));
    assert.equal(container.querySelector(".private-shop-context button,.private-shop-context select,.private-shop-context input"), null);
    assert.equal(container.querySelector("a[href*='/product/'],a[href$='/admin'],a[href$='/cart']"), null);
    assert.deepEqual(cards(container).map((e) => e.querySelector("h3")?.textContent), data.products.map((p) => p.translations[locale].name));
    assert.equal(container.querySelector("textarea"), null);
    assert.ok(!(container.textContent ?? "").includes(TOKEN));
    assert.ok([...container.querySelectorAll("*")].every((e) => [...e.attributes].filter((a) => a.name.startsWith("data-")).every((a) => !a.value.includes(TOKEN))));
  });
}
test("local add/increment/decrement/remove preserve distinct line count and estimate", async () => {
  const container = mount(TOKEN, multiCatalog());
  await click(addButton(cards(container)[0]));
  await click(cards(container)[0].querySelector('button[aria-label="+"]')!);
  await click(addButton(cards(container)[1]));
  assert.ok(container.querySelector(".private-shop-line-count")?.textContent?.endsWith("2"));
  assert.equal(container.querySelector(".private-shop-estimate")?.textContent, formatCurrency(70, "en"));
  await click(cards(container)[0].querySelector('button[aria-label="−"]')!);
  assert.equal(container.querySelector(".private-shop-estimate")?.textContent, formatCurrency(40, "en"));
  await click(cards(container)[1].querySelector('button[aria-label="−"]')!);
  assert.ok(container.querySelector(".private-shop-line-count")?.textContent?.endsWith("1"));
  await click(cards(container)[0].querySelector('button[aria-label="−"]')!);
  assert.equal(container.querySelector(".private-shop-order-bar,textarea"), null);
});
test("search, categories, manufacturers, in-stock, sort and clear retain selected hidden lines", async () => {
  const container = mount(TOKEN, multiCatalog());
  const names = () => cards(container).map((c) => c.querySelector("h3")?.textContent);
  await click(addButton(cards(container)[0]));
  const search = container.querySelector<HTMLInputElement>('input[type="search"]')!;
  await fill(search, "PRIVATE-1");
  assert.deepEqual(names(), ["Beta"]);
  await click(buttonByText(container, dict.common.clear)!);
  await click(buttonByText(container, "Second")!);
  assert.deepEqual(names(), ["Beta"]);
  await click(buttonByText(container, dict.common.clear)!);
  await click(buttonByText(container, "Maker B")!);
  assert.deepEqual(names(), ["Gamma"]);
  await click(buttonByText(container, dict.common.clear)!);
  await click(buttonByText(container, dict.availability.inStock)!);
  assert.deepEqual(names(), ["Alpha", "Beta"]);
  await click(buttonByText(container, dict.common.clear)!);
  const select = container.querySelector("select")!;
  await act(async () => { select.value = "priceAsc"; select.dispatchEvent(new dom.window.Event("change", { bubbles: true })); });
  assert.deepEqual(names(), ["Beta", "Gamma", "Alpha"]);
  assert.equal(buttonByText(container, dict.common.clear), null, "sorting alone does not expose Clear");
  await fill(search, "not-a-product");
  assert.ok(container.textContent?.includes(dict.catalog.noResults));
  assert.ok(container.textContent?.includes(dict.catalog.noResultsHint));
  await click(buttonByText(container, dict.access.shop.submit)!);
  assert.deepEqual(calls[0].items, [{ productId: "private-0", quantity: 1 }]);
  await click(buttonByText(container, dict.common.clear)!);
  assert.deepEqual(names(), ["Alpha", "Beta", "Gamma"]);
});
test("exact payload and notes trimming remain unchanged; failures retain cart, notes and same key", async () => {
  const container = mount();
  await click(buttonByText(container, dict.catalog.addToCart)!);
  const notes = container.querySelector("textarea")!;
  assert.equal(notes.maxLength, 2000);
  await fill(notes, "  Keep these notes  ");
  await addAndSubmit(container);
  assert.deepEqual(Object.keys(calls[0]).sort(), ["items", "notes", "submissionKey", "token"]);
  assert.ok(calls[0].token === TOKEN, "token is passed unchanged");
  assert.deepEqual(calls[0].items, [{ productId: inStockProduct.id, quantity: 1 }]);
  assert.equal(calls[0].notes, "Keep these notes");
  assert.equal(notes.value, "  Keep these notes  ");
  assert.equal(container.querySelector(".private-shop-order-bar [role=alert]")?.textContent, dict.access.shop.error);
  await addAndSubmit(container);
  assert.ok(calls[0].submissionKey === calls[1].submissionKey, "ordinary rejection retries the same key");
});
test("blank notes stay undefined and a missing public reference is a failure", async () => {
  actionImpl = async () => ({ ok: true });
  const container = mount();
  await click(buttonByText(container, dict.catalog.addToCart)!);
  await fill(container.querySelector("textarea")!, "   ");
  await addAndSubmit(container);
  assert.equal(calls[0].notes, undefined);
  assert.ok(container.querySelector(".private-shop-order-bar [role=alert]"));
  assert.ok(container.querySelector("textarea"));
});
test("conflict preserves cart/notes/key until explicit rotation without auto-submission", async () => {
  actionImpl = async () => ({ ok: false, reason: "conflict" });
  const container = mount();
  await click(buttonByText(container, dict.catalog.addToCart)!);
  await fill(container.querySelector("textarea")!, "Retain on conflict");
  await addAndSubmit(container);
  assert.ok(buttonByText(container, dict.access.shop.submit)?.disabled);
  assert.equal(container.querySelector(".private-shop-order-bar [role=alert]")?.textContent, dict.access.shop.conflictError);
  assert.equal(container.querySelector("textarea")?.value, "Retain on conflict");
  const before = dom.window.sessionStorage.getItem(keyEntries()[0]);
  assert.ok(before);
  await click(buttonByText(container, dict.access.shop.conflictRetry)!);
  await waitFor(() => {
    const replacement = dom.window.sessionStorage.getItem(keyEntries()[0]);
    return replacement !== null && replacement !== before;
  }, "explicit key rotation");
  assert.equal(calls.length, 1, "new attempt does not submit automatically");
  assert.equal(container.querySelector("textarea")?.value, "Retain on conflict");
  assert.ok(!buttonByText(container, dict.access.shop.submit)?.disabled);
  actionImpl = async () => ({ ok: false });
  await addAndSubmit(container);
  assert.ok(calls[0].submissionKey !== calls[1].submissionKey, "explicit new attempt rotates key");
  assert.deepEqual(calls[1].items, calls[0].items);
  assert.equal(calls[1].notes, calls[0].notes);
});
test("pending disables submission; confirmed success clears inputs/key and displays only publicRef", async () => {
  let resolve!: (result: { ok: boolean; publicRef: string }) => void;
  actionImpl = () => new Promise((done) => { resolve = done; });
  const container = mount();
  await click(buttonByText(container, dict.catalog.addToCart)!);
  await fill(container.querySelector("textarea")!, "Not on success screen");
  await addAndSubmit(container);
  assert.ok(buttonByText(container, dict.access.shop.submitting)?.disabled);
  await act(async () => resolve({ ok: true, publicRef: "MDF-QATEST01" }));
  await waitFor(() => !!container.querySelector(".private-shop-success"), "success rendered");
  assert.equal(container.querySelector(".private-shop-reference-value")?.textContent, "MDF-QATEST01");
  assert.equal(container.querySelector(".private-shop-reference-value")?.getAttribute("dir"), "ltr");
  assert.equal(container.querySelector("textarea,button,.private-shop-order-bar,.private-shop-product"), null);
  assert.equal(keyEntries().length, 0);
  assert.ok(!container.textContent?.includes("Not on success screen"));
  assert.ok(!container.textContent?.includes(TOKEN));
  assert.ok(container.textContent?.includes(dict.access.shop.refHint));
  assert.ok(container.textContent?.includes(dict.access.shop.disclaimer));
});
test("empty catalog retains its existing dead-end copy without discovery or ordering", () => {
  const container = mount(TOKEN, { ...catalog(), products: [] });
  assert.equal(container.querySelector("input,select,textarea,.private-shop-order-bar,.private-shop-product"), null);
  assert.ok(container.textContent?.includes(dict.access.shop.empty));
});
