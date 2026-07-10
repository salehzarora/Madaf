/**
 * Shared date-range filtering for admin lists (M8C). Presets resolve
 * against the viewer's LOCAL clock (admin lists are per-request in
 * supabase mode; the mock demo's data lives in July 2026, so "all" stays
 * the default there).
 */

export const DATE_RANGE_PRESETS = [
  "all",
  "today",
  "7d",
  "month",
  "custom",
] as const;
export type DateRangePreset = (typeof DATE_RANGE_PRESETS)[number];

export interface DateBounds {
  /** Inclusive start (ms epoch). */
  from?: number;
  /** Exclusive end (ms epoch). */
  to?: number;
}

/** Local-midnight start of the given date. */
function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function dateRangeBounds(
  preset: DateRangePreset,
  customFrom?: string,
  customTo?: string,
): DateBounds {
  const now = new Date();
  switch (preset) {
    case "today":
      return { from: startOfDay(now) };
    case "7d":
      return { from: startOfDay(now) - 6 * 86_400_000 };
    case "month":
      return {
        from: new Date(now.getFullYear(), now.getMonth(), 1).getTime(),
      };
    case "custom": {
      // <input type="date"> values are YYYY-MM-DD in the local zone.
      const from = customFrom ? Date.parse(`${customFrom}T00:00:00`) : NaN;
      const to = customTo ? Date.parse(`${customTo}T00:00:00`) : NaN;
      return {
        from: Number.isNaN(from) ? undefined : from,
        to: Number.isNaN(to) ? undefined : to + 86_400_000, // inclusive day
      };
    }
    default:
      return {};
  }
}

export function inDateRange(iso: string, bounds: DateBounds): boolean {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return false;
  if (bounds.from !== undefined && t < bounds.from) return false;
  if (bounds.to !== undefined && t >= bounds.to) return false;
  return true;
}
