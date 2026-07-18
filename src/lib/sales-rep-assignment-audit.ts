/**
 * Sales-Rep-Assignment audit-event taxonomy + safe render/label contract (M8I.5).
 *
 * The app-layer companion to the transactional producers in migration
 * 20260810100000 (`_log_sales_rep_assignment_audit_event`, emitted only from the
 * assignment + lifecycle RPCs): a CLOSED two-event vocabulary, its category +
 * sensitivity, localized labels, and a PII-safe source/label contract. The
 * affected customer + representative are shown from the bounded `customer_name` /
 * `rep_email` snapshots (never a raw UUID).
 *
 * SCOPE. Many-to-many rep↔customer assignments only:
 *   sales_rep_assignment.created  — a rep was assigned to a customer (source manual).
 *   sales_rep_assignment.removed  — a pair was removed. source ∈ {manual,
 *                                   member_removed, role_changed, member_joined}.
 * A reassignment is one removed + one created (there is no changed/reassigned event).
 *
 * SAFETY. No event carries a token, JWT, session, password, raw auth metadata,
 * order/balance data, customer phone/email/address/notes, or a raw row — the DB
 * helper's exact-key allowlist rejects anything but rep_user_id + rep_email +
 * customer_name + source, and this module re-validates on read. rep_email +
 * customer_name are shown only on the owner/admin Team page; rep_user_id is never
 * rendered.
 *
 * Pure + serializable: no server-only imports, no `window`. Unit-tested directly.
 */
import type { Dictionary } from "@/i18n/types";
import type { AuditSensitivity } from "@/lib/audit-events";

/** The closed set of assignment audit event types (mirrors the DB
 * `_log_sales_rep_assignment_audit_event` allowlist EXACTLY). */
export const SALES_REP_ASSIGNMENT_AUDIT_EVENT_KEYS = [
  "sales_rep_assignment.created",
  "sales_rep_assignment.removed",
] as const;
export type SalesRepAssignmentAuditEventKey =
  (typeof SALES_REP_ASSIGNMENT_AUDIT_EVENT_KEYS)[number];

export function isSalesRepAssignmentAuditEventKey(
  v: unknown,
): v is SalesRepAssignmentAuditEventKey {
  return (
    typeof v === "string" &&
    (SALES_REP_ASSIGNMENT_AUDIT_EVENT_KEYS as readonly string[]).includes(v)
  );
}

/** Resolve a raw event_type to a known key, or null (explicit unknown — NEVER
 * silently "Other"). */
export function resolveSalesRepAssignmentEventKey(
  raw: string,
): SalesRepAssignmentAuditEventKey | null {
  return isSalesRepAssignmentAuditEventKey(raw) ? raw : null;
}

/** Entity-aligned audit category for this phase. */
export const AUDIT_CATEGORY_SALES_REP_ASSIGNMENT = "sales_rep_assignment" as const;
export type SalesRepAssignmentAuditCategory =
  typeof AUDIT_CATEGORY_SALES_REP_ASSIGNMENT;

export function salesRepAssignmentAuditCategory(): SalesRepAssignmentAuditCategory {
  return AUDIT_CATEGORY_SALES_REP_ASSIGNMENT;
}

/** The closed `source` enum used in assignment audit metadata (mirrors the DB
 * per-event allowlist: created→manual; removed→any of these four). */
export const SALES_REP_ASSIGNMENT_SOURCES = [
  "manual",
  "member_removed",
  "role_changed",
  "member_joined",
] as const;
export type SalesRepAssignmentSource =
  (typeof SALES_REP_ASSIGNMENT_SOURCES)[number];

export function isSalesRepAssignmentSource(
  v: unknown,
): v is SalesRepAssignmentSource {
  return (
    typeof v === "string" &&
    (SALES_REP_ASSIGNMENT_SOURCES as readonly string[]).includes(v)
  );
}

/**
 * Sensitivity — both events concern a person's identity + a customer relationship
 * (rep email + customer name PII), so both are `medium`. Unknown → `medium`
 * (never under-classified).
 */
export function salesRepAssignmentAuditSensitivity(raw: string): AuditSensitivity {
  return resolveSalesRepAssignmentEventKey(raw) ? "medium" : "medium";
}

/** Localized event label. An unrecognized type gets the explicit shared
 * unknown-event label, NOT "Other". */
export function salesRepAssignmentAuditEventLabel(
  raw: string,
  dict: Dictionary,
): string {
  const key = resolveSalesRepAssignmentEventKey(raw);
  return key ? dict.audit.assignment.events[key] : dict.audit.unknownEvent;
}

export function salesRepAssignmentAuditCategoryLabel(dict: Dictionary): string {
  return dict.audit.assignment.category;
}

// ── Safe value extractors (last line of defence on READ) ────────────────────

/** A safe normalized rep email (non-empty, ≤254) or null. Rendered ONLY as
 * escaped text (dir="ltr"); never HTML. */
export function safeAssignmentRepEmail(
  metadata: Record<string, unknown> | null | undefined,
): string | null {
  const v = (metadata ?? {}).rep_email;
  return typeof v === "string" && v.length > 0 && v.length <= 254 ? v : null;
}

/** A safe bounded customer name (non-empty, ≤200) or null. Direction-aware text. */
export function safeAssignmentCustomerName(
  metadata: Record<string, unknown> | null | undefined,
): string | null {
  const v = (metadata ?? {}).customer_name;
  return typeof v === "string" && v.length > 0 && v.length <= 200 ? v : null;
}

/** A safe `source` enum value, or undefined. */
export function safeAssignmentSource(
  v: unknown,
): SalesRepAssignmentSource | undefined {
  return isSalesRepAssignmentSource(v) ? v : undefined;
}

// ── Safe source renderer ────────────────────────────────────────────────────
// Renders ONLY the localized, typed source context (never a raw UUID or value).
// created is always `manual` ("Manual assignment"); removed maps each source to a
// distinct removal-context line. An unknown event / malformed source → NO line.

/**
 * The single localized source line for one assignment audit event, or null.
 * created → "Manual assignment"; removed → the source-specific removal wording.
 */
export function renderSalesRepAssignmentSource(
  event: { eventType: string; metadata: Record<string, unknown> },
  dict: Dictionary,
): string | null {
  const key = resolveSalesRepAssignmentEventKey(event.eventType);
  if (!key) return null;
  const source = safeAssignmentSource((event.metadata ?? {}).source);
  if (!source) return null;
  const s = dict.audit.assignment.sources;
  if (key === "sales_rep_assignment.created") {
    // created is always source=manual by contract.
    return s.createdManual;
  }
  switch (source) {
    case "manual":
      return s.removedManual;
    case "member_removed":
      return s.member_removed;
    case "role_changed":
      return s.role_changed;
    case "member_joined":
      return s.member_joined;
  }
}
