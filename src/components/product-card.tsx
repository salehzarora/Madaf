"use client";

import { AlertTriangle, Plus } from "lucide-react";
import Link from "next/link";
import { ProductImage } from "@/components/product-image";
import { QuantityStepper } from "@/components/quantity-stepper";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/types";
import { useCart } from "@/lib/cart-context";
import { categoryDot } from "@/lib/category-style";
import { packageLabel, productName } from "@/lib/catalog-helpers";
import { formatCurrency } from "@/lib/format";
import type { Category, Manufacturer, Product } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Product card v2 ("Madaf Ledger"): neutral placeholder art, a stock ticket
 * only when NOT in stock, a manufacturer eyebrow + category dot, a locked
 * two-line name, and a hairline PRICE BAR — a 44px square add button that
 * becomes the line total + a compact stepper once in the cart.
 */
export function ProductCard({
  product,
  category,
  manufacturer,
  locale,
  dict,
}: {
  product: Product;
  category: Category;
  manufacturer?: Manufacturer;
  locale: Locale;
  dict: Dictionary;
}) {
  const { quantityOf, addItem, setQuantity } = useCart();
  const quantity = quantityOf(product.id);
  const soldOut = product.availability === "outOfStock";
  const showStock = product.availability !== "inStock";
  const lineTotal = quantity * product.wholesalePrice;

  return (
    <div
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-card border bg-surface shadow-card transition-shadow hover:shadow-float",
        quantity > 0
          ? "border-brand-600 shadow-[0_0_0_1px_#17694F,0_6px_18px_rgb(23_105_79/0.15)]"
          : "border-line",
      )}
    >
      <Link
        href={`/${locale}/product/${product.id}`}
        className="absolute inset-0 z-0"
        aria-label={productName(product, locale)}
      />

      {/* Art */}
      <div className="pointer-events-none relative">
        <ProductImage
          product={product}
          category={category}
          className="aspect-[5/4] w-full sm:aspect-[4/3]"
        />
        {showStock ? (
          <span
            className={cn(
              "absolute inset-inline-start-2 top-2 rounded-badge px-2 py-0.5 text-[11px] font-bold",
              soldOut
                ? "bg-danger-soft text-danger"
                : "bg-warning-soft text-warning",
            )}
          >
            {dict.availability[product.availability]}
          </span>
        ) : null}
        {product.trackExpiry ? (
          <span className="absolute inset-inline-end-2 top-2 inline-flex items-center gap-1 rounded-badge border border-dashed border-warning/50 bg-accent-wash px-1.5 py-0.5 text-[10px] font-semibold text-accent-deep">
            <AlertTriangle className="size-3" aria-hidden />
            {dict.catalog.expiryTracked}
          </span>
        ) : null}
      </div>

      {/* Body */}
      <div className="pointer-events-none flex flex-1 flex-col gap-[3px] px-3.5 pt-3">
        <div className="flex items-center justify-between gap-2">
          <p className="truncate text-[11px] font-bold uppercase tracking-[0.05em] text-brand-700">
            {manufacturer?.name[locale] ?? " "}
          </p>
          <span
            className="size-2 shrink-0 rounded-[3px]"
            style={{ backgroundColor: categoryDot(category.id) }}
            aria-hidden
          />
        </div>
        <h3 className="line-clamp-2 min-h-[39px] text-[14.5px] font-bold leading-[1.35] text-ink">
          {productName(product, locale)}
        </h3>
        <p className="text-xs text-ink-muted">{packageLabel(product, dict)}</p>
      </div>

      {/* Price bar */}
      <div className="relative z-10 border-t border-line-hair px-3.5 pb-3 pt-2.5">
        {quantity > 0 ? (
          <div className="flex items-center justify-between gap-2.5">
            <span className="text-[15px] font-extrabold tabular-nums text-brand-800">
              {formatCurrency(lineTotal, locale)}
            </span>
            <QuantityStepper
              value={quantity}
              onChange={(next) => setQuantity(product.id, next)}
              size="sm"
              className="border-[1.5px] border-brand-600 bg-brand-50"
            />
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2.5">
            <div className="min-w-0">
              <p className="text-[19px] font-extrabold tabular-nums tracking-[-0.02em] text-ink">
                {formatCurrency(product.wholesalePrice, locale)}
              </p>
              <p className="text-[11px] text-ink-muted">
                {formatCurrency(
                  product.wholesalePrice / product.unitsPerPackage,
                  locale,
                )}{" "}
                / {dict.units[product.baseUnit]}
              </p>
            </div>
            {soldOut ? (
              <span className="flex h-8.5 items-center rounded-lg border border-dashed border-line-strong bg-surface-warm px-2.5 text-[11px] font-bold text-ink-muted">
                {dict.availability.outOfStock}
              </span>
            ) : (
              <button
                type="button"
                onClick={() => addItem(product.id)}
                aria-label={dict.catalog.addToCart}
                className="flex size-11 shrink-0 items-center justify-center rounded-field bg-brand-600 text-white transition-transform hover:bg-brand-700 active:scale-[.94]"
              >
                <Plus className="size-[18px]" strokeWidth={2.5} aria-hidden />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
