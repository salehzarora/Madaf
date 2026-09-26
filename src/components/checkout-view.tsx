"use client";

import { SendHorizontal, ShoppingCart } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ProductImage } from "@/components/product-image";
import { Input, Label, Textarea } from "@/components/ui/input";
import type { Locale } from "@/i18n/config";
import { interpolate } from "@/i18n/dictionaries";
import type { Dictionary } from "@/i18n/types";
import { submitOrderAction } from "@/lib/actions/orders";
import { useCart } from "@/lib/cart-context";
import { productName } from "@/lib/catalog-helpers";
import { getDataMode } from "@/lib/data/mode";
import { formatCurrency } from "@/lib/format";
import { useShopData } from "@/lib/shop-data-context";
import { cn } from "@/lib/utils";

/**
 * Order-request confirmation.
 * - Mock mode (default): clears the cart and navigates to the success
 *   page with a generated demo order number — no server involved.
 * - Supabase mode (local dev): submits through the order Server Action,
 *   which creates a real order + lines with server-computed totals and
 *   returns the real MDF-#### number.
 */
export function CheckoutView({
  locale,
  dict,
}: {
  locale: Locale;
  dict: Dictionary;
}) {
  const router = useRouter();
  const {
    items,
    subtotal,
    totalPackages,
    customerId,
    clear,
    hydrated,
    ensureSubmissionKey,
    resetSubmissionKey,
  } = useCart();
  const { productById, customerById } = useShopData();
  const [delivery, setDelivery] = useState<"asap" | "scheduled">("asap");
  const [sending, setSending] = useState(false);
  const [sendFailed, setSendFailed] = useState(false);
  const [conflict, setConflict] = useState(false);

  const customer = customerId ? customerById.get(customerId) : undefined;

  // Empty cart → back to the cart page (not during the send transition).
  useEffect(() => {
    if (hydrated && items.length === 0 && !sending) {
      router.replace(`/${locale}/cart`);
    }
  }, [hydrated, items.length, sending, locale, router]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSending(true);
    setSendFailed(false);
    setConflict(false);

    if (getDataMode() === "mock") {
      const orderNumber = `MDF-${1048 + Math.floor(Math.random() * 40)}`;
      // Simulate a short round-trip so the demo feels real.
      window.setTimeout(() => {
        clear();
        router.push(`/${locale}/order-success?n=${orderNumber}`);
      }, 600);
      return;
    }

    const notes = new FormData(event.currentTarget).get("notes");
    try {
      // FIX1: one submission key for this logical order — reused across retries
      // (incl. after an ambiguous failure), so a duplicate submit returns the
      // SAME order rather than creating a second one.
      const result = await submitOrderAction({
        customerId,
        items: items.map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
        })),
        notes: typeof notes === "string" && notes.trim() ? notes : undefined,
        locale,
        submissionKey: ensureSubmissionKey(),
      });
      if (result.ok && result.publicRef) {
        clear();
        router.push(
          `/${locale}/order-success?n=${encodeURIComponent(result.publicRef)}`,
        );
        return;
      }
      if (result.reason === "conflict") {
        // The key was reused with a changed order. Keep the cart; the user
        // explicitly starts a fresh attempt (which rotates the key).
        setSending(false);
        setConflict(true);
        return;
      }
    } catch {
      // Transport-level failure (server unreachable) — same recovery as a
      // rejected order: keep the cart, re-enable the button, show the error.
    }
    setSending(false);
    setSendFailed(true);
  }

  // Explicit "start a new attempt" after an idempotency conflict: rotate the
  // submission key so the next submit is a brand-new logical order.
  function startNewAttempt() {
    resetSubmissionKey();
    setConflict(false);
    setSendFailed(false);
  }

  return (
    <div className="storefront-checkout">
      <header className="storefront-checkout-heading">
        <p>
          {dict.nav.cart}
        </p>
        <h1>
          {dict.checkout.title}
        </h1>
      </header>

      <form onSubmit={submit} className="storefront-checkout-layout">
        <div className="storefront-checkout-form-sections">
          {/* Shop details */}
          <section className="storefront-checkout-panel">
            <h2>{dict.checkout.shopDetails}</h2>
            <div className="storefront-checkout-fields">
              <div>
                <Label htmlFor="co-shop">{dict.checkout.shopName}</Label>
                <Input
                  id="co-shop"
                  required
                  defaultValue={customer?.name ?? ""}
                />
              </div>
              <div>
                <Label htmlFor="co-contact">{dict.checkout.contactName}</Label>
                <Input
                  id="co-contact"
                  defaultValue={customer?.contactName ?? ""}
                />
              </div>
              <div>
                <Label htmlFor="co-phone">{dict.common.phone}</Label>
                <Input
                  id="co-phone"
                  type="tel"
                  dir="ltr"
                  required
                  defaultValue={customer?.phone ?? ""}
                />
              </div>
              <div>
                <Label htmlFor="co-city">{dict.common.city}</Label>
                <Input
                  id="co-city"
                  defaultValue={customer?.city[locale] ?? ""}
                />
              </div>
            </div>
          </section>

          {/* Delivery preference */}
          <section className="storefront-checkout-panel">
            <h2>{dict.checkout.delivery}</h2>
            <div className="storefront-checkout-delivery">
              {(["asap", "scheduled"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setDelivery(option)}
                  aria-pressed={delivery === option}
                  className="storefront-checkout-delivery-option"
                >
                  {dict.checkout[option === "asap" ? "asap" : "scheduled"]}
                </button>
              ))}
              {delivery === "scheduled" ? (
                <Input
                  type="date"
                  className="storefront-checkout-date"
                  dir="ltr"
                  aria-label={dict.checkout.scheduled}
                />
              ) : null}
            </div>
          </section>

          {/* Notes */}
          <section className="storefront-checkout-panel">
            <h2>
              {dict.common.notes}{" "}
              <span className="storefront-checkout-optional">
                ({dict.common.optional})
              </span>
            </h2>
            <Textarea
              name="notes"
              aria-label={dict.common.notes}
              placeholder={dict.cart.notesPlaceholder}
            />
          </section>
        </div>

        {/* Summary */}
        <section className="storefront-checkout-summary">
          <div className="storefront-checkout-summary-heading">
            <div><ShoppingCart className="size-5" aria-hidden /><h2>{dict.checkout.summary}</h2></div>
            <p>
              {interpolate(dict.checkout.itemsCount, { count: items.length })} ·{" "}
              {totalPackages} {dict.common.packages}
            </p>
          </div>
          <div className="storefront-checkout-summary-body">
            <ul className="storefront-checkout-lines">
              {items.map((item) => {
                const product = productById.get(item.productId);
                if (!product) return null;
                return (
                  <li
                    key={item.productId}
                    className="storefront-checkout-line"
                  >
                    <ProductImage product={product} presentation="storefront" showSizeTag={false} className="storefront-checkout-thumbnail" />
                    <div className="storefront-checkout-line-copy">
                      <p title={productName(product, locale)}>{productName(product, locale)}</p>
                      <span dir="ltr">×{item.quantity}</span>
                    </div>
                    <bdi dir="ltr" className="storefront-checkout-line-price">
                      {formatCurrency(
                        product.wholesalePrice * item.quantity,
                        locale,
                      )}
                    </bdi>
                  </li>
                );
              })}
            </ul>
            <div className="storefront-checkout-subtotal">
              <span>{dict.common.subtotal}</span>
              <bdi dir="ltr">
                {formatCurrency(subtotal, locale)}
              </bdi>
            </div>
            <p className="storefront-checkout-disclaimer">
              {dict.checkout.disclaimer}
            </p>
            {sendFailed ? (
              <p
                role="alert"
                className="storefront-checkout-error"
              >
                {dict.checkout.sendError}
              </p>
            ) : null}
            {conflict ? (
              <div
                role="alert"
                className="storefront-checkout-conflict"
              >
                <span>{dict.checkout.conflictError}</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={startNewAttempt}
                  className="storefront-checkout-retry"
                >
                  {dict.checkout.conflictRetry}
                </Button>
              </div>
            ) : null}
            <Button
              type="submit"
              size="lg"
              disabled={sending || conflict || items.length === 0}
              className="storefront-checkout-submit"
            >
              <SendHorizontal
                className={cn("size-4 rtl:-scale-x-100", sending && "animate-pulse")}
                aria-hidden
              />
              {dict.checkout.sendOrder}
            </Button>
          </div>
        </section>
      </form>
    </div>
  );
}
