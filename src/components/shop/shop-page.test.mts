import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { beforeEach, mock, test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { locales } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import type { TokenCatalog } from "@/lib/data/token";

const credential = "synthetic-route-credential-for-unit-test";
const data: TokenCatalog = {
  tenantName: { ar: "مورد تجريبي", he: "ספק לבדיקה", en: "Synthetic supplier" },
  customer: { name: "Fixed synthetic customer", city: { ar: "", he: "", en: "" } },
  products: [], categories: [], manufacturers: [],
};
let mode = "supabase";
let current: TokenCatalog | null = data;
let inactive = false;
const reads: string[] = [];
mock.module("next/navigation", { namedExports: { notFound: () => { throw new Error("not-found"); } } });
mock.module("@/lib/data", { namedExports: { getDataMode: () => mode } });
mock.module("@/lib/data/token", { namedExports: {
  getTokenCatalog: async (token: string) => { assert.ok(token === credential, "credential unchanged"); reads.push("catalog"); return current; },
  isShopLinkInactive: async (token: string) => { assert.ok(token === credential, "credential unchanged"); reads.push("inactive"); return inactive; },
} });
// Route tests isolate only the client child. Mounted behavior lives in shop-view.test.mts.
const ShopViewStub = () => null;
mock.module("@/components/shop/shop-view", { namedExports: { ShopView: ShopViewStub } });
const { default: ShopTokenPage, metadata } = await import("@/app/[locale]/shop/[token]/page");
beforeEach(() => { mode = "supabase"; current = data; inactive = false; reads.length = 0; });
function page(locale = "en") { return ShopTokenPage({ params: Promise.resolve({ locale, token: credential }) }); }

test("private route stays server-rendered and non-indexable", () => {
  assert.deepEqual(metadata.robots, { index: false, follow: false });
  const source = readFileSync(new URL("../../app/[locale]/shop/[token]/page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /["']use client["']|\b(?:AppShell|CartProvider|ShopDataProvider|useCart)\b/);
});
test("invalid locale fails closed before token reads", async () => {
  await assert.rejects(page("invalid"), /not-found/);
  assert.deepEqual(reads, []);
});
test("mock mode remains notFound before token reads", async () => {
  mode = "mock";
  await assert.rejects(page(), /not-found/);
  assert.deepEqual(reads, []);
});
for (const locale of locales) {
  test(`${locale}: valid token preserves the exact ShopView inputs without inactive probing`, async () => {
    const tree = await page(locale);
    assert.equal(tree.type, ShopViewStub);
    assert.deepEqual(Object.keys(tree.props).sort(), ["catalog", "dict", "locale", "token"]);
    assert.equal(tree.props.catalog, data);
    assert.equal(tree.props.dict, getDictionary(locale));
    assert.equal(tree.props.locale, locale);
    assert.ok(tree.props.token === credential, "credential passed unchanged to existing child");
    assert.deepEqual(reads, ["catalog"]);
  });
  for (const state of ["invalid", "inactive"] as const) {
    test(`${locale}: ${state} remains a safe simple dead end with no identity or extra detail`, async () => {
      current = null;
      inactive = state === "inactive";
      const document = new JSDOM(renderToStaticMarkup(await page(locale))).window.document;
      const t = getDictionary(locale).access.shop;
      assert.equal(document.querySelector("h1")?.textContent, inactive ? t.inactiveTitle : t.invalidTitle);
      assert.equal(document.querySelector("p")?.textContent, inactive ? t.inactiveBody : t.invalidBody);
      assert.equal(document.querySelector("a,button,input,select,textarea"), null);
      assert.ok(!document.body.textContent?.includes(credential));
      assert.ok(!document.body.textContent?.includes(data.customer.name));
      assert.ok(!document.body.textContent?.includes(data.tenantName[locale]));
      assert.deepEqual(reads, ["catalog", "inactive"]);
    });
  }
}
