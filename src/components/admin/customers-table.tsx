"use client";

import { Link2, Search, ShoppingBag, Store } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/types";
import { formatDate, formatNumber } from "@/lib/format";
import type { Customer } from "@/lib/types";

export interface CustomerRowStat {
  count: number;
  lastOrder?: string;
}

/**
 * Admin stores list (M8B.5) — the former inline server table, extracted so a
 * supplier with many stores can SEARCH by name / contact / phone / city /
 * address across all three locales. Rows + per-store order stats come from
 * the server page.
 */
export function CustomersTable({
  customers,
  stats,
  locale,
  dict,
}: {
  customers: Customer[];
  stats: Record<string, CustomerRowStat>;
  locale: Locale;
  dict: Dictionary;
}) {
  const t = dict.admin.customers;
  const [query, setQuery] = useState("");
  const [lifecycle, setLifecycle] = useState<"all" | "active" | "inactive">(
    "all",
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = customers.filter((c) => {
      if (lifecycle === "active") return c.isActive !== false;
      if (lifecycle === "inactive") return c.isActive === false;
      return true;
    });
    if (!q) return base;
    return base.filter((c) =>
      [
        c.name,
        c.contactName ?? "",
        c.phone ?? "",
        c.address ?? "",
        c.city.ar,
        c.city.he,
        c.city.en,
      ]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [customers, query, lifecycle]);

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
          onChange={(e) =>
            setLifecycle(e.target.value as "all" | "active" | "inactive")
          }
          aria-label={t.lifecycle.filterLabel}
          className="sm:w-44"
        >
          <option value="all">{dict.common.all}</option>
          <option value="active">{t.lifecycle.activeBadge}</option>
          <option value="inactive">{t.lifecycle.inactiveBadge}</option>
        </Select>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={<Store />} title={t.noMatches} />
      ) : (
        <Card className="overflow-x-auto">
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
              {filtered.map((customer) => {
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
    </div>
  );
}
