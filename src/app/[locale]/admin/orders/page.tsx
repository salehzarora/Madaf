import { notFound } from "next/navigation";
import { OrdersTable } from "@/components/admin/orders-table";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { listOrders } from "@/lib/data";

export default async function AdminOrdersPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const dict = getDictionary(locale);
  const t = dict.admin.orders;
  const orders = await listOrders();

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink">
          {t.title}
        </h1>
        <p className="mt-1 text-sm text-ink-muted">{t.subtitle}</p>
      </div>
      <OrdersTable orders={orders} locale={locale} dict={dict} />
    </div>
  );
}
