"use client";
import { EffectivePrice } from "@/components/effective-price";

import { ArrowRight, ShoppingCart, Trash2, X } from "lucide-react";
import Link from "next/link";
import { CustomerPicker } from "@/components/customer-picker";
import { ProductImage } from "@/components/product-image";
import { QuantityStepper } from "@/components/quantity-stepper";
import type { Locale } from "@/i18n/config";
import { interpolate } from "@/i18n/dictionaries";
import type { Dictionary } from "@/i18n/types";
import { useCart } from "@/lib/cart-context";
import { packageLabel, productName } from "@/lib/catalog-helpers";
import { formatCurrency } from "@/lib/format";
import { useShopData } from "@/lib/shop-data-context";

/** Only the lines scroll, keeping the shop and totals in view. The customer
 * picker is not enclosed by a clipping container. */
export function OrderPad({ locale, dict, headingId, onClose }: {
  locale: Locale;
  dict: Dictionary;
  headingId?: string;
  onClose?: () => void;
}) {
  const { items, setQuantity, removeItem, subtotal, totalPackages, hydrated } = useCart();
  const { productById } = useShopData();

  return (
    <aside className="catalog-order-pad" aria-label={dict.cart.orderSummary}>
      <header className="catalog-order-header">
        <div className="flex items-center gap-2 bg-band px-4 py-4 text-band-ink">
          <ShoppingCart className="size-5 text-accent" aria-hidden />
          <h2 id={headingId} className="text-sm font-bold">{dict.cart.orderSummary}</h2>
          <span dir="ltr" className="ms-auto rounded-full bg-band-ink/10 px-2.5 py-1 font-mono text-xs font-semibold">{hydrated ? totalPackages : 0}</span>
          {onClose ? (
            <button type="button" onClick={onClose} aria-label={dict.common.close} data-catalog-review-close className="flex size-11 shrink-0 items-center justify-center rounded-field text-band-ink transition-colors hover:bg-band-ink/10 focus-visible:outline-2 focus-visible:outline-accent">
              <X className="size-5" aria-hidden />
            </button>
          ) : null}
        </div>
        <div className="border-b border-line bg-surface-warm p-3">
          <CustomerPicker locale={locale} dict={dict} className="w-full" />
        </div>
      </header>
      <div className="catalog-order-lines">
        {!hydrated || items.length === 0 ? (
          <div className="flex min-h-48 flex-col items-center justify-center gap-2 px-4 py-8 text-center">
            <span className="mb-1 flex size-14 items-center justify-center rounded-full bg-surface-warm"><ShoppingCart className="size-6 text-brand-600" aria-hidden /></span>
            <p className="text-sm font-semibold text-ink">{dict.cart.empty}</p>
            <p className="max-w-56 text-xs leading-relaxed text-ink-soft">{dict.cart.emptyHint}</p>
          </div>
        ) : (
          <ul className="divide-y divide-line-hair">
            {items.map((item) => {
              const product = productById.get(item.productId);
              if (!product) return null;
              const name = productName(product, locale);
              return (
                <li key={item.productId} className="catalog-order-line">
                  <div className="flex items-start gap-2.5">
                    <ProductImage product={product} presentation="catalog" showSizeTag={false} className="catalog-order-thumbnail size-14 shrink-0 rounded-field" />
                    <div className="min-w-0 flex-1 pt-1">
                      <p className="line-clamp-2 text-[13px] font-semibold leading-snug text-ink" title={name}>{name}</p>
                      <p className="mt-1 text-[11px] leading-snug text-ink-soft">{packageLabel(product, dict)}</p>
                    </div>
                    <button type="button" onClick={() => removeItem(item.productId)} aria-label={dict.common.remove} title={`${dict.common.remove}: ${name}`} className="catalog-order-remove flex size-11 shrink-0 items-center justify-center rounded-field text-ink-muted transition-colors hover:bg-danger-soft hover:text-danger focus-visible:outline-2 focus-visible:outline-brand-600">
                      <Trash2 className="size-4" aria-hidden />
                    </button>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                    <QuantityStepper
                      className="catalog-order-stepper"
                      value={item.quantity}
                      increaseDisabled={product.availability === "outOfStock"}
                      onChange={(next) => setQuantity(item.productId, next)}
                      decreaseLabel={interpolate(dict.catalog.decreaseQuantity, { product: name })}
                      increaseLabel={interpolate(dict.catalog.increaseQuantity, { product: name })}
                    />
                    <bdi dir="ltr" className="text-sm font-bold tabular-nums text-ink"><EffectivePrice productId={product.id} locale={locale} quantity={item.quantity} /></bdi>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <footer className="catalog-order-footer">
        <p className="mb-2 text-[11px] text-ink-soft"><bdi dir="ltr">{hydrated ? totalPackages : 0}</bdi> {dict.common.packages} · {interpolate(dict.checkout.itemsCount, { count: hydrated ? items.length : 0 })}</p>
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-sm font-semibold">{dict.common.subtotal}</span>
          <bdi dir="ltr" className="text-xl font-extrabold tabular-nums text-brand-900">{subtotal === null ? "—" : formatCurrency(subtotal, locale)}</bdi>
        </div>
        <p className="mt-1.5 text-[11px] leading-relaxed text-ink-soft">{dict.cart.vatNote}</p>
        {hydrated && items.length > 0 ? (
          <Link href={`/${locale}/cart`} className="catalog-cart-cta mt-3">
            {dict.catalog.viewCart}<ArrowRight className="size-4 rtl:-scale-x-100" aria-hidden />
          </Link>
        ) : (
          <button type="button" disabled className="catalog-cart-cta mt-3">{dict.catalog.viewCart}</button>
        )}
      </footer>
    </aside>
  );
}
