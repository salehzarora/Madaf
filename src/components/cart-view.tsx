"use client";

import { ArrowRight, ShoppingCart, Trash2 } from "lucide-react";
import Link from "next/link";
import { CustomerPicker } from "@/components/customer-picker";
import { EmptyState } from "@/components/empty-state";
import { ProductImage } from "@/components/product-image";
import { QuantityStepper } from "@/components/quantity-stepper";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label, Textarea } from "@/components/ui/input";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/types";
import { useCart } from "@/lib/cart-context";
import { formatCurrency } from "@/lib/format";
import { categoryById, packageLabel, productById, productName } from "@/lib/mock";

/** Cart page body — items, shop selection, notes and order summary. */
export function CartView({
  locale,
  dict,
}: {
  locale: Locale;
  dict: Dictionary;
}) {
  const { items, setQuantity, removeItem, subtotal, totalPackages, hydrated } =
    useCart();

  if (!hydrated) {
    return (
      <div className="mx-auto w-full max-w-6xl px-4 py-16 text-center text-sm text-ink-muted sm:px-6">
        …
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
        <h1 className="mb-6 text-2xl font-bold tracking-tight text-ink">
          {dict.cart.title}
        </h1>
        <EmptyState
          icon={<ShoppingCart />}
          title={dict.cart.empty}
          hint={dict.cart.emptyHint}
          action={
            <Link
              href={`/${locale}/catalog`}
              className="inline-flex h-11 items-center gap-2 rounded-field bg-brand-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-brand-700"
            >
              {dict.cart.browseCatalog}
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-bold tracking-tight text-ink">
        {dict.cart.title}
      </h1>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_360px]">
        {/* Items */}
        <div className="flex flex-col gap-3">
          {items.map((item) => {
            const product = productById.get(item.productId);
            if (!product) return null;
            const category = categoryById.get(product.categoryId)!;
            return (
              <Card key={item.productId} className="flex items-center gap-4 p-4">
                <ProductImage
                  product={product}
                  category={category}
                  className="size-20 shrink-0 rounded-field"
                  iconClassName="text-2xl"
                />
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/${locale}/product/${product.id}`}
                    className="line-clamp-2 text-sm font-semibold text-ink hover:text-brand-700"
                  >
                    {productName(product, locale)}
                  </Link>
                  <p className="mt-0.5 text-xs text-ink-muted">
                    {packageLabel(product, dict)}
                  </p>
                  <p className="mt-1 text-sm font-bold text-ink">
                    {formatCurrency(product.wholesalePrice * item.quantity, locale)}
                    <span className="ms-1.5 text-xs font-normal text-ink-muted">
                      ({formatCurrency(product.wholesalePrice, locale)} ×{" "}
                      {item.quantity})
                    </span>
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-2">
                  <QuantityStepper
                    size="sm"
                    value={item.quantity}
                    onChange={(next) => setQuantity(item.productId, next)}
                  />
                  <button
                    type="button"
                    onClick={() => removeItem(item.productId)}
                    className="inline-flex items-center gap-1 text-xs text-ink-muted transition-colors hover:text-danger"
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                    {dict.common.remove}
                  </button>
                </div>
              </Card>
            );
          })}
        </div>

        {/* Side column: shop, notes, summary */}
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>{dict.cart.shopSection}</CardTitle>
              <p className="text-xs text-ink-muted">{dict.cart.shopHint}</p>
            </CardHeader>
            <CardContent className="pt-3">
              <CustomerPicker locale={locale} dict={dict} className="w-full" />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{dict.cart.orderNotes}</CardTitle>
            </CardHeader>
            <CardContent className="pt-3">
              <Label htmlFor="cart-notes" className="sr-only">
                {dict.cart.orderNotes}
              </Label>
              <Textarea
                id="cart-notes"
                placeholder={dict.cart.notesPlaceholder}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{dict.cart.orderSummary}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 pt-3">
              <div className="flex justify-between text-sm text-ink-soft">
                <span>{dict.common.items}</span>
                <span className="tabular-nums">
                  {totalPackages} {dict.common.packages}
                </span>
              </div>
              <div className="flex justify-between text-base font-bold text-ink">
                <span>{dict.common.subtotal}</span>
                <span className="tabular-nums">
                  {formatCurrency(subtotal, locale)}
                </span>
              </div>
              <p className="text-xs leading-relaxed text-ink-muted">
                {dict.cart.vatNote}
              </p>
              <Link
                href={`/${locale}/checkout`}
                className="mt-2 inline-flex h-12 items-center justify-center gap-2 rounded-field bg-brand-600 px-5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700"
              >
                {dict.cart.proceedCheckout}
                <ArrowRight className="size-4 rtl:-scale-x-100" aria-hidden />
              </Link>
              <Link
                href={`/${locale}/catalog`}
                className="inline-flex h-11 items-center justify-center rounded-field text-sm font-medium text-ink-soft transition-colors hover:bg-surface-sunken"
              >
                {dict.cart.continueShopping}
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
