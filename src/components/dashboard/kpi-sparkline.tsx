import type { Dictionary } from "@/i18n/types";
import { interpolate } from "@/i18n/dictionaries";

/** Chronological, zero-based microchart. It describes actual bucket movement,
 * never a growth percentage or historical change in operational backlog. */
export function KpiSparkline({ values, labels }: { values: number[]; labels: Dictionary["admin"]["dashboard"]["range"] }) {
  if (values.length < 2) return null;
  const max = Math.max(1, ...values);
  const points = values.map((value, i) => `${4 + i / (values.length - 1) * 152},${40 - value / max * 34}`).join(" ");
  const direction = values.at(-1)! > values[0] ? "rising" : values.at(-1)! < values[0] ? "falling" : "flat";
  return <div className="dashboard-sparkline" data-direction={direction}>
    <svg viewBox="0 0 160 46" preserveAspectRatio="none" role="img" aria-label={interpolate(labels.spark, { direction: labels[direction] })}>
      <polygon points={`4,44 ${points} 156,44`} fill="currentColor" opacity=".09" />
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  </div>;
}
