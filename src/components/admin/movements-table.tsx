"use client";

import { Download, History, Search } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { Input, Select } from "@/components/ui/input";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/types";
import { loadMoreMovementsAction } from "@/lib/actions/inventory";
import { productName } from "@/lib/catalog-helpers";
import { downloadCsv, toCsv } from "@/lib/csv";
import {
  dateRangeBounds,
  inDateRange,
  type DateRangePreset,
} from "@/lib/date-range";
import { formatDate, formatNumber } from "@/lib/format";
import type { InventoryMovement, Order, Product } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Server page size - mirrors sbListInventoryMovements. */
const PAGE_SIZE = 500;

type Direction = "all" | "in" | "out" | "manual";

/**
 * Stock-movement ledger table (M8B.1) with product search, reason and
 * direction filters. Rows/products/orders come from the server page; known
 * machine reasons map to localized labels, unknown ones render raw.
 */
export function MovementsTable({
  movements: initialMovements,
  products,
  orders,
  canExport = false,
  locale,
  dict,
}: {
  movements: InventoryMovement[];
  products: Product[];
  orders: Order[];
  /** Owner/admin (RLS gives others zero rows anyway) - shows CSV export. */
  canExport?: boolean;
  locale: Locale;
  dict: Dictionary;
}) {
  const t = dict.admin.inventory.movements;
  const [query, setQuery] = useState("");
  const [reason, setReason] = useState<string>("all");
  const [direction, setDirection] = useState<Direction>("all");
  const [preset, setPreset] = useState<DateRangePreset>("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  // "Load more" appends older pages fetched through the RLS-scoped action.
  const [extra, setExtra] = useState<InventoryMovement[]>([]);
  const [hasMore, setHasMore] = useState(initialMovements.length >= PAGE_SIZE);
  const [loading, startLoading] = useTransition();
  const movements = useMemo(
    () => [...initialMovements, ...extra],
    [initialMovements, extra],
  );

  function onLoadMore() {
    startLoading(async () => {
      const result = await loadMoreMovementsAction({
        offset: movements.length,
      });
      if (!result.ok) return; // transient failure — keep the button to retry
      const page = result.movements ?? [];
      if (page.length > 0) {
        // Dedup on id - a fresh movement written between pages shifts
        // offsets, which could repeat a row at the boundary.
        const seen = new Set(movements.map((m) => m.id));
        setExtra((prev) => [...prev, ...page.filter((m) => !seen.has(m.id))]);
      }
      // Only a SHORT page means we reached the end (a failure never hides the
      // button + truncation note).
      setHasMore(page.length >= PAGE_SIZE);
    });
  }

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
    const bounds = dateRangeBounds(preset, customFrom, customTo);
    return movements
      .filter((m) => (reason === "all" ? true : m.reason === reason))
      .filter((m) => {
        switch (direction) {
          case "in":
            return m.quantityDelta > 0;
          case "out":
            return m.quantityDelta < 0;
          case "manual":
            return m.orderId === null;
          default:
            return true;
        }
      })
      .filter((m) =>
        preset === "all" ? true : inDateRange(m.createdAt, bounds),
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
  }, [
    movements,
    query,
    reason,
    direction,
    preset,
    customFrom,
    customTo,
    productById,
    orderById,
    locale,
  ]);

  function onExport() {
    // Admin-only file over the CURRENT filtered (loaded) rows.
    const rows = filtered.map((m) => {
      const product = m.productId ? productById.get(m.productId) : undefined;
      const order = m.orderId ? orderById.get(m.orderId) : undefined;
      return [
        m.createdAt,
        product ? productName(product, locale) : "",
        product?.sku ?? "",
        m.quantityDelta,
        m.reason,
        m.note ?? "",
        order?.number ?? "",
        order?.publicRef ?? "",
      ];
    });
    const csv = toCsv(
      [
        "created_at",
        "product",
        "sku",
        "quantity_delta",
        "reason",
        "note",
        "order_number",
        "public_ref",
      ],
      rows,
    );
    downloadCsv(
      `madaf-stock-movements-${new Date().toISOString().slice(0, 10)}.csv`,
      csv,
    );
  }

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
          {(["all", "in", "out", "manual"] as const).map((d) => (
            <Chip
              key={d}
              selected={direction === d}
              onClick={() => setDirection(d)}
              className="h-9 px-3 text-xs"
            >
              {d === "manual" ? t.manualBadge : t.direction[d]}
            </Chip>
          ))}
        </div>
      </div>

      {/* Date range + export (M8C) */}
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={preset}
          onChange={(e) => setPreset(e.target.value as DateRangePreset)}
          aria-label={dict.admin.orders.dateFilter.label}
          className="w-44"
        >
          <option value="all">{dict.admin.orders.dateFilter.all}</option>
          <option value="today">{dict.admin.orders.dateFilter.today}</option>
          <option value="7d">{dict.admin.orders.dateFilter.last7}</option>
          <option value="month">{dict.admin.orders.dateFilter.month}</option>
          <option value="custom">{dict.admin.orders.dateFilter.custom}</option>
        </Select>
        {preset === "custom" ? (
          <>
            <label className="flex items-center gap-1.5 text-xs text-ink-muted">
              {dict.admin.orders.dateFilter.from}
              <Input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="h-9 w-38"
              />
            </label>
            <label className="flex items-center gap-1.5 text-xs text-ink-muted">
              {dict.admin.orders.dateFilter.to}
              <Input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="h-9 w-38"
              />
            </label>
          </>
        ) : null}
        {canExport ? (
          <button
            type="button"
            onClick={onExport}
            disabled={filtered.length === 0}
            title={filtered.length === 0 ? dict.common.exportEmpty : undefined}
            className="ms-auto inline-flex h-11 items-center gap-1.5 rounded-field border border-line-strong px-4 text-sm font-semibold text-ink transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Download className="size-4" aria-hidden />
            {dict.common.exportCsv}
          </button>
        ) : null}
      </div>

      {/* Older rows exist beyond the loaded pages — say so instead of letting
          a filtered miss read as "it never happened" (M8B/M8C). */}
      {hasMore ? (
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

      {hasMore ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onLoadMore}
          disabled={loading}
          className="self-center"
        >
          {loading ? t.loadingMore : t.loadMore}
        </Button>
      ) : null}
    </div>
  );
}
