import { PlusCircle } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ProductsTable } from "@/components/admin/products-table";
import { ShelfRule } from "@/components/ui/shelf-rule";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { getSessionContext } from "@/lib/auth/session";
import { getDataMode, searchProducts } from "@/lib/data";
import { parseProductsQuery } from "@/lib/products-query";

export default async function AdminProductsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const dict = getDictionary(locale);
  const t = dict.admin.products;
  // M8F.2 — the URL is the source of truth; the server fetches ONLY the current
  // page + the exact filtered total (admin includes inactive under RLS; mock
  // lists all). No full-catalog client load.
  const query = parseProductsQuery(await searchParams);
  const result = await searchProducts(query);
  // CSV export is owner/admin (mock demo stays open) — M8C.
  const isSupabase = getDataMode() === "supabase";
  const role = isSupabase ? (await getSessionContext()).membership?.role : null;
  // Owner/admin gate for BOTH export and the edit/activate actions (M8D —
  // product writes are owner/admin; a sales_rep sees a read-only list).
  const canManage = !isSupabase || role === "owner" || role === "admin";

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
      <div>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-muted">
              {dict.nav.admin}
            </p>
            <h1 className="mt-1 text-[28px] font-extrabold tracking-[-0.02em] text-ink">
              {t.title}
            </h1>
            <p className="mt-0.5 text-sm text-ink-muted">{t.subtitle}</p>
          </div>
          {canManage ? (
            <Link
              href={`/${locale}/admin/products/new`}
              className="inline-flex h-11 items-center gap-2 rounded-field bg-brand-600 px-4 text-sm font-bold text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.12),0_1px_2px_rgb(25_22_18/0.2)] transition-colors hover:bg-brand-700 active:bg-brand-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
            >
              <PlusCircle className="size-4" aria-hidden />
              {t.addProduct}
            </Link>
          ) : null}
        </div>
        <ShelfRule className="mt-4" />
      </div>
      <ProductsTable
        result={result}
        query={query}
        canExport={canManage}
        canManage={canManage}
        locale={locale}
        dict={dict}
      />
    </div>
  );
}
