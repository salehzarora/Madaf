import Link from "next/link";
import { Box, Package, Store } from "lucide-react";
import type { ReactNode } from "react";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/types";
import { interpolate } from "@/i18n/dictionaries";
import type { DashboardMetrics } from "@/lib/data/dashboard";
import type { OrderListRow } from "@/lib/orders-query";
import { formatCurrency, formatNumber } from "@/lib/format";
import { formatTenantDateTime } from "@/lib/time";
import { OrderStatusBadge } from "@/components/order-status-badge";

/** Lower-dashboard surface only; shared Card and approved analytics stay intact. */
function AdminSectionCard({ id, title, context, action, children }: {
  id: string; title: string; context?: string; action?: ReactNode; children: ReactNode;
}) {
  return <section className="dashboard-widget-card" aria-labelledby={id}>
    <header className="dashboard-widget-header">
      <div><h2 id={id}>{title}</h2>{context ? <p>{context}</p> : null}</div>
      {action}
    </header>
    {children}
  </section>;
}

function RankedListRow({ rank, icon, name, amount, detail, progress }: {
  rank: number; icon: ReactNode; name: string; amount: string; detail?: string; progress?: number;
}) {
  return <li className="dashboard-ranked-row" data-leading={rank === 1 || undefined}>
    <bdi className="dashboard-rank" dir="ltr">{rank}</bdi>
    <span className="dashboard-widget-icon" aria-hidden>{icon}</span>
    <div className="dashboard-ranked-content">
      <div className="dashboard-ranked-main">
        <span className="dashboard-widget-name" dir="auto">{name}</span>
        <bdi className="dashboard-widget-amount" dir="ltr">{amount}</bdi>
      </div>
      {detail ? <p className="dashboard-widget-meta">{detail}</p> : null}
      {progress !== undefined ? <div className="dashboard-widget-progress" aria-hidden><span style={{ inlineSize: `${progress}%` }} /></div> : null}
    </div>
  </li>;
}

function LowStockRow({ item, locale, dict }: {
  item: DashboardMetrics["lowStock"]["items"][number]; locale: Locale; dict: Dictionary;
}) {
  const empty = item.stock === 0;
  // Rendering clamp only: exact stock/threshold remains authoritative text.
  const progress = item.threshold > 0 ? Math.max(0, Math.min(100, item.stock / item.threshold * 100)) : 0;
  return <li className="dashboard-stock-row" data-empty={empty || undefined}>
    <span className="dashboard-widget-icon" aria-hidden><Box /></span>
    <div className="dashboard-stock-content">
      <p className="dashboard-widget-name">{item.name[locale]}</p>
      {item.location ? <bdi className="dashboard-stock-location" dir="auto">{item.location}</bdi> : null}
      <div className="dashboard-stock-values">
        <bdi className="dashboard-stock-count" dir="ltr">{formatNumber(item.stock, locale)} / {formatNumber(item.threshold, locale)}</bdi>
        {empty ? <span className="dashboard-stock-warning">{dict.availability.outOfStock}</span> : null}
      </div>
      <div className="dashboard-widget-progress" aria-hidden><span style={{ inlineSize: `${progress}%` }} /></div>
    </div>
  </li>;
}

function DashboardRecentOrderRow({ order, locale, dict, timeZone }: {
  order: OrderListRow; locale: Locale; dict: Dictionary; timeZone: string;
}) {
  return <li>
    <Link href={`/${locale}/admin/orders/${order.id}`} className="dashboard-recent-row">
      <bdi className="dashboard-recent-ref" dir="ltr">{order.number}</bdi>
      <span className="dashboard-recent-customer" dir="auto">{order.customerName ?? order.customerSnapshot?.name ?? "—"}</span>
      <span className="dashboard-recent-meta">
        <time dateTime={order.createdAt} dir="ltr">{formatTenantDateTime(order.createdAt, locale, timeZone).replace(/[\u200e\u200f\u061c]/g, "")}</time>
        <span>{interpolate(dict.admin.orders.detail.itemsCount, { count: order.itemCount })}</span>
      </span>
      <bdi className="dashboard-recent-amount" dir="ltr">{formatCurrency(order.subtotalAmount, locale)}</bdi>
      <span className="dashboard-recent-status" data-status={order.status}><OrderStatusBadge status={order.status} dict={dict.status} /></span>
    </Link>
  </li>;
}

/** Presentation of existing bounded reads: no fetches, filtering or re-ranking. */
export function DashboardWidgets({ metrics, recent, locale, dict, timeZone }: {
  metrics: Pick<DashboardMetrics, "topProducts" | "topShops" | "lowStock">;
  recent: OrderListRow[]; locale: Locale; dict: Dictionary; timeZone: string;
}) {
  const d = dict.admin.dashboard;
  const labels = d.widgets;
  const topMax = Math.max(1, ...metrics.topProducts.map(item => item.revenue));
  return <div className="dashboard-widgets">
    <div className="dashboard-widget-grid">
      <AdminSectionCard id="dashboard-stock-title" title={dict.admin.lowStockTitle} context={labels.stockThreshold} action={<Link className="dashboard-widget-link" href={`/${locale}/admin/inventory?low=1`}>{dict.common.viewAll}</Link>}>
        {metrics.lowStock.items.length ? <ul className="dashboard-stock-list">
          {metrics.lowStock.items.map(item => <LowStockRow key={item.productId} item={item} locale={locale} dict={dict} />)}
        </ul> : <p className="dashboard-widget-empty">{labels.noLowStock}</p>}
      </AdminSectionCard>
      <AdminSectionCard id="dashboard-shops-title" title={d.topCustomers}>
        {metrics.topShops.length ? <ol className="dashboard-ranked-list dashboard-shop-list">
          {metrics.topShops.map((item, index) => <RankedListRow key={item.customerId} rank={index + 1} icon={<Store />} name={item.name} amount={formatCurrency(item.total, locale)} detail={interpolate(d.ordersCount, { count: item.count })} />)}
        </ol> : <p className="dashboard-widget-empty">{labels.noShops}</p>}
      </AdminSectionCard>
      <AdminSectionCard id="dashboard-products-title" title={d.topProducts} context={d.byRevenue}>
        {metrics.topProducts.length ? <ol className="dashboard-ranked-list dashboard-product-list">
          {metrics.topProducts.map((item, index) => <RankedListRow key={item.productId} rank={index + 1} icon={<Package />} name={item.name[locale]} amount={formatCurrency(item.revenue, locale)} progress={item.revenue / topMax * 100} />)}
        </ol> : <p className="dashboard-widget-empty">{labels.noProducts}</p>}
      </AdminSectionCard>
    </div>
    <AdminSectionCard id="dashboard-recent-title" title={dict.admin.recentOrders} action={<Link className="dashboard-widget-link" href={`/${locale}/admin/orders`}>{dict.common.viewAll}</Link>}>
      {recent.length ? <ul className="dashboard-recent-list">
        {recent.map(order => <DashboardRecentOrderRow key={order.id} order={order} locale={locale} dict={dict} timeZone={timeZone} />)}
      </ul> : <p className="dashboard-widget-empty">{labels.noOrders}</p>}
    </AdminSectionCard>
  </div>;
}
