"use client";

import { Inbox } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { EmptyState } from "@/components/empty-state";
import { OrderStatusBadge } from "@/components/order-status-badge";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import type { Locale } from "@/i18n/config";
import { interpolate } from "@/i18n/dictionaries";
import type { Dictionary } from "@/i18n/types";
import { orderSubtotal } from "@/lib/catalog-helpers";
import { formatCurrency, formatDate } from "@/lib/format";
import { useShopData } from "@/lib/shop-data-context";
import {
  ORDER_STATUSES,
  type Order,
  type OrderStatus,
} from "@/lib/types";

/** Admin orders list with status filter chips. Orders come from the
 * server page (data layer); shop names from the shared reference data. */
export function OrdersTable({
  orders,
  locale,
  dict,
}: {
  orders: Order[];
  locale: Locale;
  dict: Dictionary;
}) {
  const t = dict.admin.orders;
  const { customerById } = useShopData();
  const [status, setStatus] = useState<OrderStatus | null>(null);

  const filtered = useMemo(
    () =>
      [...orders]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .filter((order) => (status ? order.status === status : true)),
    [orders, status],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="scrollbar-none -mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0">
        <Chip
          selected={status === null}
          onClick={() => setStatus(null)}
          className="h-9 px-3 text-xs"
        >
          {dict.common.all}
        </Chip>
        {ORDER_STATUSES.map((s) => (
          <Chip
            key={s}
            selected={status === s}
            onClick={() => setStatus((prev) => (prev === s ? null : s))}
            className="h-9 px-3 text-xs"
          >
            {dict.status[s]}
          </Chip>
        ))}
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={<Inbox />} title={dict.catalog.noResults} />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-sm">
            <thead>
              <tr className="border-b border-line text-xs uppercase tracking-wide text-ink-muted">
                <th className="px-4 py-3 text-start font-medium">{t.colOrder}</th>
                <th className="px-4 py-3 text-start font-medium">{t.colShop}</th>
                <th className="px-4 py-3 text-end font-medium">{t.colItems}</th>
                <th className="px-4 py-3 text-end font-medium">{t.colTotal}</th>
                <th className="px-4 py-3 text-start font-medium">{t.colStatus}</th>
                <th className="px-4 py-3 text-start font-medium">{t.colDate}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((order) => {
                const customer = customerById.get(order.customerId);
                return (
                  <tr
                    key={order.id}
                    className="relative border-b border-line/60 transition-colors last:border-0 hover:bg-surface-sunken/50"
                  >
                    <td className="px-4 py-3.5">
                      <Link
                        href={`/${locale}/admin/orders/${order.id}`}
                        className="font-semibold text-brand-700 hover:underline"
                        dir="ltr"
                      >
                        {order.number}
                      </Link>
                    </td>
                    <td className="px-4 py-3.5 text-ink">
                      {customer?.name ?? "—"}
                    </td>
                    <td className="px-4 py-3.5 text-end tabular-nums text-ink-soft">
                      {interpolate(t.detail.itemsCount, {
                        count: order.items.length,
                      })}
                    </td>
                    <td className="px-4 py-3.5 text-end font-semibold tabular-nums text-ink">
                      {formatCurrency(orderSubtotal(order), locale)}
                    </td>
                    <td className="px-4 py-3.5">
                      <OrderStatusBadge status={order.status} dict={dict.status} />
                    </td>
                    <td className="px-4 py-3.5 text-ink-muted">
                      {formatDate(order.createdAt, locale)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
