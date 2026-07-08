import { notFound } from "next/navigation";
import { DocumentView } from "@/components/document-view";
import { isLocale } from "@/i18n/config";
import {
  getDataMode,
  getDocument,
  getOrder,
  getSupplier,
  listDocuments,
} from "@/lib/data";

export async function generateStaticParams() {
  // Build-time, no request — never touch cookies()/session. In supabase mode
  // documents read through the cookie-bound client, so prebuild nothing and let
  // dynamicParams render each document page on demand at request time.
  if (getDataMode() === "supabase") return [];
  const documents = await listDocuments();
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
  const doc = await getDocument(id);
  if (!doc) notFound();
  const [order, supplier] = await Promise.all([
    getOrder(doc.orderId),
    getSupplier(),
  ]);
  if (!order) notFound();

  return (
    <div className="mx-auto w-full max-w-4xl">
      <DocumentView
        document={doc}
        order={order}
        supplier={supplier}
        uiLocale={locale}
      />
    </div>
  );
}
