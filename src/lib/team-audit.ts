/**
 * Team/Access audit-event taxonomy + safe render/label contract (M8I.3).
 *
 * The app-layer companion to the transactional producers in migration
 * 20260808100000 (`_log_team_audit_event`, emitted only from the seven Team
 * RPCs): a CLOSED five-event vocabulary, its category + sensitivity, localized
 * labels, and a PII-safe details renderer that surfaces ONLY the safe role enums
 * (the affected member is shown from the bounded `target_email` snapshot, never a
 * raw UUID).
 *
 * SCOPE. Internal Team membership + invitations only:
 *   team.member_invited     — an invitation was issued (role admin|sales_rep).
 *   team.invitation_revoked — a pending invitation was revoked.
 *   team.member_joined      — an invitation was accepted (membership created).
 *   team.role_changed       — an effective role change (update/promote/demote).
 *   team.member_removed      — a membership was hard-deleted.
 * Platform onboarding (create_tenant_with_owner) and customer/store signup are
 * NOT represented here (separate lifecycles).
 *
 * SAFETY. No event carries a token, token hash/preview, acceptance URL, JWT,
 * session, password, raw auth metadata, email body, backend error, or raw
 * payload — the DB helper's per-event key allowlist rejects anything but
 * `target_email` + the safe role enums, and this module re-validates on read.
 * `target_email` is internal-staff PII, shown only on the owner/admin Team page.
 *
 * Pure + serializable: no server-only imports, no `window`. Unit-tested directly.
 */
import type { Dictionary } from "@/i18n/types";
import { interpolate } from "@/i18n/dictionaries";
import type { AuditSensitivity } from "@/lib/audit-events";

/** The closed set of Team audit event types (mirrors the DB
 * `_log_team_audit_event` allowlist EXACTLY). */
export const TEAM_AUDIT_EVENT_KEYS = [
  "team.member_invited",
  "team.invitation_revoked",
  "team.member_joined",
  "team.role_changed",
  "team.member_removed",
] as const;
export type TeamAuditEventKey = (typeof TEAM_AUDIT_EVENT_KEYS)[number];

export function isTeamAuditEventKey(v: unknown): v is TeamAuditEventKey {
  return (
    typeof v === "string" &&
    (TEAM_AUDIT_EVENT_KEYS as readonly string[]).includes(v)
  );
}

/** Resolve a raw event_type to a known key, or null (explicit unknown — NEVER
 * silently "Other"). */
export function resolveTeamEventKey(raw: string): TeamAuditEventKey | null {
  return isTeamAuditEventKey(raw) ? raw : null;
}

/** Entity-aligned audit category for this phase. */
export const AUDIT_CATEGORY_TEAM = "team" as const;
export type TeamAuditCategory = typeof AUDIT_CATEGORY_TEAM;

export function teamAuditCategory(): TeamAuditCategory {
  return AUDIT_CATEGORY_TEAM;
}

/** The closed tenant-role enum used in Team audit metadata. */
export const TEAM_AUDIT_ROLES = ["owner", "admin", "sales_rep"] as const;
export type TeamAuditRole = (typeof TEAM_AUDIT_ROLES)[number];

export function isTeamAuditRole(v: unknown): v is TeamAuditRole {
  return (
    typeof v === "string" && (TEAM_AUDIT_ROLES as readonly string[]).includes(v)
  );
}

/**
 * Sensitivity, DERIVED from the event + the safe role it carries. A role change
 * or removal that TOUCHES the owner role (a privilege grant/revoke or an owner
 * account removal) is `high`; every other Team event is `medium` (they concern a
 * person's identity + access). Unknown → `medium` (never under-classified).
 */
export function teamAuditSensitivity(
  raw: string,
  metadata?: Record<string, unknown>,
): AuditSensitivity {
  const key = resolveTeamEventKey(raw);
  if (!key) return "medium";
  const m = metadata ?? {};
  if (key === "team.role_changed") {
    return m.from_role === "owner" || m.to_role === "owner" ? "high" : "medium";
  }
  if (key === "team.member_removed") {
    return m.role === "owner" ? "high" : "medium";
  }
  return "medium";
}

/** Localized event label. An unrecognized type gets the explicit shared
 * unknown-event label, NOT "Other". */
export function teamAuditEventLabel(raw: string, dict: Dictionary): string {
  const key = resolveTeamEventKey(raw);
  return key ? dict.audit.team.events[key] : dict.audit.unknownEvent;
}

export function teamAuditCategoryLabel(dict: Dictionary): string {
  return dict.audit.team.category;
}

// ── Safe value extractors (last line of defence on READ) ────────────────────

/** A safe normalized target email (non-empty, ≤254) or null. Rendered ONLY as
 * escaped text; never HTML. */
export function safeTeamTargetEmail(
  metadata: Record<string, unknown> | null | undefined,
): string | null {
  const v = (metadata ?? {}).target_email;
  return typeof v === "string" && v.length > 0 && v.length <= 254 ? v : null;
}

/** A safe role enum value, or undefined. */
export function safeTeamRole(v: unknown): TeamAuditRole | undefined {
  return isTeamAuditRole(v) ? v : undefined;
}

// ── Safe details renderer ───────────────────────────────────────────────────
// Renders ONLY the safe role enums (localized). The affected member is shown
// from `target_email` by the component, not here. An unknown event / malformed
// value produces NO line rather than leaking anything raw.

/**
 * Localized, safe detail lines for one Team audit event.
 * role_changed → one "from → to" line (localized role labels).
 * invited/revoked/joined/removed → one "role" line (localized role label).
 */
export function renderTeamAuditDetails(
  event: { eventType: string; metadata: Record<string, unknown> },
  dict: Dictionary,
): string[] {
  const key = resolveTeamEventKey(event.eventType);
  if (!key) return [];
  const m = event.metadata ?? {};
  const roles = dict.access.session.roles;
  const t = dict.audit.team.details;

  if (key === "team.role_changed") {
    const from = safeTeamRole(m.from_role);
    const to = safeTeamRole(m.to_role);
    if (from && to) {
      return [interpolate(t.roleChange, { from: roles[from], to: roles[to] })];
    }
    return [];
  }

  const role = safeTeamRole(m.role);
  if (!role) return [];
  return [interpolate(t.role, { role: roles[role] })];
}
