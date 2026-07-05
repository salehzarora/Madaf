import { Check, ShoppingCart } from "lucide-react";
import { ProductImage } from "@/components/product-image";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/types";
import { formatCurrency } from "@/lib/format";
import { categoryById, productById, productName } from "@/lib/mock";

/**
 * Static hero visual — a mini slice of the real catalog (live mock
 * products, real placeholder art) with a floating order card on top.
 * Pure presentation: no cart wiring, it just shows what Madaf feels like.
 */
const PREVIEW_IDS = ["p01", "p09", "p32", "p19"];
const ORDER_LINES: { id: string; qty: number }[] = [
  { id: "p01", qty: 6 },
  { id: "p09", qty: 3 },
  { id: "p32", qty: 2 },
];

export function MiniCatalogPreview({
  locale,
  dict,
}: {
  locale: Locale;
  dict: Dictionary;
}) {
  const lines = ORDER_LINES.map(({ id, qty }) => {
    const product = productById.get(id)!;
    return { product, qty, total: product.wholesalePrice * qty };
  });
  const subtotal = lines.reduce((sum, line) => sum + line.total, 0);

  return (
    <div className="relative mx-auto w-full max-w-md" aria-hidden>
      {/* Product mini-grid */}
      <div className="grid grid-cols-2 gap-3">
        {PREVIEW_IDS.map((id, index) => {
          const product = productById.get(id)!;
          const category = categoryById.get(product.categoryId)!;
          return (
            <div
              key={id}
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
