import "server-only";
import type { DashboardRange } from "@/lib/dashboard-range";
import { orderSubtotal } from "@/lib/catalog-helpers";
import { orders, products, customers, inventory } from "@/lib/mock";
import { computeDashboardMetrics, type DashboardMetrics, type DashboardMetricsInput } from "./dashboard";
import { getDataMode } from "./mode";

export interface DashboardBucket {
  start: string; end: string; new: number; open: number; count: number; revenue: number;
}
export interface DashboardPeriodMetrics extends Pick<DashboardMetrics, "statusCounts" | "totalOrders" | "topProducts" | "topShops"> {
  count: number;
  revenue: number;
  buckets: DashboardBucket[];
}

/** Mock reference for the bounded SQL aggregate. Counts by creation interval
 * and CURRENT status are not historical backlog snapshots. Zero buckets are
 * genuine absence of matching orders; cancelled orders never add revenue. */
export function computeDashboardPeriod(input: DashboardMetricsInput, range: DashboardRange): DashboardPeriodMetrics {
  const selected = input.orders.filter(o => Date.parse(o.createdAt) >= Date.parse(range.start) && Date.parse(o.createdAt) < Date.parse(range.end));
  const metrics = computeDashboardMetrics({ ...input, orders: selected });
  const buckets = range.boundaries.slice(0, -1).map((start, index) => {
    const end = range.boundaries[index + 1];
    const rows = selected.filter(o => Date.parse(o.createdAt) >= Date.parse(start) && Date.parse(o.createdAt) < Date.parse(end));
    const live = rows.filter(o => o.status !== "cancelled");
    return { start, end, new: rows.filter(o => o.status === "new").length, open: rows.filter(o => ["new", "confirmed", "preparing"].includes(o.status)).length, count: live.length, revenue: live.reduce((sum, o) => sum + orderSubtotal(o), 0) };
  });
  return { statusCounts: metrics.statusCounts, totalOrders: metrics.totalOrders, topProducts: metrics.topProducts, topShops: metrics.topShops, count: buckets.reduce((sum, b) => sum + b.count, 0), revenue: buckets.reduce((sum, b) => sum + b.revenue, 0), buckets };
}

export async function getDashboardPeriodMetrics(range: DashboardRange): Promise<DashboardPeriodMetrics> {
  if (getDataMode() === "supabase") return (await import("./dashboard-period-supabase")).sbGetDashboardPeriodMetrics(range);
  return computeDashboardPeriod({ orders, products, customers, inventory, timeZone: range.timeZone, monthPrefix: range.to.slice(0, 7), today: range.to }, range);
}
