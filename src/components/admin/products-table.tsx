"use client";

import { Download, PackageSearch, Pencil, PowerOff, Power, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
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
import { setProductActiveAction } from "@/lib/actions/products";
import { isLowStock, packageLabel, productName } from "@/lib/catalog-helpers";
import { downloadCsv, toCsv } from "@/lib/csv";
import { getDataMode } from "@/lib/data/mode";
import { formatCurrency } from "@/lib/format";
import { useShopData } from "@/lib/shop-data-context";
import type { InventoryItem, Product } from "@/lib/types";

/** Filtered-export ceiling (M8E.1). Products load fully client-side, so the
 * export already covers every filtered row; the cap + warning bound a very
 * large catalog defensively. */
const EXPORT_CAP = 5000;

/**
 * Admin products list — search + category filter. Products come from the
 * server page (data layer, includes inactive in Supabase mode). In
 * Supabase mode each row gains edit + activate/deactivate actions.
 */
export function ProductsTable({
  products,
  inventory = [],
  canExport = false,
  canManage = false,
  locale,
  dict,
}: {
  products: Product[];
  /** Stock rows for the export's quantity/low-stock columns (M8C). */
  inventory?: InventoryItem[];
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
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [manufacturerId, setManufacturerId] = useState<string>("");
  const [activeFilter, setActiveFilter] = useState<
    "all" | "active" | "inactive"
  >("all");
  const [exportNote, setExportNote] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.filter((product) => {
      if (categoryId && product.categoryId !== categoryId) return false;
      if (manufacturerId && product.manufacturerId !== manufacturerId) {
        return false;
      }
      if (activeFilter === "active" && product.isActive === false) return false;
      if (activeFilter === "inactive" && product.isActive !== false) {
        return false;
      }
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
  }, [
    products,
    manufacturerById,
    query,
    categoryId,
    manufacturerId,
    activeFilter,
    locale,
  ]);

  const inventoryByProduct = useMemo(
    () => new Map(inventory.map((i) => [i.productId, i])),
    [inventory],
  );

  function onExport() {
    // Admin-only file over the CURRENT filtered rows (tenant-scoped data
    // the admin already sees). Untracked products export empty stock cells.
    // Bounded by EXPORT_CAP — past it export the first CAP rows and warn (M8E.1).
    setExportNote(null);
    const capped = filtered.length > EXPORT_CAP;
    const rows = (capped ? filtered.slice(0, EXPORT_CAP) : filtered).map((product) => {
      const inv = inventoryByProduct.get(product.id);
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
        inv ? inv.stockPackages : "",
        inv ? (isLowStock(inv) ? "yes" : "no") : "",
      ];
    });
    const h = t.csv;
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
    if (capped) {
      setExportNote(interpolate(dict.common.exportCapped, { count: EXPORT_CAP }));
    }
  }

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
        <Select
          value={manufacturerId}
          onChange={(e) => setManufacturerId(e.target.value)}
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
            value={activeFilter}
            onChange={(e) =>
              setActiveFilter(e.target.value as "all" | "active" | "inactive")
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
            disabled={filtered.length === 0}
            title={
              filtered.length === 0 ? dict.common.exportEmpty : undefined
            }
            className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-field border border-line-strong px-4 text-sm font-semibold text-ink transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Download className="size-4" aria-hidden />
            {dict.common.exportCsv}
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
        <>
          <p className="font-mono text-[13px] tabular-nums text-ink-soft">
            {interpolate(dict.catalog.resultsCount, {
              count: filtered.length,
            })}
          </p>
          <Card className={"overflow-x-auto" + (pending ? " opacity-70" : "")}>
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
              {filtered.map((product) => {
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
                            disabled={pending}
                            onClick={() => toggleActive(product)}
                            className="inline-flex h-9 items-center gap-1.5 rounded-field border border-line-strong px-2.5 text-xs font-semibold text-ink-soft transition-colors hover:border-brand-300 hover:bg-surface-sunken focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
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
        </>
      )}
    </div>
  );
}
