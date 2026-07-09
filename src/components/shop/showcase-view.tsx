"use client";

import { Eye, PackageSearch, Store } from "lucide-react";
import { useMemo, useState } from "react";
import { CatalogFilterBar } from "@/components/shop/catalog-filter-bar";
import { EmptyState } from "@/components/empty-state";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { ProductImage } from "@/components/product-image";
import { Button } from "@/components/ui/button";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/types";
import { packageLabel, productName } from "@/lib/catalog-helpers";
import {
  emptyCatalogFilters,
  filterAndSortProducts,
} from "@/lib/catalog-filter";
import type { ShowcaseCatalog } from "@/lib/data/catalog-showcase";
import { formatCurrency } from "@/lib/format";
import type { Category } from "@/lib/types";

const FALLBACK_CATEGORY: Category = {
  id: "misc",
  name: { ar: "", he: "", en: "" },
  icon: "📦",
  hue: 0,
};

/**
 * VIEW-ONLY product showcase (M7H.3). A prospective customer browses the
 * supplier's catalog (images, search, filters) but CANNOT order — there is no
 * cart, no checkout, no customer context. A CTA explains how to request a
 * store account (a private ordering link) from the supplier.
 */
export function ShowcaseView({
  locale,
  dict,
  catalog,
}: {
  locale: Locale;
  dict: Dictionary;
  catalog: ShowcaseCatalog;
}) {
  const t = dict.access.showcase;
  const [filters, setFilters] = useState(emptyCatalogFilters);
  const [showCta, setShowCta] = useState(false);

  const categoryById = useMemo(
    () => new Map(catalog.categories.map((c) => [c.id, c])),
    [catalog.categories],
  );
  const manufacturerById = useMemo(
    () => new Map(catalog.manufacturers.map((m) => [m.id, m])),
    [catalog.manufacturers],
  );
  const visible = useMemo(
    () =>
      filterAndSortProducts(catalog.products, filters, manufacturerById, locale),
    [catalog.products, filters, manufacturerById, locale],
  );

  const tenantName = catalog.tenantName[locale] || catalog.tenantName.he;

  return (
    <div className="min-h-dvh bg-surface-sunken pb-24">
      <header className="border-b border-line bg-surface-warm">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-4 sm:px-6">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-xs font-medium text-ink-muted">
              <Eye className="size-3.5" aria-hidden />
              {t.viewOnly}
            </p>
            <h1 className="truncate text-lg font-bold tracking-tight text-ink">
              {tenantName}
            </h1>
          </div>
          <div className="ms-auto">
            <LocaleSwitcher current={locale} />
          </div>
        </div>
        <div className="mx-auto max-w-5xl px-4 pb-3 sm:px-6">
          <p className="text-sm text-ink-soft">{t.intro}</p>
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
              const category =
                categoryById.get(product.categoryId) ?? FALLBACK_CATEGORY;
              const manufacturer = manufacturerById.get(product.manufacturerId);
              return (
                <div
                  key={product.id}
                  className="flex flex-col overflow-hidden rounded-card border border-line bg-surface shadow-card"
                >
                  <ProductImage
                    product={product}
                    category={category}
                    className="aspect-[5/4] w-full sm:aspect-[4/3]"
                  />
                  <div className="flex flex-1 flex-col gap-0.5 px-3 py-2.5">
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
                </div>
              );
            })}
          </div>
        )}

        {showCta ? (
          <div className="rounded-card border border-brand-300 bg-brand-50 p-4 text-sm text-ink">
            {t.requestAccessBody}
          </div>
        ) : null}
      </main>

      {/* Sticky "request store access" CTA — no cart/ordering here */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3 sm:px-6">
          <p className="hidden text-sm text-ink-soft sm:block">{t.ctaHint}</p>
          <Button
            size="lg"
            onClick={() => setShowCta((v) => !v)}
            className="ms-auto"
          >
            <Store className="size-5" aria-hidden />
            {t.requestAccess}
          </Button>
        </div>
      </div>
    </div>
  );
}
