"use client";

import { CheckCircle2, Link2, Mail, MapPin, Phone, Store, UserPlus } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/types";
import {
  createCustomerFromOrderAction,
  linkOrderToCustomerAction,
} from "@/lib/actions/orders";
import type { CustomerDuplicate } from "@/lib/data/customers";
import type { OrderCustomerSnapshot } from "@/lib/types";

/**
 * Guest (showcase) order card (M7I.1). A guest order has NO shop account — the
 * buyer's details live in a free-form snapshot. Owner/admin can promote it to a
 * permanent shop (create_customer_from_order links the order) or keep it as a
 * one-time order. M8B.3: when an existing store shares the guest's phone/name,
 * the create refuses and this card shows the matches — the admin either LINKS
 * the order to one of them or explicitly confirms creating a new store anyway.
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
  const [done, setDone] = useState<"created" | "linked" | null>(null);
  const [failed, setFailed] = useState(false);
  const [duplicates, setDuplicates] = useState<CustomerDuplicate[] | null>(null);

  const city =
    snapshot.city?.[locale] ||
    snapshot.city?.he ||
    snapshot.city?.ar ||
    snapshot.city?.en;

  function onCreate(confirmDuplicate = false) {
    setFailed(false);
    startTransition(async () => {
      const result = await createCustomerFromOrderAction({
        orderId,
        locale,
        confirmDuplicate,
      });
      if (result.ok) {
        setDone("created");
        setDuplicates(null);
        return;
      }
      if (result.duplicates && result.duplicates.length > 0) {
        setDuplicates(result.duplicates);
        return;
      }
      setFailed(true);
    });
  }

  function onLink(customerId: string) {
    setFailed(false);
    startTransition(async () => {
      const result = await linkOrderToCustomerAction({
        orderId,
        customerId,
        locale,
      });
      if (result.ok) {
        setDone("linked");
        setDuplicates(null);
      } else {
        setFailed(true);
      }
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
            {done === "linked" ? t.linked : t.created}
          </p>
        ) : duplicates ? (
          /* M8B.3 — duplicate guard: same-phone/name stores already exist. */
          <div className="mt-2 flex flex-col gap-2 rounded-field border border-warning/45 bg-warning-soft p-3">
            <p className="text-sm font-bold text-warning">{t.duplicateTitle}</p>
            <ul className="flex flex-col gap-1.5">
              {duplicates.map((d) => (
                <li
                  key={d.id}
                  className="flex flex-wrap items-center gap-2 rounded-field bg-surface px-2.5 py-2"
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 truncate text-sm font-semibold text-ink">
                      {d.name}
                      {d.isActive === false ? (
                        <span className="shrink-0 rounded-badge bg-danger-soft px-1.5 py-0.5 text-[10px] font-bold text-danger">
                          {dict.admin.customers.lifecycle.inactiveBadge}
                        </span>
                      ) : null}
                    </span>
                    <span className="block text-xs text-ink-soft">
                      {d.matchType === "phone"
                        ? t.duplicatePhoneMatch
                        : t.duplicateNameMatch}
                      {d.phone ? (
                        <span dir="ltr"> · {d.phone}</span>
                      ) : null}
                    </span>
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() => onLink(d.id)}
                  >
                    <Link2 className="size-3.5" aria-hidden />
                    {t.linkExisting}
                  </Button>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() => onCreate(true)}
              >
                <UserPlus className="size-3.5" aria-hidden />
                {t.createAnyway}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() => setDuplicates(null)}
              >
                {dict.common.cancel}
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-2 flex flex-col gap-2">
            <Button
              type="button"
              size="sm"
              onClick={() => onCreate(false)}
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
