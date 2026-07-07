import "server-only";

/**
 * Sandbox legal-document orchestration (M6E) — server-only, DORMANT.
 *
 * ⚠️ Wired to NOTHING in M6E: no route, action, or UI imports this. It exists
 * to document + test the intended future issuing flow. It only ever runs a
 * SANDBOX / NON-LEGAL simulation behind every server-side gate (three env flags
 * + the service-role-only DB kill switch + owner/admin + tenant tax settings),
 * and the schema hard-constrains `legal_effective = false`. No real tax invoice,
 * allocation number, provider call, payment, or PDF.
 */
export { sandboxOrchestrationReadiness } from "./readiness";
export { simulateSandboxLegalDocumentIssue } from "./sandbox-issuer";
export type * from "./types";
