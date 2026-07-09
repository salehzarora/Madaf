"use client";

import { Check, ChevronDown, Search, Store, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/types";
import { useCart } from "@/lib/cart-context";
import { useShopData } from "@/lib/shop-data-context";
import { cn } from "@/lib/utils";

/**
 * "Ordering for shop…" picker — the sales-visit flow. A searchable dropdown
 * of the supplier's shops (name / contact / phone / city / address), so a rep
 * with many assigned shops isn't scrolling a huge list (M7I.4). Selection is
 * stored on the cart.
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
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const selected = customers.find((c) => c.id === customerId) ?? null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter((c) =>
      [
        c.name,
        c.contactName ?? "",
        c.phone ?? "",
        c.address ?? "",
        c.city.ar,
        c.city.he,
        c.city.en,
      ]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [customers, query]);

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  // Focus the search box when the menu opens (ref call only — no state in effect).
  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  // Reset the query as we open, from the event handler (not an effect).
  function toggle() {
    setOpen((prev) => !prev);
    if (!open) setQuery("");
  }

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        type="button"
        onClick={toggle}
        className={cn(
          "flex h-11 w-full items-center gap-2 rounded-field border px-3 text-sm transition-colors sm:w-auto",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600",
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
          <div className="border-b border-line-hair p-2">
            <div className="relative">
              <Search
                className="pointer-events-none absolute inset-y-0 start-2.5 my-auto size-4 text-ink-muted"
                aria-hidden
              />
              <input
                ref={searchRef}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={dict.catalog.searchShops}
                aria-label={dict.catalog.searchShops}
                className="h-10 w-full rounded-field border border-line-strong bg-surface ps-9 pe-3 text-sm text-ink outline-none placeholder:text-ink-muted focus-visible:border-brand-400 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-brand-600"
              />
            </div>
          </div>
          <ul className="max-h-72 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <li className="px-4 py-6 text-center text-sm text-ink-muted">
                {dict.catalog.noShopsFound}
              </li>
            ) : (
              filtered.map((customer) => (
                <li key={customer.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setCustomer(customer.id);
                      setOpen(false);
                    }}
                    className="flex w-full items-center gap-3 px-4 py-3 text-start transition-colors hover:bg-surface-warm focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-600"
                  >
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-field bg-brand-50 text-brand-700">
                      <Store className="size-4" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink">
                        {customer.name}
                      </span>
                      <span className="block truncate text-xs text-ink-soft">
                        {dict.admin.customers.types[customer.type]} ·{" "}
                        {customer.city[locale]}
                        {customer.phone ? (
                          <span dir="ltr"> · {customer.phone}</span>
                        ) : null}
                      </span>
                    </span>
                    {customer.id === customerId ? (
                      <Check className="size-4 shrink-0 text-brand-600" aria-hidden />
                    ) : null}
                  </button>
                </li>
              ))
            )}
          </ul>
          {selected ? (
            <button
              type="button"
              onClick={() => {
                setCustomer(null);
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 border-t border-line-hair px-4 py-2.5 text-sm text-ink-soft transition-colors hover:bg-surface-warm hover:text-danger focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-600"
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
