import "server-only";

/**
 * Legal-invoice provider abstraction — TYPES (M6D).
 *
 * ⚠️ Madaf issues NO legal tax invoice. This abstraction only ever resolves to
 * a NullProvider (disabled) or a SandboxProvider (deterministic mock). There is
 * NO real tax-authority / רשות המסים / SHAAM integration, NO real allocation
 * number (מספר הקצאה), NO production mode, NO credentials, and NO network call.
 * Every result carries `legal: false` and a non-legal `notice`.
 */

/** Only two modes exist in M6D. `production` is clamped to `disabled` upstream
 *  by taxProviderMode() (src/lib/config/legal-invoicing.ts) and never reaches
 *  the provider layer. */
export type ProviderMode = "disabled" | "sandbox";

export type ProviderStatus =
  | "unavailable" // NullProvider / disabled
  | "approved" // sandbox deterministic mock success
  | "rejected"
  | "pending"
  | "error";

/** Attached to EVERY provider result. `legal` is ALWAYS false in M6D. */
export interface SandboxMarker {
  /** true for the SandboxProvider, false for the NullProvider (disabled). */
  sandbox: boolean;
  /** ALWAYS false in M6D — no result here is a legal/official document. */
  legal: false;
  /** Human-readable, unmistakable non-legal marker. */
  notice: string;
}

/** Input to a mutating provider call. `payload` is built server-side and MUST
 *  be redacted before any logging; it never carries secrets/credentials. */
export interface ProviderCallInput {
  /** Idempotency key — prevents double-issue on retry (no live retry in M6D). */
  idempotencyKey: string;
  legalDocumentId?: string | null;
  payload?: Record<string, unknown>;
}

/** The idempotency + error model shared by every mutating result (Scope D). */
export interface ProviderResult extends SandboxMarker {
  ok: boolean;
  mode: ProviderMode;
  status: ProviderStatus;
  idempotencyKey: string;
  providerRequestId: string | null;
  providerResponseId: string | null;
  errorCode: string | null;
  retryable: boolean;
}

export interface HealthCheckResult extends SandboxMarker {
  ok: boolean;
  mode: ProviderMode;
  /** Can this provider service a (mock) request? false for the NullProvider.
   *  NOTE: even `true` (sandbox) is NOT a legal issuer — see `legal: false`. */
  available: boolean;
}

export interface AllocationResult extends ProviderResult {
  /** A clearly-fake, non-legal sandbox string, or null. NEVER a real מספר הקצאה. */
  mockAllocationNumber: string | null;
}

export interface VerifyResult extends ProviderResult {
  /** Deterministic sandbox verification only. */
  verified: boolean;
}

export interface IssueResult extends ProviderResult {
  /** A clearly-fake, non-legal sandbox reference, or null. NEVER a legal number. */
  mockProviderRef: string | null;
}

export interface CancelResult extends ProviderResult {
  mockProviderRef: string | null;
}

/**
 * The provider contract. Real implementations (sandbox first, real last, both
 * flag-gated) are a FUTURE concern (M6E). In M6D only NullProvider +
 * SandboxProvider exist, and neither issues anything legal.
 */
export interface LegalInvoiceProvider {
  readonly mode: ProviderMode;
  healthCheck(): Promise<HealthCheckResult>;
  requestAllocationNumber(input: ProviderCallInput): Promise<AllocationResult>;
  verifyAllocationNumber(input: {
    number: string;
    idempotencyKey: string;
  }): Promise<VerifyResult>;
  submitOrIssueInvoice(input: ProviderCallInput): Promise<IssueResult>;
  cancelOrCreditInvoice(
    input: ProviderCallInput & { targetLegalDocumentId?: string | null },
  ): Promise<CancelResult>;
}

/** Redacted, sandbox-marked log records — shaped to the M6B
 *  tax_authority_requests / tax_authority_responses columns. In M6D these are
 *  BUILT (pure) but NOT persisted (those tables are service-role-only and no
 *  issuing flow writes them yet — see logging.ts). */
export interface RedactedProviderRequestLog {
  kind: "allocation_number" | "verify" | "issue" | "cancel" | "health";
  idempotencyKey: string;
  legalDocumentId: string | null;
  providerMode: ProviderMode;
  /** Secrets/tokens/credentials/PII-ish keys are replaced with "[REDACTED]". */
  redactedRequestPayload: Record<string, unknown>;
}

export interface RedactedProviderResponseLog {
  httpStatus: number | null;
  outcome: ProviderStatus;
  providerRef: string | null;
  /** Sandbox mock or null — never a real allocation number. */
  allocationNumber: string | null;
  redactedResponsePayload: Record<string, unknown>;
  sandbox: boolean;
  legal: false;
}
