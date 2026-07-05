import { notFound } from "next/navigation";
import { ManufacturersManager } from "@/components/admin/manufacturers-manager";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { listManufacturers, listProducts } from "@/lib/data";

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

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink">{t.title}</h1>
        <p className="mt-1 text-sm text-ink-muted">{t.subtitle}</p>
      </div>
      <ManufacturersManager
        manufacturers={manufacturers}
        productCounts={productCounts}
        locale={locale}
        dict={dict}
      />
    </div>
  );
}
