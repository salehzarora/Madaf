"use client";

import { ShoppingCart } from "lucide-react";
import Link from "next/link";
import { QuantityStepper } from "@/components/quantity-stepper";
import { Button } from "@/components/ui/button";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/types";
import { useCart } from "@/lib/cart-context";
import type { Product } from "@/lib/types";

/** Add-to-cart controls on the product detail page. */
export function ProductDetailActions({
  product,
  locale,
  dict,
}: {
  product: Product;
  locale: Locale;
  dict: Dictionary;
}) {
  const { quantityOf, addItem, setQuantity } = useCart();
  const quantity = quantityOf(product.id);
  const soldOut = product.availability === "outOfStock";

  if (quantity > 0) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <QuantityStepper
          value={quantity}
          onChange={(next) => setQuantity(product.id, next)}
        />
        <Link
          href={`/${locale}/cart`}
          className="inline-flex h-12 items-center gap-2 rounded-field bg-brand-600 px-6 text-sm font-bold text-white shadow-sm transition-colors hover:bg-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
        >
          <ShoppingCart className="size-4" aria-hidden />
          {dict.catalog.viewCart}
        </Link>
      </div>
    );
  }

  return (
    <Button
      size="lg"
      disabled={soldOut}
      onClick={() => addItem(product.id)}
      className="w-full sm:w-auto sm:min-w-56"
    >
      <ShoppingCart className="size-5" aria-hidden />
      {soldOut ? dict.availability.outOfStock : dict.product.addToCart}
    </Button>
  );
}
