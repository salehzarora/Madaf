/**
 * Sales-Rep-Assignment Timeline — pure, shared contract (M8I.5).
 *
 * The bounded page type and the CLIENT-SAFE metadata projection for the read-only
 * Assignment Activity stream, which consumes the M8I.5 `audit_events` rows
 * (entity_type = 'sales_rep_assignment', tenant-wide). No server-only imports, no
 * `window` — runs on the server (data layer) and the client (component) and is
 * unit tested.
 *
 * REUSE, NOT RE-DESIGN. The keyset cursor, DESC comparator, page-size clamp and
 * viewer-aware actor resolver are ENTITY-NEUTRAL and imported verbatim from the
 * M8G.3 Customer Timeline contract (also used by Order/Product/Inventory/Team/
 * Settings).
 *
 * SECURITY: nothing here authorizes anything — RLS on audit_events is the
 * authorization boundary (its sales_rep_assignment clause requires owner/admin).
 * The cursor carries only (created_at, id): never a tenant, a user id, a secret,
 * or PII.
 *
 * The projection is the LAST line of defence: it re-applies the DB helper's key
 * allowlist AND validates every value on READ, so no raw / oversized / secret /
 * uuid value can reach the client. Only rep_email + customer_name + a safe source
 * enum ever cross the wire — rep_user_id is deliberately NOT projected (never
 * rendered), and no token/order/balance/PII key exists to begin with.
 */
import type { AuditSensitivity } from "@/lib/audit-events";
import type { TimelineActor } from "@/lib/customer-timeline";
import {
  resolveSalesRepAssignmentEventKey,
  safeAssignmentSource,
  salesRepAssignmentAuditSensitivity,
} from "@/lib/sales-rep-assignment-audit";

/** One safe, client-bound Assignment Timeline row. Carries only allowlisted
 * metadata (rep_email + customer_name + a safe source enum). */
export interface SalesRepAssignmentTimelineEvent {
  /** audit_events.id (bigint) as a string. */
  id: string;
  eventType: string;
  createdAt: string;
  actor: TimelineActor;
  sensitivity: AuditSensitivity;
  /** Always "sales_rep_assignment" for this phase. */
  category: "sales_rep_assignment";
  /** ONLY the allowlisted, validated keys the renderer uses. */
  metadata: Record<string, unknown>;
}

/** A bounded Assignment Timeline page + an opaque cursor for the next (older) page. */
export interface SalesRepAssignmentTimelinePage {
  events: SalesRepAssignmentTimelineEvent[];
  nextCursor: string | null;
  hasMore: boolean;
}

/**
 * The OPTIONAL initial Assignment Timeline read, as it reaches the client. A
 * success carries the first page; a failure is explicit ({ ok: false }) so the
 * section can render a localized, retryable error WITHOUT the Team page crashing
 * and WITHOUT faking "no activity". A failure carries no backend error text.
 */
export type SalesRepAssignmentTimelineInitial =
  | { ok: true; page: SalesRepAssignmentTimelinePage }
  | { ok: false };

// ── Client-safe metadata projection (KEY-safe AND VALUE-safe) ───────────────

/** A safe normalized string (non-empty, within bound) or undefined. */
function safeBoundedString(v: unknown, max: number): string | undefined {
  return typeof v === "string" && v.length > 0 && v.length <= max ? v : undefined;
}

/**
 * Project stored metadata down to the client-safe, VALUE-VALIDATED allowlist:
 * rep_email (≤254), customer_name (≤200), and a safe source enum. An unrecognized
 * event type → {}. A malformed value under a known key is omitted (the row is
 * kept). rep_user_id is intentionally dropped — it is never rendered, so the raw
 * UUID never crosses the wire.
 */
export function clientSafeSalesRepAssignmentMetadata(
  eventType: string,
  metadata: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const key = resolveSalesRepAssignmentEventKey(eventType);
  if (!key) return {};
  const src = metadata ?? {};
  const out: Record<string, unknown> = {};

  const email = safeBoundedString(src.rep_email, 254);
  if (email !== undefined) out.rep_email = email;

  const name = safeBoundedString(src.customer_name, 200);
  if (name !== undefined) out.customer_name = name;

  const source = safeAssignmentSource(src.source);
  if (source !== undefined) out.source = source;

  return out;
}

/** Build one client-safe SalesRepAssignmentTimelineEvent from a resolved actor +
 * raw fields. */
export function buildSalesRepAssignmentTimelineEvent(input: {
  id: string;
  eventType: string;
  createdAt: string;
  actor: TimelineActor;
  metadata: Record<string, unknown> | null | undefined;
}): SalesRepAssignmentTimelineEvent {
  const metadata = clientSafeSalesRepAssignmentMetadata(
    input.eventType,
    input.metadata,
  );
  return {
    id: input.id,
    eventType: input.eventType,
    createdAt: input.createdAt,
    actor: input.actor,
    sensitivity: salesRepAssignmentAuditSensitivity(input.eventType),
    category: "sales_rep_assignment",
    metadata,
  };
}
