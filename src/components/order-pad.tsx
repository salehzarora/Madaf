"use client";

import { ArrowRight, ShoppingCart, Trash2 } from "lucide-react";
import Link from "next/link";
import { CustomerPicker } from "@/components/customer-picker";
import { QuantityStepper } from "@/components/quantity-stepper";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/types";
import { useCart } from "@/lib/cart-context";
import { productName } from "@/lib/catalog-helpers";
import { formatCurrency } from "@/lib/format";
import { useShopData } from "@/lib/shop-data-context";

/**
 * Sticky desktop/tablet-landscape order pad — the sales rep's running
 * order next to the catalog grid, like a POS terminal. Rendered only on
 * xl+ screens (smaller screens keep the bottom cart bar).
 */
export function OrderPad({
  locale,
  dict,
}: {
  locale: Locale;
  dict: Dictionary;
}) {
  const { items, setQuantity, removeItem, subtotal, totalPackages, hydrated } =
    useCart();
  const { productById } = useShopData();

  return (
    <aside className="sticky top-24 flex max-h-[calc(100dvh-7.5rem)] flex-col overflow-hidden rounded-card border border-line bg-surface shadow-card">
      <header className="border-b border-line">
        <h2 className="flex items-center gap-2 bg-band px-4 py-3 text-sm font-bold text-band-ink">
          <ShoppingCart className="size-4 text-accent" aria-hidden />
          {dict.cart.orderSummary}
          {hydrated && totalPackages > 0 ? (
            <span
              dir="ltr"
              className="ms-auto rounded-badge bg-accent px-2 py-0.5 font-mono text-xs font-bold text-ink"
            >
              {totalPackages}
            </span>
          ) : null}
        </h2>
        <div className="bg-surface-warm px-4 py-3">
          <CustomerPicker locale={locale} dict={dict} className="w-full" />
        </div>
      </header>

      {/* Lines */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2">
        {!hydrated || items.length === 0 ? (
          <div className="flex flex-col items-center gap-1.5 py-10 text-center">
            <ShoppingCart className="size-8 text-line-strong" aria-hidden />
            <p className="text-sm font-medium text-ink-soft">
              {dict.cart.empty}
            </p>
            <p className="text-xs text-ink-muted">{dict.cart.emptyHint}</p>
          </div>
        ) : (
          <ul className="divide-y divide-line-hair">
            {items.map((item) => {
              const product = productById.get(item.productId);
              if (!product) return null;
              return (
                <li key={item.productId} className="flex flex-col gap-1.5 py-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <p className="line-clamp-2 text-[13px] font-semibold leading-snug text-ink">
                      {productName(product, locale)}
                    </p>
                    <button
                      type="button"
                      onClick={() => removeItem(item.productId)}
                      aria-label={dict.common.remove}
                      className="shrink-0 rounded p-1 text-ink-muted transition-colors hover:text-danger"
                    >
                      <Trash2 className="size-3.5" aria-hidden />
                    </button>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <QuantityStepper
                      size="sm"
                      value={item.quantity}
                      onChange={(next) => setQuantity(item.productId, next)}
                    />
                    <p className="font-mono text-sm font-bold tabular-nums text-ink">
                      {formatCurrency(
                        product.wholesalePrice * item.quantity,
                        locale,
                      )}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Totals + CTA */}
      <footer className="border-t border-line bg-surface-warm px-4 py-3">
        <div className="flex items-baseline justify-between">
          <span className="text-sm font-semibold text-ink-soft">
            {dict.common.subtotal}
          </span>
          <span className="font-mono text-lg font-extrabold tabular-nums tracking-tight text-ink">
            {formatCurrency(subtotal, locale)}
          </span>
        </div>
        <p className="mt-0.5 text-[11px] leading-snug text-ink-muted">
          {dict.cart.vatNote}
        </p>
        <Link
          href={`/${locale}/cart`}
          aria-disabled={items.length === 0}
          className={
            items.length === 0
              ? "pointer-events-none mt-2.5 flex h-11 items-center justify-center rounded-field bg-line text-sm font-bold text-ink-muted"
              : "mt-2.5 flex h-11 items-center justify-center gap-2 rounded-field bg-brand-600 text-sm font-bold text-white shadow-sm transition-colors hover:bg-brand-700"
          }
        >
          {dict.cart.proceedCheckout}
          <ArrowRight className="size-4 rtl:-scale-x-100" aria-hidden />
        </Link>
      </footer>
    </aside>
  );
}
