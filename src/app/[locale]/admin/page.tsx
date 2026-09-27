import Link from "next/link";
import { notFound } from "next/navigation";
import { DashboardTop } from "@/components/dashboard/dashboard-top";
import { StatusDonut } from "@/components/dashboard/status-donut";
import { TrendChart, type TrendDay } from "@/components/dashboard/trend-chart";
import { OrderStatusBadge } from "@/components/order-status-badge";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { isLocale } from "@/i18n/config";
import { getDictionary, interpolate } from "@/i18n/dictionaries";
import { getSessionContext } from "@/lib/auth/session";
import { getDashboardMetrics, getDataMode, getTenantTimeZone, searchOrders } from "@/lib/data";
import { countPendingSignupRequests } from "@/lib/data/customer-signup";
import { parseOrdersQuery } from "@/lib/orders-query";
import { formatCurrency, formatNumber } from "@/lib/format";
import { formatTenantDateTime } from "@/lib/time";
import type { Locale } from "@/lib/types";

const STATUS_COLOR = {
  new: "#3B62B8",
  confirmed: "#17694F",
  preparing: "#E8A33D",
  delivered: "#8FC7AB",
  cancelled: "#CBC3B0",
} as const;

/** Compact money label for chart bars: 2900 → "2.9K". */
function compact(n: number, locale: Locale): string {
  if (n >= 1000) return `${formatNumber(Math.round(n / 100) / 10, locale)}K`;
  return formatNumber(Math.round(n), locale);
}

/** Admin dashboard v2 — KPIs, trend + status, widgets, recent activity.
 *
 * C1 (Batch C): all aggregates come from ONE bounded `getDashboardMetrics()`
 * read (a tenant-scoped DB aggregate in supabase mode; the same definitions over
 * the mock arrays in demo mode) instead of loading the ENTIRE order history and
 * summing in JS — so a tenant past the PostgREST 1000-row ceiling can no longer
 * see silently-truncated totals. Recent activity is a bounded 6-order page. */
export default async function AdminDashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const dict = getDictionary(locale);
  const t = dict.admin;
  const d = dict.admin.dashboard;

  // ONE bounded aggregate + a bounded 6-order "recent" page + the tenant zone.
  const [metrics, recentResult, timeZone] = await Promise.all([
    getDashboardMetrics(),
    searchOrders(parseOrdersQuery({ pageSize: "6" })),
    getTenantTimeZone(), // M8H.2 — server-derived tenant zone for dashboard times
  ]);
  const recent = recentResult.rows;

  const sc = metrics.statusCounts;
  const monthTotal = metrics.month.revenue;

  // Pending store-signup requests — supabase owner/admin only (mock has no
  // signups). An EXACT server-side count (no signup rows / PII loaded, correct
  // above the PostgREST 1000-row ceiling) — Batch C bounded-read correction.
  const isSupabase = getDataMode() === "supabase";
  const dashRole = isSupabase
    ? (await getSessionContext()).membership?.role
    : null;
  const canSeeSignups =
    isSupabase && (dashRole === "owner" || dashRole === "admin");
  const pendingSignups = canSeeSignups
    ? await countPendingSignupRequests()
    : 0;

  // Daily totals (non-cancelled), last 14 tenant-local days present in the data
  // — computed server-side by the aggregate; the UI only formats.
  const trendDays: TrendDay[] = metrics.trend.map((point, i) => {
    const [, mm, dd] = point.day.split("-");
    return {
      dayLabel: `${Number(dd)}/${Number(mm)}`,
      value: point.total,
      compact: compact(point.total, locale),
      full: formatCurrency(point.total, locale),
      isToday: i === metrics.trend.length - 1,
    };
  });

  // Status donut segments.
  const statuses = ["new", "confirmed", "preparing", "delivered", "cancelled"] as const;
  const segments = statuses.map((s) => ({
    label: dict.status[s],
    count: sc[s],
    color: STATUS_COLOR[s],
  }));

  const topProducts = metrics.topProducts;
  const topProdMax = Math.max(1, ...topProducts.map((x) => x.revenue));
  const topShops = metrics.topShops;
  const lowStockItems = metrics.lowStock.items;

  return (
    <div className="mx-auto flex w-full max-w-[1096px] flex-col gap-4">
      <DashboardTop locale={locale} dict={dict} metrics={metrics} pendingSignups={canSeeSignups ? pendingSignups : null} />

      {/* Trend + status */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1.8fr_1fr]">
        <Card>
          <CardHeader variant="strip">
            <div>
              <CardTitle>{d.trend}</CardTitle>
              <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-muted">
                {d.trendSub}
              </p>
            </div>
            <span
              className="font-mono text-sm font-semibold text-brand-700"
              dir="ltr"
            >
              {formatCurrency(monthTotal, locale)}
            </span>
          </CardHeader>
          <div className="p-4">
            <TrendChart days={trendDays} />
          </div>
        </Card>
        <Card>
          <CardHeader variant="strip">
            <CardTitle>{d.statusMix}</CardTitle>
          </CardHeader>
          <div className="p-5">
            <StatusDonut
              segments={segments}
              total={metrics.totalOrders}
              totalLabel={dict.nav.orders}
            />
          </div>
        </Card>
      </div>

      {/* Widgets */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {/* Top products */}
        <Card>
          <CardHeader variant="strip">
            <CardTitle>{d.topProducts}</CardTitle>
            <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-muted">
              {d.byRevenue}
            </span>
          </CardHeader>
          <ul className="flex flex-col gap-3 p-4">
            {topProducts.map(({ productId, name, revenue }, i) => (
              <li key={productId}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-[13px] font-semibold text-ink">
                    {name[locale]}
                  </span>
                  <span className="shrink-0 font-mono text-[13px] font-semibold tabular-nums text-ink-soft">
                    {formatCurrency(revenue, locale)}
                  </span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-[3px] bg-line-hair">
                  <span
                    className={i === 0 ? "block h-full bg-brand-600" : "block h-full bg-brand-300"}
                    style={{ width: `${(revenue / topProdMax) * 100}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </Card>

        {/* Top shops */}
        <Card>
          <CardHeader variant="strip">
            <CardTitle>{d.topCustomers}</CardTitle>
          </CardHeader>
          <ul className="divide-y divide-line-hair px-4">
            {topShops.map(({ customerId, name, total, count }, i) => (
              <li key={customerId} className="flex items-center gap-3 py-3">
                <span
                  className={
                    "flex size-[22px] shrink-0 items-center justify-center rounded-md font-mono text-[11px] font-bold " +
                    (i === 0 ? "bg-band text-accent" : "bg-background text-ink-soft")
                  }
                  dir="ltr"
                >
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-semibold text-ink">
                    {name}
                  </p>
                  <p className="text-[11px] text-ink-muted">
                    {interpolate(d.ordersCount, { count })}
                  </p>
                </div>
                <span className="shrink-0 text-sm font-bold tabular-nums text-ink">
                  {formatCurrency(total, locale)}
                </span>
              </li>
            ))}
          </ul>
        </Card>

        {/* Low stock */}
        <Card className="border-warning/35 bg-accent-wash">
          <CardHeader variant="strip" className="bg-accent-wash">
            <CardTitle>{t.lowStockTitle}</CardTitle>
            <Link
              href={`/${locale}/admin/inventory?low=1`}
              className="text-[13px] font-semibold text-brand-700 hover:underline"
            >
              {dict.common.viewAll}
            </Link>
          </CardHeader>
          <ul className="flex flex-col gap-2.5 p-4">
            {lowStockItems.map((item) => {
              const empty = item.stock === 0;
              return (
                <li key={item.productId} className="flex items-center gap-2.5">
                  <span
                    className="shrink-0 rounded-[5px] bg-ink/[.07] px-1.5 py-0.5 font-mono text-[10px] font-semibold text-ink-soft"
                    dir="ltr"
                  >
                    {item.location}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-semibold text-ink">
                      {item.name[locale]}
                    </p>
                    <div className="mt-1 h-[5px] overflow-hidden rounded-full bg-ink/[.06]">
                      <span
                        className={empty ? "block h-full bg-danger" : "block h-full bg-accent"}
                        style={{
                          width: `${Math.max((item.stock / item.threshold) * 100, 3)}%`,
                        }}
                      />
                    </div>
                  </div>
                  <span
                    className="shrink-0 font-mono text-[13px] font-bold tabular-nums text-ink"
                    dir="ltr"
                  >
                    {item.stock} / {item.threshold}
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>
      </div>

      {/* Recent activity */}
      <Card>
        <CardHeader variant="strip">
          <CardTitle>{t.recentOrders}</CardTitle>
          <Link
            href={`/${locale}/admin/orders`}
            className="text-[13px] font-semibold text-brand-700 hover:underline"
          >
            {dict.common.viewAll}
          </Link>
        </CardHeader>
        <div className="divide-y divide-line-hair">
          {recent.map((order) => (
            <Link
              key={order.id}
              href={`/${locale}/admin/orders/${order.id}`}
              className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-brand-50/60"
            >
              <span
                className="w-[110px] shrink-0 font-mono text-[13px] font-semibold text-brand-700"
                dir="ltr"
              >
                {order.number}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">
                {/* Guest showcase orders have no customer row — show the
                    snapshot store name (M8A). */}
                {order.customerName ?? order.customerSnapshot?.name ?? "—"}
              </span>
              <span className="hidden text-xs text-ink-muted sm:block">
                {formatTenantDateTime(order.createdAt, locale, timeZone)} ·{" "}
                {interpolate(dict.admin.orders.detail.itemsCount, {
                  count: order.itemCount,
                })}
              </span>
              <span className="shrink-0 text-sm font-bold tabular-nums text-ink">
                {formatCurrency(order.subtotalAmount, locale)}
              </span>
              <span className="hidden w-[130px] justify-end sm:flex">
                <OrderStatusBadge status={order.status} dict={dict.status} />
              </span>
            </Link>
          ))}
        </div>
      </Card>
    </div>
  );
}
