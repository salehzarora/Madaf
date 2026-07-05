/**
 * Pure domain/display helpers — backend-agnostic.
 *
 * These operate on the UI domain types (src/lib/types.ts) regardless of
 * whether the data came from src/lib/mock or Supabase, so both client and
 * server components may import them freely. Moved out of src/lib/mock in
 * M2 (the mock barrel re-exports them for backward compatibility).
 */
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/types";
import type { InventoryItem, Order, Product } from "@/lib/types";

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

export function orderSubtotal(order: Order): number {
  return order.items.reduce(
    (sum, item) => sum + item.quantity * item.unitPrice,
    0,
  );
}

export function orderLineCount(order: Order): number {
  return order.items.length;
}

/**
 * Threshold (in packages) under which stock counts as "low".
 * The database stores a per-row inventory_items.low_stock_threshold; the
 * UI type doesn't carry it yet, so the demo constant (which the seed also
 * uses) stays authoritative until the M3+ inventory write path.
 */
export const LOW_STOCK_THRESHOLD = 10;

export function isLowStock(item: InventoryItem): boolean {
  return item.stockPackages < LOW_STOCK_THRESHOLD;
}
