import "server-only";

/**
 * Sandbox archival + signing (M6F) — server-only, DORMANT.
 *
 * ⚠️ Wired to NOTHING in M6F: no route, action, or UI imports this. SANDBOX /
 * NON-LEGAL tamper-evidence only — not a real archive, signature, or
 * tax-compliant record. legal_effective stays false. See the DB RPC
 * `sandbox_archive_and_sign_legal_document`, which is the security boundary.
 */
export { sandboxArchiveAndSignLegalDocument } from "./sandbox-archive";
export type * from "./types";
