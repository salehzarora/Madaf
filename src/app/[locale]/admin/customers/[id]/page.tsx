import { ArrowRight, MapPin, Pencil, Phone, Store, User } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { OrderStatusBadge } from "@/components/order-status-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CustomerLifecycleToggle } from "@/components/admin/customer-lifecycle-toggle";
import { CustomerLinksManager } from "@/components/admin/customer-links-manager";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { getSessionContext } from "@/lib/auth/session";
import { getCustomer, getDataMode, listOrders } from "@/lib/data";
import { listCustomerLinks } from "@/lib/data/customer-links";
import { formatDate } from "@/lib/format";

/** Shop detail + private order-link management (links are Supabase-mode). */
export default async function AdminCustomerDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  if (!isLocale(locale)) notFound();
  const dict = getDictionary(locale);
  const t = dict.access.links;

  const customer = await getCustomer(id);
  if (!customer) notFound();

  // Private-link management is owner/admin only. A sales_rep only reaches
  // customers assigned to them (RLS-scoped getCustomer), and even then does
  // not manage links.
  const isSupabase = getDataMode() === "supabase";
  const role = isSupabase ? (await getSessionContext()).membership?.role : null;
  // Explicit owner/admin allowlist (never default-allow on a null membership);
  // RLS is the real gate (M4D.2 SELECT policy returns 0 rows for anyone else).
  const canManageLinks = role === "owner" || role === "admin";
  // Editing store fields is owner/admin + Supabase only (mock can't persist).
  const canEdit = isSupabase && canManageLinks;
  const links = isSupabase && canManageLinks ? await listCustomerLinks(id) : [];

  // Recent orders for this store (tenant/rep-scoped by the data layer).
  const recentOrders = (await listOrders())
    .filter((order) => order.customerId === id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 5);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
      <div>
        <Link
          href={`/${locale}/admin/customers`}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-muted transition-colors hover:text-ink"
        >
          <ArrowRight className="size-4 ltr:-scale-x-100" aria-hidden />
          {t.backToCustomers}
        </Link>
      </div>

      {/* Shop header */}
      <Card className="p-5 sm:p-6">
        <div className="flex items-start gap-4">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-field bg-brand-50 text-brand-700">
            <Store className="size-6" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-extrabold tracking-[-0.02em] text-ink">
                {customer.name}
              </h1>
              <Badge tone="neutral" dot>
                {dict.admin.customers.types[customer.type]}
              </Badge>
              {customer.isActive === false ? (
                <Badge tone="danger" dot>
                  {dict.admin.customers.lifecycle.inactiveBadge}
                </Badge>
              ) : null}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-ink-soft">
              {customer.contactName ? (
                <span className="inline-flex items-center gap-1.5">
                  <User className="size-4 text-ink-muted" aria-hidden />
                  {customer.contactName}
                </span>
              ) : null}
              {customer.phone ? (
                <span
                  className="inline-flex items-center gap-1.5 font-mono text-[13px]"
                  dir="ltr"
                >
                  <Phone className="size-4 text-ink-muted" aria-hidden />
                  {customer.phone}
                </span>
              ) : null}
              {customer.city[locale] ? (
                <span className="inline-flex items-center gap-1.5">
                  <Store className="size-4 text-ink-muted" aria-hidden />
                  {customer.city[locale]}
                </span>
              ) : null}
              {customer.address ? (
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="size-4 text-ink-muted" aria-hidden />
                  {customer.address}
                </span>
              ) : null}
            </div>
          </div>
          {canEdit ? (
            <div className="flex shrink-0 flex-col items-end gap-2">
              <Link
                href={`/${locale}/admin/customers/${id}/edit`}
                className="inline-flex h-9 items-center gap-1.5 rounded-field border border-line-strong px-3 text-xs font-semibold text-ink transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
              >
                <Pencil className="size-3.5" aria-hidden />
                {dict.admin.customers.edit}
              </Link>
              {/* Lifecycle (M8C.3): deactivation freezes the store's private
                  links + new-link creation; history stays. */}
              <CustomerLifecycleToggle
                customerId={id}
                isActive={customer.isActive !== false}
                locale={locale}
                dict={dict}
              />
            </div>
          ) : null}
        </div>
      </Card>

      {/* Private links — owner/admin only */}
      {!isSupabase || canManageLinks ? (
        <Card>
          <CardHeader variant="strip">
            <CardTitle>{t.title}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-4 text-sm text-ink-soft">{t.subtitle}</p>
            {isSupabase ? (
              <CustomerLinksManager
                locale={locale}
                dict={dict}
                customerId={id}
                initialLinks={links}
                customerInactive={customer.isActive === false}
              />
            ) : (
              <p className="rounded-field bg-surface-sunken px-4 py-3 text-sm text-ink-soft">
                {t.mockNote}
              </p>
            )}
          </CardContent>
        </Card>
      ) : null}

      {/* Recent orders for this store */}
      <Card>
        <CardHeader variant="strip">
          <CardTitle>{dict.admin.customers.recentOrders}</CardTitle>
        </CardHeader>
        <CardContent>
          {recentOrders.length === 0 ? (
            <p className="text-sm text-ink-soft">
              {dict.admin.customers.noOrders}
            </p>
          ) : (
            <>
              <ul className="divide-y divide-line-hair">
                {recentOrders.map((order) => (
                  <li key={order.id}>
                    <Link
                      href={`/${locale}/admin/orders/${order.id}`}
                      className="flex items-center gap-3 py-3 transition-colors hover:bg-surface-warm"
                    >
                      <div className="min-w-0 flex-1">
                        <span
                          dir="ltr"
                          className="font-mono text-sm font-semibold text-brand-700"
                        >
                          {order.number}
                        </span>
                        {order.publicRef ? (
                          <span
                            dir="ltr"
                            className="ms-2 font-mono text-xs text-ink-soft"
                          >
                            {order.publicRef}
                          </span>
                        ) : null}
                        <p className="mt-0.5 text-xs text-ink-muted">
                          {formatDate(order.createdAt, locale)}
                        </p>
                      </div>
                      <OrderStatusBadge status={order.status} dict={dict.status} />
                    </Link>
                  </li>
                ))}
              </ul>
              <Link
                href={`/${locale}/admin/orders`}
                className="mt-3 inline-block text-sm font-medium text-brand-700 underline"
              >
                {dict.admin.customers.viewAllOrders}
              </Link>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
