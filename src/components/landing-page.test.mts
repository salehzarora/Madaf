import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { beforeEach, mock, test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { locales, type Locale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import type { Dictionary } from "@/i18n/types";
import type { Category, Product } from "@/lib/types";

const category: Category = { id: "drinks", icon: "🥤", hue: 197, name: { ar: "مشروبات", he: "משקאות", en: "Drinks" } };
const product: Product = {
  id: "p1", sku: "TEST-1", categoryId: "drinks", manufacturerId: "",
  translations: { ar: { name: "منتج" }, he: { name: "מוצר" }, en: { name: "Product" } },
  packageType: "carton", unitsPerPackage: 12, baseUnit: "bottles", wholesalePrice: 36, availability: "inStock",
};
let categories: Category[];
let products: Product[];
let previewProps: { locale: Locale; dict: Dictionary } | undefined;
const reads: string[] = [];
mock.module("next/navigation", { namedExports: { notFound: () => { throw new Error("not-found"); } } });
mock.module("@/lib/data", { namedExports: {
  listCategories: async () => { reads.push("categories"); return categories; },
  listProducts: async () => { reads.push("products"); return products; },
} });
// Resolve the async preview separately in mini-catalog-preview.test.mts, keeping
// this test at the real page's existing boundary (no production refactor).
mock.module("@/components/mini-catalog-preview", { namedExports: {
  MiniCatalogPreview: (props: { locale: Locale; dict: Dictionary }) => { previewProps = props; return null; },
} });
const { default: LandingPage } = await import("@/app/[locale]/(shop)/page");
beforeEach(() => {
  categories = [category, { ...category, id: "empty", name: { ar: "قسم آخر", he: "קטגוריה נוספת", en: "Other category" } }];
  products = [product, { ...product, id: "sold-out", availability: "outOfStock" }];
  previewProps = undefined;
  reads.length = 0;
});
async function render(locale: Locale = "en") {
  return new JSDOM(renderToStaticMarkup(await LandingPage({ params: Promise.resolve({ locale }) }))).window.document;
}
test("Landing stays a server component with no client hook or direct data-source dependency", () => {
  const source = readFileSync(new URL("../app/[locale]/(shop)/page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /["']use client["']|\buse(?:State|Effect|Pathname|Router)\b|@\/lib\/(?:mock|supabase)/);
});
test("invalid locale rejects before any reads", async () => {
  await assert.rejects(LandingPage({ params: Promise.resolve({ locale: "invalid" }) }), /not-found/);
  assert.deepEqual(reads, []);
});
for (const locale of locales) {
  test(`${locale}: exact hero copy, CTA destinations and preview props`, async () => {
    const document = await render(locale);
    const dict = getDictionary(locale);
    assert.equal(document.querySelector("h1")?.textContent, dict.landing.heroTitle);
    assert.equal(document.querySelector(".storefront-landing-badge")?.textContent, dict.landing.heroBadge);
    assert.equal(document.querySelector(".storefront-landing-subtitle")?.textContent, dict.landing.heroSubtitle);
    const ctas = Array.from(document.querySelectorAll(".storefront-landing-actions a"));
    assert.deepEqual(ctas.map((e) => [e.textContent, e.getAttribute("href")]), [
      [dict.landing.ctaCatalog, `/${locale}/catalog`], [dict.landing.ctaAdmin, `/${locale}/admin`],
    ]);
    assert.equal(previewProps?.locale, locale);
    assert.equal(previewProps?.dict, dict);
    assert.deepEqual(reads, ["categories", "products"]);
  });
  test(`${locale}: category order, all-product counts and unfiltered destinations`, async () => {
    const document = await render(locale);
    const dict = getDictionary(locale);
    const tiles = Array.from(document.querySelectorAll(".storefront-landing-category"));
    assert.equal(document.querySelector(".storefront-landing-categories h2")?.textContent, dict.landing.browseByCategory);
    assert.deepEqual(tiles.map((e) => e.querySelector(".storefront-landing-category-name")?.textContent), categories.map((c) => c.name[locale]));
    assert.deepEqual(tiles.map((e) => e.querySelector(".storefront-landing-category-count")?.textContent), [`2 ${dict.nav.products}`, `0 ${dict.nav.products}`]);
    assert.deepEqual(tiles.map((e) => e.getAttribute("href")), categories.map(() => `/${locale}/catalog`));
    assert.deepEqual(tiles.map((e) => e.querySelector("[aria-hidden]")?.textContent), categories.map((c) => c.icon));
    assert.equal(document.querySelector(".storefront-landing-view-all")?.getAttribute("href"), `/${locale}/catalog`);
    assert.equal(document.querySelector(".storefront-landing-view-all")?.textContent, dict.common.viewAll);
  });
  test(`${locale}: roles keep copy, icons, order and destinations`, async () => {
    const document = await render(locale);
    const dict = getDictionary(locale);
    const roles = [dict.landing.roles.rep, dict.landing.roles.owner, dict.landing.roles.admin];
    const cards = Array.from(document.querySelectorAll(".storefront-landing-role"));
    assert.equal(document.querySelector(".storefront-landing-roles h2")?.textContent, dict.landing.rolesTitle);
    assert.deepEqual(cards.map((e) => e.getAttribute("href")), [`/${locale}/catalog`, `/${locale}/catalog`, `/${locale}/admin`]);
    assert.deepEqual(cards.map((e) => e.querySelector("h3")?.textContent), roles.map((r) => r.title));
    assert.deepEqual(cards.map((e) => e.querySelector("p")?.textContent), roles.map((r) => r.desc));
    assert.deepEqual(cards.map((e) => e.querySelector(".storefront-landing-role-cta")?.textContent), roles.map((r) => r.cta));
    ["tablet", "link-2", "layout-dashboard"].forEach((icon, i) => assert.ok(cards[i].querySelector(`.lucide-${icon}`)));
  });
  test(`${locale}: feature copy and icon order remain exact`, async () => {
    const document = await render(locale);
    const dict = getDictionary(locale);
    const cards = Array.from(document.querySelectorAll(".storefront-landing-feature"));
    assert.equal(document.querySelector(".storefront-landing-features h2")?.textContent, dict.landing.featuresTitle);
    assert.deepEqual(cards.map((e) => [e.querySelector("h3")?.textContent, e.querySelector("p")?.textContent]), dict.landing.features.map((f) => [f.title, f.desc]));
    ["shopping-bag", "languages", "clipboard-list", "file-text"].forEach((icon, i) => assert.ok(cards[i].querySelector(`.lucide-${icon}`)));
  });
}
test("empty products retain categories with zero counts and all other copy", async () => {
  products = [];
  const document = await render();
  assert.deepEqual(Array.from(document.querySelectorAll(".storefront-landing-category-count"), (e) => e.textContent), categories.map(() => `0 ${getDictionary("en").nav.products}`));
  assert.equal(document.querySelectorAll(".storefront-landing-role").length, 3);
  assert.equal(document.querySelectorAll(".storefront-landing-feature").length, getDictionary("en").landing.features.length);
});
test("empty categories retain heading and view-all without inventing tiles", async () => {
  categories = [];
  const document = await render();
  assert.equal(document.querySelectorAll(".storefront-landing-category").length, 0);
  assert.ok(document.querySelector(".storefront-landing-categories h2"));
  assert.equal(document.querySelector(".storefront-landing-view-all")?.getAttribute("href"), "/en/catalog");
  assert.ok(document.querySelector("h1"));
});
