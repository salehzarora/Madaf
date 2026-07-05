/**
 * Catalog data access — products, categories, manufacturers.
 *
 * M1: mock-backed (src/lib/mock/*). The M0 pages still import the mock
 * modules directly; they migrate to these functions in M2 so the switch to
 * Supabase happens here, in one file, without touching the UI.
 *
 * M2 mapping (see supabase/migrations/20260705100000_core_schema.sql):
 * - Product.translations.{ar,he,en}.name  ← products.name_ar/he/en
 * - Product.packageType                   ← products.package_unit
 * - Product.unitsPerPackage               ← products.package_quantity
 * - Product.baseUnit / unitSize           ← products.base_unit / unit_size
 * - Product.wholesalePrice                ← products.wholesale_price
 * - Product.availability                  ← DERIVED from inventory_items:
 *     quantity_available = 0                    → "outOfStock"
 *     quantity_available < low_stock_threshold  → "lowStock"
 *     otherwise                                 → "inStock"
 * - Category.hue ← categories.color_hue; Category.icon ← categories.icon
 */
import {
  categories,
  categoryById,
  manufacturerById,
  manufacturers,
  productById,
  products,
} from "@/lib/mock";
import type { Category, Manufacturer, Product } from "@/lib/types";

import { getDataMode, supabaseNotWiredYet } from "./mode";

export async function listProducts(): Promise<Product[]> {
  if (getDataMode() === "supabase") supabaseNotWiredYet("listProducts");
  return products;
}

export async function getProduct(id: string): Promise<Product | undefined> {
  if (getDataMode() === "supabase") supabaseNotWiredYet("getProduct");
  return productById.get(id);
}

export async function listCategories(): Promise<Category[]> {
  if (getDataMode() === "supabase") supabaseNotWiredYet("listCategories");
  return categories;
}

export async function getCategory(id: string): Promise<Category | undefined> {
  if (getDataMode() === "supabase") supabaseNotWiredYet("getCategory");
  return categoryById.get(id);
}

export async function listManufacturers(): Promise<Manufacturer[]> {
  if (getDataMode() === "supabase") supabaseNotWiredYet("listManufacturers");
  return manufacturers;
}

export async function getManufacturer(
  id: string,
): Promise<Manufacturer | undefined> {
  if (getDataMode() === "supabase") supabaseNotWiredYet("getManufacturer");
  return manufacturerById.get(id);
}
