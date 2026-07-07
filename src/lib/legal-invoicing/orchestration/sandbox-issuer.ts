import "server-only";

import { randomBytes } from "node:crypto";

import { getDataContext } from "@/lib/auth/session";
import { sandboxOrchestrationReadiness } from "./readiness";
import type { SandboxIssueInput, SandboxIssueResult } from "./types";

/**
 * SANDBOX legal-document issue simulation (M6E · hardened M6E.1) — server-only,
 * DORMANT (no route/action/UI imports it).
 *
 * ⚠️ The DB RPC `sandbox_issue_legal_document` is the SECURITY SOURCE OF TRUTH:
 * it enforces every write gate itself (owner/admin via authorize_tenant; tenant
 * tax readiness; sandbox-only provider mode; idempotency BEFORE draw; and it
 * CALLS the M6C `draw_legal_document_number` internally so the DB kill switch
 * being off fails the whole call). This helper's readiness check is UX ONLY —
 * it is NOT relied on for security. The RPC persists NO caller-supplied JSON;
 * it generates minimal, redacted, sandbox-marked payloads and draws the number
 * itself, so this helper does NOT draw a number or send any payload (avoids a
 * double increment and any raw-secret persistence). Everything stays SANDBOX /
 * NON-LEGAL (sandbox=true, legal_effective=false, draft_internal; no real
 * invoice, allocation number, provider call, payment, or PDF).
 */
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
  // Readiness is UX only (fail fast with clear reasons). The RPC re-checks
  // everything server-side, so this is never the security boundary.
  const readiness = await sandboxOrchestrationReadiness();
  if (!readiness.ready) {
    return unavailable(readiness.reasons, readiness.note);
  }

  const { client, tenantId } = await getDataContext();
  const idempotencyKey = `sbx-${randomBytes(24).toString("base64url")}`;

  // The RPC enforces auth + tenant readiness + provider mode + idempotency +
  // the M6C draw (DB kill switch) and generates its own redacted sandbox
  // payloads. No caller JSON; no app-side draw.
  const { data, error } = await client.rpc("sandbox_issue_legal_document", {
    p_tenant_id: tenantId,
    p_document_type: input.documentType,
    p_idempotency_key: idempotencyKey,
    p_order_id: input.orderId ?? undefined,
    p_provider_mode: "sandbox",
  });

  if (error) {
    // Any gate the RPC re-checks (kill switch / tax readiness / provider mode /
    // idempotency) → unavailable, not a crash.
    if (/MDF6\d|MDF7\d|disabled|not ready/i.test(error.message)) {
      return unavailable([error.message], readiness.note);
    }
    throw new Error(
      `[madaf/legal] simulateSandboxLegalDocumentIssue failed: ${error.message}`,
    );
  }

  const r = (data ?? {}) as Record<string, unknown>;
  return {
    ok: true,
    sandbox: true,
    legal: false,
    unavailable: false,
    reasons: [],
    note: readiness.note,
    legalDocumentId: (r.legalDocumentId as string) ?? null,
    status: (r.status as string) ?? "draft_internal",
    previewNumber: (r.internalPreviewNumber as string) ?? null,
    mockAllocationNumber: (r.mockAllocationNumber as string) ?? null,
    providerRef: (r.providerRef as string) ?? null,
  };
}
