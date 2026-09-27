import "server-only";
import { Temporal } from "@js-temporal/polyfill";
import { parseDateOnlyStrict, resolveTenantTimeZone } from "@/lib/time";
import { tenantDayStartUtcIso } from "@/lib/tenant-day";

export const DASHBOARD_RANGES = ["24h", "48h", "7d", "30d", "3m", "custom"] as const;
export type DashboardRangeKey = typeof DASHBOARD_RANGES[number];
export type DashboardSearchParams = Record<string, string | string[] | undefined>;
export interface DashboardRange {
  key: DashboardRangeKey;
  from: string;
  to: string;
  start: string;
  end: string;
  now: string;
  timeZone: string;
  bucket: "hour" | "day" | "week";
  /** Contiguous half-open UTC intervals. At most 93 buckets, including zeros. */
  boundaries: string[];
  invalid: boolean;
}

/** No browser/machine date authority. Custom dates include the entire final
 * tenant-local day. Reject ambiguous duplicate params and spans over one year. */
export function resolveDashboardRange(params: DashboardSearchParams, zone: string, now = new Date()): DashboardRange {
  const timeZone = resolveTenantTimeZone(zone);
  const instant = Temporal.Instant.from(now.toISOString());
  const local = instant.toZonedDateTimeISO(timeZone);
  const today = local.toPlainDate();
  const requested = params.range;
  let key: DashboardRangeKey = typeof requested === "string" && DASHBOARD_RANGES.includes(requested as DashboardRangeKey) ? requested as DashboardRangeKey : "30d";
  let invalid = requested !== undefined && key !== requested;
  let from = today.subtract({ days: 29 });
  let to = today;
  if (key === "custom") {
    const f = parseDateOnlyStrict(params.from), t = parseDateOnlyStrict(params.to);
    if (f && t && f <= t && t <= today.toString() && Temporal.PlainDate.from(f).until(Temporal.PlainDate.from(t)).days < 366) {
      from = Temporal.PlainDate.from(f); to = Temporal.PlainDate.from(t);
    } else { key = "30d"; invalid = true; }
  }
  if (key === "7d") from = today.subtract({ days: 6 });
  if (key === "3m") from = today.subtract({ months: 3 }).add({ days: 1 });
  let start: Temporal.Instant;
  let end: Temporal.Instant;
  if (key === "24h" || key === "48h") {
    end = instant; start = instant.subtract({ hours: key === "24h" ? 24 : 48 });
    from = start.toZonedDateTimeISO(timeZone).toPlainDate();
  } else {
    start = Temporal.Instant.from(tenantDayStartUtcIso(from.toString(), timeZone)!);
    end = Temporal.Instant.from(tenantDayStartUtcIso(to.add({ days: 1 }).toString(), timeZone)!);
  }
  const days = from.until(to).days + 1;
  // A historical timezone jump can skip an entire calendar date (e.g. Apia).
  // Such a custom request has no elapsed interval; never send one edge to SQL.
  if (Temporal.Instant.compare(start, end) >= 0) return { ...resolveDashboardRange({}, timeZone, now), invalid: true };
  const bucket = key === "24h" || key === "48h" ? "hour" : key === "3m" || days > 93 ? "week" : "day";
  const boundaries = [start.toString()];
  let cursor = start;
  while (Temporal.Instant.compare(cursor, end) < 0) {
    const next = bucket === "hour" ? cursor.add({ hours: 1 }) : Temporal.Instant.from(tenantDayStartUtcIso(cursor.toZonedDateTimeISO(timeZone).toPlainDate().add({ days: bucket === "week" ? 7 : 1 }).toString(), timeZone)!);
    cursor = Temporal.Instant.compare(next, end) > 0 ? end : next;
    boundaries.push(cursor.toString());
  }
  return { key, from: from.toString(), to: to.toString(), start: start.toString(), end: end.toString(), now: instant.toString(), timeZone, bucket, boundaries, invalid };
}
