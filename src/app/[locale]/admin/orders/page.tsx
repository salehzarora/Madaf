import { notFound } from "next/navigation";
import { OrdersTable } from "@/components/admin/orders-table";
import { ShelfRule } from "@/components/ui/shelf-rule";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { getSessionContext } from "@/lib/auth/session";
import { getDataMode, getTenantTimeZone, searchOrders } from "@/lib/data";
import { parseOrdersQuery } from "@/lib/orders-query";

/**
 * Admin orders list (M8F.1). The URL is the single source of truth for search /
 * filters / page — parsed once here and used to fetch ONLY the current page of
 * rows (server-side, under RLS) plus the exact filtered total. Dashboard/deep
 * links (?status=, ?source=, ?guest=, ?customer=, ?from=, ?to=) are honoured by
 * the shared parser. The client table navigates (URL changes) on every
 * filter/page change, so back/forward and shareable links Just Work.
 */
export default async function AdminOrdersPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const dict = getDictionary(locale);
  const t = dict.admin.orders;

  const query = parseOrdersQuery(await searchParams);
  const result = await searchOrders(query);
  // M8H.2 — the tenant's IANA zone, server-derived. Every time on this screen (and
  // the date presets in the client table) renders in it; the device zone is never
  // consulted, so SSR and hydration agree.
  const timeZone = await getTenantTimeZone();

  // CSV export is owner/admin (mock demo stays open); a sales_rep sees only
  // assigned-customer orders via RLS either way (M8C), and the export action is
  // role-gated too (M8F.1).
  const isSupabase = getDataMode() === "supabase";
  const role = isSupabase ? (await getSessionContext()).membership?.role : null;
  const canExport = !isSupabase || role === "owner" || role === "admin";

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
        result={result}
        query={query}
        locale={locale}
        dict={dict}
        canExport={canExport}
        timeZone={timeZone}
      />
    </div>
  );
}
