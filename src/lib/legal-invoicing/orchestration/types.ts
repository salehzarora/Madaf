import "server-only";

/**
 * Sandbox legal-document orchestration — TYPES (M6E).
 *
 * ⚠️ SANDBOX / NON-LEGAL ONLY. This layer wires M6B tax settings + M6C numbering
 * + M6D sandbox provider into a server-side *simulation*. It issues NO real tax
 * invoice, requests NO real allocation number (מספר הקצאה), calls NO tax
 * authority / provider, adds no production mode, no payments, no PDF. Every
 * result is `sandbox: true` + `legal: false`.
 */

/** The individual server-side gates. ALL must be true (and the service-role-only
 *  DB kill switch, enforced by the RPC) for a simulation to run. */
export interface SandboxOrchestrationGates {
  /** MADAF_LEGAL_INVOICING_ENABLED (server-only env; default off). */
  legalInvoicingFlag: boolean;
  /** MADAF_TAX_PROVIDER_MODE === "sandbox" (production is clamped to disabled). */
  providerSandbox: boolean;
  /** MADAF_LEGAL_NUMBERING_ENABLED (server-only env; default off). */
  numberingFlag: boolean;
  /** Data mode is supabase (mock/demo has no legal path). */
  supabaseMode: boolean;
  /** Caller is owner/admin of the selected tenant. */
  ownerOrAdmin: boolean;
  /** tenant_tax_settings.legal_invoicing_ready === true (NOT sufficient alone). */
  taxSettingsReady: boolean;
}

export interface SandboxOrchestrationReadiness {
  /** True only when every gate above passes. Even then, this is a SANDBOX
   *  simulation — no legal invoice is issued, and the DB kill switch
   *  (legal_numbering_settings.enabled, service-role-only, default off) is
   *  ALSO required and is enforced by the RPC (the app cannot read it). */
  ready: boolean;
  /** Human-readable blocking reasons (empty when ready). */
  reasons: string[];
  /** Permanent non-legal note. */
  note: string;
  gates: SandboxOrchestrationGates;
}

export interface SandboxIssueInput {
  documentType: import("@/lib/supabase/database.types").Database["public"]["Enums"]["legal_document_type"];
  orderId?: string | null;
}

export interface SandboxIssueResult {
  ok: boolean;
  /** ALWAYS true — every row/result here is a sandbox simulation. */
  sandbox: true;
  /** ALWAYS false — never a legal document. */
  legal: false;
  /** True when a gate (env/role/settings/DB kill switch) blocked the run. */
  unavailable: boolean;
  reasons: string[];
  note: string;
  legalDocumentId: string | null;
  status: string | null;
  /** Internal preview number (DRAFT-LEGAL-YYYY-######) or null — NOT a legal number. */
  previewNumber: string | null;
  /** Loud sandbox placeholder (SANDBOX-DO-NOT-USE-…) or null — NOT a real allocation number. */
  mockAllocationNumber: string | null;
  providerRef: string | null;
}
