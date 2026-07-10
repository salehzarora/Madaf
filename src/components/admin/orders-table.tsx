"use client";

import { Download, Inbox, X } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { EmptyState } from "@/components/empty-state";
import { OrderStatusBadge } from "@/components/order-status-badge";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { Input, Select } from "@/components/ui/input";
import type { Locale } from "@/i18n/config";
import { interpolate } from "@/i18n/dictionaries";
import type { Dictionary } from "@/i18n/types";
import { orderSubtotal } from "@/lib/catalog-helpers";
import { downloadCsv, toCsv } from "@/lib/csv";
import {
  dateRangeBounds,
  inDateRange,
  type DateRangePreset,
} from "@/lib/date-range";
import { formatCurrency, formatDate } from "@/lib/format";
import { useShopData } from "@/lib/shop-data-context";
import {
  ORDER_STATUSES,
  type Order,
  type OrderStatus,
} from "@/lib/types";

/** Filtered-export ceiling (M8E.1). Orders load fully client-side, so the
 * export already covers every filtered row; the cap + warning are a defensive
 * bound so a very large tenant never ships an unbounded file silently. */
const EXPORT_CAP = 5000;

/** Order-source facets (M8C): how the order reached the warehouse. */
type SourceFilter = "all" | "sales_visit" | "shop_link" | "guest";

function sourceOf(order: Order): Exclude<SourceFilter, "all"> {
  if (order.customerSnapshot?.guest && !order.customerId) return "guest";
  if (order.source === "remote_customer") return "shop_link";
  return "sales_visit";
}

/** Admin orders list with status/source/date filters, search and CSV export
 * (M8C). Orders come from the server page (data layer); shop names from the
 * shared reference data. Export is owner/admin only (page-gated) and covers
 * exactly the CURRENT filtered rows — admin-side, so the internal number is
 * allowed (customer surfaces stay publicRef-only). */
export function OrdersTable({
  orders,
  locale,
  dict,
  canExport = false,
  initialStatuses,
  initialSource,
}: {
  orders: Order[];
  locale: Locale;
  dict: Dictionary;
  /** Owner/admin (or mock demo) — shows the CSV export button. */
  canExport?: boolean;
  /** Deep-link preselected statuses (dashboard cards may span two). */
  initialStatuses?: OrderStatus[];
  /** Deep-link preselected source facet (e.g. dashboard guest-orders card). */
  initialSource?: SourceFilter;
}) {
  const t = dict.admin.orders;
  const { customerById } = useShopData();
  // Multi-select status: empty set = all (M8D — a dashboard card can preselect
  // a status GROUP like confirmed+preparing via ?status=confirmed,preparing).
  const [statuses, setStatuses] = useState<Set<OrderStatus>>(
    () => new Set((initialStatuses ?? []).filter((s) => ORDER_STATUSES.includes(s))),
  );
  const [source, setSource] = useState<SourceFilter>(initialSource ?? "all");
  const [preset, setPreset] = useState<DateRangePreset>("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [query, setQuery] = useState("");
  const [exportNote, setExportNote] = useState<string | null>(null);

  const hasFilters =
    statuses.size > 0 ||
    source !== "all" ||
    preset !== "all" ||
    query.trim() !== "";

  function toggleStatus(s: OrderStatus) {
    setStatuses((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  }

  function clearFilters() {
    setStatuses(new Set());
    setSource("all");
    setPreset("all");
    setCustomFrom("");
    setCustomTo("");
    setQuery("");
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const bounds = dateRangeBounds(preset, customFrom, customTo);
    return [...orders]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .filter((order) => (statuses.size === 0 ? true : statuses.has(order.status)))
      .filter((order) => (source === "all" ? true : sourceOf(order) === source))
      .filter((order) =>
        preset === "all" ? true : inDateRange(order.createdAt, bounds),
      )
      .filter((order) => {
        if (!q) return true;
        const customer = customerById.get(order.customerId);
        return [
          order.number,
          order.publicRef ?? "",
          customer?.name ?? "",
          customer?.phone ?? "",
          order.customerSnapshot?.name ?? "",
          order.customerSnapshot?.phone ?? "",
        ]
          .join(" ")
          .toLowerCase()
          .includes(q);
      });
  }, [orders, statuses, source, preset, customFrom, customTo, query, customerById]);

  function onExport() {
    // Admin-only file: internal number allowed; phone comes from the store
    // record / guest snapshot the admin already sees on screen. Bounded by
    // EXPORT_CAP — past it we export the first CAP rows and warn (M8E.1).
    setExportNote(null);
    const capped = filtered.length > EXPORT_CAP;
    const rows = (capped ? filtered.slice(0, EXPORT_CAP) : filtered).map((order) => {
      const customer = customerById.get(order.customerId);
      const src = sourceOf(order);
      return [
        order.number,
        order.publicRef ?? "",
        order.createdAt,
        order.status,
        customer?.name ?? order.customerSnapshot?.name ?? "",
        src === "guest" ? "yes" : "no",
        t.sourceFilter[src],
        orderSubtotal(order).toFixed(2),
        order.items.length,
        customer?.phone ?? order.customerSnapshot?.phone ?? "",
      ];
    });
    const h = t.csv;
    const csv = toCsv(
      [
        h.orderNumber,
        h.publicRef,
        h.date,
        h.status,
        h.store,
        h.guest,
        h.source,
        h.total,
        h.itemCount,
        h.phone,
      ],
      rows,
    );
    downloadCsv(
      `madaf-orders-${new Date().toISOString().slice(0, 10)}.csv`,
      csv,
    );
    if (capped) {
      setExportNote(interpolate(dict.common.exportCapped, { count: EXPORT_CAP }));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t.searchPlaceholder}
          aria-label={t.searchPlaceholder}
          className="sm:max-w-sm"
        />
        {canExport ? (
          <button
            type="button"
            onClick={onExport}
            disabled={filtered.length === 0}
            title={filtered.length === 0 ? dict.common.exportEmpty : undefined}
            className="inline-flex h-11 items-center gap-1.5 rounded-field border border-line-strong px-4 text-sm font-semibold text-ink transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:cursor-not-allowed disabled:opacity-50 sm:ms-auto"
          >
            <Download className="size-4" aria-hidden />
            {dict.common.exportCsv}
          </button>
        ) : null}
      </div>

      {exportNote ? (
        <p
          role="status"
          className="rounded-field bg-warning-soft px-3 py-2 text-[13px] font-medium text-warning"
        >
          {exportNote}
        </p>
      ) : null}

      {/* Status — multi-select (empty = all) */}
      <div className="scrollbar-none -mx-4 flex items-center gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0">
        <Chip
          selected={statuses.size === 0}
          onClick={() => setStatuses(new Set())}
          className="h-9 px-3 text-xs"
        >
          {dict.common.all}
        </Chip>
        {ORDER_STATUSES.map((s) => (
          <Chip
            key={s}
            selected={statuses.has(s)}
            onClick={() => toggleStatus(s)}
            className="h-9 px-3 text-xs"
          >
            {dict.status[s]}
          </Chip>
        ))}
        {hasFilters ? (
          <button
            type="button"
            onClick={clearFilters}
            className="ms-1 inline-flex h-9 shrink-0 items-center gap-1 rounded-field px-3 text-xs font-semibold text-ink-muted transition-colors hover:bg-surface-sunken hover:text-danger focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
          >
            <X className="size-3.5" aria-hidden />
            {t.clearFilters}
          </button>
        ) : null}
      </div>

      {/* Source + date range */}
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="scrollbar-none -mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          {(["all", "sales_visit", "shop_link", "guest"] as const).map((s) => (
            <Chip
              key={s}
              selected={source === s}
              onClick={() => setSource(s)}
              className="h-9 px-3 text-xs"
            >
              {s === "all" ? dict.common.all : t.sourceFilter[s]}
            </Chip>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={preset}
            onChange={(e) => setPreset(e.target.value as DateRangePreset)}
            aria-label={t.dateFilter.label}
            className="w-44"
          >
            <option value="all">{t.dateFilter.all}</option>
            <option value="today">{t.dateFilter.today}</option>
            <option value="7d">{t.dateFilter.last7}</option>
            <option value="month">{t.dateFilter.month}</option>
            <option value="custom">{t.dateFilter.custom}</option>
          </Select>
          {preset === "custom" ? (
            <>
              <label className="flex items-center gap-1.5 text-xs text-ink-muted">
                {t.dateFilter.from}
                <Input
                  type="date"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  className="h-9 w-38"
                />
              </label>
              <label className="flex items-center gap-1.5 text-xs text-ink-muted">
                {t.dateFilter.to}
                <Input
                  type="date"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                  className="h-9 w-38"
                />
              </label>
            </>
          ) : null}
        </div>
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
