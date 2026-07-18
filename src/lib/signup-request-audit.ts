/**
 * Customer-signup-request decision audit taxonomy + safe render/label contract
 * (M8I.6).
 *
 * The app-layer companion to the transactional producers in migration
 * 20260811100000 (`_log_customer_signup_request_audit_event`, emitted only from
 * the approve/reject review RPCs): a CLOSED two-event vocabulary, its category +
 * sensitivity, localized labels, and PII-safe extractors. These are tenant-scoped
 * CUSTOMER/store signup requests (an anonymous applicant submits through a
 * tokenized link; the tenant's owner/admin reviews). Approval creates a Customer;
 * there is NO platform signup / Tenant provisioning.
 *
 * SCOPE. The review DECISION only:
 *   customer_signup_request.approved — approve transitioned PENDING → APPROVED.
 *   customer_signup_request.rejected — reject transitioned PENDING → REJECTED.
 * Submission is NOT an event (anonymous submitter; the request row is the record).
 * Approval ALSO keeps its existing customer.created(origin=signup) event (a
 * Customer-lifecycle fact on a different entity) — this module does not touch it.
 *
 * SAFETY. No event carries applicant email/phone/address/contact/notes, a token,
 * JWT, session, secret, or a raw row — the DB helper's exact-key allowlist rejects
 * anything but business_name (+ resulting_customer_id for approved), and this
 * module re-validates on read. business_name is owner/admin-only; the resulting
 * Customer id is used only to build a safe link and is never rendered as raw text.
 *
 * Pure + serializable: no server-only imports, no `window`. Unit-tested directly.
 */
import type { Dictionary } from "@/i18n/types";
import type { AuditSensitivity } from "@/lib/audit-events";

/** The closed set of signup-decision audit event types (mirrors the DB
 * `_log_customer_signup_request_audit_event` allowlist EXACTLY). */
export const SIGNUP_REQUEST_AUDIT_EVENT_KEYS = [
  "customer_signup_request.approved",
  "customer_signup_request.rejected",
] as const;
export type SignupRequestAuditEventKey =
  (typeof SIGNUP_REQUEST_AUDIT_EVENT_KEYS)[number];

export function isSignupRequestAuditEventKey(
  v: unknown,
): v is SignupRequestAuditEventKey {
  return (
    typeof v === "string" &&
    (SIGNUP_REQUEST_AUDIT_EVENT_KEYS as readonly string[]).includes(v)
  );
}

/** Resolve a raw event_type to a known key, or null (explicit unknown — NEVER
 * silently "Other"). */
export function resolveSignupRequestEventKey(
  raw: string,
): SignupRequestAuditEventKey | null {
  return isSignupRequestAuditEventKey(raw) ? raw : null;
}

/** Entity-aligned audit category for this phase. */
export const AUDIT_CATEGORY_SIGNUP_REQUEST = "customer_signup_request" as const;
export type SignupRequestAuditCategory = typeof AUDIT_CATEGORY_SIGNUP_REQUEST;

export function signupRequestAuditCategory(): SignupRequestAuditCategory {
  return AUDIT_CATEGORY_SIGNUP_REQUEST;
}

/**
 * Sensitivity — both decision events concern a business identity + an operator
 * action (owner/admin-only), so both are `medium`. Unknown → `medium` (never
 * under-classified).
 */
export function signupRequestAuditSensitivity(raw: string): AuditSensitivity {
  return resolveSignupRequestEventKey(raw) ? "medium" : "medium";
}

/** Localized event label. An unrecognized type gets the explicit shared
 * unknown-event label, NOT "Other". */
export function signupRequestAuditEventLabel(
  raw: string,
  dict: Dictionary,
): string {
  const key = resolveSignupRequestEventKey(raw);
  return key ? dict.audit.signup.events[key] : dict.audit.unknownEvent;
}

export function signupRequestAuditCategoryLabel(dict: Dictionary): string {
  return dict.audit.signup.category;
}

// ── Safe value extractors (last line of defence on READ) ────────────────────

/** A safe bounded business name (non-empty, ≤200) or null. Direction-aware text. */
export function safeSignupBusinessName(
  metadata: Record<string, unknown> | null | undefined,
): string | null {
  const v = (metadata ?? {}).business_name;
  return typeof v === "string" && v.length > 0 && v.length <= 200 ? v : null;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A safe resulting-Customer id (validated UUID shape) or null — used ONLY to
 * build a navigation link; never rendered as raw text. */
export function safeSignupResultingCustomerId(
  metadata: Record<string, unknown> | null | undefined,
): string | null {
  const v = (metadata ?? {}).resulting_customer_id;
  return typeof v === "string" && UUID_RE.test(v) ? v : null;
}
