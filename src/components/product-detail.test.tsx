import { dom } from "@/test-support/jsdom-env";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import React, { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { ProductDetailActions } from "@/components/product-detail-actions";
import { ProductImage } from "@/components/product-image";
import { StorefrontProductTile } from "@/components/storefront-product-tile";
import { locales } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { CartProvider, useCart } from "@/lib/cart-context";
import { ShopDataProvider } from "@/lib/shop-data-context";
import type { Product } from "@/lib/types";

const product: Product = {
  id: "detail", sku: "SKU-004B", categoryId: "drinks", manufacturerId: "",
  translations: { ar: { name: "منتج طويل ".repeat(15) }, he: { name: "מוצר ארוך ".repeat(15) }, en: { name: "Long product ".repeat(15) } },
  packageType: "carton", unitsPerPackage: 12, baseUnit: "bottles", unitSize: "330ml",
  wholesalePrice: 36, availability: "inStock",
};
const key = "11110000-0000-4000-8000-00000000004b";
const cleanups: (() => void)[] = [];
function mount(element: React.ReactNode) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(element));
  cleanups.push(() => { act(() => root.unmount()); container.remove(); });
  return container;
}
afterEach(() => {
  cleanups.splice(0).reverse().forEach((cleanup) => cleanup());
  dom.window.localStorage.clear();
});

for (const locale of locales) {
  test(`${locale}: Add, quantity and View Cart retain the same cart, customer and submission key`, () => {
    dom.window.localStorage.setItem("madaf.cart.v1", JSON.stringify({ customerId: "shop", items: [], submissionKey: key }));
    const captured: { current: ReturnType<typeof useCart> | null } = { current: null };
    function Probe() { const cart = useCart(); useEffect(() => { captured.current = cart; }); return null; }
    const dict = getDictionary(locale);
    const container = mount(<ShopDataProvider products={[product]} categories={[]} manufacturers={[]} customers={[]}>
      <CartProvider><Probe /><ProductDetailActions product={product} locale={locale} dict={dict} /></CartProvider>
    </ShopDataProvider>);
    const add = container.querySelector("button");
    assert.ok(add);
    assert.equal(add.textContent, dict.product.addToCart);
    act(() => add.click());
    assert.equal(captured.current?.quantityOf(product.id), 1);
    assert.equal(container.querySelector("a")?.getAttribute("href"), `/${locale}/cart`);
    assert.equal(container.querySelector("a")?.textContent, dict.catalog.viewCart);
    const increase = container.querySelector<HTMLButtonElement>("button[aria-label='+']");
    const decrease = container.querySelector<HTMLButtonElement>("button[aria-label='−']");
    assert.ok(increase && decrease);
    act(() => increase.click());
    assert.equal(captured.current?.quantityOf(product.id), 2);
    assert.equal(container.querySelector("span[dir='ltr']")?.textContent, "2");
    act(() => decrease.click());
    act(() => decrease.click());
    assert.equal(captured.current?.quantityOf(product.id), 0);
    assert.equal(container.querySelector("a"), null);
    assert.equal(container.querySelector("button")?.textContent, dict.product.addToCart);
    assert.equal(captured.current?.submissionKey, key);
    assert.equal(captured.current?.customerId, "shop");
    assert.deepEqual(JSON.parse(dom.window.localStorage.getItem("madaf.cart.v1")!).items, []);
  });
  test(`${locale}: related tile is one localized link with long name, package and price, without ordering controls`, () => {
    const dict = getDictionary(locale);
    const container = mount(<StorefrontProductTile product={product} locale={locale} dict={dict} />);
    assert.equal(container.querySelectorAll("a").length, 1);
    assert.equal(container.querySelector("a")?.getAttribute("href"), `/${locale}/product/detail`);
    assert.equal(container.querySelector("h3")?.textContent, product.translations[locale].name);
    assert.equal(container.querySelector("a")?.getAttribute("aria-label"), product.translations[locale].name);
    assert.equal(container.querySelector("button, input"), null);
    assert.ok(container.querySelector(".storefront-media--placeholder"));
    assert.ok(container.querySelector("bdi[dir=ltr]"));
    assert.equal(container.querySelector(".storefront-tile-brand"), null);
  });
}

test("storefront media contains a real image without altering the source or legacy presentations", () => {
  const photo = { ...product, imageUrl: "https://example.test/photo-with-baked-background.png" };
  const container = mount(<>
    <ProductImage product={photo} presentation="storefront" fillPhoto className="storefront-detail-media" />
    <ProductImage product={photo} presentation="catalog-card" />
    <ProductImage product={photo} presentation="catalog" />
    <ProductImage product={photo} />
  </>);
  const images = Array.from(container.querySelectorAll("img"));
  assert.equal(images.length, 6);
  assert.deepEqual(images.map((img) => img.className), ["storefront-media-backdrop", "storefront-media-photo", "catalog-card-media-backdrop", "catalog-card-media-photo", "catalog-media-photo", "size-full object-cover"]);
  for (const image of images) {
    assert.equal(image.getAttribute("src"), photo.imageUrl);
    assert.equal(image.alt, "");
    assert.equal(image.getAttribute("loading"), "lazy");
    assert.ok(image.parentElement?.hasAttribute("aria-hidden"));
  }
  assert.equal(container.querySelector(".storefront-media-size[dir=ltr]")?.textContent, "330ml");
  assert.ok(container.children[0].classList.contains("storefront-detail-media"));
  assert.ok(container.children[0].classList.contains("storefront-media--fill"));
});
test("missing and failed storefront photos retain branded fallback and optional size label", () => {
  const container = mount(<>
    <ProductImage product={product} presentation="storefront" showSizeTag={false} />
    <ProductImage product={{ ...product, imageUrl: "https://example.test/broken.png" }} presentation="storefront" fillPhoto />
  </>);
  assert.ok(container.children[0].querySelector(".storefront-placeholder"));
  assert.equal(container.children[0].querySelector(".storefront-media-size"), null);
  const image = container.querySelector(".storefront-media-photo");
  assert.ok(image);
  act(() => image.dispatchEvent(new dom.window.Event("error")));
  assert.equal(container.querySelector("img"), null);
  assert.ok(container.children[1].classList.contains("storefront-media--placeholder"));
  assert.equal(container.children[1].querySelector(".storefront-media-size")?.textContent, "330ml");
});
test("a photo that failed before hydration still falls back on mount", () => {
  const prototype = dom.window.HTMLImageElement.prototype;
  const complete = Object.getOwnPropertyDescriptor(prototype, "complete")!;
  Object.defineProperty(prototype, "complete", { configurable: true, get: () => true });
  try {
    const container = mount(<ProductImage product={{ ...product, imageUrl: "https://example.test/failed-before-mount.png" }} presentation="storefront" />);
    assert.equal(container.querySelector("img"), null);
    assert.ok(container.querySelector(".storefront-placeholder"));
  } finally { Object.defineProperty(prototype, "complete", complete); }
});
