import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MovementsTable } from "@/components/admin/movements-table";
import { ShelfRule } from "@/components/ui/shelf-rule";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { getSessionContext } from "@/lib/auth/session";
import {
  getDataMode,
  listInventoryMovements,
  listOrders,
  listProducts,
} from "@/lib/data";

/**
 * Stock-movement ledger history (M8B.1). Every stock change — order
 * reservations/releases/edits (M7H/M7I) and manual corrections (M8B.2) —
 * lands on the append-only order_inventory_movements ledger; this page lets
 * owner/admin see WHY stock changed. Reads run under RLS (owner/admin read
 * policy — a sales_rep gets zero rows); mock mode has no ledger and shows
 * the empty state.
 */
export default async function InventoryMovementsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const dict = getDictionary(locale);
  const t = dict.admin.inventory.movements;

  // includeInactive: movements may reference deactivated products (M8A rule).
  const [movements, products, orders] = await Promise.all([
    listInventoryMovements(),
    listProducts({ includeInactive: true }),
    listOrders(),
  ]);
  // Export is owner/admin (mock demo stays open; RLS already limits the data).
  const isSupabase = getDataMode() === "supabase";
  const role = isSupabase ? (await getSessionContext()).membership?.role : null;
  const canExport = !isSupabase || role === "owner" || role === "admin";

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
      <div>
        <Link
          href={`/${locale}/admin/inventory`}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-muted transition-colors hover:text-ink"
        >
          <ArrowRight className="size-4 ltr:-scale-x-100" aria-hidden />
          {dict.admin.inventory.title}
        </Link>
        <h1 className="mt-2 text-[28px] font-extrabold tracking-[-0.02em] text-ink">
          {t.title}
        </h1>
        <p className="mt-0.5 text-sm text-ink-muted">{t.subtitle}</p>
        <ShelfRule className="mt-4" />
      </div>
      <MovementsTable
        movements={movements}
        products={products}
        orders={orders}
        canExport={canExport}
        locale={locale}
        dict={dict}
      />
    </div>
  );
}
