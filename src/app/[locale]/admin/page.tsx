import {
  AlertTriangle,
  Boxes,
  Inbox,
  Package,
  PlusCircle,
  ShoppingBag,
  Store,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MetricCard } from "@/components/metric-card";
import { OrderStatusBadge } from "@/components/order-status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { formatCurrency, formatDate, formatNumber } from "@/lib/format";
import {
  customerById,
  customers,
  inventory,
  isLowStock,
  orderSubtotal,
  orders,
  productById,
  productName,
  products,
} from "@/lib/mock";

/** Admin dashboard — metrics, recent orders, low stock, quick actions. */
export default async function AdminDashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const dict = getDictionary(locale);
  const t = dict.admin;

  const newOrders = orders.filter((o) => o.status === "new");
  const openOrders = orders.filter((o) =>
    ["new", "confirmed", "preparing"].includes(o.status),
  );
  const monthOrders = orders.filter(
    (o) => o.createdAt.startsWith("2026-07") && o.status !== "cancelled",
  );
  const monthTotal = monthOrders.reduce(
    (sum, order) => sum + orderSubtotal(order),
    0,
  );
  const lowStockItems = inventory.filter(isLowStock);
  const recentOrders = [...orders]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 5);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink">
          {t.overviewTitle}
        </h1>
        <p className="mt-1 text-sm text-ink-muted">{t.overviewSubtitle}</p>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
        <MetricCard
          label={t.metrics.newOrders}
          value={formatNumber(newOrders.length, locale)}
          icon={<Inbox />}
          tone="brand"
        />
        <MetricCard
          label={t.metrics.openOrders}
          value={formatNumber(openOrders.length, locale)}
          icon={<ShoppingBag />}
        />
        <MetricCard
          label={t.metrics.monthRevenue}
          value={formatCurrency(monthTotal, locale)}
          icon={<Wallet />}
        />
        <MetricCard
          label={t.metrics.activeProducts}
          value={formatNumber(products.length, locale)}
          icon={<Package />}
        />
        <MetricCard
          label={t.metrics.lowStock}
          value={formatNumber(lowStockItems.length, locale)}
          icon={<AlertTriangle />}
          tone="warning"
        />
        <MetricCard
          label={t.metrics.activeShops}
          value={formatNumber(customers.length, locale)}
          icon={<Store />}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        {/* Recent orders */}
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>{t.recentOrders}</CardTitle>
            <Link
              href={`/${locale}/admin/orders`}
              className="text-sm font-medium text-brand-700 hover:underline"
            >
              {dict.common.viewAll}
            </Link>
          </CardHeader>
          <CardContent className="pt-4">
            <ul className="divide-y divide-line/70">
              {recentOrders.map((order) => {
                const customer = customerById.get(order.customerId);
                return (
                  <li key={order.id}>
                    <Link
                      href={`/${locale}/admin/orders/${order.id}`}
                      className="-mx-2 flex items-center gap-3 rounded-field px-2 py-3 transition-colors hover:bg-surface-sunken/60"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-ink">
                          {customer?.name ?? "—"}
                        </p>
                        <p className="text-xs text-ink-muted">
                          <span dir="ltr">{order.number}</span> ·{" "}
                          {formatDate(order.createdAt, locale)}
                        </p>
                      </div>
                      <span className="shrink-0 text-sm font-semibold tabular-nums text-ink">
                        {formatCurrency(orderSubtotal(order), locale)}
                      </span>
                      <OrderStatusBadge status={order.status} dict={dict.status} />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4">
          {/* Low stock */}
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>{t.lowStockTitle}</CardTitle>
              <Link
                href={`/${locale}/admin/inventory`}
                className="text-sm font-medium text-brand-700 hover:underline"
              >
                {dict.common.viewAll}
              </Link>
            </CardHeader>
            <CardContent className="pt-4">
              <ul className="flex flex-col gap-3">
                {lowStockItems.slice(0, 5).map((item) => {
                  const product = productById.get(item.productId)!;
                  return (
                    <li
                      key={item.productId}
                      className="flex items-center justify-between gap-3 text-sm"
                    >
                      <span className="min-w-0 flex-1 truncate text-ink-soft">
                        {productName(product, locale)}
                      </span>
                      <span
                        className={
                          item.stockPackages === 0
                            ? "font-bold tabular-nums text-danger"
                            : "font-bold tabular-nums text-warning"
                        }
                      >
                        {formatNumber(item.stockPackages, locale)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>

          {/* Quick actions */}
          <Card>
            <CardHeader>
              <CardTitle>{t.quickActions}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 pt-4">
              <Link
                href={`/${locale}/admin/products/new`}
                className="flex h-11 items-center gap-3 rounded-field border border-line px-3 text-sm font-medium text-ink transition-colors hover:border-brand-300 hover:bg-brand-50"
              >
                <PlusCircle className="size-4 text-brand-600" aria-hidden />
                {t.actionNewProduct}
              </Link>
              <Link
                href={`/${locale}/admin/orders`}
                className="flex h-11 items-center gap-3 rounded-field border border-line px-3 text-sm font-medium text-ink transition-colors hover:border-brand-300 hover:bg-brand-50"
              >
                <Inbox className="size-4 text-brand-600" aria-hidden />
                {t.actionViewOrders}
              </Link>
              <Link
                href={`/${locale}/catalog`}
                className="flex h-11 items-center gap-3 rounded-field border border-line px-3 text-sm font-medium text-ink transition-colors hover:border-brand-300 hover:bg-brand-50"
              >
                <Boxes className="size-4 text-brand-600" aria-hidden />
                {t.actionOpenCatalog}
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
