/**
 * Customer Timeline — pure, shared contract (M8G.3).
 *
 * The bounded types, the opaque keyset cursor, the page-size limits, and the
 * client-safe metadata projection for the read-only Customer Timeline (which
 * consumes the M8G.2 audit_events rows). No server-only imports, no `window` —
 * runs on the server (data layer) and the client (component) and is unit tested.
 *
 * SECURITY: nothing here authorizes anything — RLS on audit_events is the
 * authorization boundary. The cursor carries only (created_at, id); it never
 * carries a tenant, a customer id, a secret, or PII, and it must not be trusted
 * as authorization.
 */
import {
  auditSensitivity,
  CUSTOMER_AUDIT_FIELD_KEYS,
  resolveCustomerEventKey,
  type AuditSensitivity,
} from "@/lib/audit-events";

export const TIMELINE_PAGE_SIZE_DEFAULT = 20;
export const TIMELINE_PAGE_SIZE_MAX = 50;

/** Clamp a requested page size into [1, 50]; non-integers → the default. */
export function clampTimelinePageSize(n: unknown): number {
  const v = typeof n === "number" && Number.isInteger(n) ? n : TIMELINE_PAGE_SIZE_DEFAULT;
  return Math.min(TIMELINE_PAGE_SIZE_MAX, Math.max(1, v));
}

/** Who performed an event, resolved for the CURRENT viewer (never leaks another
 * tenant's users, and shows a named actor only to owner/admin). */
export type TimelineActor =
  /** A resolved display label (owner/admin viewer, current tenant member). */
  | { kind: "named"; label: string }
  /** Actor is a team member but the identity is not shown (sales_rep viewer). */
  | { kind: "member" }
  /** actor_user_id is set but no longer a current tenant member (owner/admin). */
  | { kind: "former" }
  /** actor_user_id is null (the acting user was deleted / unattributable). */
  | { kind: "unknown" };

/** One safe, client-bound Timeline row. Carries only allowlisted metadata. */
export interface TimelineEvent {
  /** audit_events.id (bigint) as a string. */
  id: string;
  /** Raw event_type (mapped to a label + safe details via audit-events.ts). */
  eventType: string;
  createdAt: string;
  actor: TimelineActor;
  sensitivity: AuditSensitivity;
  /** Always "customer" for this phase. */
  category: "customer";
  /** ONLY the allowlisted keys the renderer uses — never the raw row metadata. */
  metadata: Record<string, unknown>;
}

/** A bounded Timeline page + an opaque cursor for the next (older) page. */
export interface TimelinePage {
  events: TimelineEvent[];
  /** Opaque cursor to fetch the next page, or null when there are no more. */
  nextCursor: string | null;
  hasMore: boolean;
}

/** The decoded keyset position (the last row of the previous page). */
export interface TimelineCursor {
  createdAt: string;
  id: string;
}

// ── Opaque cursor (base64url of "<created_at>|<id>") ───────────────────────
// btoa/atob are global in Node 18+ and browsers, so this stays isomorphic
// (no Buffer). The payload is ASCII (ISO timestamp + '|' + digits).

export function encodeTimelineCursor(c: TimelineCursor): string {
  return btoa(`${c.createdAt}|${c.id}`)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Decode + VALIDATE a cursor. A malformed / oversized / tampered cursor
 * normalizes to null (→ the caller starts from the first page) rather than
 * throwing. The cursor never authorizes access; RLS does.
 */
export function decodeTimelineCursor(
  s: string | null | undefined,
): TimelineCursor | null {
  if (typeof s !== "string" || s.length === 0 || s.length > 256) return null;
  let raw: string;
  try {
    raw = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  } catch {
    return null;
  }
  const sep = raw.lastIndexOf("|");
  if (sep <= 0) return null;
  const createdAt = raw.slice(0, sep);
  const id = raw.slice(sep + 1);
  // id is a bigint identity; created_at must be a real timestamp.
  if (!/^\d{1,19}$/.test(id)) return null;
  if (Number.isNaN(Date.parse(createdAt))) return null;
  return { createdAt, id };
}

// ── Deterministic ordering + keyset position (mock + tests; SQL does its own) ─

/** DESC comparator for the (created_at, id) sort key — newest first, with a
 * higher-id-first tie-break for equal timestamps. */
export function compareTimelineDesc(
  a: { createdAt: string; id: string },
  b: { createdAt: string; id: string },
): number {
  const ta = Date.parse(a.createdAt);
  const tb = Date.parse(b.createdAt);
  if (ta !== tb) return tb - ta;
  const ia = BigInt(a.id);
  const ib = BigInt(b.id);
  return ia < ib ? 1 : ia > ib ? -1 : 0;
}

/** True when `row` is strictly OLDER than the cursor position (i.e. belongs to
 * the NEXT page in DESC order). Mirrors the SQL keyset predicate
 * `(created_at, id) < (cursor.created_at, cursor.id)`. */
export function timelineRowBeforeCursor(
  row: { createdAt: string; id: string },
  c: TimelineCursor,
): boolean {
  const tr = Date.parse(row.createdAt);
  const tc = Date.parse(c.createdAt);
  if (tr !== tc) return tr < tc;
  return BigInt(row.id) < BigInt(c.id);
}

// ── Actor resolution (viewer-aware; never leaks identities) ────────────────

/**
 * Resolve an event's actor to a viewer-appropriate descriptor:
 *   • named  — the current viewer is owner/admin AND the actor is a current
 *              tenant member (label = email from the roster);
 *   • former — owner/admin viewer, but the actor is no longer a member;
 *   • member — a sales_rep viewer (no roster access): the action was by a team
 *              member, but the identity is deliberately not shown;
 *   • unknown — actor_user_id is null (the acting user was deleted).
 * `emails` is the tenant roster map, resolved ONCE for the page (owner/admin
 * only). A sales_rep passes an empty map + isAdmin=false.
 */
export function resolveTimelineActor(
  actorUserId: string | null,
  opts: { isAdmin: boolean; emails: ReadonlyMap<string, string> },
): TimelineActor {
  if (!actorUserId) return { kind: "unknown" };
  // Guard on isAdmin BEFORE the roster lookup: a non-owner/admin viewer sees the
  // neutral "member" label for every attributed actor, so a stray/leaked roster
  // map can never surface an email to a sales_rep (defense-in-depth — the data
  // layer also only populates the map for owner/admin). "former" is meaningful
  // only to owner/admin, who would otherwise have seen the name.
  if (!opts.isAdmin) return { kind: "member" };
  const email = opts.emails.get(actorUserId);
  return email ? { kind: "named", label: email } : { kind: "former" };
}

/** Build one client-safe TimelineEvent from a resolved actor + raw row fields. */
export function buildTimelineEvent(input: {
  id: string;
  eventType: string;
  createdAt: string;
  actor: TimelineActor;
  metadata: Record<string, unknown> | null | undefined;
}): TimelineEvent {
  return {
    id: input.id,
    eventType: input.eventType,
    createdAt: input.createdAt,
    actor: input.actor,
    sensitivity: auditSensitivity(input.eventType),
    category: "customer",
    metadata: clientSafeMetadata(input.eventType, input.metadata),
  };
}

// ── Client-safe metadata projection ────────────────────────────────────────
// Even though the M8G.2 producers only ever write safe keys, we project each
// event's metadata down to EXACTLY the keys the renderer uses before it reaches
// the client — so link ids, order ids, request ids, and any future/unexpected
// key never cross the wire. (No token/hash/URL/PII is ever stored to begin with.)
const CLIENT_METADATA_KEYS: Record<string, readonly string[]> = {
  "customer.created": ["origin", "customer_type"],
  "customer.updated": ["changed_fields", "customer_type"],
  "customer.activated": [],
  "customer.deactivated": [],
  "customer.access_link.created": ["expires_at"],
  "customer.access_link.rotated": ["expires_at"],
  "customer.access_link.revoked": [],
  "customer.order_linked": [],
};

/**
 * Project a stored metadata object down to the client-safe allowlist for its
 * event type. Unknown event types → {} (nothing rendered raw). `changed_fields`
 * is additionally filtered to the known field-key allowlist.
 */
export function clientSafeMetadata(
  eventType: string,
  metadata: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const key = resolveCustomerEventKey(eventType);
  if (!key) return {};
  const allow = CLIENT_METADATA_KEYS[key] ?? [];
  const src = metadata ?? {};
  const out: Record<string, unknown> = {};
  for (const k of allow) {
    if (!(k in src)) continue;
    if (k === "changed_fields") {
      const arr = Array.isArray(src[k]) ? (src[k] as unknown[]) : [];
      out[k] = arr.filter((f) =>
        (CUSTOMER_AUDIT_FIELD_KEYS as readonly unknown[]).includes(f),
      );
    } else if (k === "customer_type") {
      // Only the safe {from,to} enum shape (created carries a bare enum too).
      const v = src[k];
      if (typeof v === "string") out[k] = v;
      else if (v && typeof v === "object") {
        const o = v as { from?: unknown; to?: unknown };
        if (typeof o.from === "string" && typeof o.to === "string") {
          out[k] = { from: o.from, to: o.to };
        }
      }
    } else {
      out[k] = src[k];
    }
  }
  return out;
}
