"use client";

import { Check, ChevronDown, Search, Store, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { dirFor, type Locale } from "@/i18n/config";
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
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const popupId = useId();

  const selected = customers.find((c) => c.id === customerId) ?? null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    // Active stores first (M8C); inactive ones stay visible but marked and
    // unselectable — new orders belong to active stores.
    const base = [...customers].sort((a, b) => {
      const aInactive = a.isActive === false ? 1 : 0;
      const bInactive = b.isActive === false ? 1 : 0;
      return aInactive - bInactive;
    });
    if (!q) return base;
    return base.filter((c) =>
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
    if (!open) return;
    const popup = popupRef.current;
    if (!popup) return;

    // The native top layer escapes clipped order panels while keeping this
    // DOM-local control inside a containing cart-review dialog's focus scope.
    // React owns dismissal so one Escape cannot close both picker and review.
    function positionPopup() {
      const trigger = triggerRef.current;
      if (!trigger || !popup) return;
      const rect = trigger.getBoundingClientRect();
      const viewport = window.visualViewport;
      // Fixed logical insets use the layout viewport, excluding its scrollbar.
      const layoutWidth = document.documentElement.clientWidth || window.innerWidth;
      const viewTop = viewport?.offsetTop ?? 0;
      const viewLeft = viewport?.offsetLeft ?? 0;
      const viewWidth = viewport?.width ?? layoutWidth;
      const viewHeight = viewport?.height ?? window.innerHeight;
      const width = Math.min(336, Math.max(0, viewWidth - 16));
      const x = Math.max(viewLeft + 8, Math.min(
        dirFor(locale) === "rtl" ? rect.right - width : rect.left,
        viewLeft + viewWidth - width - 8,
      ));
      const below = Math.max(0, viewTop + viewHeight - rect.bottom - 14);
      const above = Math.max(0, rect.top - viewTop - 14);
      const opensBelow = below >= 240 || below >= above;
      const anchoredHeight = Math.min(440, opensBelow ? below : above);
      const viewportHeight = Math.max(0, Math.min(440, viewHeight - 16));
      const compactOrKeyboard = window.innerWidth < 1024
        || viewHeight < window.innerHeight - 64;
      // A touch keyboard can leave less room beside the trigger than the
      // search field and a few results need. Keep the picker inside the
      // visual viewport in that case, including when the trigger has scrolled
      // behind the keyboard.
      const useViewport = compactOrKeyboard && (
        rect.bottom <= viewTop + 8
        || rect.top >= viewTop + viewHeight - 8
        || anchoredHeight < Math.min(300, viewportHeight)
      );
      popup.style.width = `${width}px`;
      popup.style.maxHeight = `${useViewport ? viewportHeight : anchoredHeight}px`;
      popup.style.insetInlineStart = `${dirFor(locale) === "rtl" ? layoutWidth - x - width : x}px`;
      popup.style.insetBlockStart = useViewport
        ? `${viewTop + 8}px`
        : opensBelow ? `${Math.max(viewTop + 8, rect.bottom + 6)}px` : "auto";
      popup.style.insetBlockEnd = useViewport || opensBelow
        ? "auto"
        : `${Math.max(8, window.innerHeight - rect.top + 6)}px`;
    }

    positionPopup();
    if (typeof popup.showPopover === "function") popup.showPopover();
    else popup.style.display = "flex"; // Older browsers/test DOM: no fabricated native API.

    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("resize", positionPopup);
    window.addEventListener("scroll", positionPopup, { capture: true, passive: true });
    window.visualViewport?.addEventListener("resize", positionPopup);
    window.visualViewport?.addEventListener("scroll", positionPopup);
    searchRef.current?.focus({ preventScroll: true });
    const focusFrame = window.requestAnimationFrame?.(positionPopup);
    return () => {
      if (focusFrame !== undefined) window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("resize", positionPopup);
      window.removeEventListener("scroll", positionPopup, true);
      window.visualViewport?.removeEventListener("resize", positionPopup);
      window.visualViewport?.removeEventListener("scroll", positionPopup);
    };
  }, [open, locale]);

  function close() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  // Reset the query as we open, from the event handler (not an effect).
  function toggle() {
    setOpen((prev) => !prev);
    if (!open) setQuery("");
  }

  return (
    <div
      ref={rootRef}
      className={cn("relative min-w-0", className)}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          // Consume this Escape before the containing native dialog handles it.
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      }}
      onBlur={(event) => {
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-label={selected ? `${dict.catalog.changeShop}: ${selected.name}` : dict.catalog.selectShop}
        aria-expanded={open}
        aria-controls={popupId}
        aria-haspopup="dialog"
        onClick={toggle}
        className={cn(
          "flex h-11 w-full min-w-0 items-center gap-2 rounded-field border px-3 text-start text-sm transition-colors",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600",
          selected
            ? "border-brand-300 bg-brand-50 text-brand-900"
            : "border-line-strong bg-surface text-ink-soft hover:border-brand-300",
        )}
      >
        <Store className="size-4 shrink-0" aria-hidden />
        <span className="min-w-0 truncate font-medium">
          {!hydrated
            ? "…"
            : selected
              ? `${dict.catalog.orderingFor}: ${selected.name}`
              : dict.catalog.selectShop}
        </span>
        <ChevronDown className="ms-auto size-4 shrink-0 opacity-60" aria-hidden />
      </button>

      {open ? (
        <div
          ref={popupRef}
          id={popupId}
          popover="manual"
          role="dialog"
          aria-label={dict.catalog.selectShop}
          dir={dirFor(locale)}
          onToggle={(event) => { if (event.newState === "closed") setOpen(false); }}
          className="fixed inset-auto z-50 m-0 flex max-w-[calc(100vw-1rem)] flex-col overflow-hidden rounded-card border border-line bg-surface text-ink shadow-float"
        >
          <div className="flex shrink-0 items-center gap-2 border-b border-line-hair p-2">
            <div className="relative min-w-0 flex-1">
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
                className="h-11 w-full rounded-field border border-line-strong bg-surface ps-9 pe-3 text-base lg:text-sm text-ink outline-none placeholder:text-ink-muted focus-visible:border-brand-600 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-brand-600"
              />
            </div>
            <button
              type="button"
              onClick={close}
              aria-label={dict.common.close}
              className="flex size-11 shrink-0 items-center justify-center rounded-field text-ink-soft hover:bg-surface-warm focus-visible:outline-2 focus-visible:outline-brand-600 lg:hidden"
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>
          <ul className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-1">
            {filtered.length === 0 ? (
              <li className="px-4 py-6 text-center text-sm text-ink-muted">
                {dict.catalog.noShopsFound}
              </li>
            ) : (
              filtered.map((customer) => {
                const inactive = customer.isActive === false;
                return (
                <li key={customer.id}>
                  <button
                    type="button"
                    disabled={inactive}
                    onClick={() => {
                      setCustomer(customer.id);
                      close();
                    }}
                    className="flex w-full items-center gap-3 px-4 py-3 text-start transition-colors hover:bg-surface-warm focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-600 disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:bg-transparent"
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
                    {inactive ? (
                      <span className="shrink-0 rounded-badge bg-danger-soft px-1.5 py-0.5 text-[10px] font-bold text-danger">
                        {dict.admin.customers.lifecycle.inactiveBadge}
                      </span>
                    ) : customer.id === customerId ? (
                      <Check className="size-4 shrink-0 text-brand-600" aria-hidden />
                    ) : null}
                  </button>
                </li>
                );
              })
            )}
          </ul>
          {selected ? (
            <button
              type="button"
              onClick={() => {
                setCustomer(null);
                close();
              }}
              className="flex min-h-11 w-full shrink-0 items-center gap-2 border-t border-line-hair px-4 py-2.5 text-sm text-ink-soft transition-colors hover:bg-surface-warm hover:text-danger focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-600"
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
