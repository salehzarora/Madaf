import { Link2, Plus, ShoppingBag, Store, UserPlus } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ShelfRule } from "@/components/ui/shelf-rule";
import { isLocale } from "@/i18n/config";
import { getDictionary, interpolate } from "@/i18n/dictionaries";
import { getSessionContext } from "@/lib/auth/session";
import { getDataMode, listCustomers, listOrders } from "@/lib/data";
import { listSignupRequests } from "@/lib/data/customer-signup";
import { formatDate, formatNumber } from "@/lib/format";

/** Shops list — with per-shop order stats, an "add store" CTA and a
 * "start order" deep link. */
export default async function AdminCustomersPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const dict = getDictionary(locale);
  const t = dict.admin.customers;

  const [customers, orders] = await Promise.all([
    listCustomers(),
    listOrders(),
  ]);

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

  const stats = new Map(
    customers.map((customer) => {
      const customerOrders = orders.filter(
        (order) => order.customerId === customer.id,
      );
      const lastOrder = customerOrders
        .map((order) => order.createdAt)
        .sort()
        .at(-1);
      return [customer.id, { count: customerOrders.length, lastOrder }];
    }),
  );

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

      {customers.length === 0 ? (
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
            {customers.map((customer) => {
              const stat = stats.get(customer.id)!;
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
                        <p className="truncate font-semibold text-ink">
                          {customer.name}
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
                    {customer.city[locale]}
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
