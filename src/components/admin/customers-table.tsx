"use client";

import { Link2, Search, ShoppingBag, Store } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useOptimistic,
  useRef,
  useState,
  useTransition,
  type FormEvent,
} from "react";
import { CustomerOriginBadge } from "@/components/admin/customer-origin-badge";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/types";
import { searchCustomersAction } from "@/lib/actions/customers";
import {
  customersQueryToParams,
  withFilterChange,
  type CustomersQuery,
} from "@/lib/customers-query";
import type { CustomerRowStat } from "@/lib/data/customers";
import { formatDate, formatNumber } from "@/lib/format";
import { CUSTOMER_ORIGINS, type Customer } from "@/lib/types";

export type { CustomerRowStat };

/** Server page size — mirrors CUSTOMERS_PAGE in the action. */
const PAGE_SIZE = 50;

/**
 * Admin stores list (M8B.5 → M8E.2 → M8G.1). Search (name / contact / phone /
 * city / address), the active/inactive facet, the private-link facet and the
 * acquisition-origin facet run server-side. FILTER state lives in the URL (the
 * single source of truth): every facet change navigates, so the list is
 * shareable and back/forward restores it, and a filter change re-renders from
 * the first page (load state resets). Within a filter set, "load more" appends
 * the next page via the server action. Per-store order stats (M8F.3) come from
 * the server page, keyed by id.
 */
export function CustomersTable({
  customers,
  stats: initialStats,
  locale,
  dict,
  query,
}: {
  customers: Customer[];
  stats: Record<string, CustomerRowStat>;
  locale: Locale;
  dict: Dictionary;
  query: CustomersQuery;
}) {
  const t = dict.admin.customers;
  const router = useRouter();

  // Optimistic filter state: reflects the LATEST intended query while a
  // navigation is pending, so quick successive changes compose against it (not
  // the stale server `query` prop). Resets to the server query on settle and on
  // back/forward — the URL stays the single source of truth.
  const [optimisticQuery, setOptimisticQuery] = useOptimistic(
    query,
    (_current, next: CustomersQuery) => next,
  );
  const [, startNav] = useTransition();

  // "Load more" appends pages WITHIN the current filter set. rows/stats reset to
  // the server page whenever a navigation delivers a new first page.
  const [rows, setRows] = useState<Customer[]>(customers);
  const [stats, setStats] = useState(initialStats);
  const [hasMore, setHasMore] = useState(customers.length >= PAGE_SIZE);
  const [seenPage, setSeenPage] = useState(customers);
  const [loadingMore, startLoadMore] = useTransition();
  // Monotonic id for the current server page; bumped (ref-only, in an effect)
  // whenever a navigation delivers a new page, so a superseded "load more"
  // result is discarded instead of merged into a different filter set.
  const pageGen = useRef(0);
  useEffect(() => {
    pageGen.current += 1;
  }, [customers]);

  // A navigation delivered a new server page (new `customers`/`stats` refs,
  // which change ONLY on navigation — not on local load-more re-renders): reset
  // the appended rows/stats. React "adjust state during render" pattern
  // (https://react.dev/reference/react/useState) — not an effect, so it settles
  // before paint with no cascading render.
  if (customers !== seenPage) {
    setSeenPage(customers);
    setRows(customers);
    setStats(initialStats);
    setHasMore(customers.length >= PAGE_SIZE);
  }

  function navigate(next: CustomersQuery) {
    const qs = customersQueryToParams(next).toString();
    startNav(() => {
      setOptimisticQuery(next);
      router.push(`/${locale}/admin/customers${qs ? `?${qs}` : ""}`, {
        scroll: false,
      });
    });
  }
  const applyFilter = (patch: Partial<CustomersQuery>) =>
    navigate(withFilterChange(optimisticQuery, patch));

  // Search is submit-on-Enter (mirrors the Orders list): the uncontrolled input
  // is `key`-re-seeded from the URL on navigation, and submitting composes
  // against the LIVE optimistic query — so a facet chosen just before submit is
  // preserved, and typing during a nav round-trip is never clobbered.
  function onSearchSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const term = String(new FormData(e.currentTarget).get("q") ?? "").trim();
    applyFilter({ search: term });
  }

  function onLoadMore() {
    const myGen = pageGen.current;
    startLoadMore(async () => {
      const result = await searchCustomersAction({
        q: optimisticQuery.search || undefined,
        status:
          optimisticQuery.status === "all" ? undefined : optimisticQuery.status,
        hasLink:
          optimisticQuery.link === "all"
            ? undefined
            : optimisticQuery.link === "has",
        origin:
          optimisticQuery.origin === "all" ? undefined : optimisticQuery.origin,
        offset: rows.length,
      });
      // A newer server page arrived mid-flight → drop this (it belongs to the
      // old filter set) instead of merging it.
      if (pageGen.current !== myGen) return;
      if (!result.ok) return; // transient — keep the button to retry
      const page = result.customers ?? [];
      if (page.length > 0) {
        const seen = new Set(rows.map((c) => c.id));
        setRows((prev) => [...prev, ...page.filter((c) => !seen.has(c.id))]);
        if (result.stats) {
          const merged = result.stats;
          setStats((prev) => ({ ...prev, ...merged }));
        }
      }
      setHasMore(!!result.hasMore && page.length > 0);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <form onSubmit={onSearchSubmit} className="relative sm:max-w-sm sm:flex-1">
          {/* Uncontrolled: `key` re-seeds from the URL on navigation; submitting
              (Enter) navigates with the new term (the URL is the truth). */}
          <Search
            className="pointer-events-none absolute inset-y-0 start-3 my-auto size-4 text-ink-muted"
            aria-hidden
          />
          <Input
            key={optimisticQuery.search}
            type="search"
            name="q"
            defaultValue={optimisticQuery.search}
            placeholder={t.searchPlaceholder}
            aria-label={t.searchPlaceholder}
            className="ps-9"
          />
        </form>
        <Select
          value={optimisticQuery.status}
          onChange={(e) =>
            applyFilter({ status: e.target.value as CustomersQuery["status"] })
          }
          aria-label={t.lifecycle.filterLabel}
          className="sm:w-40"
        >
          <option value="all">{dict.common.all}</option>
          <option value="active">{t.lifecycle.activeBadge}</option>
          <option value="inactive">{t.lifecycle.inactiveBadge}</option>
        </Select>
        <Select
          value={optimisticQuery.link}
          onChange={(e) =>
            applyFilter({ link: e.target.value as CustomersQuery["link"] })
          }
          aria-label={t.linkFilter.label}
          className="sm:w-40"
        >
          <option value="all">{t.linkFilter.all}</option>
          <option value="has">{t.linkFilter.has}</option>
          <option value="none">{t.linkFilter.none}</option>
        </Select>
        <Select
          value={optimisticQuery.origin}
          onChange={(e) =>
            applyFilter({ origin: e.target.value as CustomersQuery["origin"] })
          }
          aria-label={t.origin.label}
          className="sm:w-40"
        >
          <option value="all">{t.origin.all}</option>
          {CUSTOMER_ORIGINS.map((o) => (
            <option key={o} value={o}>
              {t.origin.values[o]}
            </option>
          ))}
        </Select>
      </div>

      {rows.length === 0 ? (
        <EmptyState icon={<Store />} title={t.noMatches} />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[800px] text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-warm text-[11px] font-bold uppercase tracking-[0.06em] text-ink-muted">
                <th className="px-4 py-3 text-start">{t.colShop}</th>
                <th className="px-4 py-3 text-start">{t.colType}</th>
                <th className="px-4 py-3 text-start">{t.origin.label}</th>
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
                    <td className="px-4 py-3.5">
                      <CustomerOriginBadge
                        origin={customer.origin}
                        originDict={t.origin}
                      />
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
          disabled={loadingMore}
          className="self-center"
        >
          {loadingMore ? t.loadingMore : t.loadMore}
        </Button>
      ) : null}
    </div>
  );
}
