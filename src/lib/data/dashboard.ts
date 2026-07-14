/**
 * Dashboard metrics data access (PILOT-READINESS-BATCH-C · C1).
 *
 * The admin dashboard used to load the ENTIRE order history (every order + its
 * line items) with `listOrders()` and aggregate every KPI/chart in the page
 * component — which PostgREST silently caps at max_rows (1000), quietly
 * corrupting all-time totals once a tenant crosses that line.
 *
 * This module exposes ONE bounded read, `getDashboardMetrics()`:
 *   • supabase → the `get_dashboard_metrics` RPC (one aggregate response;
 *     never an order/order_items row list); RLS is the authorization boundary.
 *   • mock     → `computeDashboardMetrics` over the small fixed demo arrays —
 *     the SAME metric definitions, kept so the zero-config demo is unchanged.
 *
 * `computeDashboardMetrics` is the pure reference for those definitions (unit
 * tested); the RPC reproduces them in SQL (pgTAP tested). Both must agree.
 */
import {
  customers as mockCustomers,
  inventory as mockInventory,
  orders as mockOrders,
  products as mockProducts,
} from "@/lib/mock";
import { isLowStock, LOW_STOCK_THRESHOLD, orderSubtotal } from "@/lib/catalog-helpers";
import { tenantDateKey, tenantToday } from "@/lib/time";
import {
  ORDER_STATUSES,
  type Customer,
  type InventoryItem,
  type LocalizedText,
  type Order,
  type OrderStatus,
  type Product,
} from "@/lib/types";

import { getDataMode } from "./mode";
import { getTenantTimeZone } from "./supplier";

/** Bounded dashboard KPIs/charts — the ONLY thing the dashboard reads for its
 * aggregates. Names are resolved DB-side (or from the mock catalog) so no
 * separate, truncatable name lookup is needed. */
export interface DashboardMetrics {
  statusCounts: Record<OrderStatus, number>;
  totalOrders: number;
  today: { count: number; revenue: number };
  month: { count: number; revenue: number };
  guestPending: number;
  /** Ascending, ≤14 tenant-local days that HAVE non-cancelled orders. */
  trend: { day: string; total: number }[];
  topProducts: { productId: string; name: LocalizedText; revenue: number }[];
  topShops: { customerId: string; name: string; total: number; count: number }[];
  activeProductCount: number;
  activeShopCount: number;
  lowStock: {
    count: number;
    outOfStockCount: number;
    items: {
      productId: string;
      name: LocalizedText;
      location: string;
      stock: number;
      threshold: number;
    }[];
  };
}

export interface DashboardMetricsInput {
  orders: Order[];
  customers: Customer[];
  products: Product[];
  inventory: InventoryItem[];
  timeZone: string;
  /** Tenant-local `YYYY-MM` the month tiles bucket against. */
  monthPrefix: string;
  /** Tenant-local `YYYY-MM-DD` "today". */
  today: string;
}

function localizedName(product: Product): LocalizedText {
  return {
    ar: product.translations.ar?.name ?? "",
    he: product.translations.he?.name ?? "",
    en: product.translations.en?.name ?? "",
  };
}

/**
 * Pure reference implementation of every dashboard metric — the SAME
 * definitions the `get_dashboard_metrics` RPC computes in SQL. Kept pure so the
 * mock demo uses it directly and it can be unit-tested against known inputs.
 */
export function computeDashboardMetrics(
  input: DashboardMetricsInput,
): DashboardMetrics {
  const { orders, customers, products, inventory, timeZone, monthPrefix, today } =
    input;

  const productById = new Map(products.map((p) => [p.id, p]));
  const customerById = new Map(customers.map((c) => [c.id, c]));

  const live = orders.filter((o) => o.status !== "cancelled");

  const statusCounts = Object.fromEntries(
    ORDER_STATUSES.map((s) => [s, orders.filter((o) => o.status === s).length]),
  ) as Record<OrderStatus, number>;

  const todayOrders = live.filter(
    (o) => tenantDateKey(o.createdAt, timeZone) === today,
  );
  const monthOrders = live.filter((o) =>
    tenantDateKey(o.createdAt, timeZone).startsWith(monthPrefix),
  );

  const guestPending = orders.filter(
    (o) => o.status === "new" && !o.customerId && o.customerSnapshot?.guest,
  ).length;

  // Trend: per tenant-local day total (non-cancelled), the last 14 days present.
  const byDay = new Map<string, number>();
  for (const o of live) {
    const day = tenantDateKey(o.createdAt, timeZone);
    byDay.set(day, (byDay.get(day) ?? 0) + orderSubtotal(o));
  }
  const trend = [...byDay.keys()]
    .sort()
    .slice(-14)
    .map((day) => ({ day, total: byDay.get(day) ?? 0 }));

  // Top products by summed line revenue (non-cancelled).
  const prodRev = new Map<string, number>();
  for (const o of live) {
    for (const it of o.items) {
      prodRev.set(
        it.productId,
        (prodRev.get(it.productId) ?? 0) + it.quantity * it.unitPrice,
      );
    }
  }
  const topProducts = [...prodRev.entries()]
    .map(([productId, revenue]) => ({
      product: productById.get(productId),
      productId,
      revenue,
    }))
    .filter((x) => x.product)
    // productId is a deterministic tiebreak (matches the RPC's `order by rev
    // desc, product_id`) so an exact revenue tie has a stable top-5.
    .sort((a, b) => b.revenue - a.revenue || a.productId.localeCompare(b.productId))
    .slice(0, 5)
    .map((x) => ({
      productId: x.productId,
      name: localizedName(x.product!),
      revenue: x.revenue,
    }));

  // Top shops by summed subtotal (non-cancelled), linked customers only.
  const shopTotals = new Map<string, { total: number; count: number }>();
  for (const o of live) {
    const cur = shopTotals.get(o.customerId) ?? { total: 0, count: 0 };
    shopTotals.set(o.customerId, {
      total: cur.total + orderSubtotal(o),
      count: cur.count + 1,
    });
  }
  const topShops = [...shopTotals.entries()]
    .map(([customerId, v]) => ({
      customer: customerById.get(customerId),
      customerId,
      ...v,
    }))
    .filter((x) => x.customer)
    // customerId tiebreak matches the RPC's `order by total desc, customer_id`.
    .sort((a, b) => b.total - a.total || a.customerId.localeCompare(b.customerId))
    .slice(0, 4)
    .map((x) => ({
      customerId: x.customerId,
      name: x.customer!.name,
      total: x.total,
      count: x.count,
    }));

  const activeProductCount = products.filter(
    (p) => p.isActive !== false,
  ).length;
  const activeShopCount = customers.filter((c) => c.isActive !== false).length;

  // Low stock: active products below threshold.
  const lowStockItems = inventory.filter(
    (i) => isLowStock(i) && productById.get(i.productId)?.isActive !== false,
  );
  const lowStock = {
    count: lowStockItems.length,
    outOfStockCount: lowStockItems.filter((i) => i.stockPackages === 0).length,
    items: lowStockItems
      .slice(0, 4)
      .map((i) => {
        const product = productById.get(i.productId);
        return {
          productId: i.productId,
          name: product ? localizedName(product) : { ar: "", he: "", en: "" },
          location: i.location ?? "",
          stock: i.stockPackages,
          threshold: i.lowStockThreshold ?? LOW_STOCK_THRESHOLD,
        };
      }),
  };

  return {
    statusCounts,
    totalOrders: orders.length,
    today: {
      count: todayOrders.length,
      revenue: todayOrders.reduce((s, o) => s + orderSubtotal(o), 0),
    },
    month: {
      count: monthOrders.length,
      revenue: monthOrders.reduce((s, o) => s + orderSubtotal(o), 0),
    },
    guestPending,
    trend,
    topProducts,
    topShops,
    activeProductCount,
    activeShopCount,
    lowStock,
  };
}

/**
 * The dashboard's bounded aggregate. Supabase mode runs ONE `get_dashboard_metrics`
 * RPC (RLS-scoped, no full-history scan); mock mode aggregates the small demo
 * arrays with the same definitions (unchanged zero-config demo). The month tiles
 * pin `2026-07` in mock (the demo data lives there) exactly as before.
 */
export async function getDashboardMetrics(): Promise<DashboardMetrics> {
  if (getDataMode() === "supabase") {
    return (await import("./supabase-reads")).sbGetDashboardMetrics();
  }
  const timeZone = await getTenantTimeZone();
  return computeDashboardMetrics({
    orders: mockOrders,
    customers: mockCustomers,
    products: mockProducts,
    inventory: mockInventory,
    timeZone,
    monthPrefix: "2026-07",
    today: tenantToday(timeZone),
  });
}
