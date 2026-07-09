"use client";

import {
  CheckCircle2,
  Lock,
  PackageSearch,
  Plus,
  ShoppingCart,
} from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { CatalogFilterBar } from "@/components/shop/catalog-filter-bar";
import { EmptyState } from "@/components/empty-state";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { ProductImage } from "@/components/product-image";
import { QuantityStepper } from "@/components/quantity-stepper";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/types";
import { packageLabel, productName } from "@/lib/catalog-helpers";
import {
  emptyCatalogFilters,
  filterAndSortProducts,
} from "@/lib/catalog-filter";
import { formatCurrency, formatNumber } from "@/lib/format";
import { submitShopOrderAction } from "@/lib/actions/shop";
import type { TokenCatalog } from "@/lib/data/token";
import type { Category } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Used when a product's category isn't in the token catalog payload. */
const FALLBACK_CATEGORY: Category = {
  id: "misc",
  name: { ar: "", he: "", en: "" },
  icon: "📦",
  hue: 0,
};

/**
 * Self-contained tokenized storefront for a shop opening its private link.
 * No login, no global cart — the cart is local state and the order is
 * submitted through the token action. The store/customer is fixed by the
 * token and is READ-ONLY (the buyer can never change who the order is for).
 */
export function ShopView({
  locale,
  dict,
  token,
  catalog,
}: {
  locale: Locale;
  dict: Dictionary;
  token: string;
  catalog: TokenCatalog;
}) {
  const t = dict.access.shop;
  const [cart, setCart] = useState<Map<string, number>>(new Map());
  const [notes, setNotes] = useState("");
  const [pending, startTransition] = useTransition();
  // Customer-facing PUBLIC ref (MDF-XXXXXXXX), never the internal number.
  const [publicRef, setPublicRef] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [filters, setFilters] = useState(emptyCatalogFilters);

  const categoryById = useMemo(
    () => new Map(catalog.categories.map((c) => [c.id, c])),
    [catalog.categories],
  );
  const manufacturerById = useMemo(
    () => new Map(catalog.manufacturers.map((m) => [m.id, m])),
    [catalog.manufacturers],
  );
  const visible = useMemo(
    () => filterAndSortProducts(catalog.products, filters, manufacturerById, locale),
    [catalog.products, filters, manufacturerById, locale],
  );

  function setQty(productId: string, qty: number) {
    setCart((prev) => {
      const next = new Map(prev);
      if (qty <= 0) next.delete(productId);
      else next.set(productId, qty);
      return next;
    });
  }

  const lineCount = cart.size;
  const estimate = useMemo(() => {
    let sum = 0;
    for (const product of catalog.products) {
      const qty = cart.get(product.id);
      if (qty) sum += qty * product.wholesalePrice;
    }
    return sum;
  }, [cart, catalog.products]);

  function onSubmit() {
    setError(false);
    const items = [...cart.entries()].map(([productId, quantity]) => ({
      productId,
      quantity,
    }));
    if (items.length === 0) return;
    startTransition(async () => {
      const result = await submitShopOrderAction({
        token,
        items,
        notes: notes.trim() || undefined,
      });
      if (result.ok && result.publicRef) {
        setPublicRef(result.publicRef);
        setCart(new Map());
        setNotes("");
      } else {
        setError(true);
      }
    });
  }

  const tenantName = catalog.tenantName[locale] || catalog.tenantName.he;

  if (publicRef) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-lg flex-col items-center justify-center px-4 py-16 text-center">
        <CheckCircle2 className="size-14 text-success" aria-hidden />
        <h1 className="mt-4 text-2xl font-extrabold tracking-tight text-ink">
          {t.successTitle}
        </h1>
        <p className="mt-2 text-sm text-ink-soft">{t.successBody}</p>
        <div className="mt-5 rounded-card border border-line bg-surface-warm px-5 py-3">
          <p className="text-[11px] font-bold uppercase tracking-[0.06em] text-ink-muted">
            {t.orderNumberLabel}
          </p>
          <p className="mt-0.5 font-mono text-lg font-bold text-ink" dir="ltr">
            {publicRef}
          </p>
        </div>
        <p className="mt-2 max-w-sm text-xs text-ink-soft">{t.refHint}</p>
        <p className="mt-6 max-w-sm text-xs text-ink-soft">{t.disclaimer}</p>
      </main>
    );
  }

  return (
    <div className="min-h-dvh bg-surface-sunken pb-28">
      {/* Header — supplier + read-only store context */}
      <header className="border-b border-line bg-surface-warm">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-4 sm:px-6">
          <div className="min-w-0">
            <p className="text-xs font-medium text-ink-muted">{t.welcome}</p>
            <h1 className="truncate text-lg font-bold tracking-tight text-ink">
              {tenantName}
            </h1>
          </div>
          <div className="ms-auto">
            <LocaleSwitcher current={locale} />
          </div>
        </div>
        <div className="mx-auto max-w-5xl px-4 pb-3 sm:px-6">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-field bg-brand-50 px-3 py-2 text-sm">
            <Lock className="size-3.5 shrink-0 text-brand-700" aria-hidden />
            <span className="text-ink-muted">{t.orderingFor}</span>
            <span className="font-semibold text-ink">
              {catalog.customer.name}
            </span>
            {catalog.customer.city[locale] ? (
              <span className="text-ink-muted">
                · {catalog.customer.city[locale]}
              </span>
            ) : null}
            <span className="ms-auto text-[11px] text-ink-muted">
              {t.storeLocked}
            </span>
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-4 sm:px-6">
        {catalog.products.length > 0 ? (
          <CatalogFilterBar
            locale={locale}
            dict={dict}
            categories={catalog.categories}
            manufacturers={catalog.manufacturers}
            filters={filters}
            onChange={setFilters}
            onClear={() => setFilters(emptyCatalogFilters())}
          />
        ) : null}

        {catalog.products.length === 0 ? (
          <EmptyState icon={<PackageSearch />} title={t.empty} />
        ) : visible.length === 0 ? (
          <EmptyState
            icon={<PackageSearch />}
            title={dict.catalog.noResults}
            hint={dict.catalog.noResultsHint}
          />
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {visible.map((product) => {
              const qty = cart.get(product.id) ?? 0;
              const soldOut = product.availability === "outOfStock";
              const category =
                categoryById.get(product.categoryId) ?? FALLBACK_CATEGORY;
              const manufacturer = manufacturerById.get(product.manufacturerId);
              return (
                <div
                  key={product.id}
                  className={cn(
                    "flex flex-col overflow-hidden rounded-card border bg-surface shadow-card transition-all",
                    qty > 0
                      ? "border-brand-500 ring-1 ring-brand-300"
                      : "border-line",
                  )}
                >
                  <ProductImage
                    product={product}
                    category={category}
                    className="aspect-[5/4] w-full sm:aspect-[4/3]"
                  />
                  <div className="flex flex-1 flex-col gap-0.5 px-3 pt-2.5">
                    <h3 className="line-clamp-2 text-[15px] font-bold leading-snug text-ink">
                      {productName(product, locale)}
                    </h3>
                    {manufacturer ? (
                      <p className="truncate text-[11px] font-semibold uppercase tracking-[0.04em] text-brand-700">
                        {manufacturer.name[locale]}
                      </p>
                    ) : null}
                    <p className="text-xs text-ink-muted">
                      {packageLabel(product, dict)}
                    </p>
                    <p className="mt-1.5 text-xl font-extrabold tracking-tight text-ink">
                      {formatCurrency(product.wholesalePrice, locale)}
                    </p>
                  </div>
                  <div className="px-3 pb-3 pt-2">
                    {qty > 0 ? (
                      <QuantityStepper
                        value={qty}
                        onChange={(next) => setQty(product.id, next)}
                        className="w-full justify-between border-brand-500 bg-brand-50"
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => setQty(product.id, 1)}
                        disabled={soldOut}
                        className={cn(
                          "flex h-11 w-full items-center justify-center gap-1.5 rounded-field text-sm font-bold transition-all",
                          soldOut
                            ? "cursor-not-allowed bg-surface-sunken text-ink-muted"
                            : "bg-brand-600 text-white shadow-sm hover:bg-brand-700 active:scale-[0.98]",
                        )}
                      >
                        {soldOut ? (
                          dict.availability.outOfStock
                        ) : (
                          <>
                            <Plus className="size-4" strokeWidth={3} aria-hidden />
                            {dict.catalog.addToCart}
                          </>
                        )}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Notes + disclaimer */}
        {lineCount > 0 ? (
          <div className="flex flex-col gap-3">
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={dict.cart.notesPlaceholder}
              maxLength={2000}
            />
            <p className="text-xs text-ink-soft">{t.vatNote}</p>
            <p className="text-xs text-ink-soft">{t.disclaimer}</p>
          </div>
        ) : null}

        {error ? (
          <p
            role="alert"
            className="rounded-field bg-danger-soft px-3 py-2 text-sm font-medium text-danger"
          >
            {t.error}
          </p>
        ) : null}
      </main>

      {/* Sticky order bar */}
      {lineCount > 0 ? (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 backdrop-blur">
          <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3 sm:px-6">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-xs text-ink-muted">
                <ShoppingCart className="size-3.5" aria-hidden />
                {dict.cart.title} · {formatNumber(lineCount, locale)}
              </p>
              <p className="text-lg font-extrabold tabular-nums text-ink">
                {formatCurrency(estimate, locale)}
              </p>
            </div>
            <Button
              size="lg"
              onClick={onSubmit}
              disabled={pending}
              className="ms-auto"
            >
              <ShoppingCart className="size-5" aria-hidden />
              {pending ? t.submitting : t.submit}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
