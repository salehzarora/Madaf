import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { isLocale, type Locale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { notFound } from "next/navigation";

/** Storefront chrome for all customer/sales-facing pages. */
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

  return (
    <AppShell locale={locale as Locale} dict={dict}>
      {children}
    </AppShell>
  );
}
