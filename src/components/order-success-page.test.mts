import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mock, test } from "node:test";
import { JSDOM } from "jsdom";
import { renderToStaticMarkup } from "react-dom/server";
import { locales, type Locale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";

mock.module("next/navigation", { namedExports: { notFound: () => { throw Error("not-found"); } } });
const { default: Page } = await import("@/app/[locale]/(shop)/order-success/page");
async function render(locale: Locale, n?: string) {
  const tree = await Page({ params: Promise.resolve({ locale }), searchParams: Promise.resolve({ n }) });
  return new JSDOM(renderToStaticMarkup(tree)).window.document;
}
for (const locale of locales) {
  test(`${locale}: public reference, translated confirmation, ordered next steps and both destinations`, async () => {
    const reference = "MDF-PUBLIC004D";
    const document = await render(locale, reference), dict = getDictionary(locale).orderSuccess;
    assert.equal(document.querySelector("h1")?.textContent, dict.title);
    assert.ok(document.body.textContent?.includes(dict.subtitle));
    assert.ok(document.body.textContent?.includes(dict.orderNumberLabel));
    assert.equal(document.querySelector("[dir=ltr]")?.textContent?.trim(), reference);
    assert.equal(document.querySelector("h2")?.textContent, dict.whatNext);
    assert.deepEqual(Array.from(document.querySelectorAll("ol li p"), el => el.textContent), dict.steps);
    assert.deepEqual(Array.from(document.querySelectorAll("ol li > span"), el => el.textContent), ["1", "2", "3"]);
    assert.equal(document.querySelector(`a[href='/${locale}/catalog']`)?.textContent?.trim(), dict.backToCatalog);
    assert.equal(document.querySelector(`a[href='/${locale}/admin/orders']`)?.textContent?.trim(), getDictionary(locale).nav.admin);
    assert.ok(document.body.textContent?.includes(dict.adminHint));
  });
}
test("absent reference retains the exact demo fallback", async () => {
  assert.equal((await render("en")).querySelector("[dir=ltr]")?.textContent?.trim(), "MDF-DEMO0000");
});
test("empty reference remains empty: fallback is nullish, not truthy", async () => {
  assert.equal((await render("en", "")).querySelector("[dir=ltr]")?.textContent?.trim(), "");
});
test("reference text is escaped and not interpreted as markup", async () => {
  const ref = "<script>alert(1)</script> & /";
  const document = await render("ar", ref);
  assert.equal(document.querySelector("[dir=ltr]")?.textContent?.trim(), ref);
  assert.equal(document.querySelector("script"), null);
});
test("invalid locale still invokes notFound", async () => {
  await assert.rejects(Page({ params: Promise.resolve({ locale: "xx" }), searchParams: Promise.resolve({}) }), /not-found/);
});
test("success page and AppShell retain their server boundaries; checkout wrapper stays server rendered", () => {
  for (const file of ["src/app/[locale]/(shop)/order-success/page.tsx", "src/app/[locale]/(shop)/checkout/page.tsx", "src/components/app-shell.tsx"]) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(source, /^[\s]*["']use client["']/);
    assert.doesNotMatch(source, /\b(usePathname|useState|useEffect)\b/);
  }
});
