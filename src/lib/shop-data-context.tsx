"use client";

/**
 * Client-side catalog reference data — hydrated ONCE by the server root
 * layout from the data layer (src/lib/data) and shared with every client
 * component that used to import src/lib/mock directly (cart, pickers,
 * order pad, catalog filters, document preview).
 *
 * This is READ-ONLY reference data for the session. Client components
 * never fetch: the server decides the data source (mock vs Supabase), so
 * no Supabase client or key ever reaches the browser. Page-specific data
 * (orders, inventory, documents) is NOT here — server pages pass it as
 * props.
 */
import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { Category, Customer, Manufacturer, Product } from "@/lib/types";

interface ShopDataValue {
  products: Product[];
  categories: Category[];
  manufacturers: Manufacturer[];
  customers: Customer[];
  productById: Map<string, Product>;
  categoryById: Map<string, Category>;
  manufacturerById: Map<string, Manufacturer>;
  customerById: Map<string, Customer>;
}

const ShopDataContext = createContext<ShopDataValue | null>(null);

export function ShopDataProvider({
  products,
  categories,
  manufacturers,
  customers,
  children,
}: {
  products: Product[];
  categories: Category[];
  manufacturers: Manufacturer[];
  customers: Customer[];
  children: ReactNode;
}) {
  const value = useMemo<ShopDataValue>(
    () => ({
      products,
      categories,
      manufacturers,
      customers,
      productById: new Map(products.map((p) => [p.id, p])),
      categoryById: new Map(categories.map((c) => [c.id, c])),
      manufacturerById: new Map(manufacturers.map((m) => [m.id, m])),
      customerById: new Map(customers.map((c) => [c.id, c])),
    }),
    [products, categories, manufacturers, customers],
  );

  return (
    <ShopDataContext.Provider value={value}>
      {children}
    </ShopDataContext.Provider>
  );
}

export function useShopData(): ShopDataValue {
  const ctx = useContext(ShopDataContext);
  if (!ctx) {
    throw new Error("useShopData must be used inside <ShopDataProvider>");
  }
  return ctx;
}
