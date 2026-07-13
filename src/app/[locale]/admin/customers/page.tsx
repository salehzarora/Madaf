import { Plus, Store, UserPlus } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CustomersTable } from "@/components/admin/customers-table";
import { EmptyState } from "@/components/empty-state";
import { ShelfRule } from "@/components/ui/shelf-rule";
import { isLocale } from "@/i18n/config";
import { getDictionary, interpolate } from "@/i18n/dictionaries";
import { getSessionContext } from "@/lib/auth/session";
import {
  hasActiveFilters,
  parseCustomersQuery,
  toCustomerQuery,
} from "@/lib/customers-query";
import {
  getCustomerStatsForIds,
  getDataMode,
  getTenantTimeZone,
  searchCustomers,
} from "@/lib/data";
import { listSignupRequests } from "@/lib/data/customer-signup";

/** First-page size — mirrors CUSTOMERS_PAGE in the customers action. */
const PAGE_SIZE = 50;

/** Shops list — server-side search/pagination (M8E.2) with per-shop order
 * stats, an "add store" CTA and a "start order" deep link. */
export default async function AdminCustomersPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{
    q?: string;
    status?: string;
    link?: string;
    origin?: string;
  }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const dict = getDictionary(locale);
  const t = dict.admin.customers;

  // The URL is the single source of truth for search + facets
  // (?q, ?status, ?link, ?origin — M8G.1). Parsed/normalized once here and
  // handed to the table as the seed query.
  const customersQuery = parseCustomersQuery(await searchParams);
  const query = toCustomerQuery(customersQuery);

  const firstPage = await searchCustomers(query, 0, PAGE_SIZE);

  // Creating a store is owner/admin-only (enforced by create_customer). In
  // mock mode it's the open demo, so the CTA always shows.
  const isSupabase = getDataMode() === "supabase";
  const role = isSupabase ? (await getSessionContext()).membership?.role : null;
  const canAddCustomer = !isSupabase || role === "owner" || role === "admin";
  // New-store signups are owner/admin + Supabase only. Count pending requests
  // for the header indicator.
  const canManageSignups = isSupabase && (role === "owner" || role === "admin");
  const pendingSignups = canManageSignups
    ? (await listSignupRequests()).filter((r) => r.status === "pending").length
    : 0;

  // Per-store order stats for ONLY the current page's ids — one bounded
  // aggregate (get_customer_stats_for_ids), never the full orders collection
  // (M8F.3). "Load more" pages fetch their own stats via searchCustomersAction.
  const stats = await getCustomerStatsForIds(firstPage.map((c) => c.id));

  // No stores at all (and no filter narrowing them) → the add-first-store CTA.
  const noStoresYet =
    firstPage.length === 0 && !hasActiveFilters(customersQuery);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
      <div>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-muted">
              {dict.nav.admin}
            </p>
            <h1 className="mt-1 text-[28px] font-extrabold tracking-[-0.02em] text-ink">
              {t.title}
            </h1>
            <p className="mt-0.5 text-sm text-ink-muted">{t.subtitle}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canManageSignups ? (
              <Link
                href={`/${locale}/admin/customers/signup`}
                className="relative inline-flex h-11 items-center gap-1.5 rounded-field border border-line-strong px-4 text-sm font-semibold text-ink transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
              >
                <UserPlus className="size-4" aria-hidden />
                {t.signup.navLabel}
                {pendingSignups > 0 ? (
                  <span className="ms-1 inline-flex items-center rounded-badge bg-warning-soft px-1.5 py-0.5 text-[11px] font-bold text-warning">
                    {interpolate(t.signup.pendingBadge, {
                      count: pendingSignups,
                    })}
                  </span>
                ) : null}
              </Link>
            ) : null}
            {canAddCustomer ? (
              <Link
                href={`/${locale}/admin/customers/new`}
                className="inline-flex h-11 items-center gap-1.5 rounded-field bg-brand-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
              >
                <Plus className="size-4" strokeWidth={2.5} aria-hidden />
                {t.addCustomer}
              </Link>
            ) : null}
          </div>
        </div>
        <ShelfRule className="mt-4" />
      </div>

      {noStoresYet ? (
        <EmptyState
          icon={<Store />}
          title={t.empty}
          hint={t.emptyHint}
          action={
            canAddCustomer ? (
              <Link
                href={`/${locale}/admin/customers/new`}
                className="inline-flex h-11 items-center gap-1.5 rounded-field bg-brand-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
              >
                <Plus className="size-4" strokeWidth={2.5} aria-hidden />
                {t.addCustomer}
              </Link>
            ) : undefined
          }
        />
      ) : (
        <CustomersTable
          customers={firstPage}
          stats={stats}
          locale={locale}
          dict={dict}
          timeZone={await getTenantTimeZone()}
          query={customersQuery}
        />
      )}
    </div>
  );
}
