import "server-only";

import { getDataContext } from "@/lib/auth/session";
import { legalNumberingEnabled } from "@/lib/config/legal-invoicing";
import type { Database } from "@/lib/supabase/database.types";
import { getDataMode } from "./mode";

/**
 * DORMANT legal-numbering helper (M6C) — the intended FUTURE app-layer entry
 * point for drawing an internal, non-legal preview number.
 *
 * ⚠️ It is deliberately WIRED TO NOTHING in M6C — no UI, route, or action
 * imports it. It exists only to document + exercise the intended app-layer
 * gate, and it FAILS CLOSED twice over:
 *   1. App gate: the server-only `MADAF_LEGAL_NUMBERING_ENABLED` flag (default
 *      off; never NEXT_PUBLIC). Off ⇒ this refuses.
 *   2. DB gate: even if this ran, `draw_legal_document_number` refuses unless
 *      the service-role-only DB kill switch (`legal_numbering_settings.enabled`,
 *      default false) is on — which nothing in M6C turns on.
 *
 * It issues NOTHING: no tax invoice, no allocation number, no provider call,
 * no payment, no PDF, no legal_number on `legal_documents`. The returned string
 * is an INTERNAL preview like `DRAFT-LEGAL-2026-000001`, not a legal number.
 * Real numbering + issuing arrive in M6D-M6G behind flags after a professional
 * tax/accounting/legal review.
 */
export async function drawLegalDocumentNumber(input: {
  documentType: Database["public"]["Enums"]["legal_document_type"];
  year?: number | null;
  legalEntityId?: string | null;
}): Promise<string> {
  if (getDataMode() !== "supabase") {
    throw new Error(
      "[madaf/data] legal numbering is a Supabase-only path (mock has none).",
    );
  }
  // App-layer flag gate — server-only, fail-closed. In M6C this is always off.
  if (!legalNumberingEnabled()) {
    throw new Error(
      "[madaf/data] legal numbering is disabled (MADAF_LEGAL_NUMBERING_ENABLED " +
        "is off). No number is drawn; no invoice is issued.",
    );
  }
  const { client, tenantId } = await getDataContext();
  const { data, error } = await client.rpc("draw_legal_document_number", {
    p_tenant_id: tenantId,
    p_document_type: input.documentType,
    p_year: input.year ?? undefined,
    p_legal_entity_id: input.legalEntityId ?? undefined,
  });
  if (error) {
    throw new Error(`[madaf/data] drawLegalDocumentNumber failed: ${error.message}`);
  }
  return data as string;
}
