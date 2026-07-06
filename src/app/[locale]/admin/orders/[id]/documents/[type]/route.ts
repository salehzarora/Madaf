/**
 * M5A — order document PDF download (server-side generation).
 *
 * GET /[locale]/admin/orders/[id]/documents/[type]?lang=he|ar|en
 *   type ∈ order | delivery | invoiceDraft  (allowlist — legal tax invoice
 *   types are impossible to request).
 *
 * Access: the order is read through the authenticated RLS client
 * (getOrderDocumentSource), so a sales_rep only reaches assigned-customer
 * orders and a non-member reaches none → 404. Recording the row goes through
 * the create_order_document RPC, which re-verifies access (authorize_tenant +
 * can_access_order) — defense in depth. Totals + line items come from the
 * order snapshots, never from the caller.
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
import { getDictionary } from "@/i18n/dictionaries";
import { getOrderDocumentSource, recordOrderDocument } from "@/lib/data";
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

  // Document language: Hebrew-first default, ?lang=he|ar|en to override.
  const langParam = new URL(request.url).searchParams.get("lang");
  const docLocale: Locale =
    langParam && isLocale(langParam) ? langParam : defaultDocumentLocale;

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

  let record: { documentNumber: string; documentDate: string };
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
      "Content-Disposition": `attachment; filename="${record.documentNumber}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
