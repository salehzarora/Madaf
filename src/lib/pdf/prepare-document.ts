import "server-only";

import type { Locale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { getOrderDocumentSource, recordOrderDocument } from "@/lib/data";
import type { DocumentType } from "@/lib/types";

/** Shared access/record path for PDF delivery and the HTML print entry point. */
export async function prepareOrderDocument(
  orderId: string,
  type: DocumentType,
  locale: Locale,
) {
  // Authenticated RLS read; sales reps only reach assigned-customer orders.
  const source = await getOrderDocumentSource(orderId);
  if (!source) return { status: 404 } as const;

  try {
    // The existing RPC independently rechecks can_access_order. No new write
    // path, numbering rule or legal-document family is introduced here.
    const record = await recordOrderDocument({
      orderId,
      orderNumber: source.orderNumber,
      publicRef: source.publicRef,
      orderDate: source.orderDate,
      type,
      locale,
      legalNotice: type === "invoiceDraft"
        ? getDictionary(locale).docs.notLegalNotice
        : null,
    });
    return { status: 200, source, record } as const;
  } catch {
    // Do not put RPC/provider details or document content in logs/responses.
    return { status: 403 } as const;
  }
}
