import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/types";
import type { DashboardMetrics } from "@/lib/data/dashboard";
import { AnalyticsCard } from "./analytics-card";
import { StatusDonut } from "./status-donut";
import { TrendChart } from "./trend-chart";

export function DashboardAnalytics({ metrics, locale, dict }: {
  metrics: Pick<DashboardMetrics, "trend" | "statusCounts" | "totalOrders">;
  locale: Locale;
  dict: Dictionary;
}) {
  const d = dict.admin.dashboard;
  const statuses = ["new", "confirmed", "preparing", "delivered", "cancelled"] as const;
  const segments = statuses.map(status => ({ status, label: dict.status[status], count: metrics.statusCounts[status] }));
  return (
    <div className="dashboard-analytics">
      <AnalyticsCard title={d.trend} titleId="dashboard-trend-title" context={d.trendSub}>
        <TrendChart days={metrics.trend} locale={locale} labels={d.charts} />
      </AnalyticsCard>
      <AnalyticsCard title={d.statusMix} titleId="dashboard-status-title">
        <StatusDonut segments={segments} total={metrics.totalOrders} totalLabel={d.charts.totalOrders} emptyLabel={d.charts.statusEmpty} locale={locale} />
      </AnalyticsCard>
    </div>
  );
}
