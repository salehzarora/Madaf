/**
 * M5A/M5B — order document PDF download.
 *
 * GET /[locale]/admin/orders/[id]/documents/[type]?lang=he|ar|en&regenerate=1
 *   type ∈ order | delivery | invoiceDraft  (allowlist — legal tax invoice
 *   types are impossible to request).
 *
 * Access (unchanged from M4D/M5A): the order is read through the
 * authenticated RLS client (getOrderDocumentSource), so a sales_rep only
 * reaches assigned-customer orders and a non-member reaches none → 404.
 * Recording goes through create_order_document (authorize_tenant +
 * can_access_order); the storage upload + signed URL run on the same
 * authenticated client, gated a THIRD time by the storage.objects policies
 * (can_access_order on the path's tenant + order segments).
 *
 * M5B behavior:
 *   - supabase mode: store the PDF in the PRIVATE `documents` bucket and
 *     302-redirect to a SHORT-LIVED signed URL. Reuses a stored object when
 *     present unless ?regenerate=1. The signed URL is access-checked at
 *     creation and expires quickly; no public URL exists.
 *   - mock mode: no storage — stream the freshly-rendered bytes (M5A).
 *
 * ⚠️ invoice_draft renders a DRAFT watermark + not-a-tax-invoice notice; it
 * is NEVER a legal tax invoice (docs/DOCUMENTS_AND_INVOICES_GUIDE.md).
 *
 * Node runtime (pdfkit needs fs/streams); never statically cached.
 */
import { createHash } from "node:crypto";
import {
  defaultDocumentLocale,
  isLocale,
  type Locale,
} from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import {
  getOrderDocumentSource,
  recordOrderDocument,
  signStoredDocument,
  storeDocumentPdf,
} from "@/lib/data";
import { isDocumentType } from "@/lib/pdf/document-model";
import { renderOrderDocumentPdf } from "@/lib/pdf/render-document";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  ctx: { params: Promise<{ locale: string; id: string; type: string }> },
): Promise<Response> {
  const { locale, id, type } = await ctx.params;
  if (!isLocale(locale)) return new Response(null, { status: 404 });
  // Allowlist: only the three safe document types — never a legal tax type.
  if (!isDocumentType(type)) return new Response(null, { status: 404 });

  const url = new URL(request.url);
  const langParam = url.searchParams.get("lang");
  const docLocale: Locale =
    langParam && isLocale(langParam) ? langParam : defaultDocumentLocale;
  const regenerate = url.searchParams.get("regenerate") === "1";

  // Access-gated read. supabase: RLS (can_access_order) → a rep only sees
  // assigned-customer orders, others none → undefined → 404. mock: resolves.
  const source = await getOrderDocumentSource(id);
  if (!source) return new Response(null, { status: 404 });

  // Record the document row. invoice_draft pins the localized
  // not-a-tax-invoice notice so the DB CHECK is always satisfied.
  const legalNotice =
    type === "invoiceDraft"
      ? getDictionary(docLocale).docs.notLegalNotice
      : null;

  let record: {
    documentId: string;
    documentNumber: string;
    documentDate: string;
  };
  try {
    record = await recordOrderDocument({
      orderId: id,
      orderNumber: source.orderNumber,
      orderDate: source.orderDate,
      type,
      locale: docLocale,
      legalNotice,
    });
  } catch (error) {
    // RPC access failure (not a member / not accessible) — do not leak why.
    console.error("[madaf/pdf] recordOrderDocument failed:", error);
    return new Response(null, { status: 403 });
  }

  const filename = `${record.documentNumber}.pdf`;

  // Reuse a stored PDF (supabase, not ?regenerate) → redirect to a signed URL.
  if (!regenerate) {
    const existing = await signStoredDocument({
      orderId: id,
      type,
      documentId: record.documentId,
      locale: docLocale,
      filename,
    });
    if (existing) return Response.redirect(existing, 302);
  }

  // Render fresh from server-side order snapshots.
  const pdf = await renderOrderDocumentPdf({
    source,
    docType: type,
    docNumber: record.documentNumber,
    docDate: record.documentDate,
    docLocale,
  });

  // supabase: upload to private storage + redirect to a signed URL. On
  // failure (or in mock mode) storeDocumentPdf returns null and we stream
  // the bytes we already have.
  const checksum = createHash("sha256").update(pdf).digest("hex");
  const signedUrl = await storeDocumentPdf({
    orderId: id,
    type,
    documentId: record.documentId,
    locale: docLocale,
    filename,
    bytes: pdf,
    checksum,
  });
  if (signedUrl) return Response.redirect(signedUrl, 302);

  return new Response(pdf, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
