"use client";

import { CheckCircle2, Mail, MapPin, Phone, Store, UserPlus } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/types";
import { createCustomerFromOrderAction } from "@/lib/actions/orders";
import type { OrderCustomerSnapshot } from "@/lib/types";

/**
 * Guest (showcase) order card (M7I.1). A guest order has NO shop account — the
 * buyer's details live in a free-form snapshot. Owner/admin can promote it to a
 * permanent shop (create_customer_from_order links the order) or keep it as a
 * one-time order. The button is a no-op after the order gets a real customer
 * (the page re-renders with the shop card instead).
 */
export function GuestOrderCard({
  orderId,
  snapshot,
  locale,
  live,
  dict,
}: {
  orderId: string;
  snapshot: OrderCustomerSnapshot;
  locale: Locale;
  live: boolean;
  dict: Dictionary;
}) {
  const t = dict.admin.orders.detail.guest;
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);
  const [failed, setFailed] = useState(false);

  const city =
    snapshot.city?.[locale] ||
    snapshot.city?.he ||
    snapshot.city?.ar ||
    snapshot.city?.en;

  function onCreate() {
    setFailed(false);
    startTransition(async () => {
      const result = await createCustomerFromOrderAction({ orderId, locale });
      if (result.ok) setDone(true);
      else setFailed(true);
    });
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>{t.title}</CardTitle>
          <span className="inline-flex items-center gap-1 rounded-badge bg-accent-wash px-2 py-0.5 text-[11px] font-bold text-warning">
            <Store className="size-3" aria-hidden />
            {t.badge}
          </span>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-1.5 pt-3 text-sm">
        <p className="text-base font-semibold text-ink">{snapshot.name}</p>
        {snapshot.contactName ? (
          <p className="text-ink-soft">{snapshot.contactName}</p>
        ) : null}
        {snapshot.phone ? (
          <p className="flex items-center gap-1.5 text-ink-soft" dir="ltr">
            <Phone className="size-3.5 shrink-0 text-ink-muted" aria-hidden />
            {snapshot.phone}
          </p>
        ) : null}
        {snapshot.email ? (
          <p className="flex items-center gap-1.5 break-all text-ink-soft" dir="ltr">
            <Mail className="size-3.5 shrink-0 text-ink-muted" aria-hidden />
            {snapshot.email}
          </p>
        ) : null}
        {city || snapshot.address ? (
          <p className="flex items-start gap-1.5 text-ink-soft">
            <MapPin className="mt-0.5 size-3.5 shrink-0 text-ink-muted" aria-hidden />
            <span>{[city, snapshot.address].filter(Boolean).join(" · ")}</span>
          </p>
        ) : null}

        <p className="mt-2 rounded-field bg-surface-sunken px-3 py-2 text-xs leading-relaxed text-ink-soft">
          {t.hint}
        </p>

        {done ? (
          <p className="mt-1 inline-flex items-center gap-1.5 text-sm font-medium text-success">
            <CheckCircle2 className="size-4" aria-hidden />
            {t.created}
          </p>
        ) : (
          <div className="mt-2 flex flex-col gap-2">
            <Button
              type="button"
              size="sm"
              onClick={onCreate}
              disabled={pending || !live}
            >
              <UserPlus className="size-4" aria-hidden />
              {pending ? t.creating : t.create}
            </Button>
            <span className="text-xs text-ink-muted">{t.oneTime}</span>
          </div>
        )}

        {failed ? (
          <p
            role="alert"
            className="mt-1 rounded-field bg-danger-soft px-3 py-2 text-sm font-medium text-danger"
          >
            {t.createError}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
