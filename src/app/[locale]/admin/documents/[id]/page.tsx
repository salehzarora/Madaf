import { notFound } from "next/navigation";
import { DocumentPreview } from "@/components/document-preview";
import { isLocale } from "@/i18n/config";
import { getDocument } from "@/lib/data";

// Reads authenticated, tenant-scoped document data through the cookie-bound
// client, so it MUST render dynamically per request — never statically
// generated or cached. No generateStaticParams (which would mark the route SSG);
// force-dynamic. Legal/document wording is unchanged.
export const dynamic = "force-dynamic";

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
  return <DocumentPreview document={doc} locale={locale} />;
}
