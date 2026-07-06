/**
 * Order-status donut (Dashboard v2) — pure inline SVG, no chart library.
 * All circles share r=15.9; the container is rotated −90° so segments start
 * at 12 o'clock. Each segment's dasharray leaves a 1.2-unit gap.
 */
const R = 15.9;
const C = 2 * Math.PI * R; // ≈ 99.9

export interface DonutSegment {
  label: string;
  count: number;
  /** Literal chart color (intentional exception to the token rule). */
  color: string;
}

export function StatusDonut({
  segments,
  total,
  totalLabel,
}: {
  segments: DonutSegment[];
  total: number;
  totalLabel: string;
}) {
  const fracs = segments.map((s) => (total > 0 ? s.count / total : 0));
  // Cumulative offset before each segment (prefix sum × circumference) — pure.
  const offsets = fracs.map(
    (_, i) => fracs.slice(0, i).reduce((a, b) => a + b, 0) * C,
  );
  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center sm:gap-5">
      <div className="relative size-[132px] shrink-0">
        <svg viewBox="0 0 42 42" className="size-full -rotate-90">
          <circle
            cx="21"
            cy="21"
            r={R}
            fill="none"
            strokeWidth="6"
            className="stroke-line-hair"
          />
          {segments.map((s, i) => {
            if (s.count <= 0) return null;
            const len = Math.max(fracs[i] * C - 1.2, 0);
            return (
              <circle
                key={s.label}
                cx="21"
                cy="21"
                r={R}
                fill="none"
                strokeWidth="6"
                stroke={s.color}
                strokeDasharray={`${len} ${C - len}`}
                strokeDashoffset={-offsets[i]}
              />
            );
          })}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span
            className="font-mono text-xl font-bold tabular-nums text-ink"
            dir="ltr"
          >
            {total}
          </span>
          <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-ink-muted">
            {totalLabel}
          </span>
        </div>
      </div>
      <ul className="flex w-full flex-col gap-1.5">
        {segments.map((s) => (
          <li key={s.label} className="flex items-center gap-2 text-[13px]">
            <span
              className="size-[9px] shrink-0 rounded-[2px]"
              style={{ backgroundColor: s.color }}
              aria-hidden
            />
            <span className="flex-1 truncate text-ink-soft">{s.label}</span>
            <span
              className="font-mono font-semibold tabular-nums text-ink"
              dir="ltr"
            >
              {s.count}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
