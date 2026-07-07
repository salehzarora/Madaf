import "server-only";

import { createHash } from "node:crypto";

import type {
  AllocationResult,
  CancelResult,
  HealthCheckResult,
  IssueResult,
  LegalInvoiceProvider,
  ProviderCallInput,
  ProviderResult,
  ProviderStatus,
  VerifyResult,
} from "./types";

/**
 * SandboxProvider (M6D) — a DETERMINISTIC MOCK. It performs NO network call,
 * contacts NO tax authority / provider, and returns NO real allocation number
 * or legal document. Every response is explicitly marked sandbox/non-legal
 * (`legal: false`, a loud `notice`, and `SANDBOX-…` / `SANDBOX-DO-NOT-USE-…`
 * placeholder strings). Outputs are a pure function of the input (a SHA-256 of
 * the idempotency key) — no randomness, no clock — so tests are reproducible.
 *
 * Active only when MADAF_TAX_PROVIDER_MODE === "sandbox". It still issues
 * NOTHING legal and is wired to no route/UI in M6D.
 */
const SANDBOX_NOTICE =
  "SANDBOX / MOCK — non-legal. Deterministic test response only. NOT a real " +
  "tax invoice, allocation number (מספר הקצאה), verification, or " +
  "tax-authority result; no real provider was contacted. Do not use for any " +
  "legal or accounting purpose.";

/** Deterministic 12-hex id derived from the idempotency key (no network, no
 *  randomness, no clock) so the same input always yields the same output. */
function det(idempotencyKey: string, salt: string): string {
  return createHash("sha256")
    .update(`${salt}:${idempotencyKey}`)
    .digest("hex")
    .slice(0, 12)
    .toUpperCase();
}

function base(
  idempotencyKey: string,
  status: ProviderStatus,
): ProviderResult {
  return {
    ok: true,
    mode: "sandbox",
    status,
    idempotencyKey,
    providerRequestId: `SBX-REQ-${det(idempotencyKey, "req")}`,
    providerResponseId: `SBX-RES-${det(idempotencyKey, "res")}`,
    errorCode: null,
    retryable: false,
    sandbox: true,
    legal: false,
    notice: SANDBOX_NOTICE,
  };
}

export class SandboxProvider implements LegalInvoiceProvider {
  readonly mode = "sandbox" as const;

  async healthCheck(): Promise<HealthCheckResult> {
    return {
      ok: true,
      mode: "sandbox",
      // The mock responds, but it is NOT a legal issuer (see legal: false).
      available: true,
      sandbox: true,
      legal: false,
      notice: SANDBOX_NOTICE,
    };
  }

  async requestAllocationNumber(
    input: ProviderCallInput,
  ): Promise<AllocationResult> {
    return {
      ...base(input.idempotencyKey, "approved"),
      // A loud, obviously-fake placeholder — never a real מספר הקצאה.
      mockAllocationNumber: `SANDBOX-DO-NOT-USE-${det(input.idempotencyKey, "alloc")}`,
    };
  }

  async verifyAllocationNumber(input: {
    number: string;
    idempotencyKey: string;
  }): Promise<VerifyResult> {
    return { ...base(input.idempotencyKey, "approved"), verified: true };
  }

  async submitOrIssueInvoice(input: ProviderCallInput): Promise<IssueResult> {
    return {
      ...base(input.idempotencyKey, "approved"),
      mockProviderRef: `SANDBOX-REF-${det(input.idempotencyKey, "issue")}`,
    };
  }

  async cancelOrCreditInvoice(
    input: ProviderCallInput & { targetLegalDocumentId?: string | null },
  ): Promise<CancelResult> {
    return {
      ...base(input.idempotencyKey, "approved"),
      mockProviderRef: `SANDBOX-CANCEL-${det(input.idempotencyKey, "cancel")}`,
    };
  }
}
