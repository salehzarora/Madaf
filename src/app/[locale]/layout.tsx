import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Rubik } from "next/font/google";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { ServiceWorkerRegister } from "@/components/pwa/service-worker-register";
import { dirFor, isLocale, locales, type Locale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { appIdentity } from "@/lib/app-identity";
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

export const viewport: Viewport = {
  themeColor: appIdentity.themeColor,
};

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
    applicationName: appIdentity.name,
    appleWebApp: {
      capable: true,
      title: appIdentity.name,
      statusBarStyle: "default",
    },
    icons: {
      apple: { url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    },
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

  // No catalog data is loaded here. The full ShopData (products/customers/…)
  // is scoped to the routes that need it: the storefront `(shop)` layout
  // hydrates the FULL context + cart; the `admin` layout hydrates only the
  // bounded category/manufacturer reference lists. This keeps the full product
  // and customer collections OFF admin routes (e.g. the paginated Products
  // list) — M8F.2. Auth/token pages (login, invite, shop/showcase tokens) are
  // self-contained and need neither provider.
  return (
    <html
      lang={locale}
      dir={dirFor(locale as Locale)}
      className={`${rubik.variable} ${plexMono.variable} antialiased`}
    >
      <body className="min-h-dvh">
        <ServiceWorkerRegister />
        {children}
      </body>
    </html>
  );
}
