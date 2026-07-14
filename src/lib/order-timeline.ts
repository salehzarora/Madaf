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
  isOrderInventoryEffect,
  orderAuditSensitivity,
  renderOrderAuditDetails,
  resolveOrderEventKey,
  type OrderAuditEventKey,
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

// ── Client-safe metadata projection ────────────────────────────────────────
// Mirrors the M8H.1 SQL key allowlist (_log_order_audit_event) EXACTLY — the
// same keys, per the same event types. Anything else (a stray/legacy key such as
// the seed's `order_number`, or any future producer key) is dropped BEFORE the
// row crosses the wire. Values are re-validated by the renderers below.
const ORDER_CLIENT_METADATA_KEYS: Record<OrderAuditEventKey, readonly string[]> = {
  "order.created": ["initiator_kind", "item_count"],
  "order.updated": ["changed_fields", "item_count_before", "item_count_after"],
  "order.status_changed": ["from_status", "to_status", "inventory_effect"],
  "order.customer_linked": ["link_kind"],
};

/**
 * Project stored metadata down to the client-safe allowlist for its event type.
 * An unrecognized event type yields `{}` — nothing raw is ever rendered.
 *
 * `source` and `initial_status` are deliberately NOT projected for
 * `order.created`: they are safe to STORE (and the SQL allows them) but the
 * Timeline does not render them — `initial_status` is always 'new' (noise), and
 * the channel is already conveyed honestly by `initiator_kind`. Projecting only
 * what is rendered keeps the wire payload minimal.
 *
 * `changed_fields` is additionally filtered to the known field-key allowlist, so
 * an unexpected field name can never reach a label lookup.
 */
export function clientSafeOrderMetadata(
  eventType: string,
  metadata: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const key = resolveOrderEventKey(eventType);
  if (!key) return {};
  const allow = ORDER_CLIENT_METADATA_KEYS[key];
  const src = metadata ?? {};
  const out: Record<string, unknown> = {};
  for (const k of allow) {
    if (!(k in src)) continue;
    if (k === "changed_fields") {
      const arr = Array.isArray(src[k]) ? (src[k] as unknown[]) : [];
      out[k] = arr.filter(isOrderAuditFieldKey);
    } else {
      out[k] = src[k];
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
