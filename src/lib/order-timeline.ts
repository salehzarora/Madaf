/**
 * Order Timeline — pure, shared contract (M8H.3).
 *
 * The bounded page type and the CLIENT-SAFE metadata projection for the
 * read-only Order Timeline, which consumes the M8H.1 `audit_events` rows
 * (entity_type = 'order'). No server-only imports, no `window` — this runs on
 * the server (data layer) and on the client (component) and is unit tested.
 *
 * REUSE, NOT RE-DESIGN. The keyset cursor, the DESC comparator, the page-size
 * clamp and the viewer-aware actor resolver are ENTITY-NEUTRAL and are imported
 * verbatim from the M8G.3 Customer Timeline contract. Re-implementing them here
 * would let the two timelines' pagination silently drift — which is exactly the
 * class of bug (duplicate / skipped rows) the keyset design exists to prevent.
 * Nothing in M8G.3 is modified.
 *
 * SECURITY: nothing here authorizes anything — RLS on audit_events is the
 * authorization boundary (its order clause requires can_access_order). The
 * cursor carries only (created_at, id): never a tenant, an order id, a secret or
 * PII, and it must never be treated as authorization.
 *
 * The projection is the LAST line of defence: even though the M8H.1 SQL helper
 * already enforces a per-event key allowlist on WRITE, this re-applies the same
 * allowlist on READ. That matters concretely — the local seed still carries a
 * legacy `order.delivered` row whose metadata holds `order_number`, a key no
 * current producer may write. It is projected to `{}` and labelled as an
 * unrecognized event; the raw value never reaches the client.
 */
import type { Dictionary } from "@/i18n/types";
import { interpolate } from "@/i18n/dictionaries";
import type { AuditSensitivity } from "@/lib/audit-events";
import {
  isOrderAuditFieldKey,
  isOrderInitiatorKind,
  isOrderInventoryEffect,
  isOrderLinkKind,
  orderAuditSensitivity,
  renderOrderAuditDetails,
  resolveOrderEventKey,
  type OrderAuditFieldKey,
} from "@/lib/order-audit";
import type { TimelineActor } from "@/lib/customer-timeline";
import type { OrderStatus } from "@/lib/types";

/** One safe, client-bound Order Timeline row. Carries only allowlisted metadata. */
export interface OrderTimelineEvent {
  /** audit_events.id (bigint) as a string. */
  id: string;
  /** Raw event_type — mapped to a label + safe details via order-audit.ts. An
   * unrecognized type is rendered as the explicit "unknown event", never
   * "Other", and never as raw text. */
  eventType: string;
  createdAt: string;
  actor: TimelineActor;
  sensitivity: AuditSensitivity;
  /** Always "order" for this phase. */
  category: "order";
  /** ONLY the allowlisted keys the renderer uses — never the raw row metadata. */
  metadata: Record<string, unknown>;
}

/** A bounded Order Timeline page + an opaque cursor for the next (older) page. */
export interface OrderTimelinePage {
  events: OrderTimelineEvent[];
  /** Opaque cursor to fetch the next page, or null when there are no more. */
  nextCursor: string | null;
  hasMore: boolean;
}

/**
 * The result of the OPTIONAL initial Timeline read, as it reaches the client
 * component. The Timeline is a non-critical widget on the Order Details page, so
 * its first read is isolated from the REQUIRED order reads: a success carries the
 * first page; a failure is represented explicitly ({ ok: false }) so the client
 * can render a localized, retryable error WITHOUT the surrounding Order Details
 * page crashing, and WITHOUT ever faking "no activity" on error. A failure
 * carries no backend error text — only the boolean.
 */
export type OrderTimelineInitial =
  | { ok: true; page: OrderTimelinePage }
  | { ok: false };

// ── Client-safe metadata projection (KEY-safe AND VALUE-safe) ───────────────
// This is the security boundary, NOT the renderer. It mirrors the M8H.1 SQL
// contract (_log_order_audit_event) both in WHICH keys are allowed per event and
// in what SHAPE each value may take, and it VALIDATES every value before it is
// added to the client-bound object. A malformed value nested under an otherwise
// allowlisted key (e.g. a secret object smuggled in where a count belongs, or a
// snapshot object hidden inside the changed-fields array) is dropped here — it
// never crosses the Server Component / Server Action boundary. The renderers
// re-validate too, but only as defence in depth; correctness does not depend on
// them, because by the time a value reaches them it is already a closed enum, a
// bounded integer, or a filtered field-key array.

const ORDER_STATUSES: readonly OrderStatus[] = [
  "new",
  "confirmed",
  "preparing",
  "delivered",
  "cancelled",
];
function isOrderStatus(v: unknown): v is OrderStatus {
  return (
    typeof v === "string" && (ORDER_STATUSES as readonly string[]).includes(v)
  );
}

/** A generous upper bound on any rendered count. The domain maximum is ~200
 * distinct order lines (update_order_items caps lines at 200), so this only ever
 * rejects absurd / overflow / adversarial magnitudes, never a real count. */
const ORDER_COUNT_MAX = 1_000_000;

/** A safe, non-negative integer count — or undefined. Rejects strings, objects,
 * arrays, booleans, NaN/Infinity, negatives, non-integers, and absurd
 * magnitudes, so an object/array/string can never be forwarded under a numeric
 * key. */
function safeOrderCount(v: unknown): number | undefined {
  return typeof v === "number" &&
    Number.isInteger(v) &&
    v >= 0 &&
    v <= ORDER_COUNT_MAX
    ? v
    : undefined;
}

/** The `changed_fields` array reduced to the known display-safe identifiers,
 * order-preserving + deduped. A non-array, nested values, and arbitrary strings
 * are all rejected; the closed field-key set (`items` / `notes`) also bounds the
 * length, so no cap is needed. */
function safeChangedFields(v: unknown): OrderAuditFieldKey[] {
  if (!Array.isArray(v)) return [];
  const out: OrderAuditFieldKey[] = [];
  for (const f of v) {
    if (isOrderAuditFieldKey(f) && !out.includes(f)) out.push(f);
  }
  return out;
}

/**
 * Project stored metadata down to the client-safe, VALUE-VALIDATED allowlist for
 * its event type. An unrecognized event type yields `{}` — nothing raw is ever
 * rendered — and a malformed value under a known key is omitted (the event row
 * itself is kept; only the bad value is dropped).
 *
 * `source` and `initial_status` are deliberately NOT projected for
 * `order.created`: they are safe to STORE (and the SQL allows them) but the
 * Timeline does not render them — `initial_status` is always 'new' (noise), and
 * the channel is already conveyed honestly by `initiator_kind`.
 *
 * The result is a fresh object built ONLY from validated primitives / a filtered
 * field-key array, so no sub-object from the source (which could carry a hashed
 * token, a customer snapshot, notes text, an order number, a price, …) can be
 * forwarded by reference.
 */
export function clientSafeOrderMetadata(
  eventType: string,
  metadata: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const key = resolveOrderEventKey(eventType);
  if (!key) return {};
  const src = metadata ?? {};
  const out: Record<string, unknown> = {};

  switch (key) {
    case "order.created": {
      if (isOrderInitiatorKind(src.initiator_kind)) {
        out.initiator_kind = src.initiator_kind;
      }
      const count = safeOrderCount(src.item_count);
      if (count !== undefined) out.item_count = count;
      break;
    }
    case "order.updated": {
      // Present-and-array → the filtered field-key list (possibly empty); a
      // non-array is dropped entirely.
      if (Array.isArray(src.changed_fields)) {
        out.changed_fields = safeChangedFields(src.changed_fields);
      }
      const before = safeOrderCount(src.item_count_before);
      if (before !== undefined) out.item_count_before = before;
      const after = safeOrderCount(src.item_count_after);
      if (after !== undefined) out.item_count_after = after;
      break;
    }
    case "order.status_changed": {
      if (isOrderStatus(src.from_status)) out.from_status = src.from_status;
      if (isOrderStatus(src.to_status)) out.to_status = src.to_status;
      if (isOrderInventoryEffect(src.inventory_effect)) {
        out.inventory_effect = src.inventory_effect;
      }
      break;
    }
    case "order.customer_linked": {
      if (isOrderLinkKind(src.link_kind)) out.link_kind = src.link_kind;
      break;
    }
  }
  return out;
}

/** Build one client-safe OrderTimelineEvent from a resolved actor + raw fields. */
export function buildOrderTimelineEvent(input: {
  id: string;
  eventType: string;
  createdAt: string;
  actor: TimelineActor;
  metadata: Record<string, unknown> | null | undefined;
}): OrderTimelineEvent {
  return {
    id: input.id,
    eventType: input.eventType,
    createdAt: input.createdAt,
    actor: input.actor,
    sensitivity: orderAuditSensitivity(input.eventType),
    category: "order",
    metadata: clientSafeOrderMetadata(input.eventType, input.metadata),
  };
}

// ── Event-specific presentation ────────────────────────────────────────────

/** The validated before → after status pair for an `order.status_changed` row,
 * or null for any other event / a malformed or unknown status. The UI renders
 * this as two localized status chips; a null NEVER renders a raw value. */
export function orderStatusTransition(event: {
  eventType: string;
  metadata: Record<string, unknown>;
}): { from: OrderStatus; to: OrderStatus } | null {
  if (resolveOrderEventKey(event.eventType) !== "order.status_changed") {
    return null;
  }
  const from = event.metadata?.from_status;
  const to = event.metadata?.to_status;
  if (!isOrderStatus(from) || !isOrderStatus(to)) return null;
  return { from, to };
}

/**
 * The localized detail LINES for a Timeline row.
 *
 * For every event except `order.status_changed` this is exactly the M8H.1
 * renderer (already unit-tested and PII-safe). For `order.status_changed` the
 * transition itself is rendered VISUALLY as before → after chips, so repeating
 * it as prose would duplicate it — only the safe, high-level stock effect
 * remains (and 'none' adds no line at all). Exact quantities, products and stock
 * levels stay in the order_inventory_movements ledger and are never shown here.
 *
 * A row whose transition FAILS validation falls back to the prose renderer, so a
 * malformed status pair degrades to "no line" rather than to a silent blank row.
 */
export function orderTimelineDetails(
  event: { eventType: string; metadata: Record<string, unknown> },
  dict: Dictionary,
): string[] {
  if (!orderStatusTransition(event)) return renderOrderAuditDetails(event, dict);

  const effect = event.metadata?.inventory_effect;
  if (!isOrderInventoryEffect(effect) || effect === "none") return [];
  return [
    interpolate(dict.audit.order.details.inventory, {
      effect: dict.audit.order.inventoryEffect[effect],
    }),
  ];
}
