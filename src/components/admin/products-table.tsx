"use client";

import {
  ChevronLeft,
  ChevronRight,
  Download,
  PackageSearch,
  Pencil,
  Power,
  PowerOff,
  Search,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useOptimistic, useState, useTransition } from "react";
import { AvailabilityBadge } from "@/components/availability-badge";
import { EmptyState } from "@/components/empty-state";
import { ProductImage } from "@/components/product-image";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { Input, Select } from "@/components/ui/input";
import type { Locale } from "@/i18n/config";
import { interpolate } from "@/i18n/dictionaries";
import type { Dictionary } from "@/i18n/types";
import { exportProductsAction, setProductActiveAction } from "@/lib/actions/products";
import { packageLabel, productName } from "@/lib/catalog-helpers";
import { downloadCsv, toCsv } from "@/lib/csv";
import { getDataMode } from "@/lib/data/mode";
import { formatCurrency, formatNumber } from "@/lib/format";
import {
  hasActiveProductFilters,
  PRODUCTS_EXPORT_CAP,
  productsQueryToParams,
  withProductFilterChange,
  type ProductsListResult,
  type ProductsQuery,
  type ProductStatusFacet,
} from "@/lib/products-query";
import { useShopData } from "@/lib/shop-data-context";
import type { Product } from "@/lib/types";

/**
 * Admin products list (M8F.2) — SERVER-PAGINATED and URL-controlled. The page
 * fetches only the current page + the exact filtered total; every filter/page
 * change navigates (updates the URL) so the list is shareable and back/forward
 * restores it. Search covers product name (ar/he/en) / SKU / barcode; category,
 * manufacturer and status are filters. Export (owner/admin) pulls ALL filtered
 * rows (up to the cap) via a server action, not just the visible page, and the
 * CSV carries no image data. Category/manufacturer NAMES are resolved from the
 * bounded reference lists (useShopData) — no full product collection is shipped.
 */
export function ProductsTable({
  result,
  query,
  canExport = false,
  canManage = false,
  locale,
  dict,
}: {
  result: ProductsListResult;
  query: ProductsQuery;
  /** Owner/admin (or mock demo) — shows the CSV export button. */
  canExport?: boolean;
  /** Owner/admin (or mock demo) — shows edit + activate/deactivate (M8D). */
  canManage?: boolean;
  locale: Locale;
  dict: Dictionary;
}) {
  const t = dict.admin.products;
  const { categories, categoryById, manufacturerById, manufacturers } =
    useShopData();
  const live = getDataMode() === "supabase";
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isExporting, startExport] = useTransition();
  const [isToggling, startToggle] = useTransition();
  const [exportNote, setExportNote] = useState<string | null>(null);

  // Optimistic filter state: reflects the LATEST intended query while a
  // navigation is pending, so every change composes against it (not the stale
  // server `query` prop). Two quick changes both land; it resets to the server
  // query when navigation settles (and on back/forward). The URL stays the
  // single source of truth after settle.
  const [optimisticQuery, setOptimisticQuery] = useOptimistic(
    query,
    (_current, next: ProductsQuery) => next,
  );

  // Page/rows/count come from the SERVER result (result.page is the clamped
  // page); the FILTER controls render + compose against optimisticQuery.
  const { products, total, page, totalPages } = result;

  /** Push a new query + optimistically apply it. Filter helpers reset page to 1
   * (withProductFilterChange); pagination keeps the (optimistic) filters. */
  function navigate(next: ProductsQuery) {
    const qs = productsQueryToParams(next).toString();
    startTransition(() => {
      setOptimisticQuery(next);
      router.push(`/${locale}/admin/products${qs ? `?${qs}` : ""}`);
    });
  }
  const applyFilter = (patch: Partial<ProductsQuery>) =>
    navigate(withProductFilterChange(optimisticQuery, patch));
  const goToPage = (p: number) => navigate({ ...optimisticQuery, page: p });

  function onSearchSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const term = String(new FormData(e.currentTarget).get("q") ?? "").trim();
    applyFilter({ search: term });
  }

  function onExport() {
    setExportNote(null);
    startExport(async () => {
      const res = await exportProductsAction({
        q: optimisticQuery.search || undefined,
        category: optimisticQuery.categoryId ?? undefined,
        manufacturer: optimisticQuery.manufacturerId ?? undefined,
        status: optimisticQuery.status !== "all" ? optimisticQuery.status : undefined,
      });
      if (!res.ok || !res.rows) {
        setExportNote(dict.common.actionError);
        return;
      }
      const h = t.csv;
      const rows = res.rows.map(({ product, stockPackages, isLowStock }) => {
        const category = categoryById.get(product.categoryId);
        const manufacturer = manufacturerById.get(product.manufacturerId);
        return [
          productName(product, locale),
          product.sku,
          product.barcode ?? "",
          category?.name[locale] ?? "",
          manufacturer?.name[locale] ?? "",
          product.wholesalePrice.toFixed(2),
          product.isActive === false ? "inactive" : "active",
          stockPackages ?? "",
          isLowStock === null ? "" : isLowStock ? "yes" : "no",
        ];
      });
      const csv = toCsv(
        [
          h.name,
          h.sku,
          h.barcode,
          h.category,
          h.manufacturer,
          h.price,
          h.status,
          h.stock,
          h.lowStock,
        ],
        rows,
      );
      downloadCsv(
        `madaf-products-${new Date().toISOString().slice(0, 10)}.csv`,
        csv,
      );
      if (res.capped) {
        setExportNote(interpolate(dict.common.exportCapped, { count: PRODUCTS_EXPORT_CAP }));
      }
    });
  }

  function toggleActive(product: Product) {
    startToggle(async () => {
      await setProductActiveAction({
        productId: product.id,
        isActive: !(product.isActive ?? true),
        locale,
      });
      router.refresh();
    });
  }

  const filtersActive = hasActiveProductFilters(optimisticQuery);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <form onSubmit={onSearchSubmit} className="relative flex-1">
          <Search
            className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted"
            aria-hidden
          />
          {/* Uncontrolled: `key` re-seeds it from the URL on navigation/clear;
              submitting (Enter) navigates with the new term (URL is truth). */}
          <Input
            key={optimisticQuery.search}
            type="search"
            name="q"
            defaultValue={optimisticQuery.search}
            placeholder={t.searchPlaceholder}
            className="ps-9"
            aria-label={dict.common.search}
          />
        </form>
        <Select
          value={optimisticQuery.manufacturerId ?? ""}
          onChange={(e) => applyFilter({ manufacturerId: e.target.value || null })}
          aria-label={dict.catalog.manufacturers}
          className="sm:w-48"
        >
          <option value="">{dict.catalog.manufacturers}</option>
          {manufacturers.map((manufacturer) => (
            <option key={manufacturer.id} value={manufacturer.id}>
              {manufacturer.name[locale]}
            </option>
          ))}
        </Select>
        {live ? (
          <Select
            value={optimisticQuery.status}
            onChange={(e) =>
              applyFilter({ status: e.target.value as ProductStatusFacet })
            }
            aria-label={t.filterStatus}
            className="sm:w-40"
          >
            <option value="all">{t.filterStatus}</option>
            <option value="active">{t.statusActive}</option>
            <option value="inactive">{t.inactiveBadge}</option>
          </Select>
        ) : null}
        {canExport ? (
          <button
            type="button"
            onClick={onExport}
            disabled={isExporting || total === 0}
            title={total === 0 ? dict.common.exportEmpty : undefined}
            className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-field border border-line-strong px-4 text-sm font-semibold text-ink transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Download className="size-4" aria-hidden />
            {isExporting ? dict.common.exporting : dict.common.exportCsv}
          </button>
        ) : null}
      </div>

      {exportNote ? (
        <p
          role="status"
          className="rounded-field bg-warning-soft px-3 py-2 text-[13px] font-medium text-warning"
        >
          {exportNote}
        </p>
      ) : null}

      <div className="scrollbar-none -mx-4 flex items-center gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0">
        <Chip
          selected={optimisticQuery.categoryId === null}
          onClick={() => applyFilter({ categoryId: null })}
          className="h-9 px-3 text-xs"
        >
          {dict.common.all}
        </Chip>
        {categories.map((category) => (
          <Chip
            key={category.id}
            selected={optimisticQuery.categoryId === category.id}
            onClick={() =>
              applyFilter({
                categoryId:
                  optimisticQuery.categoryId === category.id ? null : category.id,
              })
            }
            className="h-9 px-3 text-xs"
          >
            {category.name[locale]}
          </Chip>
        ))}
        {filtersActive ? (
          <button
            type="button"
            onClick={() =>
              navigate(
                withProductFilterChange(optimisticQuery, {
                  search: "",
                  categoryId: null,
                  manufacturerId: null,
                  status: "all",
                }),
              )
            }
            className="ms-1 inline-flex h-9 shrink-0 items-center gap-1 rounded-field px-3 text-xs font-semibold text-ink-muted transition-colors hover:bg-surface-sunken hover:text-danger focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
          >
            <X className="size-3.5" aria-hidden />
            {t.clearFilters}
          </button>
        ) : null}
      </div>

      {/* Result count — ABOVE the empty/rows branch so a filter that yields
          zero products still announces "0 products" to screen readers. */}
      <p
        className="font-mono text-[13px] tabular-nums text-ink-soft"
        aria-live="polite"
      >
        {interpolate(dict.catalog.resultsCount, {
          count: formatNumber(total, locale),
        })}
      </p>

      {products.length === 0 ? (
        <EmptyState
          icon={<PackageSearch />}
          title={dict.catalog.noResults}
          hint={dict.catalog.noResultsHint}
        />
      ) : (
        <>
          <Card className={"overflow-x-auto" + (isPending ? " opacity-70 transition-opacity" : "")}>
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-warm text-[11px] font-bold uppercase tracking-[0.06em] text-ink-muted">
                  <th className="px-4 py-3 text-start">{t.colProduct}</th>
                  <th className="px-4 py-3 text-start">{t.colCategory}</th>
                  <th className="px-4 py-3 text-start">{t.colManufacturer}</th>
                  <th className="px-4 py-3 text-start">{t.colPackage}</th>
                  <th className="px-4 py-3 text-end">{t.colPrice}</th>
                  <th className="px-4 py-3 text-start">{t.colAvailability}</th>
                  {canManage ? (
                    <th className="px-4 py-3 text-end">{t.colActions}</th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {products.map((product) => {
                  // May be undefined (missing category row) — ProductImage
                  // tolerates it; never crash the table (M8A).
                  const category = categoryById.get(product.categoryId);
                  const manufacturer = manufacturerById.get(
                    product.manufacturerId,
                  );
                  const inactive = product.isActive === false;
                  return (
                    <tr
                      key={product.id}
                      className="border-b border-line-hair transition-colors last:border-0 hover:bg-surface-warm"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <ProductImage
                            product={product}
                            category={category}
                            className="size-10 shrink-0 rounded-field"
                            iconClassName="size-5"
                            showSizeTag={false}
                          />
                          <div className="min-w-0">
                            <p className="flex items-center gap-2 truncate font-medium text-ink">
                              {productName(product, locale)}
                              {inactive ? (
                                <Badge tone="neutral">{t.inactiveBadge}</Badge>
                              ) : null}
                            </p>
                            <p
                              className="font-mono text-[13px] text-ink-soft"
                              dir="ltr"
                            >
                              {product.sku}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-ink-soft">
                        {category?.name[locale] ?? "—"}
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
                      {canManage ? (
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            <Link
                              href={`/${locale}/admin/products/${product.id}/edit`}
                              className="inline-flex h-9 items-center gap-1.5 rounded-field border border-line-strong px-2.5 text-xs font-semibold text-ink transition-colors hover:border-brand-300 hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
                            >
                              <Pencil className="size-3.5" aria-hidden />
                              {t.edit}
                            </Link>
                            <button
                              type="button"
                              disabled={isToggling}
                              onClick={() => toggleActive(product)}
                              className="inline-flex h-9 items-center gap-1.5 rounded-field border border-line-strong px-2.5 text-xs font-semibold text-ink-soft transition-colors hover:border-brand-300 hover:bg-surface-sunken focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
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

          {totalPages > 1 ? (
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => goToPage(page - 1)}
                disabled={page <= 1 || isPending}
                className="inline-flex h-10 items-center gap-1 rounded-field border border-line-strong px-3 text-sm font-semibold text-ink transition-colors hover:border-brand-300 hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronLeft className="size-4 rtl:-scale-x-100" aria-hidden />
                {t.prevPage}
              </button>
              <span className="text-xs font-medium tabular-nums text-ink-muted">
                {interpolate(t.pageLabel, { page, pages: totalPages })}
              </span>
              <button
                type="button"
                onClick={() => goToPage(page + 1)}
                disabled={page >= totalPages || isPending}
                className="inline-flex h-10 items-center gap-1 rounded-field border border-line-strong px-3 text-sm font-semibold text-ink transition-colors hover:border-brand-300 hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {t.nextPage}
                <ChevronRight className="size-4 rtl:-scale-x-100" aria-hidden />
              </button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
