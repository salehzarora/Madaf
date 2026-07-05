"use client";

import { SendHorizontal } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Textarea } from "@/components/ui/input";
import type { Locale } from "@/i18n/config";
import { interpolate } from "@/i18n/dictionaries";
import type { Dictionary } from "@/i18n/types";
import { useCart } from "@/lib/cart-context";
import { formatCurrency } from "@/lib/format";
import { customerById, productById, productName } from "@/lib/mock";
import { cn } from "@/lib/utils";

/**
 * Order-request confirmation. Mock submit: clears the cart and navigates
 * to the success page with a generated demo order number.
 */
export function CheckoutView({
  locale,
  dict,
}: {
  locale: Locale;
  dict: Dictionary;
}) {
  const router = useRouter();
  const { items, subtotal, totalPackages, customerId, clear, hydrated } =
    useCart();
  const [delivery, setDelivery] = useState<"asap" | "scheduled">("asap");
  const [sending, setSending] = useState(false);

  const customer = customerId ? customerById.get(customerId) : undefined;

  // Empty cart → back to the cart page (not during the send transition).
  useEffect(() => {
    if (hydrated && items.length === 0 && !sending) {
      router.replace(`/${locale}/cart`);
    }
  }, [hydrated, items.length, sending, locale, router]);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setSending(true);
    const orderNumber = `MDF-${1048 + Math.floor(Math.random() * 40)}`;
    // Simulate a short round-trip so the demo feels real.
    window.setTimeout(() => {
      clear();
      router.push(`/${locale}/order-success?n=${orderNumber}`);
    }, 600);
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-bold tracking-tight text-ink">
        {dict.checkout.title}
      </h1>

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
                    "flex h-12 flex-1 items-center justify-center rounded-field border text-sm font-medium transition-colors",
                    delivery === option
                      ? "border-brand-600 bg-brand-50 text-brand-800"
                      : "border-line-strong bg-surface text-ink-soft hover:border-brand-300",
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
              <Textarea placeholder={dict.cart.notesPlaceholder} />
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
              <Button
                type="submit"
                size="lg"
                disabled={sending || items.length === 0}
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
