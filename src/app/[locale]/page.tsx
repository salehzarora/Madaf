import { notFound } from "next/navigation";
import { MarketingHome } from "@/components/marketing/marketing-home";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { marketingDictionaries } from "@/i18n/dictionaries/marketing";

/** Same public locale URL; the marketing page needs no catalog/cart providers. */
export default async function LandingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <MarketingHome locale={locale} common={getDictionary(locale).common} copy={marketingDictionaries[locale]} />;
}
