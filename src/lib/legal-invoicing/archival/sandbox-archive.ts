import "server-only";

import { randomBytes } from "node:crypto";

import { getDataContext } from "@/lib/auth/session";
import type { SandboxArchiveInput, SandboxArchiveResult } from "./types";

/**
 * SANDBOX archive + sign a sandbox legal document (M6F) — server-only, DORMANT
 * (no route/action/UI imports it).
 *
 * ⚠️ The DB RPC `sandbox_archive_and_sign_legal_document` is the SECURITY SOURCE
 * OF TRUTH: it enforces owner/admin (authorize_tenant), the fail-closed DB kill
 * switch, target validation (the row must be an M6E sandbox / non-legal
 * document), write-once, and generates the canonical payload + SHA-256 + the
 * SANDBOX placeholder signature itself (NO caller JSON). This helper sends no
 * payload and does not swallow security failures. Everything is SANDBOX /
 * NON-LEGAL: not a real archive, signature, or tax-compliant record; no PDF,
 * provider, allocation number, or payment; legal_effective stays false.
 */
const NON_LEGAL_NOTE =
  "SANDBOX / NON-LEGAL tamper-evidence — not a legal archive, not a real " +
  "digital signature, not tax-compliant.";

function unavailable(reasons: string[]): SandboxArchiveResult {
  return {
    ok: false,
    sandbox: true,
    legal: false,
    unavailable: true,
    reasons,
    legalDocumentId: null,
    archivalRecordId: null,
    signingRecordId: null,
    contentSha256: null,
    signatureAlgorithm: null,
    notice: NON_LEGAL_NOTE,
  };
}

export async function sandboxArchiveAndSignLegalDocument(
  input: SandboxArchiveInput,
): Promise<SandboxArchiveResult> {
  const { client, tenantId } = await getDataContext();
  const idempotencyKey = `sbx-arch-${randomBytes(24).toString("base64url")}`;

  const { data, error } = await client.rpc(
    "sandbox_archive_and_sign_legal_document",
    {
      p_tenant_id: tenantId,
      p_legal_document_id: input.legalDocumentId,
      p_idempotency_key: idempotencyKey,
    },
  );

  if (error) {
    // Any gate the RPC enforces (kill switch / target validation / write-once)
    // → unavailable, not a crash.
    if (/MDF7\d|disabled|not.*(sandbox|found)|already/i.test(error.message)) {
      return unavailable([error.message]);
    }
    throw new Error(
      `[madaf/legal] sandboxArchiveAndSignLegalDocument failed: ${error.message}`,
    );
  }

  const r = (data ?? {}) as Record<string, unknown>;
  return {
    ok: true,
    sandbox: true,
    legal: false,
    unavailable: false,
    reasons: [],
    legalDocumentId: (r.legalDocumentId as string) ?? null,
    archivalRecordId: (r.archivalRecordId as string) ?? null,
    signingRecordId: (r.signingRecordId as string) ?? null,
    contentSha256: (r.contentSha256 as string) ?? null,
    signatureAlgorithm: (r.signatureAlgorithm as string) ?? null,
    notice: (r.notice as string) ?? NON_LEGAL_NOTE,
  };
}
