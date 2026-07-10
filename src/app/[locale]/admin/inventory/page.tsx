import { History } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { InventoryTable } from "@/components/admin/inventory-table";
import { ShelfRule } from "@/components/ui/shelf-rule";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { getSessionContext } from "@/lib/auth/session";
import { getDataMode, listInventory, listProducts } from "@/lib/data";

export default async function AdminInventoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ low?: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const dict = getDictionary(locale);
  const t = dict.admin.inventory;
  // Dashboard low-stock card deep-links with ?low=1 (M8D).
  const initialLowOnly = (await searchParams).low === "1";
  // includeInactive: the warehouse still holds stock for DEACTIVATED
  // products — their rows must render, not crash (M8A). The shared shop-data
  // context stays active-only for the storefront, so this page passes its
  // own product list.
  const [inventory, products] = await Promise.all([
    listInventory(),
    listProducts({ includeInactive: true }),
  ]);
  const isSupabase = getDataMode() === "supabase";
  // Mock keeps the demo timeline; supabase mode uses the real current day
  // for the "expiring soon" horizon (M8A — was frozen at the demo date).
  const today = isSupabase ? new Date().toISOString().slice(0, 10) : undefined;
  // Manual adjustments (M8B.2) are a Supabase-only owner/admin write — the
  // RPC re-enforces this; here we only hide the affordance (a sales_rep
  // would just get a failing button, and mock has no write path).
  const role = isSupabase ? (await getSessionContext()).membership?.role : null;
  const canAdjust = isSupabase && (role === "owner" || role === "admin");

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
          {/* Ledger history (M8B.1) — owner/admin (RLS-gated data) and the
              mock demo (empty state). A sales_rep would only see zero rows. */}
          {canAdjust || !isSupabase ? (
            <Link
              href={`/${locale}/admin/inventory/movements`}
              className="inline-flex h-11 items-center gap-1.5 rounded-field border border-line-strong px-4 text-sm font-semibold text-ink transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
            >
              <History className="size-4" aria-hidden />
              {t.movements.navLabel}
            </Link>
          ) : null}
        </div>
        <ShelfRule className="mt-4" />
      </div>
      <InventoryTable
        inventory={inventory}
        products={products}
        today={today}
        canAdjust={canAdjust}
        initialLowOnly={initialLowOnly}
        locale={locale}
        dict={dict}
      />
    </div>
  );
}
