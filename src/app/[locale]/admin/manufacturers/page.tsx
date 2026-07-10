import { notFound } from "next/navigation";
import { ManufacturersManager } from "@/components/admin/manufacturers-manager";
import { ShelfRule } from "@/components/ui/shelf-rule";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { getSessionContext } from "@/lib/auth/session";
import { getDataMode, listManufacturers, listProducts } from "@/lib/data";

/** Manufacturers admin — brands and their logos (tenant-scoped). */
export default async function AdminManufacturersPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const dict = getDictionary(locale);
  const t = dict.admin.manufacturers;

  const [manufacturers, products] = await Promise.all([
    listManufacturers(),
    listProducts({ includeInactive: true }),
  ]);
  const productCounts = products.reduce<Record<string, number>>((acc, p) => {
    if (p.manufacturerId) acc[p.manufacturerId] = (acc[p.manufacturerId] ?? 0) + 1;
    return acc;
  }, {});
  // Catalog writes are owner/admin (M8D); mock demo stays open.
  const isSupabase = getDataMode() === "supabase";
  const role = isSupabase ? (await getSessionContext()).membership?.role : null;
  const canManage = !isSupabase || role === "owner" || role === "admin";

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
      <div>
        <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-muted">
          {dict.nav.admin}
        </p>
        <h1 className="mt-1 text-[28px] font-extrabold tracking-[-0.02em] text-ink">
          {t.title}
        </h1>
        <p className="mt-0.5 text-sm text-ink-muted">{t.subtitle}</p>
        <ShelfRule className="mt-4" />
      </div>
      <ManufacturersManager
        manufacturers={manufacturers}
        productCounts={productCounts}
        canManage={canManage}
        locale={locale}
        dict={dict}
      />
    </div>
  );
}
