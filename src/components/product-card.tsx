"use client";

import { AlertTriangle, Plus } from "lucide-react";
import Link from "next/link";
import { ProductImage } from "@/components/product-image";
import { QuantityStepper } from "@/components/quantity-stepper";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/types";
import { useCart } from "@/lib/cart-context";
import { packageLabel, productName } from "@/lib/catalog-helpers";
import { formatCurrency } from "@/lib/format";
import type { Availability, Category, Manufacturer, Product } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Wholesale product card — built for fast tablet scanning inside a shop:
 * manufacturer eyebrow, big name, package line, LOUD package price with
 * per-unit price under it, strong stock badge on the art, one-tap add.
 */
const stockBadge: Record<Availability, string> = {
  inStock: "bg-success text-white",
  lowStock: "bg-warning text-white",
  outOfStock: "bg-danger text-white",
};

export function ProductCard({
  product,
  category,
  manufacturer,
  locale,
  dict,
}: {
  product: Product;
  category: Category;
  /** Optional — a product may have no manufacturer. */
  manufacturer?: Manufacturer;
  locale: Locale;
  dict: Dictionary;
}) {
  const { quantityOf, addItem, setQuantity } = useCart();
  const quantity = quantityOf(product.id);
  const soldOut = product.availability === "outOfStock";

  return (
    <div
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-card border bg-surface shadow-card transition-all",
        quantity > 0
          ? "border-brand-400 ring-1 ring-brand-300"
          : "border-line hover:border-brand-200 hover:shadow-float",
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
        <span
          className={cn(
            "absolute start-2 top-2 inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-bold shadow-sm",
            stockBadge[product.availability],
          )}
        >
          <span className="size-1.5 rounded-full bg-white/90" aria-hidden />
          {dict.availability[product.availability]}
        </span>
        {product.trackExpiry ? (
          <span className="absolute end-2 top-2 inline-flex items-center gap-1 rounded-md bg-white/90 px-1.5 py-0.5 text-[10px] font-semibold text-warning shadow-sm backdrop-blur-sm">
            <AlertTriangle className="size-3" aria-hidden />
            {dict.catalog.expiryTracked}
          </span>
        ) : null}
      </div>

      {/* Copy */}
      <div className="pointer-events-none flex flex-1 flex-col gap-0.5 px-3 pt-2.5 sm:px-3.5">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-700">
          {manufacturer?.name[locale] ?? " "}
        </p>
        <h3 className="line-clamp-2 text-[15px] font-bold leading-snug text-ink">
          {productName(product, locale)}
        </h3>
        <p className="text-xs text-ink-muted">{packageLabel(product, dict)}</p>

        <div className="mt-1.5 flex items-baseline gap-2">
          <p className="text-xl font-extrabold tracking-tight text-ink">
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
      </div>

      {/* One-tap controls (above the card link) */}
      <div className="relative z-10 px-3 pb-3 pt-2 sm:px-3.5">
        {quantity > 0 ? (
          <QuantityStepper
            value={quantity}
            onChange={(next) => setQuantity(product.id, next)}
            className="w-full justify-between border-brand-400 bg-brand-50"
          />
        ) : (
          <button
            type="button"
            onClick={() => addItem(product.id)}
            disabled={soldOut}
            className={cn(
              "flex h-11 w-full items-center justify-center gap-1.5 rounded-field text-sm font-bold transition-all",
              soldOut
                ? "cursor-not-allowed bg-surface-sunken text-ink-muted"
                : "bg-brand-600 text-white shadow-sm hover:bg-brand-700 active:scale-[0.98]",
            )}
          >
            {soldOut ? (
              dict.availability.outOfStock
            ) : (
              <>
                <Plus className="size-4" strokeWidth={3} aria-hidden />
                {dict.catalog.addToCart}
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}
