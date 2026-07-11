import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { isLocale, type Locale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { CartProvider } from "@/lib/cart-context";
import {
  listCategories,
  listCustomers,
  listManufacturers,
  listProducts,
} from "@/lib/data";
import { ShopDataProvider } from "@/lib/shop-data-context";

/**
 * Storefront chrome for all customer/sales-facing pages. This is where the
 * FULL catalog context lives (M8F.2): the shop flows (catalog, cart, order
 * pad, pickers, checkout) legitimately browse the whole catalog client-side,
 * so the ShopData context + cart are hydrated HERE, not in the root layout —
 * keeping the full product/customer collections off admin routes. Server-side
 * reads go through the data layer (mock by default); no client component
 * fetches or imports mock data itself.
 */
export default async function ShopLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const dict = getDictionary(locale as Locale);

  const [products, categories, manufacturers, customers] = await Promise.all([
    listProducts(),
    listCategories(),
    listManufacturers(),
    listCustomers(),
  ]);

  return (
    <ShopDataProvider
      products={products}
      categories={categories}
      manufacturers={manufacturers}
      customers={customers}
    >
      <CartProvider>
        <AppShell locale={locale as Locale} dict={dict}>
          {children}
        </AppShell>
      </CartProvider>
    </ShopDataProvider>
  );
}
