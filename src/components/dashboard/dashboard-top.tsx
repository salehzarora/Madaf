import { AlertTriangle, ClipboardList, FileText, Inbox, Package, Plus, Receipt, ShoppingCart, Store, Tag, UserPlus } from "lucide-react";
import Link from "next/link";
import { KpiCard } from "./kpi-card";
import { MetricCard } from "@/components/metric-card";
import { OperationalAlertCard } from "./operational-alert-card";
import { interpolate } from "@/i18n/dictionaries";
import type { Dictionary } from "@/i18n/types";
import type { Locale } from "@/i18n/config";
import type { DashboardMetrics } from "@/lib/data/dashboard";
import { formatCurrency, formatNumber } from "@/lib/format";
import type { ReactNode } from "react";
import type { DashboardPeriodMetrics } from "@/lib/data/dashboard-period";
import { KpiSparkline } from "./kpi-sparkline";

/** Presentation only. Reads and signup authorization remain in the server page.
 * null means signup visibility was denied; zero is an authorized empty count. */
export function DashboardTop({ locale, dict, metrics, pendingSignups, period, rangeControl }: {
  locale: Locale;
  dict: Dictionary;
  metrics: DashboardMetrics;
  pendingSignups: number | null;
  period?: DashboardPeriodMetrics;
  rangeControl?: ReactNode;
}) {
  const t = dict.admin;
  const d = t.dashboard;
  const sc = period?.statusCounts ?? metrics.statusCounts;
  const current = metrics.statusCounts;
  const openCount = sc.new + sc.confirmed + sc.preparing;
  const inPreparation = current.confirmed + current.preparing;
  const openStatuses = ["new", "confirmed", "preparing"] as const;
  return (
    <div className="dashboard-top">
      <header className="dashboard-heading">
        <div className="dashboard-intro">
          <h1>{t.overviewTitle}</h1>
          <p>{t.overviewSubtitle}</p>
        </div>
        <div className="dashboard-actions">
          <Link href={`/${locale}/admin/products/new`} className="dashboard-action dashboard-action-primary"><Plus aria-hidden />{t.actionNewProduct}</Link>
          <Link href={`/${locale}/admin/orders`} className="dashboard-action dashboard-action-secondary">{t.actionViewOrders}</Link>
          <Link href={`/${locale}/catalog`} className="dashboard-action dashboard-action-tertiary">{t.actionOpenCatalog}</Link>
        </div>
      </header>
      {rangeControl}
      {period ? <p className="dashboard-period-note">{d.range.cohort}</p> : null}

      <div className="dashboard-primary-grid">
        <KpiCard label={t.metrics.newOrders} value={formatNumber(sc.new, locale)} icon={<Package />} tone="blue">
          <p>{d.alerts.needsConfirmation}</p>
          {period ? <KpiSparkline values={period.buckets.map(b => b.new)} labels={d.range} /> : null}
        </KpiCard>
        <KpiCard label={t.metrics.openOrders} value={formatNumber(openCount, locale)} icon={<FileText />} tone="mint">
          <div className="dashboard-status-bar" aria-hidden>
            {openStatuses.map((status) => sc[status] > 0 ? <span key={status} data-status={status} style={{ width: `${sc[status] / Math.max(1, openCount) * 100}%` }} /> : null)}
          </div>
          <ul className="dashboard-status-legend">
            {openStatuses.map((status) => <li key={status} data-status={status}><span>{dict.status[status]}</span><bdi dir="ltr">{formatNumber(sc[status], locale)}</bdi></li>)}
          </ul>
          {period ? <KpiSparkline values={period.buckets.map(b => b.open)} labels={d.range} /> : null}
        </KpiCard>
        <KpiCard label={period ? d.range.periodRevenue : t.metrics.monthRevenue} value={formatCurrency(period?.revenue ?? metrics.month.revenue, locale)} icon={<ShoppingCart />} tone="lilac">
          <p>{interpolate(d.ordersCount, { count: formatNumber(period?.count ?? metrics.month.count, locale) })}</p>
          {period ? <KpiSparkline values={period.buckets.map(b => b.revenue)} labels={d.range} /> : null}
        </KpiCard>
        <KpiCard label={t.metrics.lowStock} value={formatNumber(metrics.lowStock.count, locale)} icon={<AlertTriangle />} tone="warning">
          <p>{period ? d.range.current : d.lowSub}</p>
          <p className="dashboard-out-count">{d.emptyLabel}<bdi dir="ltr">{formatNumber(metrics.lowStock.outOfStockCount, locale)}</bdi></p>
        </KpiCard>
      </div>

      {period ? <p className="dashboard-period-note">{d.range.today}</p> : null}
      <div className="dashboard-secondary-grid">
        <MetricCard label={t.metrics.todayOrders} value={formatNumber(metrics.today.count, locale)} icon={<ClipboardList />} tone="blue" />
        <MetricCard label={t.metrics.todayValue} value={formatCurrency(metrics.today.revenue, locale)} icon={<Receipt />} tone="lilac" />
        <MetricCard label={t.metrics.activeProducts} value={formatNumber(metrics.activeProductCount, locale)} icon={<Tag />} tone="mint" />
        <MetricCard label={t.metrics.activeShops} value={formatNumber(metrics.activeShopCount, locale)} icon={<Store />} tone="mint" />
      </div>

      {period ? <h2 className="dashboard-operations-heading">{d.range.current}</h2> : null}
      <div className="dashboard-alert-grid">
        <OperationalAlertCard href={`/${locale}/admin/orders?status=new`} title={d.alerts.needsConfirmation} subtitle={current.new > 0 ? interpolate(d.alerts.needsConfirmationCount, { count: current.new }) : d.alerts.needsConfirmationNone} count={current.new} locale={locale} icon={<ClipboardList />} tone="warning" />
        <OperationalAlertCard href={`/${locale}/admin/orders?status=confirmed,preparing`} title={d.alerts.preparing} subtitle={inPreparation > 0 ? interpolate(d.alerts.preparingCount, { count: inPreparation }) : d.alerts.preparingNone} count={inPreparation} locale={locale} icon={<Package />} tone="blue" />
        <OperationalAlertCard href={`/${locale}/admin/orders?guest=true&status=new`} title={d.alerts.guestOrders} subtitle={metrics.guestPending > 0 ? interpolate(d.alerts.guestOrdersCount, { count: metrics.guestPending }) : d.alerts.guestOrdersNone} count={metrics.guestPending} locale={locale} icon={<Inbox />} tone="lilac" />
        {pendingSignups !== null ? <OperationalAlertCard href={`/${locale}/admin/customers/signup`} title={d.alerts.signupRequests} subtitle={pendingSignups > 0 ? interpolate(d.alerts.signupRequestsCount, { count: pendingSignups }) : d.alerts.signupRequestsNone} count={pendingSignups} locale={locale} icon={<UserPlus />} tone="mint" /> : null}
        <OperationalAlertCard href={`/${locale}/admin/inventory?low=1`} title={d.alerts.lowStock} subtitle={metrics.lowStock.count > 0 ? interpolate(d.alerts.lowStockCount, { count: metrics.lowStock.count }) : d.alerts.lowStockNone} count={metrics.lowStock.count} locale={locale} icon={<AlertTriangle />} tone="warning" />
      </div>
    </div>
  );
}
