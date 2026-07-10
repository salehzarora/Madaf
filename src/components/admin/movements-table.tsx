"use client";

import { History, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { EmptyState } from "@/components/empty-state";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { Input, Select } from "@/components/ui/input";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/types";
import { productName } from "@/lib/catalog-helpers";
import { formatDate, formatNumber } from "@/lib/format";
import type { InventoryMovement, Order, Product } from "@/lib/types";
import { cn } from "@/lib/utils";

type Direction = "all" | "in" | "out";

/**
 * Stock-movement ledger table (M8B.1) with product search, reason and
 * direction filters. Rows/products/orders come from the server page; known
 * machine reasons map to localized labels, unknown ones render raw.
 */
export function MovementsTable({
  movements,
  products,
  orders,
  locale,
  dict,
}: {
  movements: InventoryMovement[];
  products: Product[];
  orders: Order[];
  locale: Locale;
  dict: Dictionary;
}) {
  const t = dict.admin.inventory.movements;
  const [query, setQuery] = useState("");
  const [reason, setReason] = useState<string>("all");
  const [direction, setDirection] = useState<Direction>("all");

  const productById = useMemo(
    () => new Map(products.map((p) => [p.id, p])),
    [products],
  );
  const orderById = useMemo(
    () => new Map(orders.map((o) => [o.id, o])),
    [orders],
  );

  // Reason filter options: only reasons that actually occur in the data.
  const presentReasons = useMemo(
    () => [...new Set(movements.map((m) => m.reason))].sort(),
    [movements],
  );

  const reasonLabel = (value: string): string =>
    (t.reasons as Record<string, string>)[value] ?? value;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return movements
      .filter((m) => (reason === "all" ? true : m.reason === reason))
      .filter((m) =>
        direction === "all"
          ? true
          : direction === "in"
            ? m.quantityDelta > 0
            : m.quantityDelta < 0,
      )
      .filter((m) => {
        if (!q) return true;
        const product = m.productId ? productById.get(m.productId) : undefined;
        const order = m.orderId ? orderById.get(m.orderId) : undefined;
        return [
          product ? productName(product, locale) : "",
          product?.sku ?? "",
          order?.number ?? "",
          order?.publicRef ?? "",
          m.note ?? "",
        ]
          .join(" ")
          .toLowerCase()
          .includes(q);
      });
  }, [movements, query, reason, direction, productById, orderById, locale]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative sm:max-w-sm sm:flex-1">
          <Search
            className="pointer-events-none absolute inset-y-0 start-3 my-auto size-4 text-ink-muted"
            aria-hidden
          />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.searchPlaceholder}
            aria-label={t.searchPlaceholder}
            className="ps-9"
          />
        </div>
        <Select
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          aria-label={t.colReason}
          className="sm:w-56"
        >
          <option value="all">{t.allReasons}</option>
          {presentReasons.map((r) => (
            <option key={r} value={r}>
              {reasonLabel(r)}
            </option>
          ))}
        </Select>
        <div className="flex gap-2">
          {(["all", "in", "out"] as const).map((d) => (
            <Chip
              key={d}
              selected={direction === d}
              onClick={() => setDirection(d)}
              className="h-9 px-3 text-xs"
            >
              {t.direction[d]}
            </Chip>
          ))}
        </div>
      </div>

      {/* The read caps at the 500 newest rows — say so instead of letting a
          filtered miss read as "it never happened" (M8B review fix). */}
      {movements.length >= 500 ? (
        <p className="rounded-field bg-info-soft px-3 py-2 text-xs text-info">
          {t.truncatedNote}
        </p>
      ) : null}

      {filtered.length === 0 ? (
        <EmptyState
          icon={<History />}
          title={movements.length === 0 ? t.empty : dict.catalog.noResults}
          hint={movements.length === 0 ? t.emptyHint : undefined}
        />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-warm text-[11px] font-bold uppercase tracking-[0.06em] text-ink-muted">
                <th className="px-4 py-3 text-start">{t.colDate}</th>
                <th className="px-4 py-3 text-start">{t.colProduct}</th>
                <th className="px-4 py-3 text-end">{t.colDelta}</th>
                <th className="px-4 py-3 text-start">{t.colReason}</th>
                <th className="px-4 py-3 text-start">{t.colOrder}</th>
                <th className="px-4 py-3 text-start">{t.colNote}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((m) => {
                const product = m.productId
                  ? productById.get(m.productId)
                  : undefined;
                const order = m.orderId ? orderById.get(m.orderId) : undefined;
                const positive = m.quantityDelta > 0;
                return (
                  <tr
                    key={m.id}
                    className="border-b border-line-hair transition-colors last:border-0 hover:bg-surface-warm"
                  >
                    <td className="px-4 py-3 whitespace-nowrap text-ink-muted">
                      {formatDate(m.createdAt, locale)}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-ink">
                        {product
                          ? productName(product, locale)
                          : dict.admin.orders.detail.unavailableProduct}
                      </p>
                      {product?.sku ? (
                        <p className="font-mono text-xs text-ink-muted" dir="ltr">
                          {product.sku}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-end">
                      <span
                        className={cn(
                          "font-mono text-[13px] font-bold tabular-nums",
                          positive ? "text-success" : "text-danger",
                        )}
                        dir="ltr"
                      >
                        {positive ? "+" : ""}
                        {formatNumber(m.quantityDelta, locale)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-ink-soft">
                      {reasonLabel(m.reason)}
                    </td>
                    <td className="px-4 py-3">
                      {/* "Manual" means the movement HAS no order (orderId
                          null) — an order that merely failed to resolve
                          (truncated orders list) renders "—", never a
                          misleading Manual badge. */}
                      {m.orderId === null ? (
                        <span className="text-ink-muted">{t.manualBadge}</span>
                      ) : order ? (
                        <span className="font-mono text-[13px] text-brand-700" dir="ltr">
                          {order.number}
                        </span>
                      ) : (
                        <span className="text-ink-muted">—</span>
                      )}
                    </td>
                    <td className="max-w-64 px-4 py-3 text-ink-soft">
                      <span className="line-clamp-2">{m.note ?? "—"}</span>
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
