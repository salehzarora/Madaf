/**
 * Mock data barrel + small cross-entity helpers.
 * Everything here is demo data — see docs/MVP_SCOPE.md for boundaries.
 */
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/types";
import type { Product } from "@/lib/types";

export { supplier } from "./supplier";
export { categories, categoryById } from "./categories";
export { manufacturers, manufacturerById } from "./manufacturers";
export { products, productById } from "./products";
export { customers, customerById } from "./customers";
export {
  orders,
  orderById,
  orderSubtotal,
  orderLineCount,
} from "./orders";
export {
  inventory,
  inventoryByProductId,
  isLowStock,
  expiringSoon,
  LOW_STOCK_THRESHOLD,
} from "./inventory";
export { documents, documentById } from "./documents";

/** Localized product name with a safe fallback chain (locale → he → en). */
export function productName(product: Product, locale: Locale): string {
  return (
    product.translations[locale]?.name ??
    product.translations.he?.name ??
    product.translations.en.name
  );
}

/** "Carton · 24 cans · 330ml" in the current language. */
export function packageLabel(product: Product, dict: Dictionary): string {
  const packaging = dict.packaging[product.packageType];
  if (product.packageType === "unit" && product.unitsPerPackage === 1) {
    return product.unitSize
      ? `${packaging} · ${product.unitSize}`
      : packaging;
  }
  const units = `${product.unitsPerPackage} ${dict.units[product.baseUnit]}`;
  return product.unitSize
    ? `${packaging} · ${units} · ${product.unitSize}`
    : `${packaging} · ${units}`;
}
