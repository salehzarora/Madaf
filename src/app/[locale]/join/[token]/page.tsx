import { notFound } from "next/navigation";
import { StoreSignupForm } from "@/components/shop/store-signup-form";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { getDataMode } from "@/lib/data";

/**
 * Anonymous new-store signup (M7G). A prospective store opens its supplier's
 * tokenized link with NO login and NO catalog exposure — the raw token is the
 * only credential and is validated server-side by the submit action/RPC.
 * Supabase mode only (no tokens/tenants in mock).
 */
export default async function JoinPage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale, token } = await params;
  if (!isLocale(locale)) notFound();
  if (getDataMode() !== "supabase") notFound();

  const dict = getDictionary(locale);
  return <StoreSignupForm locale={locale} dict={dict} token={token} />;
}
