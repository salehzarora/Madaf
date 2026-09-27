import type { CSSProperties, ReactNode } from "react";

export type DashboardTone = "blue" | "mint" | "lilac" | "warning";

/** Dashboard-only server tile. Full values scale to their card's own width. */
export function KpiCard({ label, value, icon, tone = "blue", children }: {
  label: string;
  value: string;
  icon: ReactNode;
  tone?: DashboardTone;
  children?: ReactNode;
}) {
  return (
    <div className="dashboard-kpi" data-tone={tone}>
      <div className="dashboard-stat-heading">
        <span className="dashboard-icon" aria-hidden>{icon}</span>
        <h2>{label}</h2>
      </div>
      <p className="dashboard-stat-value" style={valueSizing(value)}><bdi dir="ltr">{value}</bdi></p>
      {children ? <div className="dashboard-kpi-support">{children}</div> : null}
    </div>
  );
}

export function valueSizing(value: string): CSSProperties {
  return { "--value-length": Math.max(1, value.replace(/[\u200e\u200f\u061c]/g, "").length) } as CSSProperties;
}
