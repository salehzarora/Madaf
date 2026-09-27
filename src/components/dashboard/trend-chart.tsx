import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/types";
import type { DashboardMetrics } from "@/lib/data/dashboard";
import { formatCurrency, formatNumber } from "@/lib/format";
import { formatDateOnly } from "@/lib/time";

/** Existing compact convention; full ILS values remain available in text. */
function compact(value: number, locale: Locale): string {
  if (value >= 1000) return `${formatNumber(Math.round(value / 100) / 10, locale)}K`;
  return formatNumber(Math.round(value), locale);
}

/** Pure server presentation of the bounded series, in its supplied chronology.
 * Dates are calendar dates, never converted through a browser/server timezone. */
export function TrendChart({ days, locale, labels, overview = false }: {
  days: (DashboardMetrics["trend"][number] & { label?: string; shortLabel?: string })[];
  locale: Locale;
  labels: Dictionary["admin"]["dashboard"]["charts"];
  overview?: boolean;
}) {
  if (!days.length) return <p className="dashboard-chart-empty">{labels.trendEmpty}</p>;

  const max = Math.max(1, ...days.map(day => day.total));
  const points = days.map(day => ({
    ...day,
    // Intl may insert RTL marks; these numeric labels already have explicit
    // LTR isolation. Remove the marks so day/month/year keep their visual order.
    dateLabel: (day.label ?? formatDateOnly(day.day, locale)).replace(/[\u200e\u200f\u061c]/g, ""),
    compact: compact(day.total, locale),
    full: formatCurrency(day.total, locale),
  }));
  // Give every date/value its own readable lane. Long compact values widen the
  // inner plot rather than clipping or widening the document.
  const pointWidth = Math.max(86, ...points.map(point => point.compact.length * 8 + 20));
  const latest = points[points.length - 1];
  const peakIndex = points.findIndex(point => point.total === max);

  return (
    <div className="dashboard-trend" data-overview={overview || undefined}>
      {!overview ? <p className="dashboard-chart-scroll-hint">{labels.scrollHint}</p> : null}
      <div className="dashboard-trend-scroll" role="region" aria-label={labels.scrollLabel} tabIndex={0}>
        <ol className="dashboard-trend-plot" style={{ minInlineSize: overview ? 0 : Math.max(240, points.length * pointWidth) }}>
          {points.map((point, index) => (
            <li key={point.day} className="dashboard-trend-point" data-tick={!overview || index % Math.ceil(points.length / 4) === 0 || undefined}>
              <span className="sr-only">
                <time dateTime={point.day}>{point.dateLabel}</time>{": "}
                <bdi dir="ltr">{point.full}</bdi>
              </span>
              <div className="dashboard-trend-bar-area" aria-hidden>
                <div
                  className="dashboard-trend-bar"
                  data-peak={point.total > 0 && point.total === max || undefined}
                  data-zero={point.total === 0 || undefined}
                  style={{ blockSize: `${point.total / max * 100}%` }}
                >
                  {(!overview || index === peakIndex) ? <span className="dashboard-trend-value" dir="ltr">{point.compact}</span> : null}
                </div>
              </div>
              <time className="dashboard-trend-date" dateTime={point.day} dir="ltr" aria-hidden>{point.shortLabel ?? point.dateLabel}</time>
            </li>
          ))}
        </ol>
      </div>
      <p className="dashboard-chart-latest">
        <span>{labels.latestRecorded}</span>
        <time dateTime={latest.day} dir="ltr">{latest.dateLabel}</time>
      </p>
      <details className="dashboard-chart-details">
        <summary>{labels.exactValues}</summary>
        <table>
          <thead><tr><th scope="col">{labels.date}</th><th scope="col">{labels.value}</th></tr></thead>
          <tbody>{points.map(point => <tr key={point.day}>
            <th scope="row"><time dateTime={point.day} dir="ltr">{point.dateLabel}</time></th>
            <td><bdi dir="ltr">{point.full}</bdi></td>
          </tr>)}</tbody>
        </table>
      </details>
    </div>
  );
}
