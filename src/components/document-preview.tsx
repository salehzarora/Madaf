import { notFound } from "next/navigation";
import { DocumentView } from "@/components/document-view";
import type { Locale } from "@/i18n/config";
import { getOrderDocumentSource } from "@/lib/data";
import type { OrderDocumentSource } from "@/lib/pdf/document-model";
import type { OrderDocument } from "@/lib/types";

/** Render one authorized saved order/header/items version for Preview or Print. */
export async function DocumentPreview({
  document,
  locale,
  autoPrint = false,
  source: preparedSource,
}: {
  document: OrderDocument;
  locale: Locale;
  autoPrint?: boolean;
  source?: OrderDocumentSource;
}) {
  const source = preparedSource ?? await getOrderDocumentSource(document.orderId);
  if (!source) notFound();

  return (
    <div className="mx-auto w-full max-w-4xl">
      <DocumentView document={document} source={source} uiLocale={locale} autoPrint={autoPrint} />
    </div>
  );
}
