import type { Locale } from "@/i18n/config";
import { productName } from "@/lib/catalog-helpers";
import type { Manufacturer, Product } from "@/lib/types";

/** Shared catalog search/filter/sort — used by the admin catalog, the private
 * shop, and the product showcase so the buying/browsing UX is consistent. */
export type SortKey = "featured" | "priceAsc" | "priceDesc" | "name";

export interface CatalogFilterState {
  query: string;
  categoryId: string | null;
  manufacturerIds: Set<string>;
  inStockOnly: boolean;
  sort: SortKey;
}

export function emptyCatalogFilters(): CatalogFilterState {
  return {
    query: "",
    categoryId: null,
    manufacturerIds: new Set(),
    inStockOnly: false,
    sort: "featured",
  };
}

export function hasActiveFilters(f: CatalogFilterState): boolean {
  return (
    f.query.trim() !== "" ||
    f.categoryId !== null ||
    f.manufacturerIds.size > 0 ||
    f.inStockOnly
  );
}

export function filterAndSortProducts(
  products: Product[],
  f: CatalogFilterState,
  manufacturerById: Map<string, Manufacturer>,
  locale: Locale,
): Product[] {
  const q = f.query.trim().toLowerCase();
  const filtered = products.filter((product) => {
    if (f.categoryId && product.categoryId !== f.categoryId) return false;
    if (
      f.manufacturerIds.size > 0 &&
      !f.manufacturerIds.has(product.manufacturerId)
    ) {
      return false;
    }
    // "In stock" excludes only sold-out items (low stock still buyable).
    if (f.inStockOnly && product.availability === "outOfStock") return false;
    if (q) {
      const m = manufacturerById.get(product.manufacturerId);
      const haystack = [
        product.translations.he.name,
        product.translations.ar.name,
        product.translations.en.name,
        product.sku,
        m?.name.he,
        m?.name.ar,
        m?.name.en,
      ]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  if (f.sort === "featured") return filtered;
  const copy = [...filtered];
  if (f.sort === "priceAsc") {
    copy.sort((a, b) => a.wholesalePrice - b.wholesalePrice);
  } else if (f.sort === "priceDesc") {
    copy.sort((a, b) => b.wholesalePrice - a.wholesalePrice);
  } else if (f.sort === "name") {
    copy.sort((a, b) =>
      productName(a, locale).localeCompare(productName(b, locale), locale),
    );
  }
  return copy;
}
