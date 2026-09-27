import type { ReactNode } from "react";
import Link from "next/link";
import { formatNumber } from "@/lib/format";
import type { Locale } from "@/i18n/config";
import type { DashboardTone } from "./kpi-card";

export function OperationalAlertCard({ href, title, subtitle, count, locale, icon, tone }: {
  href: string;
  title: string;
  subtitle: string;
  count: number;
  locale: Locale;
  icon: ReactNode;
  tone: DashboardTone;
}) {
  return (
    <Link href={href} className="dashboard-alert" data-tone={tone} data-quiet={count === 0 || undefined}>
      <span className="dashboard-icon" aria-hidden>{icon}</span>
      <span className="dashboard-alert-copy">
        <span className="dashboard-alert-title">{title}</span>
        <span className="dashboard-alert-subtitle">{subtitle}</span>
      </span>
      {count > 0 ? <bdi dir="ltr" className="dashboard-alert-count">{formatNumber(count, locale)}</bdi> : null}
    </Link>
  );
}
