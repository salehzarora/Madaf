import { Lock } from "lucide-react";
import { notFound } from "next/navigation";
import { CatalogView } from "@/components/catalog-view";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { getSessionContext } from "@/lib/auth/session";
import { getDataMode } from "@/lib/data";

/**
 * Customer/sales catalog. Supports the admin deep-link
 * `/catalog?customer=cXX` (sales-visit flow: preselects the shop).
 *
 * In supabase mode the catalog is authenticated tenant data. An anon visitor
 * with no membership (e.g. a shop that opened /catalog instead of its private
 * link) would otherwise see an empty grid that reads like a failed search —
 * so we show a clear private-link explainer instead. Mock mode is the open
 * public demo and always renders the catalog.
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

  if (getDataMode() === "supabase") {
    const { membership } = await getSessionContext();
    if (!membership) {
      const t = dict.catalog;
      return (
        <main className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-4 py-16 text-center">
          <Lock className="size-12 text-ink-muted" aria-hidden />
          <h1 className="mt-4 text-xl font-extrabold tracking-tight text-ink">
            {t.privateTitle}
          </h1>
          <p className="mt-2 text-sm text-ink-soft">{t.privateBody}</p>
        </main>
      );
    }
  }

  return (
    <CatalogView locale={locale} dict={dict} initialCustomerId={customer} />
  );
}
