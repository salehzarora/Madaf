"use client";

import {
  Archive,
  ChevronDown,
  Coffee,
  Cookie,
  Grid2X2,
  Milk,
  Package,
  Search,
  SlidersHorizontal,
  Sparkles,
  Wine,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { Chip } from "@/components/ui/chip";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { Locale } from "@/i18n/config";
import { interpolate } from "@/i18n/dictionaries";
import type { Dictionary } from "@/i18n/types";
import type { SortKey } from "@/lib/catalog-filter";
import type { Category, Manufacturer } from "@/lib/types";
import { cn } from "@/lib/utils";

export type CatalogSortKey = SortKey;

// Category semantics come from its stored pictogram, never demo category IDs.
const categoryIcons: Record<string, LucideIcon> = {
  "🥤": Wine,
  "🥨": Cookie,
  "☕": Coffee,
  "🥫": Archive,
  "🥛": Milk,
  "🧼": Sparkles,
};

const categoryButton =
  "catalog-category-button inline-flex min-h-11 shrink-0 items-center gap-2 rounded-field border px-3 py-2 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600";

export function CatalogToolbar({
  locale,
  dict,
  categories,
  manufacturers,
  query,
  onQueryChange,
  categoryId,
  onCategoryChange,
  manufacturerIds,
  onManufacturerToggle,
  onManufacturersClear,
  sort,
  onSortChange,
  resultCount,
  hasFilters,
  onClearFilters,
  children,
}: {
  locale: Locale;
  dict: Dictionary;
  categories: Category[];
  manufacturers: Manufacturer[];
  query: string;
  onQueryChange: (query: string) => void;
  categoryId: string | null;
  onCategoryChange: (id: string | null) => void;
  manufacturerIds: Set<string>;
  onManufacturerToggle: (id: string) => void;
  onManufacturersClear: () => void;
  sort: CatalogSortKey;
  onSortChange: (sort: CatalogSortKey) => void;
  resultCount: number;
  hasFilters: boolean;
  onClearFilters: () => void;
  children?: ReactNode;
}) {
  const t = dict.catalog;
  const disclosureRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    function closeOutside(event: PointerEvent) {
      const disclosure = disclosureRef.current;
      if (disclosure?.open && event.target instanceof Node && !disclosure.contains(event.target)) {
        disclosure.open = false;
      }
    }
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, []);

  return (
    <>
      <div className="catalog-discovery">
        {children}
        <div className="catalog-search relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute start-4 top-1/2 size-5 -translate-y-1/2 text-brand-700" aria-hidden />
          <Input
            type="search"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder={t.searchPlaceholder}
            aria-label={dict.common.search}
            className="h-12 border-line bg-surface pe-12 ps-12 text-base shadow-card"
          />
          {query ? (
            <button
              type="button"
              onClick={() => onQueryChange("")}
              aria-label={dict.common.clear}
              className="absolute end-0.5 top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-field text-ink-soft transition-colors hover:bg-surface-sunken focus-visible:outline-2 focus-visible:outline-brand-600"
            >
              <X className="size-4" aria-hidden />
            </button>
          ) : null}
        </div>
      </div>

      <div className="catalog-category-rail scrollbar-none flex gap-2 overflow-x-auto py-3" role="group" aria-label={t.categories}>
        <button
          type="button"
          aria-pressed={categoryId === null}
          onClick={() => onCategoryChange(null)}
          className={cn(categoryButton, categoryId === null ? "border-band bg-band text-band-ink" : "border-line bg-surface text-ink-soft hover:border-brand-600")}
        >
          <Grid2X2 className="size-5 shrink-0" aria-hidden />
          {dict.common.all}
        </button>
        {categories.map((category) => {
          const selected = categoryId === category.id;
          const Icon = categoryIcons[category.icon.replace(/\uFE0F/g, "")] ?? Package;
          return (
            <button
              key={category.id}
              type="button"
              aria-pressed={selected}
              onClick={() => onCategoryChange(selected ? null : category.id)}
              className={cn(categoryButton, selected ? "border-brand-600 bg-brand-50 text-brand-800" : "border-line bg-surface text-ink-soft hover:border-brand-600")}
            >
              <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-badge", selected ? "bg-brand-100 text-brand-800" : "bg-surface-warm text-brand-700")}>
                <Icon className="size-5" aria-hidden />
              </span>
              {category.name[locale]}
            </button>
          );
        })}
      </div>

      <div className="catalog-toolbar-meta relative flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line pb-3">
        <p className="me-auto text-xs font-semibold text-ink-soft" role="status">
          {interpolate(t.resultsCount, { count: resultCount })}
        </p>
        {manufacturers.length > 0 ? (
          <div className="flex min-w-0 items-center gap-1.5">
            <details
              ref={disclosureRef}
              className="catalog-manufacturer-disclosure group"
              onKeyDown={(event) => {
                if (event.key === "Escape" && event.currentTarget.open) {
                  event.preventDefault();
                  event.currentTarget.open = false;
                  event.currentTarget.querySelector("summary")?.focus();
                }
              }}
            >
              <summary className={cn("flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-field border px-3 py-2 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 [&::-webkit-details-marker]:hidden", manufacturerIds.size > 0 ? "border-brand-600 bg-brand-50 text-brand-800" : "border-line-strong bg-surface text-ink-soft hover:border-brand-600")}>
                <SlidersHorizontal className="size-4 shrink-0" aria-hidden />
                <span className="hidden sm:inline">{t.manufacturers}</span>
                <span className="sm:hidden">{dict.common.filters}</span>
                {manufacturerIds.size > 0 ? (
                  <span dir="ltr" className="flex min-w-5 items-center justify-center rounded-badge bg-brand-600 px-1 font-mono text-[11px] text-white">
                    {manufacturerIds.size}
                  </span>
                ) : null}
                <ChevronDown className="size-3.5 shrink-0 group-open:rotate-180" aria-hidden />
              </summary>
              <div className="catalog-manufacturer-options absolute end-0 top-full z-40 mt-2 max-h-64 w-72 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-card border border-line bg-surface p-3 shadow-float" role="group" aria-label={t.manufacturers}>
                <div className="flex flex-wrap gap-2">
                  {manufacturers.map((manufacturer) => (
                    <Chip
                      key={manufacturer.id}
                      selected={manufacturerIds.has(manufacturer.id)}
                      onClick={() => onManufacturerToggle(manufacturer.id)}
                      className="min-h-11 max-w-full gap-2 px-3 text-xs"
                    >
                      {manufacturer.logoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={manufacturer.logoUrl} alt="" className="size-5 shrink-0 rounded-full object-contain" />
                      ) : null}
                      <span className="min-w-0 whitespace-normal break-words text-start">{manufacturer.name[locale]}</span>
                    </Chip>
                  ))}
                </div>
              </div>
            </details>
            {manufacturerIds.size > 0 ? (
              <button
                type="button"
                onClick={onManufacturersClear}
                aria-label={`${dict.common.clear}: ${t.manufacturers}`}
                className="flex size-11 shrink-0 items-center justify-center rounded-field text-brand-700 transition-colors hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-brand-600"
              >
                <X className="size-4" aria-hidden />
              </button>
            ) : null}
          </div>
        ) : null}
        <label className="catalog-sort flex min-w-0 items-center gap-2">
          <span className="sr-only">{t.sort}</span>
          <Select
            value={sort}
            onChange={(event) => onSortChange(event.target.value as CatalogSortKey)}
            aria-label={t.sort}
            className="h-11 max-w-full text-xs"
          >
            <option value="featured">{t.sortFeatured}</option>
            <option value="priceAsc">{t.sortPriceAsc}</option>
            <option value="priceDesc">{t.sortPriceDesc}</option>
            <option value="name">{t.sortName}</option>
          </Select>
        </label>
        {hasFilters ? (
          <button
            type="button"
            onClick={onClearFilters}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-field px-2 text-xs font-semibold text-brand-700 transition-colors hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-brand-600"
          >
            <X className="size-3.5" aria-hidden />
            {t.clearFilters}
          </button>
        ) : null}
      </div>
    </>
  );
}
