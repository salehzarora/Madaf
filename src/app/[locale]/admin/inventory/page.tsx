import { notFound } from "next/navigation";
import { InventoryTable } from "@/components/admin/inventory-table";
import { ShelfRule } from "@/components/ui/shelf-rule";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { getDataMode, listInventory, listProducts } from "@/lib/data";

export default async function AdminInventoryPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const dict = getDictionary(locale);
  const t = dict.admin.inventory;
  // includeInactive: the warehouse still holds stock for DEACTIVATED
  // products — their rows must render, not crash (M8A). The shared shop-data
  // context stays active-only for the storefront, so this page passes its
  // own product list.
  const [inventory, products] = await Promise.all([
    listInventory(),
    listProducts({ includeInactive: true }),
  ]);
  // Mock keeps the demo timeline; supabase mode uses the real current day
  // for the "expiring soon" horizon (M8A — was frozen at the demo date).
  const today =
    getDataMode() === "mock"
      ? undefined
      : new Date().toISOString().slice(0, 10);

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
      <InventoryTable
        inventory={inventory}
        products={products}
        today={today}
        locale={locale}
        dict={dict}
      />
    </div>
  );
}
