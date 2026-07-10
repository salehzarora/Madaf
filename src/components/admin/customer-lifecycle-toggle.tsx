"use client";

import { Power, PowerOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/types";
import { setCustomerActiveAction } from "@/lib/actions/customers";

/**
 * Deactivate / reactivate a store (M8C.3) — owner/admin, supabase mode
 * (page-gated; set_customer_active re-enforces in Postgres). Deactivation
 * is reversible and keeps all history, but it's operationally loud (the
 * store's private link stops working), so it asks for one confirmation.
 */
export function CustomerLifecycleToggle({
  customerId,
  isActive,
  locale,
  dict,
}: {
  customerId: string;
  isActive: boolean;
  locale: Locale;
  dict: Dictionary;
}) {
  const t = dict.admin.customers.lifecycle;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [failed, setFailed] = useState(false);

  function apply(nextActive: boolean) {
    setFailed(false);
    setConfirming(false);
    startTransition(async () => {
      const result = await setCustomerActiveAction({
        customerId,
        active: nextActive,
        locale,
      });
      if (result.ok) router.refresh();
      else setFailed(true);
    });
  }

  return (
    <div className="flex flex-col items-end gap-2">
      {isActive ? (
        confirming ? (
          <div className="flex flex-col gap-2 rounded-field border border-warning/45 bg-warning-soft p-3 text-end">
            <p className="text-xs font-medium text-warning">
              {t.deactivateConfirm}
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => apply(false)}
                disabled={pending}
                className="inline-flex h-9 items-center gap-1.5 rounded-field bg-danger px-3 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                <PowerOff className="size-3.5" aria-hidden />
                {t.deactivate}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={pending}
                className="inline-flex h-9 items-center rounded-field px-3 text-xs font-semibold text-ink-soft transition-colors hover:bg-surface-sunken"
              >
                {dict.common.cancel}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={pending}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-field border border-line-strong px-3 text-xs font-semibold text-ink-soft transition-colors hover:border-danger/40 hover:bg-danger-soft hover:text-danger focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:opacity-50"
          >
            <PowerOff className="size-3.5" aria-hidden />
            {t.deactivate}
          </button>
        )
      ) : (
        <button
          type="button"
          onClick={() => apply(true)}
          disabled={pending}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-field bg-brand-600 px-3 text-xs font-semibold text-white transition-colors hover:bg-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:opacity-50"
        >
          <Power className="size-3.5" aria-hidden />
          {t.activate}
        </button>
      )}

      {failed ? (
        <p role="alert" className="text-xs font-medium text-danger">
          {t.error}
        </p>
      ) : null}
    </div>
  );
}
