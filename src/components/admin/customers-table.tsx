"use client";

import { Link2, Search, ShoppingBag, Store } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/types";
import { searchCustomersAction } from "@/lib/actions/customers";
import type { CustomerRowStat } from "@/lib/data/customers";
import { formatDate, formatNumber } from "@/lib/format";
import type { Customer } from "@/lib/types";

export type { CustomerRowStat };

/** Server page size — mirrors CUSTOMERS_PAGE in the action. */
const PAGE_SIZE = 50;

type Lifecycle = "all" | "active" | "inactive";
type LinkFilter = "all" | "has" | "none";

/**
 * Admin stores list (M8B.5 → M8E.2 server-side). Search (name / contact /
 * phone / city / address), the active/inactive facet and the private-link
 * facet now run in the DB query via searchCustomersAction — the client never
 * loads every store. The initial page is SSR'd; the client re-queries page 0
 * on any filter change (search debounced) and appends pages on "load more".
 * Per-store order stats come from the server page (keyed by id).
 */
export function CustomersTable({
  customers: initialCustomers,
  stats: initialStats,
  locale,
  dict,
  initialQuery = "",
  initialStatus = "all",
  initialLink = "all",
}: {
  customers: Customer[];
  stats: Record<string, CustomerRowStat>;
  locale: Locale;
  dict: Dictionary;
  initialQuery?: string;
  initialStatus?: Lifecycle;
  initialLink?: LinkFilter;
}) {
  const t = dict.admin.customers;
  const [query, setQuery] = useState(initialQuery);
  const [debouncedQuery, setDebouncedQuery] = useState(initialQuery);
  const [lifecycle, setLifecycle] = useState<Lifecycle>(initialStatus);
  const [linkFilter, setLinkFilter] = useState<LinkFilter>(initialLink);

  const [rows, setRows] = useState<Customer[]>(initialCustomers);
  // Per-store stats accumulate across pages: seeded from the SSR page, then
  // MERGED with each server page's stats (searchCustomersAction returns stats
  // for only that page's ids). On a filter change page 0 REPLACES the map.
  const [stats, setStats] = useState<Record<string, CustomerRowStat>>(initialStats);
  const [hasMore, setHasMore] = useState(initialCustomers.length >= PAGE_SIZE);
  const [loading, startLoading] = useTransition();
  const firstRun = useRef(true);
  // Monotonic filter generation: bumped on every filter change so an in-flight
  // "load more" (or a superseded page-0 query) is discarded instead of merging
  // rows across different filters.
  const loadGen = useRef(0);

  // Debounce the text search (one server round-trip per applied term).
  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(id);
  }, [query]);

  const isDefault =
    debouncedQuery.trim() === "" && lifecycle === "all" && linkFilter === "all";

  /** Serialize the current filters for the server action. */
  function currentQuery(offset: number) {
    return {
      q: debouncedQuery.trim() || undefined,
      status: lifecycle === "all" ? undefined : lifecycle,
      hasLink:
        linkFilter === "all" ? undefined : linkFilter === "has" ? true : false,
      offset,
    };
  }

  // Re-query page 0 whenever a filter changes. Skip the first run when filters
  // are still default — the SSR'd initial page already covers it.
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      if (isDefault) return;
    }
    loadGen.current += 1;
    const myGen = loadGen.current;
    startLoading(async () => {
      const result = await searchCustomersAction(currentQuery(0));
      if (loadGen.current !== myGen) return; // superseded by a newer filter
      if (result.ok) {
        setRows(result.customers ?? []);
        setStats(result.stats ?? {}); // fresh page 0 → replace the stats map
        setHasMore(!!result.hasMore);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQuery, lifecycle, linkFilter]);

  function onLoadMore() {
    const myGen = loadGen.current;
    startLoading(async () => {
      const result = await searchCustomersAction(currentQuery(rows.length));
      // A filter changed mid-flight → drop this page (it belongs to the old
      // filter set) instead of merging it into the new rows.
      if (loadGen.current !== myGen) return;
      if (!result.ok) return; // transient — keep the button to retry
      const page = result.customers ?? [];
      if (page.length > 0) {
        const seen = new Set(rows.map((c) => c.id));
        setRows((prev) => [...prev, ...page.filter((c) => !seen.has(c.id))]);
      }
      // Merge this page's stats (keyed by id) into the accumulated map.
      if (result.stats) setStats((prev) => ({ ...prev, ...result.stats }));
      setHasMore(!!result.hasMore && page.length > 0);
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
          value={lifecycle}
          onChange={(e) => setLifecycle(e.target.value as Lifecycle)}
          aria-label={t.lifecycle.filterLabel}
          className="sm:w-44"
        >
          <option value="all">{dict.common.all}</option>
          <option value="active">{t.lifecycle.activeBadge}</option>
          <option value="inactive">{t.lifecycle.inactiveBadge}</option>
        </Select>
        <Select
          value={linkFilter}
          onChange={(e) => setLinkFilter(e.target.value as LinkFilter)}
          aria-label={t.linkFilter.label}
          className="sm:w-44"
        >
          <option value="all">{t.linkFilter.all}</option>
          <option value="has">{t.linkFilter.has}</option>
          <option value="none">{t.linkFilter.none}</option>
        </Select>
      </div>

      {rows.length === 0 ? (
        <EmptyState icon={<Store />} title={t.noMatches} />
      ) : (
        <Card className={"overflow-x-auto" + (loading ? " opacity-70" : "")}>
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-warm text-[11px] font-bold uppercase tracking-[0.06em] text-ink-muted">
                <th className="px-4 py-3 text-start">{t.colShop}</th>
                <th className="px-4 py-3 text-start">{t.colType}</th>
                <th className="px-4 py-3 text-start">{t.colCity}</th>
                <th className="px-4 py-3 text-start">{t.colPhone}</th>
                <th className="px-4 py-3 text-end">{t.colOrders}</th>
                <th className="px-4 py-3 text-start">{t.colLastOrder}</th>
                <th className="px-4 py-3 text-end">{dict.common.actions}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((customer) => {
                const stat = stats[customer.id] ?? { count: 0 };
                return (
                  <tr
                    key={customer.id}
                    className="border-b border-line-hair transition-colors last:border-0 hover:bg-surface-warm"
                  >
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-3">
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-field bg-brand-50 text-brand-700">
                          <Store className="size-4" aria-hidden />
                        </span>
                        <div className="min-w-0">
                          <p className="flex items-center gap-1.5 truncate font-semibold text-ink">
                            {customer.name}
                            {customer.isActive === false ? (
                              <span className="shrink-0 rounded-badge bg-danger-soft px-1.5 py-0.5 text-[10px] font-bold text-danger">
                                {t.lifecycle.inactiveBadge}
                              </span>
                            ) : null}
                          </p>
                          <p className="truncate text-xs text-ink-muted">
                            {customer.contactName}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      <Badge tone="neutral" dot>
                        {t.types[customer.type]}
                      </Badge>
                    </td>
                    <td className="px-4 py-3.5 text-ink-soft">
                      <p>{customer.city[locale]}</p>
                      {customer.address ? (
                        <p className="truncate text-xs text-ink-muted">
                          {customer.address}
                        </p>
                      ) : null}
                    </td>
                    <td
                      className="px-4 py-3.5 font-mono text-[13px] text-ink-soft"
                      dir="ltr"
                    >
                      {customer.phone}
                    </td>
                    <td className="px-4 py-3.5 text-end tabular-nums text-ink">
                      {formatNumber(stat.count, locale)}
                    </td>
                    <td className="px-4 py-3.5 text-ink-muted">
                      {stat.lastOrder ? formatDate(stat.lastOrder, locale) : "—"}
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center justify-end gap-2">
                        <Link
                          href={`/${locale}/admin/customers/${customer.id}`}
                          className="inline-flex h-9 items-center gap-1.5 rounded-field border border-line-strong px-3 text-xs font-semibold text-ink transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
                        >
                          <Link2 className="size-3.5" aria-hidden />
                          {dict.access.links.manage}
                        </Link>
                        <Link
                          href={`/${locale}/catalog?customer=${customer.id}`}
                          className="inline-flex h-9 items-center gap-1.5 rounded-field bg-brand-600 px-3 text-xs font-semibold text-white transition-colors hover:bg-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
                        >
                          <ShoppingBag className="size-3.5" aria-hidden />
                          {t.startOrder}
                        </Link>
                      </div>
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
