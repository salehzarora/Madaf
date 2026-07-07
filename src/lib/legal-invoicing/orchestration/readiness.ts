import "server-only";

import { getCurrentMembership } from "@/lib/auth/session";
import {
  legalInvoicingEnabled,
  legalNumberingEnabled,
  taxProviderMode,
} from "@/lib/config/legal-invoicing";
import { getDataMode } from "@/lib/data/mode";
import { getTenantTaxSettings } from "@/lib/data/tax-settings";
import type {
  SandboxOrchestrationGates,
  SandboxOrchestrationReadiness,
} from "./types";

const NON_LEGAL_NOTE =
  "Even when ready, this only runs a SANDBOX / NON-LEGAL simulation — no legal " +
  "tax invoice is issued, no real allocation number (מספר הקצאה) is requested, " +
  "and no tax authority / provider is contacted. The DB kill switch " +
  "(legal_numbering_settings.enabled, service-role-only, default off) is ALSO " +
  "required and is enforced server-side by the RPC.";

/**
 * Explain whether the SANDBOX orchestration can run, and why not (M6E). All
 * gates default to blocking (disabled). Server-only; never trusts the client.
 * NOTE: the service-role-only DB kill switch cannot be read by the app — it is
 * enforced by `sandbox_issue_legal_document` at write time. This helper reports
 * only the env/role/settings gates.
 */
export async function sandboxOrchestrationReadiness(): Promise<SandboxOrchestrationReadiness> {
  const gates: SandboxOrchestrationGates = {
    legalInvoicingFlag: legalInvoicingEnabled(),
    providerSandbox: taxProviderMode() === "sandbox",
    numberingFlag: legalNumberingEnabled(),
    supabaseMode: getDataMode() === "supabase",
    ownerOrAdmin: false,
    taxSettingsReady: false,
  };

  const reasons: string[] = [];
  if (!gates.legalInvoicingFlag)
    reasons.push("MADAF_LEGAL_INVOICING_ENABLED is off");
  if (!gates.providerSandbox)
    reasons.push("MADAF_TAX_PROVIDER_MODE is not 'sandbox'");
  if (!gates.numberingFlag)
    reasons.push("MADAF_LEGAL_NUMBERING_ENABLED is off");
  if (!gates.supabaseMode)
    reasons.push("data mode is not supabase (mock/demo has no legal path)");

  if (gates.supabaseMode) {
    const membership = await getCurrentMembership();
    gates.ownerOrAdmin =
      membership?.role === "owner" || membership?.role === "admin";
    if (!gates.ownerOrAdmin)
      reasons.push("caller is not an owner/admin of the selected tenant");

    const settings = await getTenantTaxSettings();
    gates.taxSettingsReady = settings?.legalInvoicingReady === true;
    if (!settings) {
      reasons.push("tenant tax settings are missing");
    } else if (!gates.taxSettingsReady) {
      reasons.push(
        "tenant tax settings are not marked ready (legal_invoicing_ready is " +
          "false) — and note that readiness alone does NOT enable issuing",
      );
    }
  } else {
    reasons.push(
      "caller role and tenant tax settings cannot be evaluated outside supabase mode",
    );
  }

  const ready = Object.values(gates).every(Boolean) && reasons.length === 0;
  return { ready, reasons, note: NON_LEGAL_NOTE, gates };
}
