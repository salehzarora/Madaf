import "server-only";

import { taxProviderMode } from "@/lib/config/legal-invoicing";
import { NullProvider } from "./null-provider";
import { SandboxProvider } from "./sandbox-provider";
import type { LegalInvoiceProvider } from "./types";

/**
 * Legal-invoice provider selector (M6D) — server-only, DORMANT.
 *
 * ⚠️ Wired to NOTHING in M6D: no route, action, or UI imports this. It exists
 * to document + test the intended future abstraction. It only ever returns a
 * NullProvider (disabled) or a SandboxProvider (deterministic mock) — never a
 * real provider. `production` is already clamped to `disabled` upstream by
 * taxProviderMode() (src/lib/config/legal-invoicing.ts), so it can never reach
 * a real integration here. Fail-closed default: NullProvider.
 */
export function getLegalInvoiceProvider(): LegalInvoiceProvider {
  return taxProviderMode() === "sandbox"
    ? new SandboxProvider()
    : new NullProvider();
}

export { NullProvider } from "./null-provider";
export { SandboxProvider } from "./sandbox-provider";
export { buildProviderLog, redactPayload, redactValue } from "./logging";
export type * from "./types";
