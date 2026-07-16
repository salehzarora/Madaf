/**
 * Product Timeline — pure, shared contract (M8I.1).
 *
 * The bounded page type and the CLIENT-SAFE metadata projection for the
 * read-only Product Timeline, which consumes the M8I.1 `audit_events` rows
 * (entity_type = 'product'). No server-only imports, no `window` — this runs on
 * the server (data layer) and on the client (component) and is unit tested.
 *
 * REUSE, NOT RE-DESIGN. The keyset cursor, the DESC comparator, the page-size
 * clamp and the viewer-aware actor resolver are ENTITY-NEUTRAL and are imported
 * verbatim from the M8G.3 Customer Timeline contract (also used by the M8H.3
 * Order Timeline). Re-implementing them here would let the timelines' pagination
 * silently drift — exactly the duplicate/skipped-row class the keyset design
 * exists to prevent. Nothing in M8G.3 is modified.
 *
 * SECURITY: nothing here authorizes anything — RLS on audit_events is the
 * authorization boundary (its product clause requires owner/admin). The cursor
 * carries only (created_at, id): never a tenant, a product id, a secret or PII,
 * and it must never be treated as authorization.
 *
 * The projection is the LAST line of defence: even though the M8I.1 SQL helper
 * already enforces a per-event key allowlist on WRITE, this re-applies the same
 * allowlist (KEY- and VALUE-safe) on READ, so a name/price/image/raw value can
 * never reach the client through a product audit row.
 */
import type { AuditSensitivity } from "@/lib/audit-events";
import type { TimelineActor } from "@/lib/customer-timeline";
import {
  isProductAuditFieldKey,
  productAuditSensitivity,
  resolveProductEventKey,
  type ProductAuditFieldKey,
} from "@/lib/product-audit";

/** One safe, client-bound Product Timeline row. Carries only allowlisted metadata. */
export interface ProductTimelineEvent {
  /** audit_events.id (bigint) as a string. */
  id: string;
  /** Raw event_type — mapped to a label + safe details via product-audit.ts. An
   * unrecognized type is rendered as the explicit "unknown event", never
   * "Other", and never as raw text. */
  eventType: string;
  createdAt: string;
  actor: TimelineActor;
  sensitivity: AuditSensitivity;
  /** Always "product" for this phase. */
  category: "product";
  /** ONLY the allowlisted keys the renderer uses — never the raw row metadata. */
  metadata: Record<string, unknown>;
}

/** A bounded Product Timeline page + an opaque cursor for the next (older) page. */
export interface ProductTimelinePage {
  events: ProductTimelineEvent[];
  /** Opaque cursor to fetch the next page, or null when there are no more. */
  nextCursor: string | null;
  hasMore: boolean;
}

/**
 * The result of the OPTIONAL initial Timeline read, as it reaches the client
 * component. The Timeline is a non-critical section on the Product edit page, so
 * its first read is isolated from the REQUIRED product/inventory reads: a success
 * carries the first page; a failure is represented explicitly ({ ok: false }) so
 * the client can render a localized, retryable error WITHOUT the surrounding
 * Product edit form crashing, and WITHOUT ever faking "no activity" on error. A
 * failure carries no backend error text — only the boolean.
 */
export type ProductTimelineInitial =
  | { ok: true; page: ProductTimelinePage }
  | { ok: false };

// ── Client-safe metadata projection (KEY-safe AND VALUE-safe) ───────────────
// Mirrors the M8I.1 SQL contract (_log_product_audit_event) both in WHICH keys
// are allowed per event and in what SHAPE each value may take, VALIDATING every
// value before it is added to the client-bound object. A malformed value nested
// under an otherwise allowlisted key is dropped here — it never crosses the
// Server Component / Server Action boundary. The lifecycle events carry the whole
// story in their label, so their safe booleans are not projected (the renderer
// never reads them), matching the Customer Timeline convention.

/** The `changed_fields` array reduced to the known display-safe identifiers,
 * order-preserving + deduped. A non-array, nested values, and arbitrary strings
 * are all rejected; the closed field-key set also bounds the length. */
function safeChangedFields(v: unknown): ProductAuditFieldKey[] {
  if (!Array.isArray(v)) return [];
  const out: ProductAuditFieldKey[] = [];
  for (const f of v) {
    if (isProductAuditFieldKey(f) && !out.includes(f)) out.push(f);
  }
  return out;
}

/**
 * Project stored metadata down to the client-safe, VALUE-VALIDATED allowlist for
 * its event type. An unrecognized event type yields `{}` — nothing raw is ever
 * rendered — and a malformed value under a known key is omitted (the event row
 * itself is kept; only the bad value is dropped).
 */
export function clientSafeProductMetadata(
  eventType: string,
  metadata: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const key = resolveProductEventKey(eventType);
  if (!key) return {};
  const src = metadata ?? {};
  const out: Record<string, unknown> = {};

  if (key === "product.updated" && Array.isArray(src.changed_fields)) {
    out.changed_fields = safeChangedFields(src.changed_fields);
  }
  // product.created carries no metadata; product.activated/deactivated carry only
  // safe booleans the renderer does not read (the label is the whole story), so
  // nothing is projected for them.
  return out;
}

/** Build one client-safe ProductTimelineEvent from a resolved actor + raw fields. */
export function buildProductTimelineEvent(input: {
  id: string;
  eventType: string;
  createdAt: string;
  actor: TimelineActor;
  metadata: Record<string, unknown> | null | undefined;
}): ProductTimelineEvent {
  return {
    id: input.id,
    eventType: input.eventType,
    createdAt: input.createdAt,
    actor: input.actor,
    sensitivity: productAuditSensitivity(input.eventType),
    category: "product",
    metadata: clientSafeProductMetadata(input.eventType, input.metadata),
  };
}
