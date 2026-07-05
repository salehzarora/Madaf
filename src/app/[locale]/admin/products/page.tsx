import { PlusCircle } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ProductsTable } from "@/components/admin/products-table";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { listProducts } from "@/lib/data";

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
  const products = await listProducts({ includeInactive: true });

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink">
            {t.title}
          </h1>
          <p className="mt-1 text-sm text-ink-muted">{t.subtitle}</p>
        </div>
        <Link
          href={`/${locale}/admin/products/new`}
          className="inline-flex h-11 items-center gap-2 rounded-field bg-brand-600 px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700"
        >
          <PlusCircle className="size-4" aria-hidden />
          {t.addProduct}
        </Link>
      </div>
      <ProductsTable products={products} locale={locale} dict={dict} />
    </div>
  );
}
