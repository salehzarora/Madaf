import { dom } from "@/test-support/jsdom-env";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { beforeEach, mock, test } from "node:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { locales, type Locale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { formatCurrency } from "@/lib/format";
import type { Category, Product } from "@/lib/types";

const skus = ["MDF-1001", "MDF-1009", "MDF-1032", "MDF-1019"];
const samples: Product[] = skus.map((sku, i) => ({
  id: `p${i}`, sku, categoryId: "drinks", manufacturerId: "",
  translations: { ar: { name: `منتج ${i}` }, he: { name: `מוצר ${i}` }, en: { name: `Product ${i}` } },
  packageType: "carton", unitsPerPackage: 12, baseUnit: "bottles", unitSize: "330ml", wholesalePrice: (i + 1) * 10, availability: "inStock",
}));
let products: Product[];
let categories: Category[];
const reads: string[] = [];
mock.module("@/lib/data", { namedExports: {
  listProducts: async () => { reads.push("products"); return products; },
  listCategories: async () => { reads.push("categories"); return categories; },
} });
const { MiniCatalogPreview } = await import("@/components/mini-catalog-preview");
beforeEach(() => {
  products = [...samples].reverse();
  categories = [{ id: "drinks", icon: "🥤", hue: 197, name: { ar: "مشروبات", he: "משקאות", en: "Drinks" } }];
  reads.length = 0;
});
function tree(locale: Locale = "en") { return MiniCatalogPreview({ locale, dict: getDictionary(locale) }); }
async function render(locale: Locale = "en") { return new JSDOM(renderToStaticMarkup(await tree(locale))).window.document; }
test("preview remains server-rendered, using only its existing data reads", async () => {
  const source = readFileSync(new URL("./mini-catalog-preview.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /["']use client["']|\buse(?:Cart|State|Effect|Pathname)\b|@\/lib\/(?:mock|supabase)/);
  await render();
  assert.deepEqual(reads, ["products", "categories"]);
});
for (const locale of locales) {
  test(`${locale}: decorative, noninteractive preview preserves prioritized SKUs and localized prices`, async () => {
    const document = await render(locale);
    assert.equal(document.querySelector(".storefront-landing-preview")?.getAttribute("aria-hidden"), "true");
    assert.equal(document.querySelector("a, button, input, select, textarea, [tabindex], [role=button]"), null);
    const cards = Array.from(document.querySelectorAll(".storefront-landing-preview-caption"));
    assert.deepEqual(cards.map((e) => e.firstElementChild?.textContent), samples.map((p) => p.translations[locale].name));
    assert.deepEqual(cards.map((e) => e.lastElementChild?.textContent), samples.map((p) => formatCurrency(p.wholesalePrice, locale)));
    assert.deepEqual(Array.from(document.querySelectorAll(".storefront-landing-preview-qty"), (e) => e.textContent), ["×6", "×3", "×2"]);
    assert.deepEqual(Array.from(document.querySelectorAll(".storefront-landing-preview-line-total"), (e) => e.textContent), [60, 60, 60].map((n) => formatCurrency(n, locale)));
    assert.equal(document.querySelector(".storefront-landing-preview-subtotal strong")?.textContent, formatCurrency(180, locale));
    const dict = getDictionary(locale);
    for (const copy of [dict.cart.orderSummary, dict.common.subtotal, dict.checkout.sendOrder]) assert.ok(document.body.textContent?.includes(copy));
  });
}
for (const count of [1, 2]) {
  test(`${count} product fallback keeps four slots and modulo selection without duplicate React keys`, async () => {
    products = samples.slice(0, count).map((p) => ({ ...p, sku: `OTHER-${p.id}` }));
    const document = await render();
    assert.deepEqual(Array.from(document.querySelectorAll(".storefront-landing-preview-caption > p:first-child"), (e) => e.textContent), [0, 1, 2, 3].map((i) => products[i % count].translations.en.name));
    const host = dom.window.document.createElement("div");
    const root = createRoot(host);
    const errors = mock.method(console, "error", () => {});
    try {
      const content = await tree();
      await act(async () => root.render(content));
      assert.equal(host.querySelectorAll(".storefront-landing-preview-product").length, 4);
      assert.ok(!errors.mock.calls.some((call) => call.arguments.join(" ").includes("same key")));
    } finally {
      await act(async () => root.unmount());
      errors.mock.restore();
    }
  });
}
test("empty products return null after the same reads", async () => {
  products = [];
  assert.equal(await tree(), null);
  assert.deepEqual(reads, ["products", "categories"]);
});
test("missing categories retain four shared Storefront fallbacks", async () => {
  categories = [];
  const document = await render();
  assert.equal(document.querySelectorAll(".storefront-media--placeholder").length, 4);
  assert.equal(document.querySelectorAll(".storefront-placeholder-brand").length, 4);
  assert.equal(document.querySelectorAll(".storefront-media-size").length, 0, "tiny previews omit size tags only");
});
test("real URLs use the shared media renderer alongside missing-image fallbacks", async () => {
  products = samples.map((p, i) => ({ ...p, imageUrl: i === 0 ? "https://example.test/transparent-product.png" : undefined }));
  const document = await render();
  const image = document.querySelector(".storefront-media--photo img");
  assert.equal(image?.getAttribute("src"), products[0].imageUrl);
  assert.equal(image?.getAttribute("alt"), "");
  assert.equal(image?.getAttribute("loading"), "lazy");
  assert.ok(image?.classList.contains("storefront-media-photo"));
  assert.equal(document.querySelectorAll(".storefront-media--placeholder").length, 3);
});
test("mounted image failure falls back through shared ProductImage without another data read", async () => {
  products = samples.map((p, i) => ({ ...p, imageUrl: i === 0 ? "https://example.test/unavailable.jpg" : undefined }));
  const host = dom.window.document.createElement("div");
  const root = createRoot(host);
  try {
    const content = await tree();
    await act(async () => root.render(content));
    const image = host.querySelector("img");
    assert.ok(image);
    await act(async () => image.dispatchEvent(new dom.window.Event("error")));
    assert.equal(host.querySelector("img"), null);
    assert.equal(host.querySelectorAll(".storefront-media--placeholder").length, 4);
    assert.deepEqual(reads, ["products", "categories"]);
  } finally { await act(async () => root.unmount()); }
});
