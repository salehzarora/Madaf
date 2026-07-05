import type { Metadata } from "next";
import { Rubik } from "next/font/google";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { dirFor, isLocale, locales, type Locale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { CartProvider } from "@/lib/cart-context";
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

  return (
    <html
      lang={locale}
      dir={dirFor(locale as Locale)}
      className={`${rubik.variable} antialiased`}
    >
      <body className="min-h-dvh">
        <CartProvider>{children}</CartProvider>
      </body>
    </html>
  );
}
