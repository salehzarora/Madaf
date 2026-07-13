"use client";

import { Download, History, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { Input, Select } from "@/components/ui/input";
import type { Locale } from "@/i18n/config";
import { interpolate } from "@/i18n/dictionaries";
import type { Dictionary } from "@/i18n/types";
import {
  exportMovementsAction,
  searchMovementsAction,
} from "@/lib/actions/inventory";
import { productName } from "@/lib/catalog-helpers";
import { downloadCsv, toCsv } from "@/lib/csv";
import { dateRangeBounds, type DateRangePreset } from "@/lib/date-range";
import { formatNumber } from "@/lib/format";
import { formatTenantDateTime } from "@/lib/time";
import {
  INVENTORY_MOVEMENT_REASONS,
  type InventoryMovement,
  type Order,
  type Product,
} from "@/lib/types";
import { cn } from "@/lib/utils";

/** Server page size — mirrors MOVEMENTS_PAGE in the action. */
const PAGE_SIZE = 50;

type Direction = "all" | "in" | "out" | "manual";

function productMatches(p: Product, q: string): boolean {
  return [
    p.translations.ar.name,
    p.translations.he.name,
    p.translations.en.name,
    p.sku,
    p.barcode ?? "",
  ]
    .join(" ")
    .toLowerCase()
    .includes(q);
}

/**
 * Stock-movement ledger table (M8B.1 → M8D server-side). Date / reason /
 * direction filters + product search now run in the DB query (RLS
 * owner/admin) via searchMovementsAction — the client never loads more than
 * one page. The product search term is resolved to product ids against the
 * already-loaded catalog. The initial page is SSR'd (unfiltered).
 */
export function MovementsTable({
  movements: initialMovements,
  products,
  orders,
  canExport = false,
  locale,
  dict,
  timeZone,
}: {
  movements: InventoryMovement[];
  products: Product[];
  orders: Order[];
  /** Owner/admin (RLS gives others zero rows anyway) — shows CSV export. */
  canExport?: boolean;
  locale: Locale;
  dict: Dictionary;
  /** M8H.2 — the tenant's IANA zone (server-derived). */
  timeZone: string;
}) {
  const t = dict.admin.inventory.movements;
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [reason, setReason] = useState<string>("all");
  const [direction, setDirection] = useState<Direction>("all");
  const [preset, setPreset] = useState<DateRangePreset>("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const [rows, setRows] = useState<InventoryMovement[]>(initialMovements);
  const [hasMore, setHasMore] = useState(initialMovements.length >= PAGE_SIZE);
  const [loading, startLoading] = useTransition();
  // Export runs its own server round-trip over ALL filtered rows (M8E.1).
  const [exporting, startExport] = useTransition();
  const [exportNote, setExportNote] = useState<string | null>(null);
  const firstRun = useRef(true);
  // Monotonic filter generation (M8E) — bumped on every filter change so an
  // in-flight "load more" or superseded page-0 query is discarded instead of
  // merging rows across different filters.
  const loadGen = useRef(0);

  const productById = useMemo(
    () => new Map(products.map((p) => [p.id, p])),
    [products],
  );
  const orderById = useMemo(
    () => new Map(orders.map((o) => [o.id, o])),
    [orders],
  );

  // Debounce the product search (server round-trip per applied term).
  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(id);
  }, [query]);

  // Resolve the search term to product ids against the loaded catalog.
  // undefined = no product filter; [] = matched nothing → zero rows.
  const productIds = useMemo(() => {
    const q = debouncedQuery.trim().toLowerCase();
    if (!q) return undefined;
    return products.filter((p) => productMatches(p, q)).map((p) => p.id);
  }, [debouncedQuery, products]);

  const isDefault =
    reason === "all" &&
    direction === "all" &&
    preset === "all" &&
    productIds === undefined;

  /** Serialize the current filters for the server action. `new Date()` here
   * (effect/handler) is fine — it never runs during render. */
  function currentQuery(offset: number) {
    const bounds = dateRangeBounds(preset, customFrom, customTo);
    return {
      from: bounds.from !== undefined ? new Date(bounds.from).toISOString() : undefined,
      to: bounds.to !== undefined ? new Date(bounds.to).toISOString() : undefined,
      reason: reason === "all" ? undefined : reason,
      direction: direction === "all" ? undefined : direction,
      productIds,
      offset,
    };
  }

  // Re-query page 0 whenever a filter changes. Skip the very first run when
  // filters are still default — the SSR'd initial page already covers it.
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      if (isDefault) return;
    }
    loadGen.current += 1;
    const myGen = loadGen.current;
    startLoading(async () => {
      const result = await searchMovementsAction(currentQuery(0));
      if (loadGen.current !== myGen) return; // superseded by a newer filter
      if (result.ok) {
        setRows(result.movements ?? []);
        setHasMore(!!result.hasMore);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reason, direction, preset, customFrom, customTo, productIds]);

  function onLoadMore() {
    const myGen = loadGen.current;
    startLoading(async () => {
      const result = await searchMovementsAction(currentQuery(rows.length));
      // A filter changed mid-flight → drop this page (it belongs to the old
      // filter set) instead of merging it into the new rows.
      if (loadGen.current !== myGen) return;
      if (!result.ok) return; // transient — keep the button to retry
      const page = result.movements ?? [];
      if (page.length > 0) {
        const seen = new Set(rows.map((m) => m.id));
        setRows((prev) => [...prev, ...page.filter((m) => !seen.has(m.id))]);
      }
      setHasMore(!!result.hasMore && page.length > 0);
    });
  }

  const reasonLabel = (value: string): string =>
    (t.reasons as Record<string, string>)[value] ?? value;

  function onExport() {
    // Admin-only file over ALL rows matching the current filters (M8E.1) — a
    // dedicated server round-trip pages the DB-side filtered query up to the
    // cap, so the export is not limited to the loaded page.
    setExportNote(null);
    startExport(async () => {
      const result = await exportMovementsAction(currentQuery(0));
      if (!result.ok || !result.movements) return;
      const exportRows = result.movements;
      const rowsCsv = exportRows.map((m) => {
        const product = m.productId ? productById.get(m.productId) : undefined;
        const order = m.orderId ? orderById.get(m.orderId) : undefined;
        return [
          m.createdAt,
          product ? productName(product, locale) : "",
          product?.sku ?? "",
          m.quantityDelta,
          reasonLabel(m.reason),
          m.note ?? "",
          order?.number ?? "",
          order?.publicRef ?? "",
        ];
      });
      const h = t.csv;
      const csv = toCsv(
        [h.date, h.product, h.sku, h.delta, h.reason, h.note, h.order, h.publicRef],
        rowsCsv,
      );
      downloadCsv(
        `madaf-inventory-movements-${new Date().toISOString().slice(0, 10)}.csv`,
        csv,
      );
      if (result.capped) {
        setExportNote(
          interpolate(dict.common.exportCapped, { count: exportRows.length }),
        );
      }
    });
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
          {INVENTORY_MOVEMENT_REASONS.map((r) => (
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

      {/* Date range + export */}
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
            disabled={rows.length === 0 || exporting}
            title={rows.length === 0 ? dict.common.exportEmpty : undefined}
            className="ms-auto inline-flex h-11 items-center gap-1.5 rounded-field border border-line-strong px-4 text-sm font-semibold text-ink transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Download className="size-4" aria-hidden />
            {exporting ? dict.common.exporting : dict.common.exportCsv}
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

      {rows.length === 0 ? (
        <EmptyState
          icon={<History />}
          title={isDefault ? t.empty : dict.catalog.noResults}
          hint={isDefault ? t.emptyHint : undefined}
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
              {rows.map((m) => {
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
                      {formatTenantDateTime(m.createdAt, locale, timeZone)}
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
