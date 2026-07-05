/**
 * Catalog data access — products, categories, manufacturers.
 *
 * Mock mode (default): typed TS modules in src/lib/mock.
 * Supabase mode (M2, local dev): server-only reads in ./supabase-reads —
 * see the mapping notes there (name_ar/he/en → translations, package_unit
 * → packageType, availability DERIVED from inventory_items, …).
 *
 * Server components call these directly; client components receive the
 * results as props/context (never fetch themselves).
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

import { getDataMode } from "./mode";

export async function listProducts(): Promise<Product[]> {
  if (getDataMode() === "supabase") {
    return (await import("./supabase-reads")).sbListProducts();
  }
  return products;
}

export async function getProduct(id: string): Promise<Product | undefined> {
  if (getDataMode() === "supabase") {
    return (await import("./supabase-reads")).sbGetProduct(id);
  }
  return productById.get(id);
}

export async function listCategories(): Promise<Category[]> {
  if (getDataMode() === "supabase") {
    return (await import("./supabase-reads")).sbListCategories();
  }
  return categories;
}

export async function getCategory(id: string): Promise<Category | undefined> {
  if (getDataMode() === "supabase") {
    return (await import("./supabase-reads")).sbGetCategory(id);
  }
  return categoryById.get(id);
}

export async function listManufacturers(): Promise<Manufacturer[]> {
  if (getDataMode() === "supabase") {
    return (await import("./supabase-reads")).sbListManufacturers();
  }
  return manufacturers;
}

export async function getManufacturer(
  id: string,
): Promise<Manufacturer | undefined> {
  if (getDataMode() === "supabase") {
    return (await import("./supabase-reads")).sbGetManufacturer(id);
  }
  return manufacturerById.get(id);
}
