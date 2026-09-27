import type { CSSProperties } from "react";
import type { Locale } from "@/i18n/config";
import type { OrderStatus } from "@/lib/types";
import { formatNumber } from "@/lib/format";

const RADIUS = 62;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export interface DonutSegment {
  status: OrderStatus;
  label: string;
  count: number;
}

/** Exact proportional SVG arcs; no fixed gaps or rounded caps erase/inflate
 * small positive shares. Text center/legend provide the accessible data. */
export function StatusDonut({ segments, total, totalLabel, emptyLabel, locale }: {
  segments: DonutSegment[];
  total: number;
  totalLabel: string;
  emptyLabel: string;
  locale: Locale;
}) {
  const formattedTotal = formatNumber(total, locale);
  return (
    <div className="dashboard-donut">
      <div className="dashboard-donut-layout">
        <div className="dashboard-donut-ring">
          <svg viewBox="0 0 160 160" aria-hidden="true" focusable="false">
            <circle cx="80" cy="80" r={RADIUS} fill="none" strokeWidth="22" className="dashboard-donut-track" />
            {total > 0 ? segments.map((segment, index) => {
              if (segment.count <= 0) return null;
              const length = segment.count / total * CIRCUMFERENCE;
              const offset = segments.slice(0, index).reduce((sum, item) => sum + item.count, 0) / total * CIRCUMFERENCE;
              return <circle
                key={segment.status}
                className="dashboard-donut-segment"
                data-status={segment.status}
                cx="80" cy="80" r={RADIUS} fill="none" strokeWidth="22"
                strokeDasharray={`${length} ${CIRCUMFERENCE - length}`}
                strokeDashoffset={-offset}
                transform="rotate(-90 80 80)"
              />;
            }) : null}
          </svg>
          <div className="dashboard-donut-center">
            <bdi dir="ltr" style={{ "--donut-total-length": formattedTotal.length } as CSSProperties}>{formattedTotal}</bdi>
            <span>{totalLabel}</span>
          </div>
        </div>
        <ul className="dashboard-donut-legend">
          {segments.map(segment => <li key={segment.status} data-status={segment.status}>
            <span className="dashboard-donut-marker" aria-hidden />
            <span className="dashboard-donut-label">{segment.label}</span>
            <bdi dir="ltr">{formatNumber(segment.count, locale)}</bdi>
          </li>)}
        </ul>
      </div>
      {total === 0 ? <p className="dashboard-donut-empty">{emptyLabel}</p> : null}
    </div>
  );
}
