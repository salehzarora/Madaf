"use client";

import { Check, ChevronDown, Store, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/types";
import { useCart } from "@/lib/cart-context";
import { useShopData } from "@/lib/shop-data-context";
import { cn } from "@/lib/utils";

/**
 * "Ordering for shop…" picker — the sales-visit flow. A compact dropdown
 * listing the supplier's shops; selection is stored on the cart.
 */
export function CustomerPicker({
  locale,
  dict,
  className,
}: {
  locale: Locale;
  dict: Dictionary;
  className?: string;
}) {
  const { customerId, setCustomer, hydrated } = useCart();
  const { customers } = useShopData();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const selected = customers.find((c) => c.id === customerId) ?? null;

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex h-11 w-full items-center gap-2 rounded-field border px-3 text-sm transition-colors sm:w-auto",
          selected
            ? "border-brand-300 bg-brand-50 text-brand-900"
            : "border-line-strong bg-surface text-ink-soft hover:border-brand-300",
        )}
      >
        <Store className="size-4 shrink-0" aria-hidden />
        <span className="truncate font-medium">
          {!hydrated
            ? "…"
            : selected
              ? `${dict.catalog.orderingFor}: ${selected.name}`
              : dict.catalog.selectShop}
        </span>
        <ChevronDown className="ms-auto size-4 shrink-0 opacity-60" aria-hidden />
      </button>

      {open ? (
        <div className="absolute start-0 top-full z-50 mt-2 w-full min-w-72 overflow-hidden rounded-card border border-line bg-surface shadow-float sm:w-80">
          <ul className="max-h-80 overflow-y-auto py-1">
            {customers.map((customer) => (
              <li key={customer.id}>
                <button
                  type="button"
                  onClick={() => {
                    setCustomer(customer.id);
                    setOpen(false);
                  }}
                  className="flex w-full items-center gap-3 px-4 py-3 text-start transition-colors hover:bg-surface-sunken"
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-field bg-brand-50 text-brand-700">
                    <Store className="size-4" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink">
                      {customer.name}
                    </span>
                    <span className="block truncate text-xs text-ink-muted">
                      {dict.admin.customers.types[customer.type]} ·{" "}
                      {customer.city[locale]}
                    </span>
                  </span>
                  {customer.id === customerId ? (
                    <Check className="size-4 shrink-0 text-brand-600" aria-hidden />
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
          {selected ? (
            <button
              type="button"
              onClick={() => {
                setCustomer(null);
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 border-t border-line px-4 py-2.5 text-sm text-ink-muted transition-colors hover:bg-surface-sunken hover:text-danger"
            >
              <X className="size-4" aria-hidden />
              {dict.common.clear}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
