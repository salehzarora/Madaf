import "server-only";

import type {
  ProviderMode,
  ProviderStatus,
  RedactedProviderRequestLog,
  RedactedProviderResponseLog,
} from "./types";

/**
 * Redaction + log-record shaping for provider calls (M6D) — PURE, and NOT
 * persisted.
 *
 * ⚠️ PERSISTENCE IS DEFERRED. The M6B `tax_authority_requests` /
 * `tax_authority_responses` tables are service-role-only (no anon/authenticated
 * grant) and no issuing flow exists to write them. Widening those grants or
 * introducing a service-role writer is out of M6D scope, so this module only
 * BUILDS redacted, sandbox-marked records (shaped to those tables' columns).
 * A future trusted-server writer (M6E, behind flags) will persist them. Nothing
 * here writes to the database, contacts a provider, or logs credentials.
 */

// Keys whose values are always replaced — secrets, tokens, credentials, and
// hash/signature material must never reach a log.
const REDACT_KEY =
  /(token|secret|api[-_ ]?key|authorization|password|passwd|credential|private|signature|sig|hash|bearer|cookie|jwt|otp|pin)/i;
const REDACTED = "[REDACTED]";
const MAX_STRING = 256;
const MAX_ARRAY = 50;
const MAX_DEPTH = 6;

/** Recursively redact a value: drop secret-ish keys, cap string/array length,
 *  and bound depth. Never throws. */
export function redactValue(value: unknown, keyHint = "", depth = 0): unknown {
  if (REDACT_KEY.test(keyHint)) return REDACTED;
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    return value.length > MAX_STRING
      ? `${value.slice(0, MAX_STRING)}…[truncated]`
      : value;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (depth >= MAX_DEPTH) return REDACTED;
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY).map((v) => redactValue(v, "", depth + 1));
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactValue(v, k, depth + 1);
    }
    return out;
  }
  // Unknown type (function, symbol, bigint, …) → redact rather than leak.
  return REDACTED;
}

/** Redact a request payload object into a safe, loggable shape. */
export function redactPayload(
  payload: Record<string, unknown> | undefined,
): Record<string, unknown> {
  return redactValue(payload ?? {}) as Record<string, unknown>;
}

/**
 * Build (but DO NOT persist) a redacted request+response log pair for a provider
 * call, shaped to the M6B tax_authority_* columns. Always sandbox-marked and
 * `legal: false`.
 */
export function buildProviderLog(args: {
  kind: RedactedProviderRequestLog["kind"];
  idempotencyKey: string;
  legalDocumentId?: string | null;
  providerMode: ProviderMode;
  requestPayload?: Record<string, unknown>;
  httpStatus?: number | null;
  outcome: ProviderStatus;
  providerRef?: string | null;
  allocationNumber?: string | null;
  responsePayload?: Record<string, unknown>;
}): {
  request: RedactedProviderRequestLog;
  response: RedactedProviderResponseLog;
} {
  return {
    request: {
      kind: args.kind,
      idempotencyKey: args.idempotencyKey,
      legalDocumentId: args.legalDocumentId ?? null,
      providerMode: args.providerMode,
      redactedRequestPayload: redactPayload(args.requestPayload),
    },
    response: {
      httpStatus: args.httpStatus ?? null,
      outcome: args.outcome,
      providerRef: args.providerRef ?? null,
      allocationNumber: args.allocationNumber ?? null,
      redactedResponsePayload: redactPayload(args.responsePayload),
      sandbox: args.providerMode === "sandbox",
      legal: false,
    },
  };
}
