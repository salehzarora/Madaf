import { notFound } from "next/navigation";
import { DocumentView } from "@/components/document-view";
import { isLocale } from "@/i18n/config";
import { documentById, documents, orderById } from "@/lib/mock";

export function generateStaticParams() {
  return documents.map((doc) => ({ id: doc.id }));
}

/**
 * Hebrew-first document preview. The DocumentView client component owns
 * the document-language toggle and all legal-wording rules.
 */
export default async function AdminDocumentDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  if (!isLocale(locale)) notFound();
  const doc = documentById.get(id);
  if (!doc) notFound();
  const order = orderById.get(doc.orderId);
  if (!order) notFound();

  return (
    <div className="mx-auto w-full max-w-4xl">
      <DocumentView document={doc} order={order} uiLocale={locale} />
    </div>
  );
}
