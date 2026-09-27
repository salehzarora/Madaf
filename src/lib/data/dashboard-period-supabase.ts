import "server-only";
import { getDataContext, NO_TENANT } from "@/lib/auth/session";
import type { DashboardRange } from "@/lib/dashboard-range";
import type { DashboardPeriodMetrics } from "./dashboard-period";

/** One aggregate response, not paginated orders. The existing RLS policies
 * remain authoritative even if a caller supplies a different tenant to SQL. */
export async function sbGetDashboardPeriodMetrics(range: DashboardRange): Promise<DashboardPeriodMetrics> {
  const { client, tenantId } = await getDataContext();
  const empty: DashboardPeriodMetrics = { statusCounts: { new: 0, confirmed: 0, preparing: 0, delivered: 0, cancelled: 0 }, totalOrders: 0, count: 0, revenue: 0, topProducts: [], topShops: [], buckets: range.boundaries.slice(0, -1).map((start, i) => ({ start, end: range.boundaries[i + 1], new: 0, open: 0, count: 0, revenue: 0 })) };
  if (tenantId === NO_TENANT) return empty;
  const { data, error } = await client.rpc("get_dashboard_period_metrics", { p_tenant_id: tenantId, p_boundaries: range.boundaries });
  if (error) throw new Error(`[madaf/data] dashboard period aggregate failed: ${error.message}`);
  if (!data) return empty;
  // The versioned read RPC emits this exact camel-case DTO. PostgreSQL numeric
  // values serialize as JSON numbers; no raw rows or storage paths are exposed.
  return data as unknown as DashboardPeriodMetrics;
}
