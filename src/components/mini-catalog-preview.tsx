import { Check, ShoppingCart } from "lucide-react";
import { ProductImage } from "@/components/product-image";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/types";
import { productName } from "@/lib/catalog-helpers";
import { listCategories, listProducts } from "@/lib/data";
import { formatCurrency } from "@/lib/format";
import type { Product } from "@/lib/types";

/**
 * Static hero visual — a mini slice of the real catalog (live demo
 * products, real placeholder art) with a floating order card on top.
 * Pure presentation: no cart wiring, it just shows what Madaf feels like.
 *
 * Server component: reads through the data layer. Preview products are
 * picked by SKU (stable across mock AND the seeded database — mock ids
 * like "p01" only exist in mock mode), falling back to catalog order.
 */
const PREVIEW_SKUS = ["MDF-1001", "MDF-1009", "MDF-1032", "MDF-1019"];
const ORDER_LINES: { sku: string; qty: number }[] = [
  { sku: "MDF-1001", qty: 6 },
  { sku: "MDF-1009", qty: 3 },
  { sku: "MDF-1032", qty: 2 },
];

export async function MiniCatalogPreview({
  locale,
  dict,
}: {
  locale: Locale;
  dict: Dictionary;
}) {
  const [products, categories] = await Promise.all([
    listProducts(),
    listCategories(),
  ]);
  // A hero visual is never worth a crash: with an empty catalog (e.g. an
  // unseeded dev database) simply render nothing.
  if (products.length === 0) return null;
  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const bySku = new Map(products.map((p) => [p.sku, p]));
  const pick = (sku: string, fallbackIndex: number): Product =>
    bySku.get(sku) ?? products[fallbackIndex % products.length];

  const previewProducts = PREVIEW_SKUS.map((sku, index) => pick(sku, index));
  const lines = ORDER_LINES.map(({ sku, qty }, index) => {
    const product = pick(sku, index);
    return { product, qty, total: product.wholesalePrice * qty };
  });
  const subtotal = lines.reduce((sum, line) => sum + line.total, 0);

  return (
    <div className="storefront-landing-preview" aria-hidden>
      {/* Product mini-grid */}
      <div className="storefront-landing-preview-grid">
        {previewProducts.map((product, index) => {
          // Optional for ProductImage — never crash on a missing category (M8A).
          const category = categoryById.get(product.categoryId);
          return (
            <div
              key={`${index}-${product.id}`}
              className="storefront-landing-preview-product"
            >
              <ProductImage
                product={product}
                category={category}
                presentation="storefront"
                className="storefront-landing-preview-media"
                showSizeTag={false}
              />
              <div className="storefront-landing-preview-caption">
                <p className="line-clamp-1">
                  {productName(product, locale)}
                </p>
                <p className="storefront-landing-preview-price">
                  {formatCurrency(product.wholesalePrice, locale)}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Floating order card */}
      <div className="storefront-landing-preview-order">
        <p className="storefront-landing-preview-order-heading">
          <ShoppingCart className="size-4" aria-hidden />
          {dict.cart.orderSummary}
        </p>
        <ul>
          {lines.map(({ product, qty, total }, index) => (
            <li
              key={`${index}-${product.id}`}
            >
              <span className="storefront-landing-preview-line-name">
                {productName(product, locale)}
              </span>
              <span className="storefront-landing-preview-qty">
                ×{qty}
              </span>
              <span className="storefront-landing-preview-line-total">
                {formatCurrency(total, locale)}
              </span>
            </li>
          ))}
        </ul>
        <div className="storefront-landing-preview-subtotal">
          <span>
            {dict.common.subtotal}
          </span>
          <strong>
            {formatCurrency(subtotal, locale)}
          </strong>
        </div>
        <div className="storefront-landing-preview-confirmation">
          <Check className="size-3.5" aria-hidden />
          {dict.checkout.sendOrder}
        </div>
      </div>
    </div>
  );
}
