import "server-only";

import type {
  AllocationResult,
  CancelResult,
  HealthCheckResult,
  IssueResult,
  LegalInvoiceProvider,
  ProviderCallInput,
  ProviderResult,
  VerifyResult,
} from "./types";

/**
 * NullProvider (M6D) — the DISABLED provider. Every call returns
 * `unavailable` and issues NOTHING. This is the default whenever
 * MADAF_TAX_PROVIDER_MODE is not `sandbox` (missing/blank/`disabled`, and
 * `production` — which is clamped to `disabled` upstream). No network, no
 * dependency, no credentials.
 */
const NULL_NOTICE =
  "Legal invoicing provider is DISABLED. No tax invoice, allocation number " +
  "(מספר הקצאה), verification, cancellation, or tax-authority call is " +
  "available. This is not a legal document.";

function disabled(idempotencyKey: string): ProviderResult {
  return {
    ok: false,
    mode: "disabled",
    status: "unavailable",
    idempotencyKey,
    providerRequestId: null,
    providerResponseId: null,
    errorCode: "PROVIDER_DISABLED",
    retryable: false,
    sandbox: false,
    legal: false,
    notice: NULL_NOTICE,
  };
}

export class NullProvider implements LegalInvoiceProvider {
  readonly mode = "disabled" as const;

  async healthCheck(): Promise<HealthCheckResult> {
    return {
      ok: false,
      mode: "disabled",
      available: false,
      sandbox: false,
      legal: false,
      notice: NULL_NOTICE,
    };
  }

  async requestAllocationNumber(
    input: ProviderCallInput,
  ): Promise<AllocationResult> {
    return { ...disabled(input.idempotencyKey), mockAllocationNumber: null };
  }

  async verifyAllocationNumber(input: {
    number: string;
    idempotencyKey: string;
  }): Promise<VerifyResult> {
    return { ...disabled(input.idempotencyKey), verified: false };
  }

  async submitOrIssueInvoice(input: ProviderCallInput): Promise<IssueResult> {
    return { ...disabled(input.idempotencyKey), mockProviderRef: null };
  }

  async cancelOrCreditInvoice(
    input: ProviderCallInput & { targetLegalDocumentId?: string | null },
  ): Promise<CancelResult> {
    return { ...disabled(input.idempotencyKey), mockProviderRef: null };
  }
}
