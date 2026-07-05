"use client";

import { ArrowRight, PackageSearch, Search, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CustomerPicker } from "@/components/customer-picker";
import { EmptyState } from "@/components/empty-state";
import { ProductCard } from "@/components/product-card";
import { Chip } from "@/components/ui/chip";
import { Input } from "@/components/ui/input";
import type { Locale } from "@/i18n/config";
import { interpolate } from "@/i18n/dictionaries";
import type { Dictionary } from "@/i18n/types";
import { useCart } from "@/lib/cart-context";
import { formatCurrency } from "@/lib/format";
import {
  categories,
  categoryById,
  manufacturerById,
  manufacturers,
  products,
} from "@/lib/mock";

/**
 * The catalog experience: prominent search, category chips (single-select),
 * manufacturer chips (multi-select), responsive product grid and a sticky
 * cart summary bar. Client-side filtering over mock data.
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
  const { totalPackages, subtotal, hydrated, setCustomer } = useCart();
  const [query, setQuery] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [manufacturerIds, setManufacturerIds] = useState<Set<string>>(
    new Set(),
  );

  // Admin "Start order" deep-link: /catalog?customer=cXX
  useEffect(() => {
    if (initialCustomerId) setCustomer(initialCustomerId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCustomerId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.filter((product) => {
      if (categoryId && product.categoryId !== categoryId) return false;
      if (manufacturerIds.size > 0 && !manufacturerIds.has(product.manufacturerId))
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
  }, [query, categoryId, manufacturerIds]);

  const hasFilters = query !== "" || categoryId !== null || manufacturerIds.size > 0;

  function toggleManufacturer(id: string) {
    setManufacturerIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-28 pt-6 sm:px-6">
      {/* Header row */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink">
            {dict.catalog.title}
          </h1>
          <p className="mt-1 text-sm text-ink-muted">{dict.catalog.subtitle}</p>
        </div>
        <CustomerPicker locale={locale} dict={dict} />
      </div>

      {/* Search */}
      <div className="relative mt-5">
        <Search
          className="pointer-events-none absolute start-3.5 top-1/2 size-5 -translate-y-1/2 text-ink-muted"
          aria-hidden
        />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={dict.catalog.searchPlaceholder}
          className="h-13 ps-11 text-base shadow-card"
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

      {/* Category chips */}
      <div className="scrollbar-none -mx-4 mt-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
        <Chip selected={categoryId === null} onClick={() => setCategoryId(null)}>
          {dict.common.all}
        </Chip>
        {categories.map((category) => (
          <Chip
            key={category.id}
            selected={categoryId === category.id}
            onClick={() =>
              setCategoryId((prev) => (prev === category.id ? null : category.id))
            }
          >
            <span aria-hidden>{category.icon}</span>
            {category.name[locale]}
          </Chip>
        ))}
      </div>

      {/* Manufacturer chips */}
      <div className="scrollbar-none -mx-4 mt-2 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
        {manufacturers.map((manufacturer) => (
          <Chip
            key={manufacturer.id}
            selected={manufacturerIds.has(manufacturer.id)}
            onClick={() => toggleManufacturer(manufacturer.id)}
            className="h-9 px-3 text-xs"
          >
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

      {/* Results */}
      <p className="mt-5 text-sm text-ink-muted">
        {interpolate(dict.catalog.resultsCount, { count: filtered.length })}
      </p>

      {filtered.length === 0 ? (
        <EmptyState
          className="mt-4"
          icon={<PackageSearch />}
          title={dict.catalog.noResults}
          hint={dict.catalog.noResultsHint}
        />
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-4">
          {filtered.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              category={categoryById.get(product.categoryId)!}
              manufacturer={manufacturerById.get(product.manufacturerId)!}
              locale={locale}
              dict={dict}
            />
          ))}
        </div>
      )}

      {/* Sticky cart summary */}
      {hydrated && totalPackages > 0 ? (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 backdrop-blur print-hidden">
          <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
            <div className="min-w-0">
              <p className="text-xs text-ink-muted">
                {totalPackages} {dict.common.packages}
              </p>
              <p className="text-lg font-bold tracking-tight text-ink">
                {formatCurrency(subtotal, locale)}
                <span className="ms-1.5 text-xs font-normal text-ink-muted">
                  + {dict.docs.vatEstimate.split("—")[0].trim()}
                </span>
              </p>
            </div>
            <Link
              href={`/${locale}/cart`}
              className="inline-flex h-12 shrink-0 items-center gap-2 rounded-field bg-brand-600 px-6 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700"
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
