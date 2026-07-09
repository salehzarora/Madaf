"use client";

import { Search, X } from "lucide-react";
import { Chip } from "@/components/ui/chip";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/types";
import {
  hasActiveFilters,
  type CatalogFilterState,
  type SortKey,
} from "@/lib/catalog-filter";
import { categoryDot } from "@/lib/category-style";
import type { Category, Manufacturer } from "@/lib/types";

/** Shared search + category/manufacturer/in-stock filter + sort bar for the
 * private shop and the product showcase (mobile/RTL-friendly, sticky). */
export function CatalogFilterBar({
  locale,
  dict,
  categories,
  manufacturers,
  filters,
  onChange,
  onClear,
}: {
  locale: Locale;
  dict: Dictionary;
  categories: Category[];
  manufacturers: Manufacturer[];
  filters: CatalogFilterState;
  onChange: (next: CatalogFilterState) => void;
  onClear: () => void;
}) {
  const t = dict.catalog;

  function toggleManufacturer(id: string) {
    const next = new Set(filters.manufacturerIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange({ ...filters, manufacturerIds: next });
  }

  return (
    <div className="sticky top-0 z-20 -mx-4 flex flex-col gap-2.5 border-b border-line bg-surface-warm/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-card sm:border">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted"
            aria-hidden
          />
          <Input
            type="search"
            value={filters.query}
            onChange={(e) => onChange({ ...filters, query: e.target.value })}
            placeholder={t.searchPlaceholder}
            aria-label={dict.common.search}
            className="ps-9"
          />
        </div>
        <Select
          value={filters.sort}
          onChange={(e) =>
            onChange({ ...filters, sort: e.target.value as SortKey })
          }
          aria-label={t.sort}
          className="w-auto shrink-0"
        >
          <option value="featured">{t.sortFeatured}</option>
          <option value="priceAsc">{t.sortPriceAsc}</option>
          <option value="priceDesc">{t.sortPriceDesc}</option>
          <option value="name">{t.sortName}</option>
        </Select>
      </div>

      {/* Categories */}
      <div className="scrollbar-none -mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0">
        <Chip
          selected={filters.categoryId === null}
          onClick={() => onChange({ ...filters, categoryId: null })}
          className="h-8 shrink-0 px-3 text-xs"
        >
          {dict.common.all}
        </Chip>
        {categories.map((category) => (
          <Chip
            key={category.id}
            selected={filters.categoryId === category.id}
            onClick={() =>
              onChange({
                ...filters,
                categoryId:
                  filters.categoryId === category.id ? null : category.id,
              })
            }
            className="h-8 shrink-0 gap-1.5 px-3 text-xs"
          >
            <span
              className="size-2 rounded-[3px]"
              style={{ backgroundColor: categoryDot(category.id) }}
              aria-hidden
            />
            {category.name[locale]}
          </Chip>
        ))}
      </div>

      {/* Manufacturers (if any) + in-stock + clear */}
      <div className="scrollbar-none -mx-4 flex items-center gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0">
        {manufacturers.map((manufacturer) => (
          <Chip
            key={manufacturer.id}
            selected={filters.manufacturerIds.has(manufacturer.id)}
            onClick={() => toggleManufacturer(manufacturer.id)}
            className="h-8 shrink-0 px-3 text-xs"
          >
            {manufacturer.name[locale]}
          </Chip>
        ))}
        <Chip
          selected={filters.inStockOnly}
          onClick={() =>
            onChange({ ...filters, inStockOnly: !filters.inStockOnly })
          }
          className="h-8 shrink-0 px-3 text-xs"
        >
          {dict.availability.inStock}
        </Chip>
        {hasActiveFilters(filters) ? (
          <button
            type="button"
            onClick={onClear}
            className="inline-flex h-8 shrink-0 items-center gap-1 rounded-field px-2.5 text-xs font-medium text-ink-soft transition-colors hover:bg-surface-sunken focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
          >
            <X className="size-3.5" aria-hidden />
            {dict.common.clear}
          </button>
        ) : null}
      </div>
    </div>
  );
}
