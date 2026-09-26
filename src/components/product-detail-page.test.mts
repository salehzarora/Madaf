/** Real server page, with only its existing data/read boundary isolated. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { beforeEach, mock, test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { getDictionary } from "@/i18n/dictionaries";
import { locales, type Locale } from "@/i18n/config";
import { packageLabel } from "@/lib/catalog-helpers";
import { formatCurrency } from "@/lib/format";
import type { Category, Manufacturer, Product } from "@/lib/types";

const product: Product = {
  id: "detail", sku: "SKU-004B", categoryId: "drinks", manufacturerId: "brand",
  translations: { ar: { name: "منتج للاختبار" }, he: { name: "מוצר לבדיקה" }, en: { name: "Test product" } },
  packageType: "carton", unitsPerPackage: 12, baseUnit: "bottles", unitSize: "330ml",
  wholesalePrice: 36, availability: "inStock",
};
const category: Category = { id: "drinks", icon: "🥤", hue: 197, name: { ar: "مشروبات", he: "משקאות", en: "Drinks" } };
const manufacturer: Manufacturer = { id: "brand", name: { ar: "ماركة", he: "מותג", en: "Brand" } };
let current: Product | undefined;
let currentCategory: Category | undefined;
let currentManufacturer: Manufacturer | undefined;
let products: Product[];
const reads: string[] = [];
mock.module("next/navigation", { namedExports: { notFound: () => { throw new Error("not-found"); } } });
// Actions have mounted, real-provider coverage in product-detail.test.tsx.
mock.module("@/components/product-detail-actions", { namedExports: { ProductDetailActions: () => null } });
mock.module("@/lib/data", { namedExports: {
  getProduct: async (id: string) => { reads.push(`product:${id}`); return current; },
  getCategory: async (id: string) => { reads.push(`category:${id}`); return currentCategory; },
  getManufacturer: async (id: string) => { reads.push(`manufacturer:${id}`); return currentManufacturer; },
  listProducts: async () => { reads.push("products"); return products; },
} });
const { default: ProductPage, dynamic } = await import("@/app/[locale]/(shop)/product/[id]/page");

beforeEach(() => {
  current = { ...product };
  currentCategory = category;
  currentManufacturer = manufacturer;
  products = [product, ...Array.from({ length: 6 }, (_, i) => ({ ...product, id: `related-${i}` }))];
  reads.length = 0;
});
function page(locale = "en") { return ProductPage({ params: Promise.resolve({ locale, id: "detail" }) }); }
async function render(locale: Locale = "en") {
  const tree = await page(locale);
  return new JSDOM(renderToStaticMarkup(tree)).window.document;
}

test("Product route stays server-rendered and force-dynamic", () => {
  assert.equal(dynamic, "force-dynamic");
  const source = readFileSync(new URL("../app/[locale]/(shop)/product/[id]/page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /["']use client["']|\busePathname\b|export\s+(?:async\s+)?function\s+generateStaticParams/);
});
test("invalid locale fails before all reads", async () => {
  await assert.rejects(page("invalid"), /not-found/);
  assert.deepEqual(reads, []);
});
for (const state of ["missing", "inactive"] as const) {
  test(`${state} product fails before dependent reads`, async () => {
    current = state === "missing" ? undefined : { ...product, isActive: false };
    await assert.rejects(page(), /not-found/);
    assert.deepEqual(reads, ["product:detail"]);
  });
}
test("missing category retains notFound guard", async () => {
  currentCategory = undefined;
  await assert.rejects(page(), /not-found/);
  assert.deepEqual(reads, ["product:detail", "category:drinks", "manufacturer:brand", "products"]);
});
for (const state of ["no ID", "missing record"] as const) {
  test(`manufacturer ${state} remains optional`, async () => {
    if (state === "no ID") current = { ...product, manufacturerId: "" };
    else currentManufacturer = undefined;
    const document = await render();
    assert.equal(document.querySelectorAll("h1").length, 1);
    assert.equal(document.querySelectorAll("dl dt").length, 4);
    assert.equal(reads.includes("manufacturer:brand"), state === "missing record");
  });
}
for (const locale of locales) {
  test(`${locale}: normal page retains name, package, prices, all specs and localized links`, async () => {
    const document = await render(locale);
    const dict = getDictionary(locale);
    assert.equal(document.querySelector("h1")?.textContent, product.translations[locale].name);
    assert.ok(document.body.textContent?.includes(packageLabel(product, dict)));
    assert.ok(document.body.textContent?.includes(formatCurrency(36, locale)));
    assert.ok(document.body.textContent?.includes(formatCurrency(3, locale)));
    assert.deepEqual(Array.from(document.querySelectorAll("dl dt"), (e) => e.textContent), [
      dict.product.manufacturer, dict.product.category, dict.product.packageInfo, dict.product.pricePerUnit, dict.product.sku,
    ]);
    assert.equal(document.querySelector("dl [dir=ltr]")?.textContent, product.sku);
    assert.ok(document.querySelector(`a[href='/${locale}/catalog']`));
    assert.equal(document.querySelector("section h2")?.textContent, dict.product.related);
    const links = Array.from(document.querySelectorAll("section a"));
    assert.deepEqual(links.map((e) => e.getAttribute("href")), [0, 1, 2, 3].map((i) => `/${locale}/product/related-${i}`));
    assert.equal(document.querySelector("section button"), null, "related products are navigation-only");
    assert.deepEqual(reads, ["product:detail", "category:drinks", "manufacturer:brand", "products"]);
  });
}
test("related selection retains category, source order, current exclusion and four-item limit", async () => {
  products = [product, { ...product, id: "other", categoryId: "other" },
    ...["a", "b", "c", "d", "e"].map((id) => ({ ...product, id, availability: "outOfStock" as const }))];
  const document = await render();
  assert.deepEqual(Array.from(document.querySelectorAll("section a"), (e) => e.getAttribute("href")), ["a", "b", "c", "d"].map((id) => `/en/product/${id}`));
});
test("no related products omits the section", async () => {
  products = [product];
  assert.equal((await render()).querySelector("section"), null);
});
test("related tiles show only the already-resolved matching manufacturer without additional reads", async () => {
  products = [{ ...product, id: "same" }, { ...product, id: "different", manufacturerId: "other" }, { ...product, id: "none", manufacturerId: "" }];
  const document = await render();
  const tiles = Array.from(document.querySelectorAll(".storefront-product-tile"));
  assert.equal(tiles.length, 3);
  assert.equal(tiles[0].querySelector(".storefront-tile-brand")?.textContent, manufacturer.name.en);
  assert.equal(tiles[1].querySelector(".storefront-tile-brand"), null);
  assert.equal(tiles[2].querySelector(".storefront-tile-brand"), null);
  assert.deepEqual(reads, ["product:detail", "category:drinks", "manufacturer:brand", "products"]);
});
for (const availability of ["inStock", "lowStock", "outOfStock"] as const) {
  test(`${availability}: availability and expiry labels reflect data only`, async () => {
    current = { ...product, availability, trackExpiry: true };
    const document = await render();
    const dict = getDictionary("en");
    assert.ok(document.body.textContent?.includes(dict.availability[availability]));
    assert.ok(document.body.textContent?.includes(dict.catalog.expiryTracked));
    current = { ...product, availability, trackExpiry: false };
    assert.ok(!(await render()).body.textContent?.includes(dict.catalog.expiryTracked));
  });
}
