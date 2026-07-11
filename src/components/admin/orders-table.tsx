"use client";

import { ChevronLeft, ChevronRight, Download, Inbox, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useOptimistic, useState, useTransition } from "react";
import { EmptyState } from "@/components/empty-state";
import { OrderStatusBadge } from "@/components/order-status-badge";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { Input, Select } from "@/components/ui/input";
import type { Locale } from "@/i18n/config";
import { interpolate } from "@/i18n/dictionaries";
import type { Dictionary } from "@/i18n/types";
import { downloadCsv, toCsv } from "@/lib/csv";
import { formatCurrency, formatDate, formatNumber } from "@/lib/format";
import { exportOrdersAction } from "@/lib/actions/orders";
import {
  hasActiveFilters,
  marketToday,
  orderSourceFacet,
  ordersQueryToParams,
  ORDERS_EXPORT_CAP,
  toggleStatusFilter,
  withFilterChange,
  type OrderSourceFacet,
  type OrdersListResult,
  type OrdersQuery,
} from "@/lib/orders-query";
import { ORDER_STATUSES, type OrderStatus } from "@/lib/types";

const SOURCE_FACETS: readonly OrderSourceFacet[] = [
  "all",
  "sales_visit",
  "shop_link",
  "guest",
];

type DatePreset = "today" | "7d" | "month";

/** MARKET-timezone calendar-date bounds for a quick preset — computed in the
 * market tz (via marketToday) to match the server/mock date filter, so a preset
 * and a manually-typed range use identical calendar-day semantics. */
function marketPresetRange(preset: DatePreset): { from: string; to: string } {
  const to = marketToday(); // YYYY-MM-DD in the market timezone
  if (preset === "today") return { from: to, to };
  const [y, m, d] = to.split("-").map(Number);
  if (preset === "7d") {
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() - 6); // last 7 days inclusive
    return { from: dt.toISOString().slice(0, 10), to };
  }
  // month-to-date: the 1st of the market's current month
  return { from: `${to.slice(0, 8)}01`, to };
}

/**
 * Admin orders list (M8F.1) — SERVER-PAGINATED and URL-controlled. The page
 * fetches only the current page + the exact filtered total; every filter/page
 * change navigates (updates the URL) so the list is shareable and back/forward
 * restores it. Search covers order_number/public_ref/buyer name+phone. Export
 * (owner/admin) pulls ALL filtered rows (up to the cap) via a server action, not
 * just the visible page. The internal order number is admin-only here (customer
 * surfaces show public_ref only).
 */
export function OrdersTable({
  result,
  query,
  locale,
  dict,
  canExport = false,
}: {
  result: OrdersListResult;
  query: OrdersQuery;
  locale: Locale;
  dict: Dictionary;
  canExport?: boolean;
}) {
  const t = dict.admin.orders;
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isExporting, startExport] = useTransition();
  const [exportNote, setExportNote] = useState<string | null>(null);

  // Optimistic filter state: reflects the LATEST intended query while a
  // navigation is pending, so every change composes against it (not the stale
  // server `query` prop). Two quick toggles both land; it resets to the server
  // query when navigation settles (and on back/forward). The URL stays the
  // single source of truth after settle.
  const [optimisticQuery, setOptimisticQuery] = useOptimistic(
    query,
    (_current, next: OrdersQuery) => next,
  );

  // Page/rows/count come from the SERVER result (result.page is the clamped
  // page); the FILTER controls render + compose against optimisticQuery.
  const { rows, total, page, totalPages } = result;
  const statusSet = new Set(optimisticQuery.statuses);

  /** Push a new query + optimistically apply it. Filter helpers reset page to 1;
   * pagination keeps the (optimistic) filters. */
  function navigate(next: OrdersQuery) {
    const qs = ordersQueryToParams(next).toString();
    startTransition(() => {
      setOptimisticQuery(next);
      router.push(`/${locale}/admin/orders${qs ? `?${qs}` : ""}`);
    });
  }
  const applyFilter = (patch: Partial<OrdersQuery>) =>
    navigate(withFilterChange(optimisticQuery, patch));
  const goToPage = (p: number) => navigate({ ...optimisticQuery, page: p });

  function onSearchSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const term = String(new FormData(e.currentTarget).get("q") ?? "").trim();
    applyFilter({ search: term });
  }

  function toggleStatus(s: OrderStatus) {
    navigate(toggleStatusFilter(optimisticQuery, s));
  }

  function onPreset(value: string) {
    if (value === "all") {
      applyFilter({ dateFrom: null, dateTo: null });
      return;
    }
    if (value === "today" || value === "7d" || value === "month") {
      const { from, to } = marketPresetRange(value);
      applyFilter({ dateFrom: from, dateTo: to });
    }
  }

  // Read BOTH date inputs from the DOM (uncontrolled form) on any change, so a
  // From→To range set in quick succession — before a pending navigation settles
  // — never drops the first bound to a stale `query` prop.
  function onDateChange(e: React.FormEvent<HTMLFormElement>) {
    const fd = new FormData(e.currentTarget);
    applyFilter({
      dateFrom: String(fd.get("from") ?? "") || null,
      dateTo: String(fd.get("to") ?? "") || null,
    });
  }

  function onExport() {
    setExportNote(null);
    startExport(async () => {
      const res = await exportOrdersAction({
        q: optimisticQuery.search || undefined,
        status: optimisticQuery.statuses.length ? optimisticQuery.statuses.join(",") : undefined,
        source: optimisticQuery.source !== "all" ? optimisticQuery.source : undefined,
        customer: optimisticQuery.customerId ?? undefined,
        from: optimisticQuery.dateFrom ?? undefined,
        to: optimisticQuery.dateTo ?? undefined,
      });
      if (!res.ok || !res.rows) {
        setExportNote(dict.common.actionError);
        return;
      }
      const h = t.csv;
      const csvRows = res.rows.map((r) => {
        const facet = orderSourceFacet(r);
        const name = r.customerName ?? r.customerSnapshot?.name ?? "";
        const phone = r.customerPhone ?? r.customerSnapshot?.phone ?? "";
        return [
          r.number,
          r.publicRef ?? "",
          r.createdAt,
          r.status,
          name,
          facet === "guest" ? "yes" : "no",
          t.sourceFilter[facet],
          r.subtotalAmount.toFixed(2),
          r.itemCount,
          phone,
        ];
      });
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
        csvRows,
      );
      downloadCsv(
        `madaf-orders-${new Date().toISOString().slice(0, 10)}.csv`,
        csv,
      );
      if (res.capped) {
        setExportNote(interpolate(dict.common.exportCapped, { count: ORDERS_EXPORT_CAP }));
      }
    });
  }

  const filtersActive = hasActiveFilters(optimisticQuery);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <form onSubmit={onSearchSubmit} className="w-full sm:max-w-sm">
          {/* Uncontrolled: `key` re-seeds it from the URL on navigation/clear;
              submitting (Enter) navigates with the new term (URL is truth). */}
          <Input
            key={optimisticQuery.search}
            type="search"
            name="q"
            defaultValue={optimisticQuery.search}
            placeholder={t.searchPlaceholder}
            aria-label={t.searchPlaceholder}
          />
        </form>
        {canExport ? (
          <button
            type="button"
            onClick={onExport}
            disabled={isExporting || total === 0}
            title={total === 0 ? dict.common.exportEmpty : undefined}
            className="inline-flex h-11 items-center gap-1.5 rounded-field border border-line-strong px-4 text-sm font-semibold text-ink transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:cursor-not-allowed disabled:opacity-50 sm:ms-auto"
          >
            <Download className="size-4" aria-hidden />
            {isExporting ? dict.common.exporting : dict.common.exportCsv}
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
          selected={statusSet.size === 0}
          onClick={() => applyFilter({ statuses: [] })}
          className="h-9 px-3 text-xs"
        >
          {dict.common.all}
        </Chip>
        {ORDER_STATUSES.map((s) => (
          <Chip
            key={s}
            selected={statusSet.has(s)}
            onClick={() => toggleStatus(s)}
            className="h-9 px-3 text-xs"
          >
            {dict.status[s]}
          </Chip>
        ))}
        {filtersActive ? (
          <button
            type="button"
            onClick={() => navigate(withFilterChange(optimisticQuery, {
              search: "",
              statuses: [],
              source: "all",
              customerId: null,
              dateFrom: null,
              dateTo: null,
            }))}
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
          {SOURCE_FACETS.map((s) => (
            <Chip
              key={s}
              selected={optimisticQuery.source === s}
              onClick={() => applyFilter({ source: s })}
              className="h-9 px-3 text-xs"
            >
              {s === "all" ? dict.common.all : t.sourceFilter[s]}
            </Chip>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Quick presets — an uncontrolled "jump to" menu (keyed to reset to
              the placeholder after it navigates). The concrete range always
              lives in the two date inputs + the URL, so there is no misleading
              "current preset" state and no dead control. */}
          <Select
            key={`${optimisticQuery.dateFrom ?? ""}-${optimisticQuery.dateTo ?? ""}`}
            defaultValue=""
            onChange={(e) => onPreset(e.target.value)}
            aria-label={t.dateFilter.label}
            className="w-40"
          >
            <option value="" disabled>
              {t.dateFilter.label}
            </option>
            <option value="all">{t.dateFilter.all}</option>
            <option value="today">{t.dateFilter.today}</option>
            <option value="7d">{t.dateFilter.last7}</option>
            <option value="month">{t.dateFilter.month}</option>
          </Select>
          {/* Uncontrolled: `key` re-seeds from the URL on navigation; form
              onChange reads BOTH current values so a from/to range set quickly
              can't drop a bound to the stale (pending) query prop. */}
          <form
            onChange={onDateChange}
            className="flex flex-wrap items-center gap-2"
          >
            <label className="flex items-center gap-1.5 text-xs text-ink-muted">
              {t.dateFilter.from}
              <Input
                type="date"
                name="from"
                key={`from-${optimisticQuery.dateFrom ?? ""}`}
                defaultValue={optimisticQuery.dateFrom ?? ""}
                className="h-9 w-38"
                aria-label={t.dateFilter.from}
              />
            </label>
            <label className="flex items-center gap-1.5 text-xs text-ink-muted">
              {t.dateFilter.to}
              <Input
                type="date"
                name="to"
                key={`to-${optimisticQuery.dateTo ?? ""}`}
                defaultValue={optimisticQuery.dateTo ?? ""}
                className="h-9 w-38"
                aria-label={t.dateFilter.to}
              />
            </label>
          </form>
        </div>
      </div>

      {/* Result count */}
      <p className="text-xs font-medium text-ink-muted" aria-live="polite">
        {interpolate(t.resultsCount, { count: formatNumber(total, locale) })}
      </p>

      {rows.length === 0 ? (
        <EmptyState icon={<Inbox />} title={t.noResults} hint={t.noResultsHint} />
      ) : (
        <>
          <Card className={`overflow-x-auto ${isPending ? "opacity-60 transition-opacity" : ""}`}>
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
                {rows.map((order) => (
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
                      {order.customerName ? (
                        order.customerName
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
                      {interpolate(t.detail.itemsCount, { count: order.itemCount })}
                    </td>
                    <td className="px-4 py-3.5 text-end font-bold tabular-nums text-ink">
                      {formatCurrency(order.subtotalAmount, locale)}
                    </td>
                    <td className="px-4 py-3.5">
                      <OrderStatusBadge status={order.status} dict={dict.status} />
                    </td>
                    <td className="px-4 py-3.5 text-ink-muted">
                      {formatDate(order.createdAt, locale)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          {totalPages > 1 ? (
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => goToPage(page - 1)}
                disabled={page <= 1 || isPending}
                className="inline-flex h-10 items-center gap-1 rounded-field border border-line-strong px-3 text-sm font-semibold text-ink transition-colors hover:border-brand-300 hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronLeft className="size-4 rtl:-scale-x-100" aria-hidden />
                {t.prevPage}
              </button>
              <span className="text-xs font-medium tabular-nums text-ink-muted">
                {interpolate(t.pageLabel, { page, pages: totalPages })}
              </span>
              <button
                type="button"
                onClick={() => goToPage(page + 1)}
                disabled={page >= totalPages || isPending}
                className="inline-flex h-10 items-center gap-1 rounded-field border border-line-strong px-3 text-sm font-semibold text-ink transition-colors hover:border-brand-300 hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {t.nextPage}
                <ChevronRight className="size-4 rtl:-scale-x-100" aria-hidden />
              </button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
