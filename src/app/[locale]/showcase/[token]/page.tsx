import { Link2Off } from "lucide-react";
import { notFound } from "next/navigation";
import { ShowcaseView } from "@/components/shop/showcase-view";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { getDataMode } from "@/lib/data";
import { getShowcaseCatalog } from "@/lib/data/catalog-showcase";

import type { Metadata } from "next";

// The raw token in the URL IS the credential — a leaked link must not
// become search-indexable (M8A).
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/**
 * Product showcase / guest ordering (M7H.3 → M7I.1). A prospective customer
 * opens the supplier's tokenized "view products" link with NO login, browses
 * the catalog, and can submit an ORDER REQUEST with their store details (no
 * customer account). The token is validated by SECURITY DEFINER RPCs — no
 * catalog is exposed and no order is created without it. Supabase mode only.
 */
export default async function ShowcaseTokenPage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale, token } = await params;
  if (!isLocale(locale)) notFound();
  if (getDataMode() !== "supabase") notFound();

  const dict = getDictionary(locale);
  const t = dict.access.showcase;
  const catalog = await getShowcaseCatalog(token);

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

  return (
    <ShowcaseView locale={locale} dict={dict} token={token} catalog={catalog} />
  );
}
