import type { ReactNode } from "react";
import { valueSizing, type DashboardTone } from "@/components/dashboard/kpi-card";

/** Compact, dashboard-only secondary metric. */
export function MetricCard({ label, value, icon, tone = "blue" }: {
  label: string;
  value: string;
  icon: ReactNode;
  tone?: DashboardTone;
}) {
  return (
    <div className="dashboard-metric" data-tone={tone}>
      <div className="dashboard-stat-heading">
        <span className="dashboard-icon" aria-hidden>{icon}</span>
        <h2>{label}</h2>
      </div>
      <p className="dashboard-stat-value" style={valueSizing(value)}><bdi dir="ltr">{value}</bdi></p>
    </div>
  );
}
