import { Link2, ShoppingBag, Store } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ShelfRule } from "@/components/ui/shelf-rule";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { listCustomers, listOrders } from "@/lib/data";
import { formatDate, formatNumber } from "@/lib/format";

/** Shops list — with per-shop order stats and a "start order" deep link. */
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
        <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-muted">
          {dict.nav.admin}
        </p>
        <h1 className="mt-1 text-[28px] font-extrabold tracking-[-0.02em] text-ink">
          {t.title}
        </h1>
        <p className="mt-0.5 text-sm text-ink-muted">{t.subtitle}</p>
        <ShelfRule className="mt-4" />
      </div>

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
    </div>
  );
}
