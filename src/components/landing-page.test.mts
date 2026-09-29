import { dom } from "@/test-support/jsdom-env";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mock, test } from "node:test";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { locales, type Locale } from "@/i18n/config";
import { marketingDictionaries } from "@/i18n/dictionaries/marketing";
import { MarketingMobileMenu } from "./marketing/mobile-menu";

mock.module("next/navigation", { namedExports: { notFound: () => { throw new Error("not-found"); } } });
mock.module("@/components/locale-switcher", { namedExports: { LocaleSwitcher: ({ current }: { current: Locale }) => createElement("span", { "data-locale-switcher": current }) } });
const { default: LandingPage } = await import("@/app/[locale]/page");
async function render(locale: Locale = "ar") {
  return new JSDOM(renderToStaticMarkup(await LandingPage({ params: Promise.resolve({ locale }) }))).window.document;
}

test("homepage stays server-rendered outside the ordering providers at the same locale URL", () => {
  const source = readFileSync(new URL("../app/[locale]/page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /["']use client["']|@\/lib\/(?:data|supabase|mock|cart-context)/);
  assert.equal(existsSync(new URL("../app/[locale]/(shop)/page.tsx", import.meta.url)), false);
  const shopLayout = readFileSync(new URL("../app/[locale]/(shop)/layout.tsx", import.meta.url), "utf8");
  assert.match(shopLayout, /ShopDataProvider/);
  assert.match(shopLayout, /CartProvider/);
});

test("invalid locale rejects", async () => {
  await assert.rejects(LandingPage({ params: Promise.resolve({ locale: "invalid" }) }), /not-found/);
});

test("mobile navigation closes after a destination, outside pointer or Escape; Escape returns focus", () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    act(() => root.render(createElement(MarketingMobileMenu, { label: "Menu" }, createElement("a", { href: "#features" }, "Features"))));
    const menu = container.querySelector("details")!;
    menu.open = true;
    act(() => container.querySelector("a")!.click());
    assert.equal(menu.open, false);
    menu.open = true;
    act(() => document.body.dispatchEvent(new dom.window.Event("pointerdown", { bubbles: true })));
    assert.equal(menu.open, false);
    menu.open = true;
    act(() => document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    assert.equal(menu.open, false);
    assert.equal(document.activeElement, container.querySelector("summary"));
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

for (const locale of locales) {
  test(`${locale}: complete localized marketing hierarchy and working destinations`, async () => {
    const document = await render(locale);
    const c = marketingDictionaries[locale];
    assert.equal(document.querySelectorAll("h1").length, 1);
    assert.equal(document.querySelector("h1")?.textContent, c.hero.title + c.hero.accent);
    assert.equal(document.querySelectorAll("main").length, 1);
    assert.equal(document.querySelectorAll(".marketing-feature").length, 8);
    assert.equal(document.querySelectorAll(".marketing-steps > li").length, 4);
    assert.equal(document.querySelectorAll(".marketing-audience-grid > article").length, 5);
    assert.ok(document.querySelector(`a[href='/${locale}/catalog']`));
    assert.ok(document.querySelector(`a[href='/${locale}/admin']`));
    assert.equal(document.querySelector("[data-locale-switcher]")?.getAttribute("data-locale-switcher"), locale);
    for (const anchor of document.querySelectorAll("a[href^='#']")) {
      const id = anchor.getAttribute("href")!.slice(1);
      assert.ok(document.getElementById(id), `missing destination ${id}`);
    }
  });

  test(`${locale}: supplier request remains visibly a preview with no submission surface`, async () => {
    const document = await render(locale);
    const request = document.querySelector("#request")!;
    assert.equal(request.querySelector("form, [action], [formaction], button[type=submit]"), null);
    const send = request.querySelector<HTMLButtonElement>("button")!;
    assert.equal(send.type, "button");
    assert.equal(send.disabled, true);
    assert.equal(document.getElementById("request-preview-note")?.textContent, marketingDictionaries[locale].request.preview);
    assert.equal(request.querySelectorAll("input, select, textarea").length, 7);
    for (const field of request.querySelectorAll("input, select, textarea")) {
      assert.ok(document.querySelector(`label[for='${field.id}']`), `unlabeled ${field.id}`);
      assert.equal(field.closest("form"), null);
    }
    assert.equal(document.querySelector("#supplier-email")?.getAttribute("dir"), "ltr");
    assert.equal(document.querySelector("#supplier-phone")?.getAttribute("dir"), "ltr");
  });

  test(`${locale}: decorative visuals are local, sized and noninteractive; mobile navigation is native`, async () => {
    const document = await render(locale);
    for (const img of document.querySelectorAll("img")) {
      assert.equal(img.getAttribute("alt"), "");
      assert.ok(Number(img.getAttribute("width")) > 0);
      assert.ok(Number(img.getAttribute("height")) > 0);
    }
    assert.equal(document.querySelector("figure figcaption")?.textContent, marketingDictionaries[locale].hero.illustration);
    assert.ok(document.querySelector("details.marketing-mobile-menu > summary[aria-label]"));
    assert.equal(document.querySelector(".marketing-skip")?.getAttribute("href"), "#marketing-main");
    assert.equal(document.querySelector(".storefront-header, .storefront-cart-link"), null);
  });
}
