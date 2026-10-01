/** Characterize the real checkout controller before changing its presentation. */
import { dom } from "@/test-support/jsdom-env";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, afterEach, mock, test } from "node:test";
import React, { act, useEffect } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { locales, type Locale } from "@/i18n/config";
import { getDictionary, interpolate } from "@/i18n/dictionaries";
import { formatCurrency } from "@/lib/format";
import type { CartItem, Customer, Product } from "@/lib/types";

type Payload = Parameters<typeof import("@/lib/actions/orders").submitOrderAction>[0];
type Result = Awaited<ReturnType<typeof import("@/lib/actions/orders").submitOrderAction>>;
const calls: Payload[] = [];
const pushes: string[] = [], replacements: string[] = [];
const router = { push: (url: string) => pushes.push(url), replace: (url: string) => replacements.push(url) };
let action: (input: Payload) => Promise<Result> = async () => ({ ok: false });
let mode = "supabase";
let quoteRevision = 1;
mock.module("next/navigation", { namedExports: { useRouter: () => router } });
mock.module("@/lib/data/mode", { namedExports: { getDataMode: () => mode } });
mock.module("@/lib/actions/orders", { namedExports: {
  submitOrderAction: (input: Payload) => { calls.push(input); return action(input); },
} });
mock.module("@/lib/actions/pricing", { namedExports: {
  resolvePricesAction: async (_scope: unknown, ids: string[]) => ({ mode: "active", prices: ids.map(id => ({ product_id: id, status: "base", price: id === "first" ? "36.50" : "10.00", vat: "0.18" })) }),
  quoteOrderAction: async (_scope: unknown, items: CartItem[]) => ({ mode: "active", quote: {version: 1, digest: (quoteRevision === 1 ? "a" : "b").repeat(64)}, unchangedItems: false,
    lines: items.map(i => ({ product_id: i.productId, quantity:i.quantity, unit_price_snapshot:i.productId === "first" ? (quoteRevision === 1 ? "36.50" : "40.00") : "10.00", vat_rate_snapshot:"0.18", line_subtotal:"0",line_vat:"0",line_total:"0" })),
    headers: {subtotal:quoteRevision === 1 ? "103.00" : "110.00",vat:"18.54",total:"121.54"} }),
} });
// Load the controller/providers through the same tsx CJS graph so React uses
// one context instance rather than separate ESM/CJS provider identities.
const require = createRequire(import.meta.url);
const { CheckoutView } = require("@/components/checkout-view") as typeof import("@/components/checkout-view");
const { CartProvider, useCart } = require("@/lib/cart-context") as typeof import("@/lib/cart-context");
const { ShopDataProvider } = require("@/lib/shop-data-context") as typeof import("@/lib/shop-data-context");
const nativeFormData = globalThis.FormData;
globalThis.FormData = dom.window.FormData;
after(() => { globalThis.FormData = nativeFormData; });

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const product: Product = {
  id: "first", sku: "CHECKOUT-004D", categoryId: "missing", manufacturerId: "",
  translations: { ar: { name: "منتج طويل ".repeat(8) }, he: { name: "מוצר ארוך ".repeat(8) }, en: { name: "LongProductName".repeat(10) } },
  packageType: "carton", unitsPerPackage: 12, baseUnit: "bottles", unitSize: "330ml",
  wholesalePrice: 36.5, availability: "inStock",
};
const second: Product = { ...product, id: "second", wholesalePrice: 10, availability: "outOfStock" };
const customer: Customer = { id: "shop", name: "Test shop", type: "grocery", phone: "0500000040", contactName: "Test contact", city: { ar: "مدينة", he: "עיר", en: "City" } };
const initialItems = [{ productId: "first", quantity: 2 }, { productId: "second", quantity: 3 }];
const cleanups: (() => void)[] = [];
type Cart = ReturnType<typeof useCart>;
async function mount(locale: Locale = "en", options: { items?: CartItem[]; hydrate?: boolean; preserveStorage?: boolean; submissionKey?: string | null } = {}) {
  if (!options.preserveStorage) dom.window.localStorage.setItem("madaf.cart.v1", JSON.stringify({
    items: options.items ?? initialItems, customerId: customer.id, submissionKey: options.submissionKey ?? null,
  }));
  const container = document.createElement("div");
  document.body.append(container);
  const captured: { current: Cart | null } = { current: null };
  function Probe() { const cart = useCart(); useEffect(() => { captured.current = cart; }); return null; }
  const dict = getDictionary(locale);
  // The provider requires children in its props type; .mts cannot use JSX.
  // eslint-disable-next-line react/no-children-prop
  const tree = React.createElement(ShopDataProvider, {
    products: [product, second], categories: [], manufacturers: [], customers: [customer],
    children: React.createElement(CartProvider, null, React.createElement(Probe), React.createElement(CheckoutView, { locale, dict })),
  });
  let root: ReturnType<typeof createRoot>;
  const errors: unknown[] = [];
  if (options.hydrate) {
    container.innerHTML = renderToString(tree);
    assert.equal(container.querySelector<HTMLButtonElement>("button[type=submit]")!.disabled, true);
    assert.deepEqual(replacements, [], "SSR cannot redirect before cart hydration");
    act(() => { root = hydrateRoot(container, tree, { onRecoverableError: (e) => errors.push(e) }); });
  } else {
    root = createRoot(container);
    act(() => root.render(tree));
  }
  const cleanup = () => { act(() => root.unmount()); container.remove(); };
  cleanups.push(cleanup);
  for (let i = 0; i < 30 && captured.current?.items.length && !captured.current.orderQuote && mode !== "mock"; i++) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  }
  return { container, dict, errors, cart: () => { assert.ok(captured.current); return captured.current; } };
}
function stored() { return JSON.parse(dom.window.localStorage.getItem("madaf.cart.v1")!); }
function submitButton(h: Awaited<ReturnType<typeof mount>>) { return h.container.querySelector<HTMLButtonElement>("button[type=submit]")!; }
function button(h: Awaited<ReturnType<typeof mount>>, text: string) {
  const found = Array.from(h.container.querySelectorAll("button")).find(b => b.textContent?.trim() === text);
  assert.ok(found, text); return found;
}
function click(element: HTMLButtonElement) { act(() => element.click()); }
async function submit(h: Awaited<ReturnType<typeof mount>>) {
  await act(async () => { h.container.querySelector("form")!.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })); });
}
function intact(h: Awaited<ReturnType<typeof mount>>) {
  assert.deepEqual(h.cart().items, initialItems);
  assert.deepEqual(stored().items, initialItems);
  if (calls.length) assert.equal(stored().submissionKey, calls[0].submissionKey);
  else assert.equal(stored().submissionKey, null);
  assert.equal(stored().customerId, customer.id);
  assert.deepEqual(pushes, []);
  assert.deepEqual(replacements, []);
}
afterEach(() => {
  cleanups.splice(0).reverse().forEach(fn => fn());
  dom.window.localStorage.clear(); calls.length = 0; pushes.length = 0; replacements.length = 0;
  action = async () => ({ ok: false }); mode = "supabase"; quoteRevision = 1;
});

for (const locale of locales) {
  test(`${locale}: real hydration restores populated cart/customer and summary without premature redirect`, async () => {
    const h = await mount(locale, { hydrate: true });
    assert.deepEqual(h.errors, []);
    assert.equal(h.cart().hydrated, true);
    assert.equal(h.container.querySelector("h1")?.textContent, h.dict.checkout.title);
    assert.equal(h.container.querySelector<HTMLInputElement>("#co-shop")?.value, customer.name);
    assert.equal(h.container.querySelector<HTMLInputElement>("#co-contact")?.value, customer.contactName);
    assert.equal(h.container.querySelector<HTMLInputElement>("#co-phone")?.value, customer.phone);
    assert.equal(h.container.querySelector<HTMLInputElement>("#co-city")?.value, customer.city[locale]);
    assert.equal(h.container.querySelector("#co-phone")?.getAttribute("dir"), "ltr");
    assert.equal(h.container.querySelectorAll("input[required]").length, 2);
    assert.equal(h.container.querySelectorAll("ul li").length, 2);
    assert.ok(h.container.textContent?.includes(product.translations[locale].name));
    assert.ok(h.container.textContent?.includes(interpolate(h.dict.checkout.itemsCount, { count: 2 })));
    assert.ok(h.container.textContent?.includes(`5 ${h.dict.common.packages}`));
    assert.ok(h.container.textContent?.includes(formatCurrency(103, locale)));
    assert.equal(submitButton(h).disabled, false);
    intact(h);
  });
  test(`${locale}: hydrated empty cart redirects to its localized cart and cannot submit`, async () => {
    const h = await mount(locale, { items: [], hydrate: true });
    assert.deepEqual(replacements, [`/${locale}/cart`]);
    assert.equal(submitButton(h).disabled, true);
    assert.deepEqual(calls, []);
  });
}
test("exact payload preserves untrimmed notes and excludes edited display-only customer/delivery fields", async () => {
  const h = await mount("ar");
  h.container.querySelectorAll<HTMLInputElement>("input[id]").forEach(input => { input.value = "Changed display value"; assert.equal(input.name, ""); });
  click(button(h, h.dict.checkout.scheduled));
  const date = h.container.querySelector<HTMLInputElement>("input[type=date]")!;
  date.value = "2026-10-02";
  assert.equal(date.name, "");
  h.container.querySelector<HTMLTextAreaElement>("textarea[name=notes]")!.value = "  Leave beside the door  \n";
  await submit(h);
  assert.deepEqual(calls, [{ customerId: "shop", items: initialItems, notes: "  Leave beside the door  \n", locale: "ar", submissionKey: calls[0].submissionKey, quote: {version: 1, digest: (quoteRevision === 1 ? "a" : "b").repeat(64)} }]);
  intact(h);
});
test("blank notes stay explicitly undefined in the payload", async () => {
  const h = await mount();
  h.container.querySelector("textarea")!.value = " \n ";
  await submit(h);
  assert.deepEqual(calls[0], { customerId: "shop", items: initialItems, notes: undefined, locale: "en", submissionKey: calls[0].submissionKey, quote: {version: 1, digest: (quoteRevision === 1 ? "a" : "b").repeat(64)} });
});
test("delivery only reveals an uncontrolled date and toggling away resets it", async () => {
  const h = await mount();
  assert.equal(h.container.querySelector("input[type=date]"), null);
  click(button(h, h.dict.checkout.scheduled));
  const date = h.container.querySelector<HTMLInputElement>("input[type=date]")!;
  assert.equal(date.dir, "ltr"); date.value = "2026-10-02";
  click(button(h, h.dict.checkout.asap));
  assert.equal(h.container.querySelector("input[type=date]"), null);
  click(button(h, h.dict.checkout.scheduled));
  assert.equal(h.container.querySelector<HTMLInputElement>("input[type=date]")!.value, "");
  intact(h);
});
test("pending request disables the single submit while fields and cart remain intact", async () => {
  let resolve!: (result: Result) => void;
  action = () => new Promise(done => { resolve = done; });
  const h = await mount();
  await submit(h);
  assert.equal(h.container.querySelectorAll("button[type=submit]").length, 1);
  assert.equal(submitButton(h).disabled, true);
  assert.equal(submitButton(h).textContent?.trim(), h.dict.pricing.retry);
  assert.equal(h.container.querySelectorAll("input:disabled, textarea:disabled").length, 1);
  intact(h);
  await act(async () => resolve({ ok: false }));
  assert.equal(submitButton(h).disabled, false);
});
for (const failure of ["rejected result", "transport rejection", "success without publicRef"] as const) {
  test(`${failure}: retains cart/key, displays error and reuses the key on retry`, async () => {
    action = async () => {
      if (failure === "transport rejection") throw Error("connection lost after commit");
      return { ok: failure === "success without publicRef" };
    };
    const h = await mount();
    await submit(h);
    assert.equal(h.container.querySelector("[role=alert]")?.textContent, h.dict.checkout.sendError);
    assert.equal(submitButton(h).disabled, false); intact(h);
    await submit(h);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].submissionKey, calls[1].submissionKey); intact(h);
  });
}
test("refresh preserves key but missing original payload stays unresolved without guessing", async () => {
  let h = await mount("en", { submissionKey: null });
  await submit(h);
  const generated = calls[0].submissionKey;
  assert.match(generated, uuid);
  cleanups.splice(0).forEach(fn => fn());
  h = await mount("en", { preserveStorage: true });
  await submit(h);
  assert.equal(calls.length, 1);
  assert.equal(submitButton(h).disabled, true);
  assert.ok(h.container.textContent?.includes(h.dict.pricing.unresolved));
  assert.equal(stored().submissionKey, generated);
});
test("conflict keeps cart/key until an explicit new attempt; only the next submit generates a new key", async () => {
  action = async () => ({ ok: false, reason: "conflict" });
  const h = await mount(); await submit(h);
  assert.ok(h.container.querySelector("[role=alert]")?.textContent?.includes(h.dict.checkout.conflictError));
  assert.equal(submitButton(h).disabled, true); intact(h);
  click(button(h, h.dict.checkout.conflictRetry));
  assert.equal(calls.length, 1, "explicit reset does not submit");
  assert.equal(h.container.querySelector("[role=alert]"), null);
  assert.equal(stored().submissionKey, null);
  assert.deepEqual(stored().items, initialItems);
  assert.equal(submitButton(h).disabled, false);
  await submit(h);
  assert.match(calls[1].submissionKey, uuid);
  assert.notEqual(calls[1].submissionKey, calls[0].submissionKey);
});
test("confirmed success clears cart/key, retains customer and redirects using encoded publicRef without an empty-cart race", async () => {
  const publicRef = "MDF-PUBLIC /?&אב";
  action = async () => ({ ok: true, publicRef });
  const h = await mount("he"); await submit(h);
  assert.deepEqual(stored(), { items: [], customerId: "shop", submissionKey: null });
  assert.deepEqual(pushes, [`/he/order-success?n=${encodeURIComponent(publicRef)}`]);
  assert.deepEqual(replacements, []);
  assert.equal(submitButton(h).disabled, true);
});
test("mock submit retains its 600ms delay, never calls the action, then clears and navigates", async () => {
  mode = "mock";
  const h = await mount();
  let finish: (() => void) | undefined;
  const timer = mock.method(dom.window, "setTimeout", (callback: () => void, delay: number) => { assert.equal(delay, 600); finish = callback; return 1; });
  try {
    await submit(h); assert.equal(calls.length, 0); intact(h);
    assert.equal(submitButton(h).disabled, true);
    assert.ok(finish); act(finish);
    assert.deepEqual(stored().items, []);
    assert.equal(stored().submissionKey, null);
    assert.match(pushes[0], /^\/en\/order-success\?n=MDF-\d+$/);
    assert.deepEqual(replacements, []);
  } finally { timer.mock.restore(); }
});

test("changed quote refreshes reviewed amounts without autosubmit or key rotation",async()=>{
 const h=await mount();action=async()=>{quoteRevision=2;return {ok:false,reason:"pricing"};};await submit(h);
 const key=calls[0].submissionKey;
 for(let i=0;i<30&&h.cart().orderQuote?.quote.digest!=="b".repeat(64);i++)await act(async()=>{await new Promise(r=>setTimeout(r,10));});
 assert.equal(calls.length,1);assert.equal(h.cart().subtotal,110);assert.ok(h.container.textContent?.includes(h.dict.pricing.changed));assert.equal(stored().submissionKey,key);
 action=async()=>({ok:false});await submit(h);assert.equal(calls.length,2);assert.equal(calls[1].submissionKey,key);assert.deepEqual(calls[1].quote,{version:1,digest:"b".repeat(64)});
});
test("double-click while pending makes one creation call",async()=>{let finish!:(r:Result)=>void;action=()=>new Promise(r=>{finish=r;});const h=await mount();await submit(h);await submit(h);assert.equal(calls.length,1);await act(async()=>finish({ok:false}));await submit(h);assert.equal(calls.length,2);assert.deepEqual(calls[1].quote,{mode:"replay_only"});await act(async()=>finish({ok:false}));});
