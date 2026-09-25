"use client";

import { ArrowRight, ShoppingCart } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { OrderPad } from "@/components/order-pad";
import { dirFor, type Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/types";
import { useCart } from "@/lib/cart-context";
import { formatCurrency } from "@/lib/format";

const SIDE_PANEL_QUERY = "(min-width: 1024px) and (min-height: 650px)";

/** A second view of the same cart, never another order/submission path. Keep
 * this component mounted when empty so removing the last line keeps review open. */
export function CatalogCartReview({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const { hydrated, totalPackages, subtotal } = useCart();
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const returnFocusRef = useRef<HTMLButtonElement>(null);
  const dialogId = useId();
  const headingId = useId();
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const workspace = dialog.closest(".catalog-workspace");
    const body = document.body;
    const page = document.documentElement;
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    const styles = [
      { element: body, properties: ["position", "inset-block-start", "inset-inline-start", "inline-size", "overflow"] },
      { element: page, properties: ["overflow", "scrollbar-gutter", "scroll-behavior"] },
    ].flatMap(({ element, properties }) => properties.map((property) => ({
      element, property,
      value: element.style.getPropertyValue(property),
      priority: element.style.getPropertyPriority(property),
    })));

    // Reserve the existing scrollbar gutter. Removing overflow must not change
    // the workspace's width breakpoint while a review is opening/closing.
    page.style.scrollbarGutter = "stable";
    page.style.overflow = "hidden";
    body.style.position = "fixed";
    body.style.insetBlockStart = `${-scrollY}px`;
    body.style.insetInlineStart = `${dirFor(locale) === "rtl" ? scrollX : -scrollX}px`;
    body.style.inlineSize = "100%";
    body.style.overflow = "hidden";

    dialog.showModal();
    dialog.querySelector<HTMLButtonElement>("[data-catalog-review-close]")?.focus({ preventScroll: true });

    const sidePanel = window.matchMedia(SIDE_PANEL_QUERY);
    function onLayoutChange(event: MediaQueryListEvent) {
      if (event.matches) close();
    }
    sidePanel.addEventListener("change", onLayoutChange);

    return () => {
      sidePanel.removeEventListener("change", onLayoutChange);
      if (dialog.open) dialog.close();
      for (const { element, property, value, priority } of styles) {
        if (value) element.style.setProperty(property, value, priority);
        else element.style.removeProperty(property);
      }
      // Restoration must be immediate even when the page uses smooth scrolling.
      const previousScroll = page.style.getPropertyValue("scroll-behavior");
      const previousPriority = page.style.getPropertyPriority("scroll-behavior");
      page.style.setProperty("scroll-behavior", "auto", "important");
      window.scrollTo(scrollX, scrollY);
      if (previousScroll) page.style.setProperty("scroll-behavior", previousScroll, previousPriority);
      else page.style.removeProperty("scroll-behavior");

      queueMicrotask(() => {
        // Route navigation owns focus after the whole catalog has unmounted.
        if (workspace && !workspace.isConnected) return;
        const visible = (element: HTMLElement | null): element is HTMLElement =>
          Boolean(element?.isConnected && element.getClientRects().length > 0);
        const trigger = returnFocusRef.current;
        if (visible(trigger)) {
          trigger.focus({ preventScroll: true });
          return;
        }
        const fallback = [
          '.catalog-side-panel button[aria-haspopup="dialog"]',
          ".catalog-side-panel a.catalog-cart-cta",
          ".catalog-search input",
          'header a[href$="/cart"]',
        ].flatMap((selector) => Array.from(document.querySelectorAll<HTMLElement>(selector))).find(visible);
        fallback?.focus({ preventScroll: true });
      });
    };
  }, [open, locale, close]);

  return (
    <>
      {hydrated && totalPackages > 0 ? (
        <div className="catalog-cart-bar">
          <ShoppingCart className="size-5 shrink-0 text-accent" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-[11px] text-band-muted"><bdi dir="ltr">{totalPackages}</bdi> {dict.common.packages}</p>
            <p className="text-lg font-bold tabular-nums"><bdi dir="ltr">{formatCurrency(subtotal, locale)}</bdi></p>
          </div>
          <button
            type="button"
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-controls={dialogId}
            onClick={(event) => {
              if (window.matchMedia(SIDE_PANEL_QUERY).matches) return;
              returnFocusRef.current = event.currentTarget;
              setOpen(true);
            }}
            className="catalog-cart-bar-action"
          >
            {dict.catalog.reviewCart}<ArrowRight className="size-4 rtl:-scale-x-100" aria-hidden />
          </button>
        </div>
      ) : null}
      <dialog
        ref={dialogRef}
        id={dialogId}
        aria-labelledby={headingId}
        dir={dirFor(locale)}
        tabIndex={-1}
        className="catalog-review-dialog"
        onKeyDown={(event) => {
          if (event.key !== "Tab") return;
          const dialog = event.currentTarget;
          const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
            'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]',
          )).filter((element) => element.tabIndex >= 0
            && !element.matches(":disabled")
            && !element.closest('[inert], [aria-hidden="true"]')
            && element.getClientRects().length > 0
            && getComputedStyle(element).visibility !== "hidden");
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          const active = document.activeElement;
          if (!first) {
            event.preventDefault();
            dialog.focus({ preventScroll: true });
          } else if (!focusable.some((element) => element === active)
            || (event.shiftKey && active === first)
            || (!event.shiftKey && active === last)) {
            event.preventDefault();
            (event.shiftKey ? last : first).focus({ preventScroll: true });
          }
        }}
        onCancel={(event) => { event.preventDefault(); close(); }}
        onClose={(event) => { if (!event.currentTarget.open) close(); }}
      >
        {open ? <OrderPad locale={locale} dict={dict} headingId={headingId} onClose={close} /> : null}
      </dialog>
    </>
  );
}
