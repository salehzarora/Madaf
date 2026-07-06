import { FileText, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ShelfRule } from "@/components/ui/shelf-rule";
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
        <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-muted">
          {dict.nav.admin}
        </p>
        <h1 className="mt-1 text-[28px] font-extrabold tracking-[-0.02em] text-ink">
          {t.title}
        </h1>
        <p className="mt-0.5 text-sm text-ink-muted">{t.subtitle}</p>
        <ShelfRule className="mt-4" />
      </div>

      {/* Legal banner — always visible on the documents index */}
      <div className="flex items-start gap-3 rounded-field border border-dashed border-warning/45 bg-accent-wash px-4 py-3 text-sm text-accent-deep">
        <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
        <p>{t.legalBanner}</p>
      </div>

      <Card className="overflow-x-auto">
        <table className="w-full min-w-[680px] text-sm">
          <thead>
            <tr className="border-b border-line bg-surface-warm text-[11px] font-bold uppercase tracking-[0.06em] text-ink-muted">
              <th className="px-4 py-3 text-start">{t.colDoc}</th>
              <th className="px-4 py-3 text-start">{t.colType}</th>
              <th className="px-4 py-3 text-start">{t.colOrder}</th>
              <th className="px-4 py-3 text-start">{t.colShop}</th>
              <th className="px-4 py-3 text-start">{t.colDate}</th>
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
                  className="border-b border-line-hair transition-colors last:border-0 hover:bg-surface-warm"
                >
                  <td className="px-4 py-3.5">
                    <Link
                      href={`/${locale}/admin/documents/${doc.id}`}
                      className="inline-flex items-center gap-2 text-brand-700 hover:underline"
                    >
                      <FileText className="size-4 shrink-0" aria-hidden />
                      <span
                        dir="ltr"
                        className="font-mono text-[13px] font-semibold"
                      >
                        {doc.number}
                      </span>
                    </Link>
                  </td>
                  <td className="px-4 py-3.5">
                    <Badge
                      tone={typeTone[doc.type]}
                      dot
                      dashed={doc.type === "invoiceDraft"}
                    >
                      {dict.docs.types[doc.type]}
                    </Badge>
                  </td>
                  <td
                    className="px-4 py-3.5 font-mono text-[13px] text-ink-soft"
                    dir="ltr"
                  >
                    {order?.number ?? "—"}
                  </td>
                  <td className="px-4 py-3.5 font-medium text-ink">
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
