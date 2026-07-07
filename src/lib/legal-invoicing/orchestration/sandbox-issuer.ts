import "server-only";

import { randomBytes } from "node:crypto";

import { getDataContext } from "@/lib/auth/session";
import { drawLegalDocumentNumber } from "@/lib/data/legal-numbering";
import {
  buildProviderLog,
  getLegalInvoiceProvider,
} from "@/lib/legal-invoicing/provider";
import type { Json } from "@/lib/supabase/database.types";
import { sandboxOrchestrationReadiness } from "./readiness";
import type { SandboxIssueInput, SandboxIssueResult } from "./types";

/**
 * SANDBOX legal-document issue simulation (M6E) — server-only, DORMANT.
 *
 * ⚠️ Wired to NOTHING in M6E (no route/action/UI imports it). It only runs when
 * EVERY gate is explicitly enabled locally, and even then it writes ONLY
 * clearly-marked SANDBOX / NON-LEGAL rows via `sandbox_issue_legal_document`
 * (draft_internal, sandbox=true, legal_effective=false, provider_mode=sandbox;
 * legal_number/allocation_number stay NULL). It issues NO real tax invoice,
 * requests NO real allocation number (מספר הקצאה), calls NO tax authority /
 * provider (SandboxProvider mock only), and creates NO PDF or payment.
 * Fail-closed: any missing gate returns { ok:false, unavailable:true }.
 */
const SANDBOX_ROW_NOTICE =
  "SANDBOX / NON-LEGAL SIMULATION — not a legal tax invoice, not a real " +
  "allocation number (מספר הקצאה); no tax authority or provider was contacted. " +
  "Do not use for any legal or accounting purpose.";

function unavailable(reasons: string[], note: string): SandboxIssueResult {
  return {
    ok: false,
    sandbox: true,
    legal: false,
    unavailable: true,
    reasons,
    note,
    legalDocumentId: null,
    status: null,
    previewNumber: null,
    mockAllocationNumber: null,
    providerRef: null,
  };
}

export async function simulateSandboxLegalDocumentIssue(
  input: SandboxIssueInput,
): Promise<SandboxIssueResult> {
  // 1. Env / role / tax-settings gates (fail-closed).
  const readiness = await sandboxOrchestrationReadiness();
  if (!readiness.ready) {
    return unavailable(readiness.reasons, readiness.note);
  }

  const { client, tenantId } = await getDataContext();
  const idempotencyKey = `sbx-${randomBytes(24).toString("base64url")}`;

  // 2. Draw an INTERNAL preview number (M6C helper — also gated by the env
  //    numbering flag + the DB kill switch). If the DB kill switch is off the
  //    draw throws; the RPC below then authoritatively reports it as disabled.
  let previewNumber: string | null = null;
  try {
    previewNumber = await drawLegalDocumentNumber({
      documentType: input.documentType,
    });
  } catch {
    previewNumber = null;
  }

  // 3. Sandbox provider (M6D) — MOCK only. providerSandbox gate guarantees this
  //    selector returns the SandboxProvider; it makes no network call.
  const provider = getLegalInvoiceProvider();
  const alloc = await provider.requestAllocationNumber({
    idempotencyKey,
    legalDocumentId: null,
    payload: { documentType: input.documentType, orderId: input.orderId ?? null },
  });
  const issue = await provider.submitOrIssueInvoice({
    idempotencyKey,
    legalDocumentId: null,
    payload: { documentType: input.documentType },
  });

  // 4. Build REDACTED, sandbox-marked log payloads (M6D). No secrets exist here.
  const log = buildProviderLog({
    kind: "issue",
    idempotencyKey,
    providerMode: "sandbox",
    outcome: "approved",
    requestPayload: {
      documentType: input.documentType,
      orderId: input.orderId ?? null,
      previewNumber,
    },
    responsePayload: {
      mockAllocationNumber: alloc.mockAllocationNumber,
      providerRef: issue.mockProviderRef,
      previewNumber,
      sandbox: true,
      legal: false,
    },
  });

  // 5. Write ONLY sandbox / non-legal rows via the gated SECURITY DEFINER RPC.
  //    The RPC re-checks owner/admin + the DB kill switch + sandbox-only mode,
  //    and the schema hard-constrains legal_effective=false.
  const { data, error } = await client.rpc("sandbox_issue_legal_document", {
    p_tenant_id: tenantId,
    p_document_type: input.documentType,
    p_idempotency_key: idempotencyKey,
    p_non_legal_notice: SANDBOX_ROW_NOTICE,
    p_provider_ref: issue.mockProviderRef ?? undefined,
    p_mock_allocation_number: alloc.mockAllocationNumber ?? undefined,
    p_request_payload: log.request.redactedRequestPayload as unknown as Json,
    p_response_payload: log.response.redactedResponsePayload as unknown as Json,
    p_order_id: input.orderId ?? undefined,
    p_provider_mode: "sandbox",
  });

  if (error) {
    // Kill switch off (or any gate the RPC re-checks) → unavailable, not a crash.
    if (/disabled|MDF70/i.test(error.message)) {
      return unavailable(
        ["the DB kill switch (legal_numbering_settings.enabled) is off"],
        readiness.note,
      );
    }
    throw new Error(
      `[madaf/legal] simulateSandboxLegalDocumentIssue failed: ${error.message}`,
    );
  }

  const result = (data ?? {}) as Record<string, unknown>;
  return {
    ok: true,
    sandbox: true,
    legal: false,
    unavailable: false,
    reasons: [],
    note: readiness.note,
    legalDocumentId: (result.legalDocumentId as string) ?? null,
    status: (result.status as string) ?? "draft_internal",
    previewNumber,
    mockAllocationNumber: alloc.mockAllocationNumber,
    providerRef: issue.mockProviderRef,
  };
}
