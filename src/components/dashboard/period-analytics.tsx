import type { DashboardPeriodMetrics } from "@/lib/data/dashboard-period";
import type { DashboardRange } from "@/lib/dashboard-range";
import type { Dictionary } from "@/i18n/types";
import { intlLocaleFor, type Locale } from "@/i18n/config";
import { formatDateOnly, formatTenantDateTime, tenantDateKey } from "@/lib/time";
import { formatCurrency, formatNumber } from "@/lib/format";
import { AnalyticsCard } from "./analytics-card";
import { StatusDonut } from "./status-donut";
import { TrendChart } from "./trend-chart";

export function PeriodAnalytics({ period, range, locale, dict }: { period: DashboardPeriodMetrics; range: DashboardRange; locale: Locale; dict: Dictionary }) {
  const d = dict.admin.dashboard;
  const offset = (date: string) => new Intl.DateTimeFormat(intlLocaleFor[locale], { timeZone: range.timeZone, timeZoneName: "shortOffset" }).formatToParts(new Date(date)).find(p => p.type === "timeZoneName")?.value ?? "";
  const label = (start: string) => range.bucket === "hour" ? `${formatTenantDateTime(start, locale, range.timeZone)} ${offset(start)}` : formatDateOnly(tenantDateKey(start, range.timeZone), locale);
  const bucketLabels = period.buckets.map(b => `${label(b.start)} – ${range.bucket === "hour" ? label(b.end) : formatDateOnly(tenantDateKey(new Date(Date.parse(b.end) - 1), range.timeZone), locale)}`);
  const short = (start: string) => new Intl.DateTimeFormat(intlLocaleFor[locale], { timeZone: range.timeZone, day: "2-digit", month: "2-digit", ...(range.bucket === "hour" ? { hour: "2-digit", minute: "2-digit", hourCycle: "h23" as const } : {}) }).format(new Date(start)).replace(/[\u200e\u200f\u061c]/g, "");
  return <div className="dashboard-analytics">
    <AnalyticsCard title={d.trend} titleId="dashboard-trend-title" context={d.range[range.bucket === "hour" ? "hourly" : range.bucket === "week" ? "weekly" : "daily"]}>
      <TrendChart overview days={period.buckets.map((b, i) => ({ day: b.start, total: b.revenue, label: bucketLabels[i], shortLabel: short(b.start) }))} locale={locale} labels={{ ...d.charts, latestRecorded: d.range.latestBucket }} />
      <details className="dashboard-chart-details dashboard-bucket-details">
        <summary>{d.charts.exactValues} · {dict.admin.metrics.newOrders} / {dict.admin.metrics.openOrders}</summary>
        <div className="dashboard-bucket-table-scroll" tabIndex={0} role="region" aria-label={d.charts.exactValues}>
          <table><thead><tr><th>{d.charts.date}</th><th>{dict.admin.metrics.newOrders}</th><th>{dict.admin.metrics.openOrders}</th><th>{d.range.liveOrders}</th><th>{d.charts.value}</th></tr></thead>
          <tbody>{period.buckets.map((b, i) => <tr key={b.start}><th scope="row" dir="ltr">{bucketLabels[i]}</th><td dir="ltr">{formatNumber(b.new, locale)}</td><td dir="ltr">{formatNumber(b.open, locale)}</td><td dir="ltr">{formatNumber(b.count, locale)}</td><td dir="ltr">{formatCurrency(b.revenue, locale)}</td></tr>)}</tbody></table>
        </div>
      </details>
    </AnalyticsCard>
    <AnalyticsCard title={d.statusMix} titleId="dashboard-status-title" context={d.range.period}>
      <StatusDonut segments={(["new", "confirmed", "preparing", "delivered", "cancelled"] as const).map(status => ({ status, label: dict.status[status], count: period.statusCounts[status] }))} total={period.totalOrders} totalLabel={d.charts.totalOrders} emptyLabel={d.charts.statusEmpty} locale={locale} />
    </AnalyticsCard>
  </div>;
}
