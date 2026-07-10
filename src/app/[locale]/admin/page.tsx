import {
  AlertTriangle,
  ClipboardList,
  Inbox,
  Package,
  PlusCircle,
  Store,
  UserPlus,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { MetricCard } from "@/components/metric-card";
import { StatusDonut } from "@/components/dashboard/status-donut";
import { TrendChart, type TrendDay } from "@/components/dashboard/trend-chart";
import { OrderStatusBadge } from "@/components/order-status-badge";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { ShelfRule } from "@/components/ui/shelf-rule";
import { isLocale } from "@/i18n/config";
import { getDictionary, interpolate } from "@/i18n/dictionaries";
import {
  isLowStock,
  LOW_STOCK_THRESHOLD,
  orderSubtotal,
  productName,
} from "@/lib/catalog-helpers";
import { getSessionContext } from "@/lib/auth/session";
import {
  getDataMode,
  listCustomers,
  listInventory,
  listOrders,
  listProducts,
} from "@/lib/data";
import { listSignupRequests } from "@/lib/data/customer-signup";
import { formatCurrency, formatDate, formatNumber } from "@/lib/format";
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

/** Admin dashboard v2 — KPIs, trend + status, widgets, recent activity. */
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

  // includeInactive: order lines / inventory rows / low-stock entries may
  // reference DEACTIVATED products — lookups must still resolve (M8A crash
  // fix). Active-only derived values filter explicitly below.
  const [orders, customers, inventory, products] = await Promise.all([
    listOrders(),
    listCustomers(),
    listInventory(),
    listProducts({ includeInactive: true }),
  ]);
  const customerById = new Map(customers.map((c) => [c.id, c]));
  const productById = new Map(products.map((p) => [p.id, p]));
  // `isActive !== false`: mock products omit the optional flag (implicitly
  // active) — a truthy check would render "Active products: 0" in mock mode.
  const activeProductCount = products.filter(
    (p) => p.isActive !== false,
  ).length;

  const live = orders.filter((o) => o.status !== "cancelled");
  const newOrders = orders.filter((o) => o.status === "new");
  const open = orders.filter((o) =>
    ["new", "confirmed", "preparing"].includes(o.status),
  );
  // Mock data lives in July 2026; supabase mode uses the real current month
  // (the KPI was hardcoded to "2026-07" and went stale — M8A).
  const monthPrefix =
    getDataMode() === "mock"
      ? "2026-07"
      : new Date().toISOString().slice(0, 7);
  const monthOrders = live.filter((o) => o.createdAt.startsWith(monthPrefix));
  const monthTotal = monthOrders.reduce((s, o) => s + orderSubtotal(o), 0);
  const lowStockItems = inventory.filter(isLowStock);
  const outCount = lowStockItems.filter((i) => i.stockPackages === 0).length;

  // ── Operational alerts (M8B.4) ──────────────────────────────────────────
  // Guest showcase orders awaiting a decision: status new, no linked shop.
  const pendingGuestOrders = newOrders.filter(
    (o) => !o.customerId && o.customerSnapshot?.guest,
  ).length;
  // Pending store-signup requests — supabase owner/admin only (the list RPC
  // path is owner/admin; mock has no signups).
  const isSupabase = getDataMode() === "supabase";
  const dashRole = isSupabase
    ? (await getSessionContext()).membership?.role
    : null;
  const canSeeSignups =
    isSupabase && (dashRole === "owner" || dashRole === "admin");
  const pendingSignups = canSeeSignups
    ? (await listSignupRequests()).filter((r) => r.status === "pending").length
    : 0;

  // At-a-glance counts. "Today" is the real current day; in supabase mode the
  // dashboard renders per-request (authenticated), so it stays accurate.
  const todayStr = new Date().toISOString().slice(0, 10);
  const todayOrders = live.filter((o) => o.createdAt.slice(0, 10) === todayStr);
  const todayOrdersCount = todayOrders.length;
  // M8C: today's order value (non-cancelled, ex-VAT) for the ops strip.
  const todayTotal = todayOrders.reduce((s, o) => s + orderSubtotal(o), 0);
  // Orders being worked right now (confirmed or preparing).
  const inPreparation = orders.filter((o) =>
    ["confirmed", "preparing"].includes(o.status),
  ).length;

  // Open-orders segmented mini-bar shares.
  const openBy = {
    new: open.filter((o) => o.status === "new").length,
    confirmed: open.filter((o) => o.status === "confirmed").length,
    preparing: open.filter((o) => o.status === "preparing").length,
  };

  // Daily totals (non-cancelled), last 14 days present in the data.
  const byDay = new Map<string, number>();
  for (const o of live) {
    const day = o.createdAt.slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + orderSubtotal(o));
  }
  const dayKeys = [...byDay.keys()].sort().slice(-14);
  const trendDays: TrendDay[] = dayKeys.map((k, i) => {
    const value = byDay.get(k) ?? 0;
    const [, mm, dd] = k.split("-");
    return {
      dayLabel: `${Number(dd)}/${Number(mm)}`,
      value,
      compact: compact(value, locale),
      full: formatCurrency(value, locale),
      isToday: i === dayKeys.length - 1,
    };
  });

  // Sparkline points (month daily totals) over a 0..84 × 0..30 viewBox.
  const spark = trendDays.map((x) => x.value);
  const sparkMax = Math.max(1, ...spark);
  const sparkPts = spark
    .map((v, i) => {
      const x = spark.length > 1 ? (i / (spark.length - 1)) * 84 : 42;
      const y = 28 - (v / sparkMax) * 26;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  // Status donut segments.
  const statuses = ["new", "confirmed", "preparing", "delivered", "cancelled"] as const;
  const segments = statuses.map((s) => ({
    label: dict.status[s],
    count: orders.filter((o) => o.status === s).length,
    color: STATUS_COLOR[s],
  }));

  // Top products by summed line revenue (non-cancelled).
  const prodRev = new Map<string, number>();
  for (const o of live) {
    for (const it of o.items) {
      prodRev.set(
        it.productId,
        (prodRev.get(it.productId) ?? 0) + it.quantity * it.unitPrice,
      );
    }
  }
  const topProducts = [...prodRev.entries()]
    .map(([id, rev]) => ({ product: productById.get(id), rev }))
    .filter((x) => x.product)
    .sort((a, b) => b.rev - a.rev)
    .slice(0, 5);
  const topProdMax = Math.max(1, ...topProducts.map((x) => x.rev));

  // Top shops by summed subtotal (non-cancelled).
  const shopTotals = new Map<string, { total: number; count: number }>();
  for (const o of live) {
    const cur = shopTotals.get(o.customerId) ?? { total: 0, count: 0 };
    shopTotals.set(o.customerId, {
      total: cur.total + orderSubtotal(o),
      count: cur.count + 1,
    });
  }
  const topShops = [...shopTotals.entries()]
    .map(([id, v]) => ({ customer: customerById.get(id), ...v }))
    .filter((x) => x.customer)
    .sort((a, b) => b.total - a.total)
    .slice(0, 4);

  const recent = [...orders]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 6);

  const actionLink =
    "inline-flex h-9 items-center gap-1.5 rounded-field px-3 text-sm font-semibold transition-colors";

  return (
    <div className="mx-auto flex w-full max-w-[1096px] flex-col gap-4">
      {/* Header row */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-extrabold tracking-[-0.02em] text-ink">
            {t.overviewTitle}
          </h1>
          <p className="mt-1 text-sm text-ink-soft">{t.overviewSubtitle}</p>
          <ShelfRule className="mt-3 w-40" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/${locale}/admin/products/new`}
            className={`${actionLink} bg-brand-600 text-white hover:bg-brand-700`}
          >
            <PlusCircle className="size-4" aria-hidden />
            {t.actionNewProduct}
          </Link>
          <Link
            href={`/${locale}/admin/orders`}
            className={`${actionLink} border border-line-strong bg-surface text-ink-soft hover:bg-background`}
          >
            {t.actionViewOrders}
          </Link>
          <Link
            href={`/${locale}/catalog`}
            className={`${actionLink} text-ink-soft hover:bg-surface-sunken hover:text-ink`}
          >
            {t.actionOpenCatalog}
          </Link>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          label={t.metrics.newOrders}
          value={formatNumber(newOrders.length, locale)}
        >
          {/* All-time count of status=new — no "Today" badge (M8A: it was
              misleading; today's count has its own MetricCard below). */}
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-ink-muted">
              {t.metrics.openOrders}: {formatNumber(open.length, locale)}
            </span>
          </div>
        </KpiCard>

        <KpiCard
          label={t.metrics.openOrders}
          value={formatNumber(open.length, locale)}
        >
          <div className="flex h-1.5 overflow-hidden rounded-[3px] bg-line-hair">
            {(["new", "confirmed", "preparing"] as const).map((s) =>
              openBy[s] > 0 ? (
                <span
                  key={s}
                  style={{
                    width: `${(openBy[s] / Math.max(1, open.length)) * 100}%`,
                    backgroundColor: STATUS_COLOR[s],
                  }}
                />
              ) : null,
            )}
          </div>
        </KpiCard>

        <KpiCard
          label={t.metrics.monthRevenue}
          value={formatCurrency(monthTotal, locale)}
        >
          <div className="flex items-center justify-between gap-2">
            <svg viewBox="0 0 84 30" className="h-[30px] w-[84px]" aria-hidden>
              <polyline
                points={sparkPts}
                fill="none"
                className="stroke-brand-600"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {spark.length ? (
                <circle
                  cx="84"
                  cy={28 - (spark[spark.length - 1] / sparkMax) * 26}
                  r="2.6"
                  className="fill-accent"
                />
              ) : null}
            </svg>
            <span className="text-[11px] text-ink-muted">
              {interpolate(d.ordersCount, { count: monthOrders.length })}
            </span>
          </div>
        </KpiCard>

        <KpiCard
          label={t.metrics.lowStock}
          value={formatNumber(lowStockItems.length, locale)}
          tone="warning"
        >
          <div className="flex items-center gap-2">
            <span
              className="rounded-badge bg-danger-soft px-1.5 py-0.5 font-mono text-[11px] font-bold text-danger"
              dir="ltr"
            >
              {d.emptyLabel} · {outCount}
            </span>
            <span className="text-[11px] text-warning/90">{d.lowSub}</span>
          </div>
        </KpiCard>
      </div>

      {/* At-a-glance counts */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard
          label={t.metrics.todayOrders}
          value={formatNumber(todayOrdersCount, locale)}
          icon={<ClipboardList />}
          tone="brand"
        />
        <MetricCard
          label={t.metrics.todayValue}
          value={formatCurrency(todayTotal, locale)}
          icon={<ClipboardList />}
        />
        <MetricCard
          label={t.metrics.activeProducts}
          value={formatNumber(activeProductCount, locale)}
          icon={<Package />}
        />
        <MetricCard
          label={t.metrics.activeShops}
          value={formatNumber(customers.length, locale)}
          icon={<Store />}
        />
      </div>

      {/* Operational alerts (M8B.4) — what needs the admin's attention NOW.
          Each card links to where the work happens; zero shows a calm
          "all clear" line instead of a number badge. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Link
          href={`/${locale}/admin/orders?status=new`}
          className="group flex items-center gap-3 rounded-card border border-line bg-surface p-4 shadow-card transition-colors hover:border-brand-300"
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-field bg-brand-50 text-brand-700">
            <ClipboardList className="size-5" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-bold text-ink">
              {d.alerts.needsConfirmation}
            </span>
            <span className="block text-xs text-ink-soft">
              {newOrders.length > 0
                ? interpolate(d.alerts.needsConfirmationCount, {
                    count: newOrders.length,
                  })
                : d.alerts.needsConfirmationNone}
            </span>
          </span>
          {newOrders.length > 0 ? (
            <span className="shrink-0 rounded-badge bg-warning-soft px-2 py-0.5 font-mono text-sm font-bold tabular-nums text-warning">
              {formatNumber(newOrders.length, locale)}
            </span>
          ) : null}
        </Link>

        <Link
          href={`/${locale}/admin/orders`}
          className="group flex items-center gap-3 rounded-card border border-line bg-surface p-4 shadow-card transition-colors hover:border-brand-300"
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-field bg-brand-50 text-brand-700">
            <Package className="size-5" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-bold text-ink">
              {d.alerts.preparing}
            </span>
            <span className="block text-xs text-ink-soft">
              {inPreparation > 0
                ? interpolate(d.alerts.preparingCount, { count: inPreparation })
                : d.alerts.preparingNone}
            </span>
          </span>
          {inPreparation > 0 ? (
            <span className="shrink-0 rounded-badge bg-info-soft px-2 py-0.5 font-mono text-sm font-bold tabular-nums text-info">
              {formatNumber(inPreparation, locale)}
            </span>
          ) : null}
        </Link>

        <Link
          href={`/${locale}/admin/orders`}
          className="group flex items-center gap-3 rounded-card border border-line bg-surface p-4 shadow-card transition-colors hover:border-brand-300"
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-field bg-brand-50 text-brand-700">
            <Inbox className="size-5" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-bold text-ink">
              {d.alerts.guestOrders}
            </span>
            <span className="block text-xs text-ink-soft">
              {pendingGuestOrders > 0
                ? interpolate(d.alerts.guestOrdersCount, {
                    count: pendingGuestOrders,
                  })
                : d.alerts.guestOrdersNone}
            </span>
          </span>
          {pendingGuestOrders > 0 ? (
            <span className="shrink-0 rounded-badge bg-warning-soft px-2 py-0.5 font-mono text-sm font-bold tabular-nums text-warning">
              {formatNumber(pendingGuestOrders, locale)}
            </span>
          ) : null}
        </Link>

        {canSeeSignups ? (
          <Link
            href={`/${locale}/admin/customers/signup`}
            className="group flex items-center gap-3 rounded-card border border-line bg-surface p-4 shadow-card transition-colors hover:border-brand-300"
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-field bg-brand-50 text-brand-700">
              <UserPlus className="size-5" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-bold text-ink">
                {d.alerts.signupRequests}
              </span>
              <span className="block text-xs text-ink-soft">
                {pendingSignups > 0
                  ? interpolate(d.alerts.signupRequestsCount, {
                      count: pendingSignups,
                    })
                  : d.alerts.signupRequestsNone}
              </span>
            </span>
            {pendingSignups > 0 ? (
              <span className="shrink-0 rounded-badge bg-warning-soft px-2 py-0.5 font-mono text-sm font-bold tabular-nums text-warning">
                {formatNumber(pendingSignups, locale)}
              </span>
            ) : null}
          </Link>
        ) : null}

        <Link
          href={`/${locale}/admin/inventory`}
          className="group flex items-center gap-3 rounded-card border border-line bg-surface p-4 shadow-card transition-colors hover:border-brand-300"
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-field bg-accent-wash text-warning">
            <AlertTriangle className="size-5" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-bold text-ink">
              {d.alerts.lowStock}
            </span>
            <span className="block text-xs text-ink-soft">
              {lowStockItems.length > 0
                ? interpolate(d.alerts.lowStockCount, {
                    count: lowStockItems.length,
                  })
                : d.alerts.lowStockNone}
            </span>
          </span>
          {lowStockItems.length > 0 ? (
            <span className="shrink-0 rounded-badge bg-warning-soft px-2 py-0.5 font-mono text-sm font-bold tabular-nums text-warning">
              {formatNumber(lowStockItems.length, locale)}
            </span>
          ) : null}
        </Link>
      </div>

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
              total={orders.length}
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
            {topProducts.map(({ product, rev }, i) => (
              <li key={product!.id}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-[13px] font-semibold text-ink">
                    {productName(product!, locale)}
                  </span>
                  <span className="shrink-0 font-mono text-[13px] font-semibold tabular-nums text-ink-soft">
                    {formatCurrency(rev, locale)}
                  </span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-[3px] bg-line-hair">
                  <span
                    className={i === 0 ? "block h-full bg-brand-600" : "block h-full bg-brand-300"}
                    style={{ width: `${(rev / topProdMax) * 100}%` }}
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
            {topShops.map(({ customer, total, count }, i) => (
              <li key={customer!.id} className="flex items-center gap-3 py-3">
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
                    {customer!.name}
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
              href={`/${locale}/admin/inventory`}
              className="text-[13px] font-semibold text-brand-700 hover:underline"
            >
              {dict.common.viewAll}
            </Link>
          </CardHeader>
          <ul className="flex flex-col gap-2.5 p-4">
            {lowStockItems.slice(0, 4).map((item) => {
              // Guarded: the product may be deactivated (includeInactive map)
              // or, in a pathological case, missing entirely — never crash.
              const product = productById.get(item.productId);
              if (!product) return null;
              const threshold = item.lowStockThreshold ?? LOW_STOCK_THRESHOLD;
              const empty = item.stockPackages === 0;
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
                      {productName(product, locale)}
                    </p>
                    <div className="mt-1 h-[5px] overflow-hidden rounded-full bg-ink/[.06]">
                      <span
                        className={empty ? "block h-full bg-danger" : "block h-full bg-accent"}
                        style={{
                          width: `${Math.max((item.stockPackages / threshold) * 100, 3)}%`,
                        }}
                      />
                    </div>
                  </div>
                  <span
                    className="shrink-0 font-mono text-[13px] font-bold tabular-nums text-ink"
                    dir="ltr"
                  >
                    {item.stockPackages} / {threshold}
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
          {recent.map((order) => {
            const customer = customerById.get(order.customerId);
            return (
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
                  {customer?.name ?? order.customerSnapshot?.name ?? "—"}
                </span>
                <span className="hidden text-xs text-ink-muted sm:block">
                  {formatDate(order.createdAt, locale)} ·{" "}
                  {interpolate(dict.admin.orders.detail.itemsCount, {
                    count: order.items.length,
                  })}
                </span>
                <span className="shrink-0 text-sm font-bold tabular-nums text-ink">
                  {formatCurrency(orderSubtotal(order), locale)}
                </span>
                <span className="hidden w-[130px] justify-end sm:flex">
                  <OrderStatusBadge status={order.status} dict={dict.status} />
                </span>
              </Link>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
