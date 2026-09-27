import "server-only";
import { productById } from "@/lib/mock";
import { getDataMode } from "./mode";
import type { DashboardMetrics } from "./dashboard";

export type DashboardThumbnail = { imageUrl?: string };
/** At most five ranked products + four low-stock products; duplicates coalesce.
 * Caller cannot accidentally turn this into a catalog read. No prices, raw
 * object paths, translations or other product fields cross the client boundary. */
export function dashboardThumbnailIds(metrics: Pick<DashboardMetrics, "topProducts" | "lowStock">): string[] {
  return [...new Set([...metrics.topProducts.slice(0, 5), ...metrics.lowStock.items.slice(0, 4)].map(p => p.productId))];
}
export async function getDashboardThumbnails(metrics: Pick<DashboardMetrics, "topProducts" | "lowStock">): Promise<Record<string, DashboardThumbnail>> {
  const ids = dashboardThumbnailIds(metrics);
  if (!ids.length) return {};
  if (getDataMode() === "supabase") return (await import("./supabase-reads")).sbGetDashboardThumbnails(ids);
  return Object.fromEntries(ids.map(id => [id, { imageUrl: productById.get(id)?.imageUrl }]));
}
