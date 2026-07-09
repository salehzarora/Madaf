"use client";

import { Inbox } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { EmptyState } from "@/components/empty-state";
import { OrderStatusBadge } from "@/components/order-status-badge";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { Input } from "@/components/ui/input";
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
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...orders]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .filter((order) => (status ? order.status === status : true))
      .filter((order) => {
        if (!q) return true;
        const customer = customerById.get(order.customerId);
        return [
          order.number,
          order.publicRef ?? "",
          customer?.name ?? "",
          order.customerSnapshot?.name ?? "",
        ]
          .join(" ")
          .toLowerCase()
          .includes(q);
      });
  }, [orders, status, query, customerById]);

  return (
    <div className="flex flex-col gap-4">
      <Input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t.searchPlaceholder}
        aria-label={t.searchPlaceholder}
        className="sm:max-w-sm"
      />
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
        <EmptyState
          icon={<Inbox />}
          title={dict.catalog.noResults}
          hint={dict.catalog.noResultsHint}
        />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-warm text-[11px] font-bold uppercase tracking-[0.06em] text-ink-muted">
                <th className="px-4 py-3 text-start">{t.colOrder}</th>
                <th className="px-4 py-3 text-start">{t.colRef}</th>
                <th className="px-4 py-3 text-start">{t.colShop}</th>
                <th className="px-4 py-3 text-end">{t.colItems}</th>
                <th className="px-4 py-3 text-end">{t.colTotal}</th>
                <th className="px-4 py-3 text-start">{t.colStatus}</th>
                <th className="px-4 py-3 text-start">{t.colDate}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((order) => {
                const customer = customerById.get(order.customerId);
                return (
                  <tr
                    key={order.id}
                    className="relative border-b border-line-hair transition-colors last:border-0 hover:bg-surface-warm"
                  >
                    <td className="px-4 py-3.5">
                      <Link
                        href={`/${locale}/admin/orders/${order.id}`}
                        className="font-mono text-[13px] font-semibold text-brand-700 hover:underline"
                        dir="ltr"
                      >
                        {order.number}
                      </Link>
                    </td>
                    <td
                      className="px-4 py-3.5 font-mono text-[13px] text-ink-soft"
                      dir="ltr"
                    >
                      {order.publicRef ?? "—"}
                    </td>
                    <td className="px-4 py-3.5 font-medium text-ink">
                      {customer ? (
                        customer.name
                      ) : order.customerSnapshot?.name ? (
                        <span className="flex flex-wrap items-center gap-1.5">
                          {order.customerSnapshot.name}
                          <span className="rounded-badge bg-accent-wash px-1.5 py-0.5 text-[10px] font-bold text-warning">
                            {t.detail.guest.badge}
                          </span>
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-3.5 text-end tabular-nums text-ink-soft">
                      {interpolate(t.detail.itemsCount, {
                        count: order.items.length,
                      })}
                    </td>
                    <td className="px-4 py-3.5 text-end font-bold tabular-nums text-ink">
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
