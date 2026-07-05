import { notFound } from "next/navigation";
import { CheckoutView } from "@/components/checkout-view";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";

export default async function CheckoutPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <CheckoutView locale={locale} dict={getDictionary(locale)} />;
}
