/**
 * Customer audit-event taxonomy + safe render/label contract (M8G.2).
 *
 * This is the app-layer companion to the transactional producers in migration
 * 20260731100000: a CLOSED customer event vocabulary, its derived category +
 * sensitivity, the localized labels, and a PII-safe details renderer. The future
 * Customer Timeline (M8G.3) and any Activity Log consume THIS module — no event
 * is ever silently shown as "Other"; an unrecognized type maps to an explicit
 * "unknown event" label instead.
 *
 * Category and sensitivity are DERIVED from the event type here (the DB stores
 * only event_type) — there is no per-row category/sensitivity column.
 *
 * Pure + serializable: no server-only imports, no `window`. Unit-tested directly.
 */
import type { Dictionary } from "@/i18n/types";
import { interpolate } from "@/i18n/dictionaries";
import { isCustomerOrigin, type CustomerType } from "@/lib/types";

/** The closed set of customer-lifecycle audit event types (mirrors the DB
 * `_log_customer_audit_event` allowlist EXACTLY). */
export const CUSTOMER_AUDIT_EVENT_KEYS = [
  "customer.created",
  "customer.updated",
  "customer.activated",
  "customer.deactivated",
  "customer.access_link.created",
  "customer.access_link.rotated",
  "customer.access_link.revoked",
  "customer.order_linked",
] as const;
export type CustomerAuditEventKey = (typeof CUSTOMER_AUDIT_EVENT_KEYS)[number];

export function isCustomerAuditEventKey(v: unknown): v is CustomerAuditEventKey {
  return (
    typeof v === "string" &&
    (CUSTOMER_AUDIT_EVENT_KEYS as readonly string[]).includes(v)
  );
}

/** Single audit category for this phase (entity-aligned). */
export const AUDIT_CATEGORY_CUSTOMER = "customer" as const;
export type AuditCategory = typeof AUDIT_CATEGORY_CUSTOMER;

export type AuditSensitivity = "low" | "medium" | "high";

/**
 * Sensitivity per event — DERIVED from the metadata content it carries. Access
 * links (credential lifecycle) and updates (which PII fields changed) are
 * `medium`; plain lifecycle transitions are `low`. Never `high` (no event
 * carries raw PII/tokens by design). Access events are never under-classified.
 */
const SENSITIVITY: Record<CustomerAuditEventKey, AuditSensitivity> = {
  "customer.created": "low",
  "customer.updated": "medium",
  "customer.activated": "low",
  "customer.deactivated": "low",
  "customer.access_link.created": "medium",
  "customer.access_link.rotated": "medium",
  "customer.access_link.revoked": "medium",
  "customer.order_linked": "low",
};

/** The lean audit row the app reads (mirrors public.audit_events; camelCased).
 * The DB never stores tokens/URLs/full PII, so `metadata` is always safe. */
export interface AuditEvent {
  id: string;
  eventType: string;
  entityType: string;
  entityId: string | null;
  actorUserId: string | null;
  /** Resolved display name for the actor (looked up at read time; never stored
   * in the audit row). */
  actorName?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

/** A customer audit field key (the `changed_fields` allowlist for updates). */
export const CUSTOMER_AUDIT_FIELD_KEYS = [
  "name",
  "contact_name",
  "phone",
  "city",
  "address",
  "customer_type",
  "notes",
] as const;
export type CustomerAuditFieldKey = (typeof CUSTOMER_AUDIT_FIELD_KEYS)[number];

// ── Category / sensitivity / label resolution ──────────────────────────────

/** Resolve a raw event_type to a known key, or null (explicit unknown — NEVER
 * silently "Other"). */
export function resolveCustomerEventKey(
  raw: string,
): CustomerAuditEventKey | null {
  return isCustomerAuditEventKey(raw) ? raw : null;
}

export function auditCategory(): AuditCategory {
  return AUDIT_CATEGORY_CUSTOMER;
}

/** Sensitivity for a raw event type. Unknown types are treated as `medium`
 * (never under-classified) rather than dropped. */
export function auditSensitivity(raw: string): AuditSensitivity {
  const key = resolveCustomerEventKey(raw);
  return key ? SENSITIVITY[key] : "medium";
}

/** Localized event label. An unrecognized type gets the explicit unknown-event
 * label, NOT "Other". */
export function auditEventLabel(raw: string, dict: Dictionary): string {
  const key = resolveCustomerEventKey(raw);
  return key ? dict.audit.events[key] : dict.audit.unknownEvent;
}

export function auditCategoryLabel(dict: Dictionary): string {
  return dict.audit.category;
}

export function auditSensitivityLabel(
  s: AuditSensitivity,
  dict: Dictionary,
): string {
  return dict.audit.sensitivity[s];
}

// ── Safe details rendering ─────────────────────────────────────────────────

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/**
 * Render an audit event's metadata into SAFE, localized detail lines. Only the
 * per-event allowlist is read — any unexpected key is ignored, and no PII value,
 * token, hash, or URL is ever surfaced (they are never stored to begin with).
 */
export function renderCustomerAuditDetails(
  event: { eventType: string; metadata: Record<string, unknown> },
  dict: Dictionary,
): string[] {
  const key = resolveCustomerEventKey(event.eventType);
  if (!key) return [];
  const m = event.metadata ?? {};
  const t = dict.audit.details;
  const out: string[] = [];

  switch (key) {
    case "customer.created": {
      const origin = m.origin;
      if (isCustomerOrigin(origin)) {
        out.push(
          interpolate(t.origin, {
            value: dict.admin.customers.origin.values[origin],
          }),
        );
      }
      break;
    }
    case "customer.updated": {
      const fields = Array.isArray(m.changed_fields)
        ? (m.changed_fields as unknown[]).filter(
            (f): f is CustomerAuditFieldKey =>
              (CUSTOMER_AUDIT_FIELD_KEYS as readonly unknown[]).includes(f),
          )
        : [];
      if (fields.length > 0) {
        out.push(
          interpolate(t.changed, {
            fields: fields.map((f) => dict.audit.fields[f]).join(", "),
          }),
        );
      }
      // Safe enum before/after for the non-PII customer_type only.
      const tc = m.customer_type as { from?: unknown; to?: unknown } | undefined;
      if (tc && typeof tc === "object") {
        const from = str(tc.from);
        const to = str(tc.to);
        if (from && to) {
          const types = dict.admin.customers.types;
          out.push(
            interpolate(t.typeChange, {
              from: types[from as CustomerType] ?? from,
              to: types[to as CustomerType] ?? to,
            }),
          );
        }
      }
      break;
    }
    case "customer.access_link.created":
    case "customer.access_link.rotated":
    case "customer.access_link.revoked": {
      // NEVER render a token/hash/URL — only a safe expiry if present.
      const expires = str(m.expires_at);
      if (expires) out.push(interpolate(t.linkExpires, { date: expires }));
      break;
    }
    case "customer.order_linked": {
      out.push(t.orderLinked);
      break;
    }
    case "customer.activated":
    case "customer.deactivated":
      // The label itself is the whole story; before/after is redundant.
      break;
  }
  return out;
}

// ── Pure derivation model (mock/Supabase parity for the producers) ─────────
// These model the SQL producers' taxonomy + metadata SHAPE + change/no-op
// semantics so mock-mode application tests can assert them without a DB. (The
// SQL producers always populate their safe ids — signup_request_id / source_
// order_id / customer_type — from NOT-NULL inputs; these helpers include each
// only when the caller supplies it, which is what the tests exercise.)

/** The customer fields an update diff compares (mirrors update_customer). */
export interface CustomerAuditSnapshot {
  name: string;
  contactName?: string;
  phone?: string;
  cityAr?: string;
  cityHe?: string;
  cityEn?: string;
  address?: string;
  customerType: CustomerType;
  notes?: string;
}

function norm(v: string | undefined): string | null {
  const t = (v ?? "").trim();
  return t === "" ? null : t;
}

/**
 * Compute the change-gated customer.updated metadata (mirrors the SQL diff):
 * the list of changed field keys + a safe customer_type before/after. Returns
 * null when nothing effectively changed → the producer emits NO event.
 */
export function deriveCustomerUpdateEvent(
  before: CustomerAuditSnapshot,
  after: CustomerAuditSnapshot,
): { eventType: "customer.updated"; metadata: Record<string, unknown> } | null {
  const changed: CustomerAuditFieldKey[] = [];
  if (norm(before.name) !== norm(after.name)) changed.push("name");
  if (norm(before.contactName) !== norm(after.contactName))
    changed.push("contact_name");
  if (norm(before.phone) !== norm(after.phone)) changed.push("phone");
  if (
    norm(before.cityAr) !== norm(after.cityAr) ||
    norm(before.cityHe) !== norm(after.cityHe) ||
    norm(before.cityEn) !== norm(after.cityEn)
  )
    changed.push("city");
  if (norm(before.address) !== norm(after.address)) changed.push("address");
  if (norm(before.notes) !== norm(after.notes)) changed.push("notes");
  if (before.customerType !== after.customerType) changed.push("customer_type");

  if (changed.length === 0) return null;
  const metadata: Record<string, unknown> = { changed_fields: changed };
  if (before.customerType !== after.customerType) {
    metadata.customer_type = { from: before.customerType, to: after.customerType };
  }
  return { eventType: "customer.updated", metadata };
}

/**
 * The activation event for an is_active transition (mirrors set_customer_active):
 * activated / deactivated, or null when the state is unchanged (no event).
 */
export function deriveActivationEvent(
  before: boolean,
  after: boolean,
): { eventType: "customer.activated" | "customer.deactivated"; metadata: Record<string, unknown> } | null {
  if (before === after) return null;
  return {
    eventType: after ? "customer.activated" : "customer.deactivated",
    metadata: { before_active: before, after_active: after },
  };
}

/** The customer.created metadata for a given creation path (mirrors the SQL). */
export function deriveCustomerCreatedEvent(input: {
  origin: "manual" | "signup" | "guest_conversion";
  customerType?: CustomerType;
  signupRequestId?: string;
  sourceOrderId?: string;
}): { eventType: "customer.created"; metadata: Record<string, unknown> } {
  const metadata: Record<string, unknown> = { origin: input.origin };
  if (input.origin === "manual" && input.customerType) {
    metadata.customer_type = input.customerType;
  }
  if (input.origin === "signup" && input.signupRequestId) {
    metadata.signup_request_id = input.signupRequestId;
  }
  if (input.origin === "guest_conversion" && input.sourceOrderId) {
    metadata.source_order_id = input.sourceOrderId;
  }
  return { eventType: "customer.created", metadata };
}
