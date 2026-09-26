/**
 * PILOT-OPS-AUDIT-008-FIX2 — MOUNTED ShowcaseView token-order retry persistence.
 *
 * Mounts the REAL ShowcaseView (browse → checkout guest form) with the showcase
 * order action module-mocked to CAPTURE the submission key. Proves the same
 * persistence contract as the shop flow: the SAME key survives a refresh
 * (remount) and an ambiguous-failure retry; a confirmed success rotates it; a
 * different token gets a different key; storage-unavailable fails closed (no
 * action call); the key never renders and the raw token / guest details are
 * never persisted by the key helper.
 *
 * Runner: `npm run test:showcase-view` (needs --experimental-test-module-mocks).
 */
// FIRST: DOM globals must exist before react-dom/client is evaluated.
import { dom } from "@/test-support/jsdom-env";

// The checkout form builds `new FormData(event.currentTarget)`; jsdom's FormData
// supports the (form) constructor argument that Node's global (undici) FormData
// does not. Bridge it so the mounted submit path works.
(globalThis as unknown as { FormData: typeof dom.window.FormData }).FormData =
  dom.window.FormData;

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, mock, test } from "node:test";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { getDictionary } from "@/i18n/dictionaries";
import { locales, type Locale } from "@/i18n/config";
import { formatCurrency } from "@/lib/format";
import type { ShowcaseCatalog } from "@/lib/data/catalog-showcase";
import { categories, manufacturers, products } from "@/lib/mock";

interface ActionCall {
  token: string;
  submissionKey: string;
  items: { productId: string; quantity: number }[];
  store: Record<string, unknown>;
  notes?: string;
}
const calls: ActionCall[] = [];
let actionImpl: (input: ActionCall) => Promise<{ ok: boolean; publicRef?: string; reason?: "conflict" }> = async () => ({
  ok: false,
});
mock.module("@/lib/actions/catalog-showcase", {
  namedExports: {
    submitShowcaseOrderAction: async (input: ActionCall) => {
      calls.push(structuredClone(input));
      return actionImpl(input);
    },
  },
});
mock.module("next/navigation", {
  namedExports: {
    usePathname: () => "/en/showcase/token",
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

const { ShowcaseView } = await import("@/components/shop/showcase-view");

const dict = getDictionary("en");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = "showcasetoken-fixture-cccccccccc";
const TOKEN2 = "showcasetoken-fixture-dddddddddd";
const inStockProduct = { ...products[0], availability: "inStock" as const };

function catalog(): ShowcaseCatalog {
  return {
    tenantName: { ar: "متجر", he: "חנות", en: "Shop" },
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
    root.render(React.createElement(ShowcaseView, { locale, dict: getDictionary(locale), token, catalog: data }));
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

/** Browse → add (if needed) → review (if on browse) → fill required name →
 * submit the form; resolve when the action is called or a prep error shows. */
async function guestSubmit(container: HTMLElement, storeName = "Test Store"): Promise<number> {
  const add = buttonByText(container, dict.catalog.addToCart);
  if (add) await click(add);
  const review = buttonByText(container, dict.access.showcase.reviewOrder);
  if (review) await click(review);
  const nameInput = container.querySelector('input[name="name"]') as HTMLInputElement | null;
  assert.ok(nameInput, "store-name input present on the checkout step");
  nameInput.value = storeName;
  const form = container.querySelector("form") as HTMLFormElement | null;
  assert.ok(form, "checkout form present");
  const submitBtn = buttonByText(container, dict.access.showcase.submit);
  const before = calls.length;
  // requestSubmit() is the spec path: it fires a real submit event so React's
  // onSubmit receives a proper event.currentTarget for its FormData.
  await act(async () => {
    form.requestSubmit(submitBtn ?? undefined);
  });
  await waitFor(
    () =>
      calls.length > before ||
      (container.textContent ?? "").includes(dict.access.showcase.prepError),
    "submit resolves",
  );
  return before;
}

test("first submit sends a persisted UUID key; a refresh (remount) sends the SAME key", async () => {
  const c1 = mount();
  await guestSubmit(c1);
  assert.equal(calls.length, 1);
  const key1 = calls[0].submissionKey;
  assert.match(key1, UUID);
  assert.equal(calls[0].token, TOKEN);

  unmountAll();
  const c2 = mount();
  await guestSubmit(c2);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].submissionKey, key1, "the remount reused the persisted key");
});

test("an ambiguous failure retains the key; the retry reuses it", async () => {
  actionImpl = async () => {
    throw new Error("network lost after commit");
  };
  const c = mount();
  await guestSubmit(c);
  const key1 = calls[0].submissionKey;
  await guestSubmit(c); // component stays on the checkout step after the error
  assert.equal(calls.length, 2);
  assert.equal(calls[1].submissionKey, key1, "the retry sent the same key");
});

test("a confirmed success clears the key; the next order gets a DIFFERENT key", async () => {
  actionImpl = async () => ({ ok: true, publicRef: "MDF-BBBBBBBB" });
  const c1 = mount();
  await guestSubmit(c1);
  const key1 = calls[0].submissionKey;
  unmountAll();
  actionImpl = async () => ({ ok: false });
  const c2 = mount();
  await guestSubmit(c2);
  assert.notEqual(calls[1].submissionKey, key1, "a new order after success gets a fresh key");
});

test("a different token gets a different key", async () => {
  const c1 = mount(TOKEN);
  await guestSubmit(c1);
  unmountAll();
  const c2 = mount(TOKEN2);
  await guestSubmit(c2);
  assert.notEqual(calls[1].submissionKey, calls[0].submissionKey);
});

test("storage unavailable → the order action is NOT called and a prep error shows", async () => {
  const realDesc = Object.getOwnPropertyDescriptor(dom.window, "sessionStorage")!;
  Object.defineProperty(dom.window, "sessionStorage", { value: undefined, configurable: true });
  try {
    const c = mount();
    await guestSubmit(c);
    assert.equal(calls.length, 0, "no order was submitted (fail closed)");
    assert.ok((c.textContent ?? "").includes(dict.access.showcase.prepError), "prep error shown");
  } finally {
    Object.defineProperty(dom.window, "sessionStorage", realDesc);
  }
});

test("the submission key never appears in the DOM, and the raw token is never persisted", async () => {
  const c = mount();
  await guestSubmit(c, "Guest Shop Ltd");
  const key = calls[0].submissionKey;
  assert.ok(!(dom.window.document.body.textContent ?? "").includes(key), "key not rendered");
  const ss = dom.window.sessionStorage;
  for (let i = 0; i < ss.length; i++) {
    const k = ss.key(i)!;
    assert.ok(!k.includes(TOKEN), "raw token not in a storage key");
    const v = ss.getItem(k) ?? "";
    assert.ok(!v.includes(TOKEN), "raw token not in a storage value");
    assert.ok(!v.includes("Guest Shop Ltd"), "guest PII not in a storage value");
  }
});

test("initial sold-out Add is disabled and cannot create a selected line", async () => {
  const data = { ...catalog(), products: [{ ...inStockProduct, availability: "outOfStock" as const }] };
  const container = mount(TOKEN, data);
  const add = buttonByText(container, dict.availability.outOfStock)!;
  assert.equal(add.disabled, true);
  await click(add);
  assert.equal(container.querySelector('button[aria-label="+"]'), null);
  assert.equal(buttonByText(container, dict.access.showcase.reviewOrder), null);
  assert.equal(calls.length, 0);
});

test("selected sold-out item keeps quantity, blocks increment and permits decrement/removal", async () => {
  const container = mount();
  await click(buttonByText(container, dict.catalog.addToCart)!);
  const increase = () => container.querySelector<HTMLButtonElement>('button[aria-label="+"]')!;
  const decrease = () => container.querySelector<HTMLButtonElement>('button[aria-label="−"]')!;
  const quantity = () => increase().parentElement?.querySelector('span[dir="ltr"]')?.textContent;
  await click(increase());
  assert.equal(quantity(), "2");
  const data = { ...catalog(), products: [{ ...inStockProduct, availability: "outOfStock" as const }] };
  act(() => mounted[0].root.render(React.createElement(ShowcaseView, { locale: "en", dict, token: TOKEN, catalog: data })));
  assert.equal(quantity(), "2", "availability must not silently remove existing quantities");
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
  assert.equal(buttonByText(container, dict.access.showcase.reviewOrder), null);
  assert.equal(calls.length, 0);
});

function cards(c: HTMLElement) { return [...c.querySelectorAll<HTMLElement>(".public-store-product")]; }
function input(c: HTMLElement, name: string) { return c.querySelector<HTMLInputElement>(`input[name="${name}"]`)!; }
function keyEntries() { return Object.keys(dom.window.sessionStorage).filter((k) => k.startsWith("madaf:order-submission:")); }
async function fill(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = el.tagName === "TEXTAREA" ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
}
async function checkout(c: HTMLElement) {
  await click(cards(c)[0].querySelector(".public-store-add")!);
  await click(c.querySelector(".showcase-proceed")!);
}
async function submit(c: HTMLElement) {
  await act(async () => c.querySelector("form")!.requestSubmit());
}
function multiCatalog(): ShowcaseCatalog {
  return {
    ...catalog(),
    categories: ["One", "Two"].map((name, i) => ({ id: `category-${i}`, name: { ar: name, he: name, en: name }, icon: "📦", hue: 1 })),
    manufacturers: ["Maker A", "Maker B"].map((name, i) => ({ id: `maker-${i}`, name: { ar: name, he: name, en: name } })),
    products: ["Alpha", "Beta", "Gamma"].map((name, i) => ({ ...inStockProduct, id: `guest-${i}`, sku: `GUEST-${i}`, categoryId: `category-${i === 1 ? 1 : 0}`, manufacturerId: `maker-${i === 2 ? 1 : 0}`, wholesalePrice: [30, 10, 20][i], availability: i === 2 ? "outOfStock" : "inStock", translations: { ar: { name }, he: { name }, en: { name } } })),
  };
}

test("Showcase shares presentation without authenticated or private-shop controllers", () => {
  const source = readFileSync(new URL("./showcase-view.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\b(?:AppShell|CartProvider|ShopDataProvider|CustomerPicker|CheckoutView|ShopView|ProductCard|useCart)\b|href=.*product\//);
  for (const action of ["getOrCreateTokenSubmissionKey", "rotateTokenSubmissionKey", "clearTokenSubmissionKey"]) {
    assert.ok(source.includes(`${action}("showcase", token)`));
  }
});

for (const locale of locales) {
  test(`${locale}: supplier identity, guest fields and exact localized snapshot payload remain unchanged`, async () => {
    const c = mount(TOKEN, catalog(), locale);
    const d = getDictionary(locale);
    assert.equal(c.querySelector("h1")?.textContent?.trim(), catalog().tenantName[locale]);
    assert.ok(c.textContent?.includes(d.access.showcase.intro));
    assert.equal(c.querySelector('a[href*="/product/"],a[href$="/admin"],a[href$="/cart"],select[name="customerId"]'), null);
    await checkout(c);
    const fields = { name: "  Synthetic guest  ", contactName: "  Contact  ", phone: "  0500000000  ", email: "qa@example.invalid", city: "  Sample city  ", address: "  Sample address  " };
    for (const [name, value] of Object.entries(fields)) input(c, name).value = value;
    await fill(c.querySelector("textarea")!, "  Sample notes  ");
    await submit(c);
    await waitFor(() => calls.length === 1, "action captured");
    const cityKey = locale === "ar" ? "cityAr" : locale === "he" ? "cityHe" : "cityEn";
    assert.deepEqual(Object.keys(calls[0]).sort(), ["items", "notes", "store", "submissionKey", "token"]);
    assert.deepEqual(calls[0].store, { name: fields.name, contactName: fields.contactName, phone: fields.phone, email: fields.email, address: fields.address, [cityKey]: "Sample city" });
    assert.deepEqual(calls[0].items, [{ productId: inStockProduct.id, quantity: 1 }]);
    assert.equal(calls[0].notes, "Sample notes");
    assert.ok(calls[0].token === TOKEN);
    assert.ok(!c.textContent?.includes(TOKEN));
    assert.ok([...c.querySelectorAll("*")].every((e) => [...e.attributes].filter((a) => a.name.startsWith("data-")).every((a) => !a.value.includes(TOKEN))));
    for (const k of keyEntries()) {
      const value = dom.window.sessionStorage.getItem(k)!;
      assert.ok(!k.includes(TOKEN) && !value.includes(TOKEN));
      for (const pii of Object.values(fields)) assert.ok(!value.includes(pii.trim()), "guest fields never persisted");
    }
  });
}

test("guest field names, limits and required/email validation stay unchanged", async () => {
  const c = mount(); await checkout(c);
  const limits = { name: 200, contactName: 200, phone: 40, email: 254, city: 120, address: 300 };
  assert.deepEqual([...c.querySelectorAll("input")].map((e) => e.name), Object.keys(limits));
  for (const [name, max] of Object.entries(limits)) { assert.equal(input(c, name).maxLength, max); assert.equal(input(c, name).required, name === "name"); }
  assert.equal(input(c, "phone").type, "text");
  assert.equal(input(c, "email").type, "email");
  assert.equal(input(c, "phone").dir, "ltr"); assert.equal(input(c, "email").dir, "ltr");
  assert.equal(c.querySelector("textarea")!.maxLength, 2000);
  assert.equal(c.querySelector("textarea")!.getAttribute("name"), null);
  await submit(c); assert.equal(calls.length, 0); assert.equal(input(c, "name").validity.valueMissing, true);
  input(c, "name").value = "Guest"; input(c, "email").value = "invalid-email";
  await submit(c); assert.equal(calls.length, 0); assert.equal(input(c, "email").validity.typeMismatch, true);
  input(c, "email").value = ""; await fill(c.querySelector("textarea")!, "  "); await submit(c);
  await waitFor(() => calls.length === 1, "optional fields accepted");
  assert.deepEqual(calls[0].store, { name: "Guest", contactName: undefined, phone: undefined, email: undefined, cityEn: undefined, address: undefined });
  assert.equal(calls[0].notes, undefined);
});

test("cart count/estimate and read-only recap preserve quantities without submitting on Proceed", async () => {
  const c = mount(TOKEN, multiCatalog());
  await click(cards(c)[0].querySelector(".public-store-add")!);
  await click(cards(c)[0].querySelector('button[aria-label="+"]')!);
  await click(cards(c)[1].querySelector(".public-store-add")!);
  assert.ok(c.querySelector(".public-store-line-count")?.textContent?.endsWith("2"));
  assert.equal(c.querySelector(".public-store-estimate")?.textContent, formatCurrency(70, "en"));
  await click(cards(c)[0].querySelector('button[aria-label="−"]')!);
  await click(cards(c)[1].querySelector('button[aria-label="−"]')!);
  assert.ok(c.querySelector(".public-store-line-count")?.textContent?.endsWith("1"));
  await click(c.querySelector(".showcase-proceed")!);
  assert.equal(calls.length, 0); assert.equal(keyEntries().length, 0);
  assert.equal(c.querySelectorAll(".showcase-summary-line").length, 1);
  assert.equal(c.querySelector(".showcase-summary-price")?.textContent, formatCurrency(30, "en"));
  assert.equal(c.querySelector(".showcase-summary-total span:last-child")?.textContent, formatCurrency(30, "en"));
  assert.equal(c.querySelector(".showcase-summary button,.showcase-summary input"), null);
});

test("search/category/manufacturer/stock/sort/clear preserve hidden selected products", async () => {
  const c = mount(TOKEN, multiCatalog()); const names = () => cards(c).map((e) => e.querySelector("h3")?.textContent?.trim());
  await click(cards(c)[0].querySelector(".public-store-add")!);
  const search = c.querySelector<HTMLInputElement>('input[type="search"]')!;
  await fill(search, "GUEST-1"); assert.deepEqual(names(), ["Beta"]);
  await click(buttonByText(c, dict.common.clear)!);
  await click(buttonByText(c, "Two")!); assert.deepEqual(names(), ["Beta"]);
  await click(buttonByText(c, dict.common.clear)!);
  await click(buttonByText(c, "Maker B")!); assert.deepEqual(names(), ["Gamma"]);
  await click(buttonByText(c, dict.common.clear)!);
  await click(buttonByText(c, dict.availability.inStock)!); assert.deepEqual(names(), ["Alpha", "Beta"]);
  await click(buttonByText(c, dict.common.clear)!);
  const select = c.querySelector("select")!;
  await act(async () => { select.value = "priceAsc"; select.dispatchEvent(new dom.window.Event("change", { bubbles: true })); });
  assert.deepEqual(names(), ["Beta", "Gamma", "Alpha"]); assert.equal(buttonByText(c, dict.common.clear), null);
  await fill(search, "No matching product"); assert.equal(cards(c).length, 0); assert.ok(c.textContent?.includes(dict.catalog.noResults));
  await click(c.querySelector(".showcase-proceed")!);
  assert.equal(c.querySelector(".showcase-summary-name")?.textContent, "Alpha");
  await click(c.querySelector(".showcase-back")!); await click(buttonByText(c, dict.common.clear)!);
  assert.deepEqual(names(), ["Alpha", "Beta", "Gamma"]);
});

test("Back retains cart/filter/notes but guest identity inputs remount empty as before", async () => {
  const c = mount(TOKEN, multiCatalog());
  await fill(c.querySelector<HTMLInputElement>('input[type="search"]')!, "Alpha"); await checkout(c);
  input(c, "name").value = "Guest identity"; input(c, "phone").value = "0500000000";
  await fill(c.querySelector("textarea")!, "Keep notes");
  await click(c.querySelector(".showcase-back")!);
  assert.equal(c.querySelector<HTMLInputElement>('input[type="search"]')?.value, "Alpha");
  assert.equal(c.querySelector(".public-store-quantity span")?.textContent, "1");
  await click(c.querySelector(".showcase-proceed")!);
  assert.equal(input(c, "name").value, ""); assert.equal(input(c, "phone").value, "");
  assert.equal(c.querySelector("textarea")?.value, "Keep notes");
  assert.equal(c.querySelectorAll(".showcase-summary-line").length, 1); assert.equal(calls.length, 0);
});

test("ordinary rejection retains form/notes/cart and retries with the same payload/key", async () => {
  const c = mount(); await checkout(c); input(c, "name").value = "Guest";
  await fill(c.querySelector("textarea")!, "Keep notes"); await submit(c); await waitFor(() => calls.length === 1, "first rejection");
  assert.equal(c.querySelector("[role=alert]")?.textContent, dict.access.showcase.error);
  assert.equal(input(c, "name").value, "Guest"); assert.equal(c.querySelector("textarea")?.value, "Keep notes");
  await submit(c); await waitFor(() => calls.length === 2, "retry"); assert.deepEqual(calls[1], calls[0]);
});

test("conflict retains guest form/key; explicit rotation does not auto-submit", async () => {
  actionImpl = async () => ({ ok: false, reason: "conflict" });
  const c = mount(); await checkout(c); input(c, "name").value = "Guest";
  await fill(c.querySelector("textarea")!, "Conflict notes"); await submit(c); await waitFor(() => !!c.querySelector(".showcase-conflict"), "conflict");
  const before = dom.window.sessionStorage.getItem(keyEntries()[0]); assert.ok(before);
  assert.ok(c.querySelector<HTMLButtonElement>(".showcase-submit")?.disabled);
  assert.equal(input(c, "name").value, "Guest"); assert.equal(c.querySelector("textarea")?.value, "Conflict notes");
  await click(c.querySelector(".public-store-new-attempt")!);
  await waitFor(() => { const next = dom.window.sessionStorage.getItem(keyEntries()[0]); return next !== null && next !== before; }, "rotation");
  assert.equal(calls.length, 1); assert.equal(input(c, "name").value, "Guest");
  actionImpl = async () => ({ ok: false }); await submit(c); await waitFor(() => calls.length === 2, "new attempt");
  assert.ok(calls[1].submissionKey !== calls[0].submissionKey); assert.deepEqual(calls[1].store, calls[0].store); assert.deepEqual(calls[1].items, calls[0].items); assert.equal(calls[1].notes, calls[0].notes);
});

test("pending disables submit/back; success clears local surfaces/key and displays only public reference", async () => {
  let resolve!: (result: { ok: boolean; publicRef: string }) => void;
  actionImpl = () => new Promise((done) => { resolve = done; });
  const c = mount(); await checkout(c); input(c, "name").value = "Guest"; await fill(c.querySelector("textarea")!, "Clear notes"); await submit(c);
  assert.ok(c.querySelector<HTMLButtonElement>(".showcase-submit")?.disabled); assert.ok(c.querySelector<HTMLButtonElement>(".showcase-back")?.disabled);
  await act(async () => resolve({ ok: true, publicRef: "MDF-QAGUEST1" }));
  await waitFor(() => !!c.querySelector(".showcase-success"), "success");
  assert.equal(c.querySelector(".public-store-reference-value")?.textContent, "MDF-QAGUEST1");
  assert.equal(c.querySelector("input,textarea,button,.public-store-product,.showcase-summary"), null);
  assert.equal(keyEntries().length, 0); assert.ok(!c.textContent?.includes("Clear notes"));
  assert.ok(c.textContent?.includes(dict.access.showcase.refHint)); assert.ok(c.textContent?.includes(dict.access.showcase.disclaimer));
});

test("missing public reference remains a failure and empty catalog has no ordering controls", async () => {
  actionImpl = async () => ({ ok: true });
  const c = mount(); await guestSubmit(c); assert.ok(c.querySelector("[role=alert]")); assert.ok(c.querySelector("form"));
  unmountAll(); const empty = mount(TOKEN, { ...catalog(), products: [] });
  assert.ok(empty.textContent?.includes(dict.access.showcase.empty));
  assert.equal(empty.querySelector("input,select,textarea,.showcase-proceed,.public-store-product"), null);
});
