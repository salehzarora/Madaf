"use client";

import {
  ArrowRight,
  PackageSearch,
  Search,
  Store,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CustomerPicker } from "@/components/customer-picker";
import { EmptyState } from "@/components/empty-state";
import { OrderPad } from "@/components/order-pad";
import { ProductCard } from "@/components/product-card";
import { Chip } from "@/components/ui/chip";
import { Input } from "@/components/ui/input";
import type { Locale } from "@/i18n/config";
import { interpolate } from "@/i18n/dictionaries";
import type { Dictionary } from "@/i18n/types";
import { categoryStyle } from "@/lib/category-style";
import { useCart } from "@/lib/cart-context";
import { formatCurrency } from "@/lib/format";
import { useShopData } from "@/lib/shop-data-context";
import { cn } from "@/lib/utils";

/**
 * The catalog experience, retail-first:
 * - wide layout (up to ~1720px) with a persistent order pad on xl+
 * - sticky search + filter zone on md+ (always at hand on tablets)
 * - category chips with per-category color identity
 * - prominent "ordering for shop" banner in sales-visit mode
 * - sticky bottom cart bar below xl
 */
export function CatalogView({
  locale,
  dict,
  initialCustomerId,
}: {
  locale: Locale;
  dict: Dictionary;
  initialCustomerId?: string;
}) {
  const { totalPackages, subtotal, hydrated, customerId, setCustomer } =
    useCart();
  const {
    products,
    categories,
    manufacturers,
    categoryById,
    manufacturerById,
    customerById,
  } = useShopData();
  const [query, setQuery] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [manufacturerIds, setManufacturerIds] = useState<Set<string>>(
    new Set(),
  );

  // Admin "Start order" deep-link: /catalog?customer=cXX.
  // Gated on `hydrated` so the localStorage hydration (which restores the
  // previously stored shop) cannot clobber the deep-linked one on hard loads.
  useEffect(() => {
    if (hydrated && initialCustomerId) setCustomer(initialCustomerId);
  }, [hydrated, initialCustomerId, setCustomer]);

  const selectedShop = customerId ? customerById.get(customerId) : undefined;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.filter((product) => {
      if (categoryId && product.categoryId !== categoryId) return false;
      if (
        manufacturerIds.size > 0 &&
        !manufacturerIds.has(product.manufacturerId)
      )
        return false;
      if (q) {
        const manufacturer = manufacturerById.get(product.manufacturerId);
        const haystack = [
          product.translations.he.name,
          product.translations.ar.name,
          product.translations.en.name,
          product.sku,
          manufacturer?.name.he,
          manufacturer?.name.ar,
          manufacturer?.name.en,
        ]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [query, categoryId, manufacturerIds, products, manufacturerById]);

  const hasFilters =
    query !== "" || categoryId !== null || manufacturerIds.size > 0;

  function toggleManufacturer(id: string) {
    setManufacturerIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="mx-auto w-full max-w-[1720px] px-4 pb-28 pt-5 sm:px-6 xl:pb-10">
      {/* Title row */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink">
            {dict.catalog.title}
          </h1>
          <p className="mt-0.5 text-sm text-ink-muted">
            {dict.catalog.subtitle}
          </p>
        </div>
        {/* Shop picker lives in the order pad on xl+ */}
        <CustomerPicker locale={locale} dict={dict} className="xl:hidden" />
      </div>

      {/* Sales-visit banner — loud and unmissable when a shop is selected */}
      {hydrated && selectedShop ? (
        <div className="mt-4 flex items-center gap-3 rounded-card border border-brand-300 bg-brand-50 px-4 py-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-field bg-brand-600 text-white">
            <Store className="size-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-brand-700">
              {dict.catalog.orderingFor}
            </p>
            <p className="truncate text-base font-bold text-brand-900">
              {selectedShop.name}
              <span className="ms-2 text-sm font-normal text-brand-700">
                {selectedShop.city[locale]}
              </span>
            </p>
          </div>
          <button
            type="button"
            onClick={() => setCustomer(null)}
            className="shrink-0 rounded-field px-3 py-2 text-xs font-semibold text-brand-700 transition-colors hover:bg-brand-100"
          >
            {dict.catalog.changeShop}
          </button>
        </div>
      ) : null}

      <div className="mt-4 xl:grid xl:grid-cols-[minmax(0,1fr)_330px] xl:items-start xl:gap-6">
        {/* ── Catalog column ── */}
        <div className="min-w-0">
          {/* Sticky search + filters (md+: always at hand while scrolling) */}
          <div className="z-30 -mx-4 bg-background/95 px-4 pb-2 pt-1 backdrop-blur-sm sm:-mx-6 sm:px-6 md:sticky md:top-16 xl:mx-0 xl:px-0">
            <div className="relative">
              <Search
                className="pointer-events-none absolute start-3.5 top-1/2 size-5 -translate-y-1/2 text-ink-muted"
                aria-hidden
              />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={dict.catalog.searchPlaceholder}
                className="h-13 border-line bg-surface ps-11 text-base shadow-card"
                aria-label={dict.common.search}
              />
              {query ? (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  aria-label={dict.common.clear}
                  className="absolute end-2.5 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink"
                >
                  <X className="size-4" />
                </button>
              ) : null}
            </div>

            {/* Category chips — color-coded, one tap */}
            <div className="scrollbar-none -mx-4 mt-2.5 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0">
              <button
                type="button"
                aria-pressed={categoryId === null}
                onClick={() => setCategoryId(null)}
                className={cn(
                  "inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full border px-4 text-sm font-semibold transition-colors",
                  categoryId === null
                    ? "border-ink bg-ink text-white shadow-sm"
                    : "border-line-strong bg-surface text-ink-soft hover:border-ink/40",
                )}
              >
                {dict.common.all}
              </button>
              {categories.map((category) => {
                const style = categoryStyle(category.id);
                const selected = categoryId === category.id;
                return (
                  <button
                    key={category.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() =>
                      setCategoryId((prev) =>
                        prev === category.id ? null : category.id,
                      )
                    }
                    className={cn(
                      "inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full border px-4 text-sm font-semibold shadow-sm transition-colors",
                      selected ? style.chipSelected : style.chipIdle,
                    )}
                  >
                    <span className="text-base" aria-hidden>
                      {category.icon}
                    </span>
                    {category.name[locale]}
                  </button>
                );
              })}
            </div>

            {/* Manufacturer chips */}
            <div className="scrollbar-none -mx-4 mt-2 flex items-center gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0">
              <span className="shrink-0 text-xs font-medium text-ink-muted">
                {dict.catalog.manufacturers}:
              </span>
              {manufacturers.map((manufacturer) => (
                <Chip
                  key={manufacturer.id}
                  selected={manufacturerIds.has(manufacturer.id)}
                  onClick={() => toggleManufacturer(manufacturer.id)}
                  className="h-9 gap-1.5 px-3 text-xs"
                >
                  {manufacturer.logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={manufacturer.logoUrl}
                      alt=""
                      className="-ms-0.5 size-4 rounded-full object-cover"
                    />
                  ) : null}
                  {manufacturer.name[locale]}
                </Chip>
              ))}
              {hasFilters ? (
                <button
                  type="button"
                  onClick={() => {
                    setQuery("");
                    setCategoryId(null);
                    setManufacturerIds(new Set());
                  }}
                  className="inline-flex h-9 shrink-0 items-center gap-1 rounded-full px-3 text-xs font-medium text-ink-muted transition-colors hover:text-danger"
                >
                  <X className="size-3.5" aria-hidden />
                  {dict.catalog.clearFilters}
                </button>
              ) : null}
            </div>
          </div>

          {/* Results */}
          <p className="mt-3 text-sm text-ink-muted">
            {interpolate(dict.catalog.resultsCount, { count: filtered.length })}
          </p>

          {filtered.length === 0 ? (
            <EmptyState
              className="mt-3"
              icon={<PackageSearch />}
              title={dict.catalog.noResults}
              hint={dict.catalog.noResultsHint}
            />
          ) : (
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-4 2xl:grid-cols-5">
              {filtered.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  category={categoryById.get(product.categoryId)!}
                  manufacturer={manufacturerById.get(product.manufacturerId)}
                  locale={locale}
                  dict={dict}
                />
              ))}
            </div>
          )}
        </div>

        {/* ── Order pad column (xl+) ── */}
        <div className="hidden xl:block">
          <OrderPad locale={locale} dict={dict} />
        </div>
      </div>

      {/* Sticky bottom cart bar (below xl — the order pad replaces it) */}
      {hydrated && totalPackages > 0 ? (
        <div className="print-hidden fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 backdrop-blur xl:hidden">
          <div className="mx-auto flex w-full max-w-[1720px] items-center justify-between gap-4 px-4 py-3 sm:px-6">
            <div className="min-w-0">
              <p className="text-xs text-ink-muted">
                {totalPackages} {dict.common.packages}
                {selectedShop ? (
                  <span className="ms-2 font-medium text-brand-700">
                    · {selectedShop.name}
                  </span>
                ) : null}
              </p>
              <p className="text-lg font-extrabold tracking-tight text-ink">
                {formatCurrency(subtotal, locale)}
              </p>
            </div>
            <Link
              href={`/${locale}/cart`}
              className="inline-flex h-12 shrink-0 items-center gap-2 rounded-field bg-brand-600 px-6 text-sm font-bold text-white shadow-sm transition-colors hover:bg-brand-700"
            >
              {dict.catalog.viewCart}
              <ArrowRight className="size-4 rtl:-scale-x-100" aria-hidden />
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
