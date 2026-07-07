import "server-only";

/**
 * Sandbox archival + signing — TYPES (M6F).
 *
 * ⚠️ SANDBOX / NON-LEGAL tamper-evidence only. NOT a real legal archive, NOT a
 * real digital signature, NOT tax-compliant. Every result is `sandbox: true` +
 * `legal: false`.
 */
export interface SandboxArchiveInput {
  legalDocumentId: string;
}

export interface SandboxArchiveResult {
  ok: boolean;
  /** ALWAYS true. */
  sandbox: true;
  /** ALWAYS false — never a legal archive/signature. */
  legal: false;
  /** True when a gate (kill switch / target validation / write-once) blocked it. */
  unavailable: boolean;
  reasons: string[];
  legalDocumentId: string | null;
  archivalRecordId: string | null;
  signingRecordId: string | null;
  /** SHA-256 of the canonical (SQL-generated) non-legal payload. */
  contentSha256: string | null;
  /** Always a SANDBOX placeholder label. */
  signatureAlgorithm: string | null;
  notice: string;
}
