/**
 * Operational order document PDF bytes.
 *
 * GET /[locale]/admin/orders/[id]/documents/[type]?lang=he|ar|en&regenerate=1
 * Optional mode=share streams inline PDF bytes; absent/download streams a
 * freshly rendered same-origin attachment. Other modes are rejected.
 *   type ∈ order | delivery | invoiceDraft  (allowlist — legal tax invoice
 *   types are impossible to request).
 *
 * Access (unchanged from M4D/M5A): the order is read through the
 * authenticated RLS client (getOrderDocumentSource), so a sales_rep only
 * reaches assigned-customer orders and a non-member reaches none → 404.
 * Recording goes through create_order_document (authorize_tenant +
 * can_access_order). Every response uses one coherent saved source and the
 * existing renderer. A recorded storage path is never a freshness guarantee:
 * this route neither reuses it nor redirects to a mutable stored object.
 * Historical storage objects/metadata and shared storage helpers are intact.
 *
 * ⚠️ invoice_draft renders a DRAFT watermark + not-a-tax-invoice notice; it
 * is NEVER a legal tax invoice (docs/DOCUMENTS_AND_INVOICES_GUIDE.md).
 *
 * Node runtime (pdfkit needs fs/streams); never statically cached.
 */
import {
  defaultDocumentLocale,
  isLocale,
  type Locale,
} from "@/i18n/config";
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

  const prepared = await prepareOrderDocument(id, type, docLocale);
  if (prepared.status !== 200) {
    return new Response(null, { status: prepared.status, headers: { "Cache-Control": "private, no-store" } });
  }
  const { source, record } = prepared;

  // Authoritative number, restricted to a safe ASCII filename/header value.
  const filename = `${record.documentNumber.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 100) || "document"}.pdf`;

  // Render fresh from server-side order snapshots.
  const pdf = await renderOrderDocumentPdf({
    source,
    docType: type,
    docNumber: record.documentNumber,
    docDate: record.documentDate,
    docLocale,
  });

  return new Response(pdf, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${mode === "share" ? "inline" : "attachment"}; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
