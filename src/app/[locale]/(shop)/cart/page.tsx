import { notFound } from "next/navigation";
import { CartView } from "@/components/cart-view";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";

export default async function CartPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <CartView locale={locale} dict={getDictionary(locale)} />;
}
