/**
 * M5A/M5B — order document PDF download.
 *
 * GET /[locale]/admin/orders/[id]/documents/[type]?lang=he|ar|en&regenerate=1
 * Optional mode=share streams inline PDF bytes; absent/download retains the
 * existing private-storage download behavior. Other modes are rejected.
 *   type ∈ order | delivery | invoiceDraft  (allowlist — legal tax invoice
 *   types are impossible to request).
 *
 * Access (unchanged from M4D/M5A): the order is read through the
 * authenticated RLS client (getOrderDocumentSource), so a sales_rep only
 * reaches assigned-customer orders and a non-member reaches none → 404.
 * Recording goes through create_order_document (authorize_tenant +
 * can_access_order), and set_document_storage (authenticated) re-checks
 * access + the exact expected path. Only AFTER these authorization checks
 * does the TRUSTED, server-only service-role client perform the actual
 * upload + signing (M5B.1) — normal authenticated users can no longer write
 * to the documents bucket directly (its storage policies were dropped), so a
 * forged PDF cannot be planted at the deterministic path.
 *
 * M5B/M5B.1 behavior:
 *   - supabase mode: store the PDF in the PRIVATE `documents` bucket via the
 *     trusted server path and 302-redirect to a SHORT-LIVED signed URL. Reuse
 *     a stored object ONLY when its recorded storage_path is exactly the
 *     expected DB-derived path, unless ?regenerate=1. No public URL exists.
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
import {
  signStoredDocument,
  storeDocumentPdf,
} from "@/lib/data";
import { isDocumentType } from "@/lib/pdf/document-model";
import { prepareOrderDocument } from "@/lib/pdf/prepare-document";
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
  const mode = url.searchParams.get("mode") ?? "download";
  if (mode !== "download" && mode !== "share") {
    return new Response(null, { status: 400, headers: { "Cache-Control": "private, no-store" } });
  }
  const langParam = url.searchParams.get("lang");
  const docLocale: Locale =
    langParam && isLocale(langParam) ? langParam : defaultDocumentLocale;
  const regenerate = url.searchParams.get("regenerate") === "1";

  const prepared = await prepareOrderDocument(id, type, docLocale);
  if (prepared.status !== 200) {
    return new Response(null, { status: prepared.status, headers: { "Cache-Control": "private, no-store" } });
  }
  const { source, record } = prepared;

  // Authoritative number, restricted to a safe ASCII filename/header value.
  const filename = `${record.documentNumber.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 100) || "document"}.pdf`;

  // Reuse a stored PDF only when the recorded storage_path is exactly the
  // expected DB-derived path (M5B.1 — never trust an object at an unexpected
  // path). Signing runs on the trusted server client; access was already
  // verified above. ?regenerate=1 always re-renders through the trusted path.
  if (mode === "download" && !regenerate && record.storagePath) {
    const existing = await signStoredDocument({
      orderId: id,
      type,
      documentId: record.documentId,
      locale: docLocale,
      storedPath: record.storagePath,
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

  // File sharing needs same-origin bytes, never a signed storage URL. Use
  // exactly the same authorized source/renderer without uploading or signing.
  if (mode === "share") {
    return new Response(pdf, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${filename}"`,
        "Cache-Control": "private, no-store",
      },
    });
  }

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
