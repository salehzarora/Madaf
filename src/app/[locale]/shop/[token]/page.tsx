import { Link2Off } from "lucide-react";
import { notFound } from "next/navigation";
import { ShopView } from "@/components/shop/shop-view";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { getDataMode } from "@/lib/data";
import { getTokenCatalog } from "@/lib/data/token";

import type { Metadata } from "next";

// The raw token in the URL IS the credential — a leaked link must not
// become search-indexable (M8A).
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/**
 * Tokenized shop — a customer opens their private link with NO login. The
 * token is the credential; the server resolves it to a tenant-scoped
 * catalog (SECURITY DEFINER RPC). Supabase mode only — there are no tokens
 * in mock mode, so the route 404s there.
 */
export default async function ShopTokenPage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale, token } = await params;
  if (!isLocale(locale)) notFound();
  if (getDataMode() !== "supabase") notFound();

  const dict = getDictionary(locale);
  const t = dict.access.shop;

  const catalog = await getTokenCatalog(token);

  // Invalid / revoked / expired token — clean dead-end, no detail leaked.
  if (!catalog) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-4 py-16 text-center">
        <Link2Off className="size-12 text-ink-muted" aria-hidden />
        <h1 className="mt-4 text-xl font-extrabold tracking-tight text-ink">
          {t.invalidTitle}
        </h1>
        <p className="mt-2 text-sm text-ink-soft">{t.invalidBody}</p>
      </main>
    );
  }

  return <ShopView locale={locale} dict={dict} token={token} catalog={catalog} />;
}
