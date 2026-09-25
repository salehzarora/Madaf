"use client";

import { AlertTriangle, Check, Plus } from "lucide-react";
import Link from "next/link";
import { ProductImage } from "@/components/product-image";
import { QuantityStepper } from "@/components/quantity-stepper";
import type { Locale } from "@/i18n/config";
import { interpolate } from "@/i18n/dictionaries";
import type { Dictionary } from "@/i18n/types";
import { useCart } from "@/lib/cart-context";
import { packageLabel, productName } from "@/lib/catalog-helpers";
import { formatCurrency } from "@/lib/format";
import type { Category, Manufacturer, Product } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Separate detail and ordering regions. Package prices remain visible when
 * a quantity is selected; line totals are secondary information. */
export function ProductCard({ product, category, manufacturer, locale, dict }: {
  product: Product;
  category: Category;
  manufacturer?: Manufacturer;
  locale: Locale;
  dict: Dictionary;
}) {
  const { quantityOf, addItem, setQuantity } = useCart();
  const quantity = quantityOf(product.id);
  const soldOut = product.availability === "outOfStock";
  const name = productName(product, locale);

  return (
    <article className={cn("catalog-product", quantity > 0 && "catalog-product-selected")}>
      <Link href={`/${locale}/product/${product.id}`} aria-label={name} className="catalog-product-detail">
        <div className="catalog-product-frame relative">
          <ProductImage product={product} category={category} presentation="catalog" className="catalog-product-image" />
          <div className="catalog-product-badges">
            {product.availability !== "inStock" ? (
              <span className={cn("rounded-badge px-2 py-1 text-[11px] font-semibold", soldOut ? "bg-danger-soft text-danger" : "bg-warning-soft text-warning")}>
                {dict.availability[product.availability]}
              </span>
            ) : null}
            {product.trackExpiry ? (
              <span className="inline-flex items-center gap-1 rounded-badge border border-dashed border-warning/50 bg-accent-wash px-2 py-1 text-[10px] font-semibold text-accent-deep">
                <AlertTriangle className="size-3 shrink-0" aria-hidden />{dict.catalog.expiryTracked}
              </span>
            ) : null}
          </div>
        </div>
        <div className="catalog-product-copy">
          <p className="catalog-product-brand min-h-4 truncate text-[11px] font-semibold text-brand-700">
            {manufacturer ? <span>{manufacturer.name[locale]}</span> : "\u00a0"}
          </p>
          <h3 className="catalog-product-name line-clamp-2 min-h-[2.7em] text-sm font-bold leading-snug text-ink" title={name}>{name}</h3>
          <p className="catalog-package-label">{packageLabel(product, dict)}</p>
        </div>
      </Link>
      <div className="catalog-product-order">
        <div className="catalog-product-prices">
          <p className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0">
            <bdi dir="ltr" className="catalog-package-price text-[21px] font-extrabold tabular-nums tracking-tight text-ink">{formatCurrency(product.wholesalePrice, locale)}</bdi>
            <span className="text-[10px] text-ink-soft">/ {dict.packaging[product.packageType]}</span>
          </p>
          <p className="mt-0.5 text-[11px] text-ink-soft">
            <bdi dir="ltr">{formatCurrency(product.wholesalePrice / product.unitsPerPackage, locale)}</bdi>
            {" / "}{dict.units[product.baseUnit]}
          </p>
        </div>
        {quantity > 0 ? (
          <QuantityStepper
            value={quantity}
            increaseDisabled={soldOut}
            onChange={(next) => setQuantity(product.id, next)}
            decreaseLabel={interpolate(dict.catalog.decreaseQuantity, { product: name })}
            increaseLabel={interpolate(dict.catalog.increaseQuantity, { product: name })}
            className="catalog-card-stepper"
          />
        ) : (
          <button
            type="button"
            onClick={() => addItem(product.id)}
            disabled={soldOut}
            aria-label={dict.catalog.addToCart}
            className="catalog-add-button"
          >
            {soldOut ? null : <Plus className="size-4 shrink-0" aria-hidden />}
            <span>{soldOut ? dict.availability.outOfStock : dict.product.addToCart}</span>
          </button>
        )}
        <p className="catalog-line-total" aria-hidden={quantity === 0 ? true : undefined}>
          {quantity > 0 ? <>
            <span className="inline-flex items-center gap-1"><Check className="size-3 shrink-0" aria-hidden />{dict.catalog.inCart}</span>
            <bdi dir="ltr" aria-label={dict.catalog.lineTotal}>{formatCurrency(quantity * product.wholesalePrice, locale)}</bdi>
          </> : null}
        </p>
      </div>
    </article>
  );
}
