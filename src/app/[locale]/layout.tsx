import type { Metadata } from "next";
import { IBM_Plex_Mono, Rubik } from "next/font/google";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { dirFor, isLocale, locales, type Locale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { CartProvider } from "@/lib/cart-context";
import {
  listCategories,
  listCustomers,
  listManufacturers,
  listProducts,
} from "@/lib/data";
import { ShopDataProvider } from "@/lib/shop-data-context";
import "../globals.css";

/**
 * Root layout — nested under /[locale] (Next 16 pattern for i18n routing).
 * Sets <html lang> and dir per locale; Rubik covers all three scripts.
 */
const rubik = Rubik({
  subsets: ["latin", "arabic", "hebrew"],
  variable: "--font-rubik",
  display: "swap",
});

// IBM Plex Mono — Latin only; applied solely to Latin identifiers/digits
// (order/doc numbers, SKUs, warehouse slots, emails, chart values). Needs no
// Hebrew/Arabic glyphs.
const plexMono = IBM_Plex_Mono({
  weight: ["400", "500", "600"],
  subsets: ["latin"],
  variable: "--font-plex-mono",
  display: "swap",
});

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const dict = getDictionary(isLocale(locale) ? locale : "he");
  return {
    title: {
      default: `${dict.meta.appNameNative} · ${dict.meta.tagline}`,
      template: `%s · ${dict.meta.appName}`,
    },
    description: dict.meta.description,
  };
}

export default async function RootLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  // Server-side reads through the data layer (mock by default). The shop
  // data context hydrates every client consumer (cart, pickers, order
  // pad, catalog filters) so no client component fetches or imports mock
  // data itself.
  const [products, categories, manufacturers, customers] = await Promise.all([
    listProducts(),
    listCategories(),
    listManufacturers(),
    listCustomers(),
  ]);

  return (
    <html
      lang={locale}
      dir={dirFor(locale as Locale)}
      className={`${rubik.variable} ${plexMono.variable} antialiased`}
    >
      <body className="min-h-dvh">
        <ShopDataProvider
          products={products}
          categories={categories}
          manufacturers={manufacturers}
          customers={customers}
        >
          <CartProvider>{children}</CartProvider>
        </ShopDataProvider>
      </body>
    </html>
  );
}
