import { PlusCircle } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ProductsTable } from "@/components/admin/products-table";
import { ShelfRule } from "@/components/ui/shelf-rule";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { getSessionContext } from "@/lib/auth/session";
import { getDataMode, listInventory, listProducts } from "@/lib/data";

export default async function AdminProductsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const dict = getDictionary(locale);
  const t = dict.admin.products;
  // Admin sees inactive products too (supabase mode); mock lists all.
  const [products, inventory] = await Promise.all([
    listProducts({ includeInactive: true }),
    listInventory(),
  ]);
  // CSV export is owner/admin (mock demo stays open) — M8C.
  const isSupabase = getDataMode() === "supabase";
  const role = isSupabase ? (await getSessionContext()).membership?.role : null;
  const canExport = !isSupabase || role === "owner" || role === "admin";

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
          <Link
            href={`/${locale}/admin/products/new`}
            className="inline-flex h-11 items-center gap-2 rounded-field bg-brand-600 px-4 text-sm font-bold text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.12),0_1px_2px_rgb(25_22_18/0.2)] transition-colors hover:bg-brand-700 active:bg-brand-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
          >
            <PlusCircle className="size-4" aria-hidden />
            {t.addProduct}
          </Link>
        </div>
        <ShelfRule className="mt-4" />
      </div>
      <ProductsTable
        products={products}
        inventory={inventory}
        canExport={canExport}
        locale={locale}
        dict={dict}
      />
    </div>
  );
}
