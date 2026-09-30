import { notFound } from "next/navigation";
import { DocumentPreview } from "@/components/document-preview";
import { defaultDocumentLocale, isLocale } from "@/i18n/config";
import { isDocumentType } from "@/lib/pdf/document-model";
import { prepareOrderDocument } from "@/lib/pdf/prepare-document";

export const dynamic = "force-dynamic";

/** Print without a PDF download, using the same access/record path and template. */
export default async function OrderDocumentPrintPage({ params }: {
  params: Promise<{ locale: string; id: string; type: string }>;
}) {
  const { locale, id, type } = await params;
  if (!isLocale(locale) || !isDocumentType(type)) notFound();
  const prepared = await prepareOrderDocument(id, type, defaultDocumentLocale);
  if (prepared.status !== 200) notFound();
  const { record } = prepared;

  // The RPC is idempotent in live mode. Mock mode returns the same authoritative
  // number/date without persisting a row, so a lookup by its new ID is not needed.
  return <DocumentPreview locale={locale} autoPrint document={{
    id: record.documentId,
    orderId: id,
    type,
    number: record.documentNumber,
    date: record.documentDate,
  }} />;
}
