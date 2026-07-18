"use client";

import { SendHorizontal } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Textarea } from "@/components/ui/input";
import { ShelfRule } from "@/components/ui/shelf-rule";
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
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <div>
        <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-muted">
          {dict.nav.cart}
        </p>
        <h1 className="mt-1 text-[28px] font-extrabold tracking-[-0.02em] text-ink">
          {dict.checkout.title}
        </h1>
        <ShelfRule className="mt-4" />
      </div>

      <form onSubmit={submit} className="mt-6 grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="flex flex-col gap-4">
          {/* Shop details */}
          <Card>
            <CardHeader>
              <CardTitle>{dict.checkout.shopDetails}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 pt-4 sm:grid-cols-2">
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
            </CardContent>
          </Card>

          {/* Delivery preference */}
          <Card>
            <CardHeader>
              <CardTitle>{dict.checkout.delivery}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 pt-4 sm:flex-row">
              {(["asap", "scheduled"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setDelivery(option)}
                  className={cn(
                    "flex h-12 flex-1 items-center justify-center rounded-field border text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600",
                    delivery === option
                      ? "border-brand-600 bg-brand-50 text-brand-800 shadow-[inset_0_0_0_1px_var(--color-brand-600)]"
                      : "border-line-strong bg-surface text-ink-soft hover:border-ink",
                  )}
                >
                  {dict.checkout[option === "asap" ? "asap" : "scheduled"]}
                </button>
              ))}
              {delivery === "scheduled" ? (
                <Input type="date" className="sm:max-w-44" dir="ltr" />
              ) : null}
            </CardContent>
          </Card>

          {/* Notes */}
          <Card>
            <CardHeader>
              <CardTitle>
                {dict.common.notes}{" "}
                <span className="text-xs font-normal text-ink-muted">
                  ({dict.common.optional})
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4">
              <Textarea name="notes" placeholder={dict.cart.notesPlaceholder} />
            </CardContent>
          </Card>
        </div>

        {/* Summary */}
        <div>
          <Card className="sticky top-24">
            <CardHeader>
              <CardTitle>{dict.checkout.summary}</CardTitle>
              <p className="text-xs text-ink-muted">
                {interpolate(dict.checkout.itemsCount, { count: items.length })} ·{" "}
                {totalPackages} {dict.common.packages}
              </p>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 pt-3">
              <ul className="flex max-h-64 flex-col gap-1.5 overflow-y-auto text-sm">
                {items.map((item) => {
                  const product = productById.get(item.productId);
                  if (!product) return null;
                  return (
                    <li
                      key={item.productId}
                      className="flex items-baseline justify-between gap-3"
                    >
                      <span className="min-w-0 flex-1 truncate text-ink-soft">
                        {productName(product, locale)}
                      </span>
                      <span className="shrink-0 tabular-nums text-ink-muted">
                        ×{item.quantity}
                      </span>
                      <span className="w-20 shrink-0 text-end tabular-nums font-medium text-ink">
                        {formatCurrency(
                          product.wholesalePrice * item.quantity,
                          locale,
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
              <div className="mt-2 flex justify-between border-t border-line pt-3 text-base font-bold text-ink">
                <span>{dict.common.subtotal}</span>
                <span className="tabular-nums">
                  {formatCurrency(subtotal, locale)}
                </span>
              </div>
              <p className="text-xs leading-relaxed text-ink-muted">
                {dict.checkout.disclaimer}
              </p>
              {sendFailed ? (
                <p
                  role="alert"
                  className="rounded-field bg-danger-soft px-3 py-2 text-sm font-medium text-danger"
                >
                  {dict.checkout.sendError}
                </p>
              ) : null}
              {conflict ? (
                <div
                  role="alert"
                  className="flex flex-col gap-2 rounded-field bg-warning-soft px-3 py-2 text-sm font-medium text-accent-deep"
                >
                  <span>{dict.checkout.conflictError}</span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={startNewAttempt}
                    className="self-start"
                  >
                    {dict.checkout.conflictRetry}
                  </Button>
                </div>
              ) : null}
              <Button
                type="submit"
                size="lg"
                disabled={sending || conflict || items.length === 0}
                className="mt-1 w-full"
              >
                <SendHorizontal
                  className={cn("size-4 rtl:-scale-x-100", sending && "animate-pulse")}
                  aria-hidden
                />
                {dict.checkout.sendOrder}
              </Button>
            </CardContent>
          </Card>
        </div>
      </form>
    </div>
  );
}
