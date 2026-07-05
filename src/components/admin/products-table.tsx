"use client";

import { PackageSearch, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { AvailabilityBadge } from "@/components/availability-badge";
import { EmptyState } from "@/components/empty-state";
import { ProductImage } from "@/components/product-image";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { Input } from "@/components/ui/input";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/types";
import { packageLabel, productName } from "@/lib/catalog-helpers";
import { formatCurrency } from "@/lib/format";
import { useShopData } from "@/lib/shop-data-context";

/** Admin products list — search + category filter over the catalog. */
export function ProductsTable({
  locale,
  dict,
}: {
  locale: Locale;
  dict: Dictionary;
}) {
  const t = dict.admin.products;
  const { products, categories, categoryById, manufacturerById } =
    useShopData();
  const [query, setQuery] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.filter((product) => {
      if (categoryId && product.categoryId !== categoryId) return false;
      if (!q) return true;
      const manufacturer = manufacturerById.get(product.manufacturerId);
      return [
        product.translations.he.name,
        product.translations.ar.name,
        product.translations.en.name,
        product.sku,
        manufacturer?.name[locale],
      ]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [products, manufacturerById, query, categoryId, locale]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.searchPlaceholder}
            className="ps-9"
            aria-label={dict.common.search}
          />
        </div>
      </div>

      <div className="scrollbar-none -mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0">
        <Chip
          selected={categoryId === null}
          onClick={() => setCategoryId(null)}
          className="h-9 px-3 text-xs"
        >
          {dict.common.all}
        </Chip>
        {categories.map((category) => (
          <Chip
            key={category.id}
            selected={categoryId === category.id}
            onClick={() =>
              setCategoryId((prev) =>
                prev === category.id ? null : category.id,
              )
            }
            className="h-9 px-3 text-xs"
          >
            {category.name[locale]}
          </Chip>
        ))}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<PackageSearch />}
          title={dict.catalog.noResults}
          hint={dict.catalog.noResultsHint}
        />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-line text-start text-xs uppercase tracking-wide text-ink-muted">
                <th className="px-4 py-3 text-start font-medium">{t.colProduct}</th>
                <th className="px-4 py-3 text-start font-medium">{t.colCategory}</th>
                <th className="px-4 py-3 text-start font-medium">{t.colManufacturer}</th>
                <th className="px-4 py-3 text-start font-medium">{t.colPackage}</th>
                <th className="px-4 py-3 text-end font-medium">{t.colPrice}</th>
                <th className="px-4 py-3 text-start font-medium">{t.colAvailability}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((product) => {
                const category = categoryById.get(product.categoryId)!;
                const manufacturer = manufacturerById.get(
                  product.manufacturerId,
                )!;
                return (
                  <tr
                    key={product.id}
                    className="border-b border-line/60 transition-colors last:border-0 hover:bg-surface-sunken/50"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <ProductImage
                          product={product}
                          category={category}
                          className="size-10 shrink-0 rounded-field"
                          iconClassName="text-base"
                        />
                        <div className="min-w-0">
                          <p className="truncate font-medium text-ink">
                            {productName(product, locale)}
                          </p>
                          <p className="text-xs text-ink-muted" dir="ltr">
                            {product.sku}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-ink-soft">
                      {category.name[locale]}
                    </td>
                    <td className="px-4 py-3 text-ink-soft">
                      {manufacturer.name[locale]}
                    </td>
                    <td className="px-4 py-3 text-ink-soft">
                      {packageLabel(product, dict)}
                    </td>
                    <td className="px-4 py-3 text-end font-semibold tabular-nums text-ink">
                      {formatCurrency(product.wholesalePrice, locale)}
                    </td>
                    <td className="px-4 py-3">
                      <AvailabilityBadge
                        availability={product.availability}
                        dict={dict.availability}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
