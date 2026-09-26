import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { beforeEach, mock, test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { locales } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import type { ShowcaseCatalog } from "@/lib/data/catalog-showcase";

const credential = "synthetic-showcase-route-credential";
const catalog: ShowcaseCatalog = {
  tenantName: { ar: "مورد تجريبي", he: "ספק לבדיקה", en: "Synthetic supplier" },
  products: [], categories: [], manufacturers: [],
};
let mode = "supabase";
let current: ShowcaseCatalog | null = catalog;
let reads = 0;
mock.module("next/navigation", { namedExports: { notFound: () => { throw new Error("not-found"); } } });
mock.module("@/lib/data", { namedExports: { getDataMode: () => mode } });
mock.module("@/lib/data/catalog-showcase", { namedExports: {
  getShowcaseCatalog: async (token: string) => { assert.ok(token === credential, "credential unchanged"); reads++; return current; },
} });
const ShowcaseViewStub = () => null;
mock.module("@/components/shop/showcase-view", { namedExports: { ShowcaseView: ShowcaseViewStub } });
const { default: ShowcaseTokenPage, metadata } = await import("@/app/[locale]/showcase/[token]/page");
beforeEach(() => { mode = "supabase"; current = catalog; reads = 0; });
function page(locale = "en") { return ShowcaseTokenPage({ params: Promise.resolve({ locale, token: credential }) }); }

test("Showcase route stays server-rendered and noindex/nofollow without authenticated boundaries", () => {
  assert.deepEqual(metadata.robots, { index: false, follow: false });
  const source = readFileSync(new URL("../../app/[locale]/showcase/[token]/page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /["']use client["']|\b(?:AppShell|CartProvider|ShopDataProvider|CustomerPicker|useCart)\b/);
});
test("invalid locale stops before the token catalog read", async () => {
  await assert.rejects(page("invalid"), /not-found/); assert.equal(reads, 0);
});
test("mock mode remains notFound without reading token data", async () => {
  mode = "mock"; await assert.rejects(page(), /not-found/); assert.equal(reads, 0);
});
for (const locale of locales) {
  test(`${locale}: validated catalog passes exactly the existing ShowcaseView props`, async () => {
    const tree = await page(locale);
    assert.equal(tree.type, ShowcaseViewStub);
    assert.deepEqual(Object.keys(tree.props).sort(), ["catalog", "dict", "locale", "token"]);
    assert.equal(tree.props.catalog, catalog); assert.equal(tree.props.dict, getDictionary(locale));
    assert.equal(tree.props.locale, locale); assert.ok(tree.props.token === credential); assert.equal(reads, 1);
  });
  test(`${locale}: invalid/revoked/expired catalog result remains an anonymous dead end`, async () => {
    current = null;
    const document = new JSDOM(renderToStaticMarkup(await page(locale))).window.document;
    const t = getDictionary(locale).access.showcase;
    assert.equal(document.querySelector("h1")?.textContent, t.invalidTitle);
    assert.equal(document.querySelector("p")?.textContent, t.invalidBody);
    assert.equal(document.querySelector("a,button,input,select,textarea"), null);
    assert.ok(!document.body.textContent?.includes(credential));
    assert.ok(!document.body.textContent?.includes(catalog.tenantName[locale])); assert.equal(reads, 1);
  });
}
