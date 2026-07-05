import { notFound } from "next/navigation";
import { CatalogView } from "@/components/catalog-view";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";

/**
 * Customer/sales catalog. Supports the admin deep-link
 * `/catalog?customer=cXX` (sales-visit flow: preselects the shop).
 */
export default async function CatalogPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ customer?: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const { customer } = await searchParams;
  const dict = getDictionary(locale);

  return (
    <CatalogView locale={locale} dict={dict} initialCustomerId={customer} />
  );
}
