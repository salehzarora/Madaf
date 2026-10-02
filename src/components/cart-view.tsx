"use client";
import { EffectivePrice } from "@/components/effective-price";

import { ArrowRight, ShoppingCart, Trash2 } from "lucide-react";
import Link from "next/link";
import { CustomerPicker } from "@/components/customer-picker";
import { ProductImage } from "@/components/product-image";
import { QuantityStepper } from "@/components/quantity-stepper";
import { Label, Textarea } from "@/components/ui/input";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/types";
import { useCart } from "@/lib/cart-context";
import { packageLabel, productName } from "@/lib/catalog-helpers";
import { formatCurrency } from "@/lib/format";
import { useShopData } from "@/lib/shop-data-context";

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
  const { productById, categoryById } = useShopData();

  if (!hydrated) {
    return (
      <div className="storefront-cart-page storefront-cart-loading">
        …
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="storefront-cart-page storefront-cart-page--empty">
        <header className="storefront-cart-heading">
          <p>
            {dict.nav.cart}
          </p>
          <h1>
            {dict.cart.title}
          </h1>
        </header>
        <div className="storefront-cart-empty">
          <div className="storefront-cart-empty-art" aria-hidden><ShoppingCart strokeWidth={1.5} /></div>
          <h2>{dict.cart.empty}</h2>
          <p>{dict.cart.emptyHint}</p>
          <Link href={`/${locale}/catalog`} className="storefront-cart-primary">
            {dict.cart.browseCatalog}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="storefront-cart-page">
      <header className="storefront-cart-heading">
        <p>
          {dict.nav.cart}
        </p>
        <h1>
          {dict.cart.title}
        </h1>
      </header>

      {/* Zero-minimum tracks prevent item min-content width expanding the grid. */}
      <div className="storefront-cart-layout">
        <div className="storefront-cart-items">
          {items.map((item) => {
            const product = productById.get(item.productId);
            if (!product) return null;
            // Optional for ProductImage — never crash on a missing category (M8A).
            const category = categoryById.get(product.categoryId);
            return (
              <article key={item.productId} className="storefront-cart-line">
                <div className="storefront-cart-line-product">
                  <ProductImage
                    product={product}
                    category={category}
                    presentation="storefront"
                    showSizeTag={false}
                    className="storefront-cart-thumbnail"
                  />
                  <div className="storefront-cart-line-copy">
                    <Link
                      href={`/${locale}/product/${product.id}`}
                      className="storefront-cart-product-link"
                      title={productName(product, locale)}
                    >
                      {productName(product, locale)}
                    </Link>
                    <p className="storefront-cart-package">
                      {packageLabel(product, dict)}
                    </p>
                  </div>
                </div>
                <div className="storefront-cart-line-footer">
                  <div className="storefront-cart-line-price">
                    <bdi dir="ltr"><EffectivePrice productId={product.id} locale={locale} quantity={item.quantity} /></bdi>
                    <span><bdi dir="ltr">
                      (<EffectivePrice productId={product.id} locale={locale} /> ×{" "}
                      {item.quantity})
                    </bdi></span>
                  </div>
                  <div className="storefront-cart-line-controls">
                    <QuantityStepper
                      className="storefront-cart-stepper"
                      value={item.quantity}
                      increaseDisabled={product.availability === "outOfStock"}
                      onChange={(next) => setQuantity(item.productId, next)}
                    />
                    <button
                      type="button"
                      onClick={() => removeItem(item.productId)}
                      className="storefront-cart-remove"
                      aria-label={`${dict.common.remove}: ${productName(product, locale)}`}
                    >
                      <Trash2 className="size-4" aria-hidden />
                      <span className="sr-only">{dict.common.remove}</span>
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>

        {/* Side column: shop, notes, summary */}
        <div className="storefront-cart-side">
          <section className="storefront-cart-panel storefront-cart-customer">
            <h2>{dict.cart.shopSection}</h2>
            <p className="storefront-cart-hint">{dict.cart.shopHint}</p>
            <CustomerPicker locale={locale} dict={dict} className="storefront-cart-picker" />
          </section>

          <section className="storefront-cart-panel storefront-cart-notes">
            <h2>{dict.cart.orderNotes}</h2>
            <Label htmlFor="cart-notes" className="sr-only">
              {dict.cart.orderNotes}
            </Label>
            <Textarea
              id="cart-notes"
              className="storefront-cart-notes-field"
              placeholder={dict.cart.notesPlaceholder}
            />
          </section>

          <section className="storefront-cart-summary">
            <div className="storefront-cart-summary-heading">
              <ShoppingCart className="size-5" aria-hidden />
              <h2>{dict.cart.orderSummary}</h2>
            </div>
            <div className="storefront-cart-summary-body">
              <div className="storefront-cart-count">
                <span>{dict.common.items}</span>
                <span>
                  <bdi>{totalPackages}</bdi> {dict.common.packages}
                </span>
              </div>
              <div className="storefront-cart-subtotal">
                <span>{dict.common.subtotal}</span>
                <bdi dir="ltr">
                  {subtotal === null ? "—" : formatCurrency(subtotal, locale)}
                </bdi>
              </div>
              <p className="storefront-cart-vat">
                {dict.cart.vatNote}
              </p>
              <Link
                href={`/${locale}/checkout`}
                className="storefront-cart-primary"
              >
                {dict.cart.proceedCheckout}
                <ArrowRight className="size-4 rtl:-scale-x-100" aria-hidden />
              </Link>
              <Link
                href={`/${locale}/catalog`}
                className="storefront-cart-secondary"
              >
                {dict.cart.continueShopping}
              </Link>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
