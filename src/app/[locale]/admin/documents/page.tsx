import { FileText, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ShelfRule } from "@/components/ui/shelf-rule";
import { isLocale } from "@/i18n/config";
import { getDictionary, interpolate } from "@/i18n/dictionaries";
import { getTenantTimeZone, listDocumentsPage } from "@/lib/data";
import { formatTenantDateTime } from "@/lib/time";
import type { DocumentType } from "@/lib/types";

const typeTone: Record<DocumentType, "info" | "brand" | "warning"> = {
  order: "info",
  delivery: "brand",
  invoiceDraft: "warning",
};

/**
 * Documents index — order docs, delivery notes and invoice DRAFTS. Bounded +
 * paginated (M8I.7): a single page-bounded document read enriched only for the
 * orders/customers on the page, so the index never silently drops rows at the
 * PostgREST 1000-row cap. Owner/admin access is enforced by the admin layout guard.
 */
export default async function AdminDocumentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ page?: string | string[] }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const dict = getDictionary(locale);
  const t = dict.admin.documents;

  // A repeated ?page arrives as string[] — collapse to the first, then parse;
  // the data layer clamps an out-of-range page to the last one.
  const { page: rawPage } = await searchParams;
  const pageParam = Array.isArray(rawPage) ? rawPage[0] : rawPage;
  const parsedPage = Number.parseInt((pageParam ?? "").trim(), 10);
  const requestedPage = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;

  const [result, timeZone] = await Promise.all([
    listDocumentsPage(requestedPage),
    getTenantTimeZone(),
  ]);
  const { rows, page, totalPages } = result;
  const pageHref = (n: number) => `/${locale}/admin/documents?page=${n}`;

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

      {rows.length === 0 ? (
        <Card className="px-4 py-10 text-center">
          <p className="text-sm font-medium text-ink-soft">{t.empty}</p>
        </Card>
      ) : (
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
              {rows.map((doc) => (
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
                      <span dir="ltr" className="font-mono text-[13px] font-semibold">
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
                  <td className="px-4 py-3.5 font-mono text-[13px] text-ink-soft" dir="ltr">
                    {doc.orderNumber ?? "—"}
                  </td>
                  <td className="px-4 py-3.5 font-medium text-ink">
                    {doc.customerName ?? "—"}
                  </td>
                  <td className="px-4 py-3.5 text-ink-muted">
                    {formatTenantDateTime(doc.date, locale, timeZone)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {totalPages > 1 ? (
        <nav
          className="flex items-center justify-center gap-4 text-sm"
          aria-label={t.title}
        >
          {page > 1 ? (
            <Link
              href={pageHref(page - 1)}
              className="font-medium text-brand-700 hover:underline"
              rel="prev"
            >
              {t.prevPage}
            </Link>
          ) : (
            <span className="text-ink-muted">{t.prevPage}</span>
          )}
          <span className="text-ink-soft">
            {interpolate(t.pageLabel, { page, pages: totalPages })}
          </span>
          {page < totalPages ? (
            <Link
              href={pageHref(page + 1)}
              className="font-medium text-brand-700 hover:underline"
              rel="next"
            >
              {t.nextPage}
            </Link>
          ) : (
            <span className="text-ink-muted">{t.nextPage}</span>
          )}
        </nav>
      ) : null}
    </div>
  );
}
