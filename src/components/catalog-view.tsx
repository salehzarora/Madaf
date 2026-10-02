"use client";

import { PricingStatus } from "@/components/effective-price";
import { PackageSearch } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { CatalogHero, type CatalogSupplierIdentity } from "@/components/catalog-hero";
import { CatalogCartReview } from "@/components/catalog-cart-review";
import { CatalogToolbar, type CatalogSortKey } from "@/components/catalog-toolbar";
import { CustomerPicker } from "@/components/customer-picker";
import { EmptyState } from "@/components/empty-state";
import { OrderPad } from "@/components/order-pad";
import { ProductCard } from "@/components/product-card";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/types";
import { useCart } from "@/lib/cart-context";
import { productName } from "@/lib/catalog-helpers";
import { useShopData } from "@/lib/shop-data-context";
import type { Category } from "@/lib/types";

/** A missing category must not make its product unorderable. */
const FALLBACK_CATEGORY: Category = {
  id: "misc", name: { ar: "", he: "", en: "" }, icon: "📦", hue: 0,
};

/** One set of filters and one cart provider across all responsive layouts. */
export function CatalogView({ locale, dict, supplier, initialCustomerId }: {
  locale: Locale;
  dict: Dictionary;
  supplier: CatalogSupplierIdentity;
  initialCustomerId?: string;
}) {
  const { hydrated, setCustomer, priceOf, pricingReady } = useCart();
  const { products, categories, manufacturers, categoryById, manufacturerById } = useShopData();
  const [query, setQuery] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [sort, setSort] = useState<CatalogSortKey>("featured");
  const [manufacturerIds, setManufacturerIds] = useState<Set<string>>(new Set());

  // The admin deep link wins AFTER storage hydration; customer selection does
  // not clear lines or rotate the existing submission key.
  useEffect(() => {
    if (hydrated && initialCustomerId) setCustomer(initialCustomerId);
  }, [hydrated, initialCustomerId, setCustomer]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.filter((product) => {
      if (categoryId && product.categoryId !== categoryId) return false;
      if (manufacturerIds.size > 0 && !manufacturerIds.has(product.manufacturerId)) return false;
      if (q) {
        const manufacturer = manufacturerById.get(product.manufacturerId);
        const haystack = [
          product.translations.he.name, product.translations.ar.name, product.translations.en.name,
          product.sku, manufacturer?.name.he, manufacturer?.name.ar, manufacturer?.name.en,
        ].join(" ").toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [query, categoryId, manufacturerIds, products, manufacturerById]);

  const sorted = useMemo(() => {
    if (sort === "featured" || !pricingReady) return filtered;
    const copy = [...filtered];
    if (sort === "priceAsc") copy.sort((a, b) => (priceOf(a.id) ?? Infinity) - (priceOf(b.id) ?? Infinity));
    else if (sort === "priceDesc") copy.sort((a, b) => (priceOf(b.id) ?? -Infinity) - (priceOf(a.id) ?? -Infinity));
    else if (sort === "name") copy.sort((a, b) => productName(a, locale).localeCompare(productName(b, locale), locale));
    return copy;
  }, [filtered, sort, locale, priceOf, pricingReady]);

  const hasFilters = query !== "" || categoryId !== null || manufacturerIds.size > 0;
  function toggleManufacturer(id: string) {
    setManufacturerIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function clearFilters() {
    setQuery("");
    setCategoryId(null);
    setManufacturerIds(new Set());
  }

  return (
    <div className="catalog-workspace">
      <div className="catalog-main">
        <CatalogHero supplier={supplier} products={products} dict={dict} />
        <PricingStatus dict={dict} />
        <CatalogToolbar
          locale={locale} dict={dict} categories={categories} manufacturers={manufacturers}
          query={query} onQueryChange={setQuery}
          categoryId={categoryId} onCategoryChange={setCategoryId}
          manufacturerIds={manufacturerIds} onManufacturerToggle={toggleManufacturer}
          onManufacturersClear={() => setManufacturerIds(new Set())}
          sort={sort} onSortChange={setSort} resultCount={sorted.length}
          hasFilters={hasFilters} onClearFilters={clearFilters}
        >
          <div className="catalog-customer-mobile">
            <CustomerPicker locale={locale} dict={dict} />
          </div>
        </CatalogToolbar>
        {sorted.length === 0 ? (
          <div className="py-8">
            <EmptyState icon={<PackageSearch aria-hidden />} title={dict.catalog.noResults} hint={dict.catalog.noResultsHint} />
          </div>
        ) : (
          <div className="catalog-product-grid">
            {sorted.map((product) => (
              <ProductCard
                key={product.id} product={product}
                category={categoryById.get(product.categoryId) ?? FALLBACK_CATEGORY}
                manufacturer={manufacturerById.get(product.manufacturerId)}
                locale={locale} dict={dict}
              />
            ))}
          </div>
        )}
      </div>
      <div className="catalog-side-panel"><OrderPad locale={locale} dict={dict} /></div>
      <CatalogCartReview locale={locale} dict={dict} />
    </div>
  );
}
