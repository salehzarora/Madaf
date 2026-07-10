import { notFound } from "next/navigation";
import { OrdersTable } from "@/components/admin/orders-table";
import { ShelfRule } from "@/components/ui/shelf-rule";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { getSessionContext } from "@/lib/auth/session";
import { getDataMode, listOrders } from "@/lib/data";
import { ORDER_STATUSES, type OrderStatus } from "@/lib/types";

type SourceFilter = "all" | "sales_visit" | "shop_link" | "guest";
const SOURCE_FILTERS: readonly SourceFilter[] = [
  "all",
  "sales_visit",
  "shop_link",
  "guest",
];

export default async function AdminOrdersPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ status?: string; source?: string; guest?: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const dict = getDictionary(locale);
  const t = dict.admin.orders;
  const orders = await listOrders();

  // CSV export is owner/admin (mock demo stays open); a sales_rep still sees
  // only assigned-customer orders via RLS either way (M8C).
  const isSupabase = getDataMode() === "supabase";
  const role = isSupabase ? (await getSessionContext()).membership?.role : null;
  const canExport = !isSupabase || role === "owner" || role === "admin";

  // Dashboard cards deep-link with query params (M8D). Comma-separated status
  // supports a status GROUP (e.g. confirmed,preparing). ?guest=true is an
  // alias for the guest source facet.
  const sp = await searchParams;
  const initialStatuses = (sp.status ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is OrderStatus => ORDER_STATUSES.includes(s as OrderStatus));
  const initialSource: SourceFilter =
    sp.guest === "true"
      ? "guest"
      : SOURCE_FILTERS.includes(sp.source as SourceFilter)
        ? (sp.source as SourceFilter)
        : "all";

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
      <OrdersTable
        orders={orders}
        locale={locale}
        dict={dict}
        canExport={canExport}
        initialStatuses={initialStatuses}
        initialSource={initialSource}
      />
    </div>
  );
}
