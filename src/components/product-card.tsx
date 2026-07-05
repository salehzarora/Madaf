"use client";

import Link from "next/link";
import { AvailabilityBadge } from "@/components/availability-badge";
import { ProductImage } from "@/components/product-image";
import { QuantityStepper } from "@/components/quantity-stepper";
import { Button } from "@/components/ui/button";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/types";
import { useCart } from "@/lib/cart-context";
import { formatCurrency } from "@/lib/format";
import { packageLabel, productName } from "@/lib/mock";
import type { Category, Manufacturer, Product } from "@/lib/types";

/**
 * Catalog product card — image placeholder, name, package info, wholesale
 * price and an add/stepper control. Card link goes to the detail page;
 * the cart controls stop propagation.
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
  manufacturer: Manufacturer;
  locale: Locale;
  dict: Dictionary;
}) {
  const { quantityOf, addItem, setQuantity } = useCart();
  const quantity = quantityOf(product.id);
  const soldOut = product.availability === "outOfStock";

  return (
    <div className="group relative flex flex-col overflow-hidden rounded-card border border-line bg-surface shadow-card transition-shadow hover:shadow-float">
      <Link
        href={`/${locale}/product/${product.id}`}
        className="absolute inset-0 z-0"
        aria-label={productName(product, locale)}
      />

      <div className="pointer-events-none relative">
        <ProductImage
          product={product}
          category={category}
          className="aspect-[4/3] w-full"
        />
        <div className="absolute start-2.5 top-2.5">
          <AvailabilityBadge
            availability={product.availability}
            dict={dict.availability}
          />
        </div>
        {product.trackExpiry ? (
          <span className="absolute end-2.5 top-2.5 rounded-full bg-surface/90 px-2 py-0.5 text-[11px] font-medium text-ink-soft backdrop-blur-sm">
            {dict.catalog.expiryTracked}
          </span>
        ) : null}
      </div>

      <div className="pointer-events-none flex flex-1 flex-col gap-1 p-3.5">
        <p className="text-xs font-medium text-ink-muted">
          {manufacturer.name[locale]}
        </p>
        <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-ink">
          {productName(product, locale)}
        </h3>
        <p className="text-xs text-ink-muted">{packageLabel(product, dict)}</p>

        <div className="mt-auto flex items-end justify-between gap-2 pt-2">
          <div>
            <p className="text-lg font-bold tracking-tight text-ink">
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
      </div>

      {/* Cart controls sit above the card link */}
      <div className="relative z-10 px-3.5 pb-3.5">
        {quantity > 0 ? (
          <QuantityStepper
            value={quantity}
            onChange={(next) => setQuantity(product.id, next)}
            className="w-full justify-between"
          />
        ) : (
          <Button
            onClick={() => addItem(product.id)}
            disabled={soldOut}
            variant={soldOut ? "outline" : "primary"}
            className="w-full"
          >
            {soldOut ? dict.availability.outOfStock : dict.catalog.addToCart}
          </Button>
        )}
      </div>
    </div>
  );
}
