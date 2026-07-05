"use client";

import { PackageSearch, Pencil, PowerOff, Power, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { AvailabilityBadge } from "@/components/availability-badge";
import { EmptyState } from "@/components/empty-state";
import { ProductImage } from "@/components/product-image";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { Input } from "@/components/ui/input";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/types";
import { setProductActiveAction } from "@/lib/actions/products";
import { packageLabel, productName } from "@/lib/catalog-helpers";
import { getDataMode } from "@/lib/data/mode";
import { formatCurrency } from "@/lib/format";
import { useShopData } from "@/lib/shop-data-context";
import type { Product } from "@/lib/types";

/**
 * Admin products list — search + category filter. Products come from the
 * server page (data layer, includes inactive in Supabase mode). In
 * Supabase mode each row gains edit + activate/deactivate actions.
 */
export function ProductsTable({
  products,
  locale,
  dict,
}: {
  products: Product[];
  locale: Locale;
  dict: Dictionary;
}) {
  const t = dict.admin.products;
  const { categories, categoryById, manufacturerById } = useShopData();
  const live = getDataMode() === "supabase";
  const router = useRouter();
  const [pending, startTransition] = useTransition();
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

  function toggleActive(product: Product) {
    startTransition(async () => {
      await setProductActiveAction({
        productId: product.id,
        isActive: !(product.isActive ?? true),
        locale,
      });
      router.refresh();
    });
  }

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
        <Card className={"overflow-x-auto" + (pending ? " opacity-70" : "")}>
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-line text-start text-xs uppercase tracking-wide text-ink-muted">
                <th className="px-4 py-3 text-start font-medium">{t.colProduct}</th>
                <th className="px-4 py-3 text-start font-medium">{t.colCategory}</th>
                <th className="px-4 py-3 text-start font-medium">{t.colManufacturer}</th>
                <th className="px-4 py-3 text-start font-medium">{t.colPackage}</th>
                <th className="px-4 py-3 text-end font-medium">{t.colPrice}</th>
                <th className="px-4 py-3 text-start font-medium">{t.colAvailability}</th>
                {live ? (
                  <th className="px-4 py-3 text-end font-medium">{t.colActions}</th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {filtered.map((product) => {
                const category = categoryById.get(product.categoryId)!;
                const manufacturer = manufacturerById.get(
                  product.manufacturerId,
                );
                const inactive = product.isActive === false;
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
                          <p className="flex items-center gap-2 truncate font-medium text-ink">
                            {productName(product, locale)}
                            {inactive ? (
                              <Badge tone="neutral">{t.inactiveBadge}</Badge>
                            ) : null}
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
                      {manufacturer?.name[locale] ?? "—"}
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
                    {live ? (
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <Link
                            href={`/${locale}/admin/products/${product.id}/edit`}
                            className="inline-flex h-9 items-center gap-1.5 rounded-field border border-line-strong px-2.5 text-xs font-semibold text-ink transition-colors hover:border-brand-300 hover:bg-brand-50"
                          >
                            <Pencil className="size-3.5" aria-hidden />
                            {t.edit}
                          </Link>
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() => toggleActive(product)}
                            className="inline-flex h-9 items-center gap-1.5 rounded-field border border-line-strong px-2.5 text-xs font-semibold text-ink-soft transition-colors hover:border-brand-300 hover:bg-surface-sunken"
                          >
                            {inactive ? (
                              <Power className="size-3.5" aria-hidden />
                            ) : (
                              <PowerOff className="size-3.5" aria-hidden />
                            )}
                            {inactive ? t.activate : t.deactivate}
                          </button>
                        </div>
                      </td>
                    ) : null}
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
