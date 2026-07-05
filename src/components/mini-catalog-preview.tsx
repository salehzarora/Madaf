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
    <div className="relative mx-auto w-full max-w-md" aria-hidden>
      {/* Product mini-grid */}
      <div className="grid grid-cols-2 gap-3">
        {previewProducts.map((product, index) => {
          const category = categoryById.get(product.categoryId)!;
          return (
            <div
              key={product.id}
              className={
                "overflow-hidden rounded-card border border-line bg-surface shadow-card " +
                (index % 2 === 1 ? "translate-y-4" : "")
              }
            >
              <ProductImage
                product={product}
                category={category}
                className="aspect-[4/3] w-full"
                iconClassName="text-3xl"
              />
              <div className="p-2.5">
                <p className="line-clamp-1 text-xs font-bold text-ink">
                  {productName(product, locale)}
                </p>
                <p className="mt-0.5 text-sm font-extrabold text-ink">
                  {formatCurrency(product.wholesalePrice, locale)}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Floating order card */}
      <div className="absolute -bottom-6 -start-2 w-64 rounded-card border border-line bg-surface p-3.5 shadow-float sm:-start-8">
        <p className="flex items-center gap-1.5 text-xs font-bold text-ink">
          <ShoppingCart className="size-3.5 text-brand-600" aria-hidden />
          {dict.cart.orderSummary}
        </p>
        <ul className="mt-2 flex flex-col gap-1">
          {lines.map(({ product, qty, total }) => (
            <li
              key={product.id}
              className="flex items-baseline justify-between gap-2 text-[11px]"
            >
              <span className="min-w-0 flex-1 truncate text-ink-soft">
                {productName(product, locale)}
              </span>
              <span className="shrink-0 tabular-nums text-ink-muted">
                ×{qty}
              </span>
              <span className="w-14 shrink-0 text-end font-semibold tabular-nums text-ink">
                {formatCurrency(total, locale)}
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-2 flex items-baseline justify-between border-t border-line pt-2">
          <span className="text-xs font-medium text-ink-soft">
            {dict.common.subtotal}
          </span>
          <span className="text-base font-extrabold tabular-nums text-ink">
            {formatCurrency(subtotal, locale)}
          </span>
        </div>
        <div className="mt-2 flex h-9 items-center justify-center gap-1.5 rounded-field bg-brand-600 text-xs font-bold text-white">
          <Check className="size-3.5" aria-hidden />
          {dict.checkout.sendOrder}
        </div>
      </div>
    </div>
  );
}
