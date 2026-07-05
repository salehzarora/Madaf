import { FileText, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { listCustomers, listDocuments, listOrders } from "@/lib/data";
import { formatDate } from "@/lib/format";
import type { DocumentType } from "@/lib/types";

const typeTone: Record<DocumentType, "info" | "brand" | "warning"> = {
  order: "info",
  delivery: "brand",
  invoiceDraft: "warning",
};

/** Documents index — order docs, delivery notes and invoice DRAFTS. */
export default async function AdminDocumentsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const dict = getDictionary(locale);
  const t = dict.admin.documents;

  const [documents, orders, customers] = await Promise.all([
    listDocuments(),
    listOrders(),
    listCustomers(),
  ]);
  const orderById = new Map(orders.map((o) => [o.id, o]));
  const customerById = new Map(customers.map((c) => [c.id, c]));
  const sorted = [...documents].sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink">
          {t.title}
        </h1>
        <p className="mt-1 text-sm text-ink-muted">{t.subtitle}</p>
      </div>

      {/* Legal banner — always visible on the documents index */}
      <div className="flex items-start gap-3 rounded-field border border-warning/40 bg-warning-soft px-4 py-3 text-sm text-warning">
        <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
        <p>{t.legalBanner}</p>
      </div>

      <Card className="overflow-x-auto">
        <table className="w-full min-w-[680px] text-sm">
          <thead>
            <tr className="border-b border-line text-xs uppercase tracking-wide text-ink-muted">
              <th className="px-4 py-3 text-start font-medium">{t.colDoc}</th>
              <th className="px-4 py-3 text-start font-medium">{t.colType}</th>
              <th className="px-4 py-3 text-start font-medium">{t.colOrder}</th>
              <th className="px-4 py-3 text-start font-medium">{t.colShop}</th>
              <th className="px-4 py-3 text-start font-medium">{t.colDate}</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((doc) => {
              const order = orderById.get(doc.orderId);
              const customer = order
                ? customerById.get(order.customerId)
                : undefined;
              return (
                <tr
                  key={doc.id}
                  className="border-b border-line/60 transition-colors last:border-0 hover:bg-surface-sunken/50"
                >
                  <td className="px-4 py-3.5">
                    <Link
                      href={`/${locale}/admin/documents/${doc.id}`}
                      className="inline-flex items-center gap-2 font-semibold text-brand-700 hover:underline"
                    >
                      <FileText className="size-4" aria-hidden />
                      <span dir="ltr">{doc.number}</span>
                    </Link>
                  </td>
                  <td className="px-4 py-3.5">
                    <Badge tone={typeTone[doc.type]}>
                      {dict.docs.types[doc.type]}
                    </Badge>
                  </td>
                  <td className="px-4 py-3.5 text-ink-soft" dir="ltr">
                    {order?.number ?? "—"}
                  </td>
                  <td className="px-4 py-3.5 text-ink">
                    {customer?.name ?? "—"}
                  </td>
                  <td className="px-4 py-3.5 text-ink-muted">
                    {formatDate(doc.date, locale)}
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
