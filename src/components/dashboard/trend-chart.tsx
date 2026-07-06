import { cn } from "@/lib/utils";

/**
 * Orders-trend bars (Dashboard v2) — pure flexbox, no chart library. Bar
 * chronology follows reading direction (right→left in he/ar is intentional).
 * Value labels + day labels are Latin identifiers → dir="ltr".
 */
export interface TrendDay {
  /** dd/M day label. */
  dayLabel: string;
  value: number;
  /** Compact value label, e.g. "2.9K". */
  compact: string;
  /** Full currency string for the title tooltip. */
  full: string;
  isToday?: boolean;
}

export function TrendChart({ days }: { days: TrendDay[] }) {
  const max = Math.max(1, ...days.map((d) => d.value));
  return (
    <div className="overflow-x-auto">
      {/* min-width floor keeps 14 bars legible; scrolls inside the card on
          narrow viewports instead of overflowing the page. */}
      <div className="min-w-[440px]">
      <div className="flex h-[150px] items-end gap-2 border-b-[1.5px] border-line-strong">
        {days.map((d, i) => {
          const pct = d.value > 0 ? Math.max((d.value / max) * 100, 2) : 0;
          const isMax = d.value === max && d.value > 0;
          return (
            <div
              key={i}
              className="flex h-full flex-1 flex-col items-center justify-end gap-1.5"
              title={d.full}
            >
              <span
                className={cn(
                  "font-mono text-[10px] font-semibold tabular-nums",
                  d.isToday ? "text-accent-text" : "text-ink-muted",
                )}
                dir="ltr"
              >
                {d.value > 0 ? d.compact : ""}
              </span>
              <div
                className={cn(
                  "w-full max-w-11 rounded-[5px_5px_2px_2px]",
                  d.value === 0
                    ? "bg-line-hair"
                    : d.isToday
                      ? "bg-accent"
                      : isMax
                        ? "bg-brand-600"
                        : "bg-brand-300",
                )}
                style={{ height: `${pct}%`, minHeight: d.value > 0 ? 2 : 0 }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex gap-2">
        {days.map((d, i) => (
          <span
            key={i}
            className="flex-1 text-center font-mono text-[10px] text-ink-muted"
            dir="ltr"
          >
            {d.dayLabel}
          </span>
        ))}
      </div>
      </div>
    </div>
  );
}
