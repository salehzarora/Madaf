/**
 * Order audit-event taxonomy + safe render/label contract (M8H.1).
 *
 * The app-layer companion to the transactional producers in migration
 * 20260802100000: a CLOSED order event vocabulary, its category + sensitivity,
 * localized labels, an honest initiator model, a PII-safe details renderer, and
 * the PURE derivation model that mock and Supabase BOTH obey (so a no-op can
 * never fabricate an event in either mode).
 *
 * The Order Timeline is M8H.2 — this phase adds NO UI. An unrecognized event
 * type (e.g. the legacy `order.delivered` demo row in the local seed) maps to an
 * explicit "unknown event" label, NEVER a silent "Other".
 *
 * SAFETY: no event ever carries a token, hash, URL, customer/guest name, phone,
 * email, address, notes TEXT, snapshot, line item, product id, price, total, or
 * order_number. The DB helper enforces the same allowlist per event type; this
 * module renders only what that allowlist permits.
 *
 * Pure + serializable: no server-only imports, no `window`. Unit-tested directly.
 */
import type { Dictionary } from "@/i18n/types";
import { interpolate } from "@/i18n/dictionaries";
import type { AuditSensitivity } from "@/lib/audit-events";
import type { OrderStatus } from "@/lib/types";

/** The closed set of Order-lifecycle audit event types (mirrors the DB
 * `_log_order_audit_event` allowlist EXACTLY). */
export const ORDER_AUDIT_EVENT_KEYS = [
  "order.created",
  "order.updated",
  "order.status_changed",
  "order.customer_linked",
] as const;
export type OrderAuditEventKey = (typeof ORDER_AUDIT_EVENT_KEYS)[number];

export function isOrderAuditEventKey(v: unknown): v is OrderAuditEventKey {
  return (
    typeof v === "string" &&
    (ORDER_AUDIT_EVENT_KEYS as readonly string[]).includes(v)
  );
}

/** Resolve a raw event_type to a known key, or null (explicit unknown — NEVER
 * silently "Other"). */
export function resolveOrderEventKey(raw: string): OrderAuditEventKey | null {
  return isOrderAuditEventKey(raw) ? raw : null;
}

/** Entity-aligned audit category for this phase. */
export const AUDIT_CATEGORY_ORDER = "order" as const;
export type OrderAuditCategory = typeof AUDIT_CATEGORY_ORDER;

export function orderAuditCategory(): OrderAuditCategory {
  return AUDIT_CATEGORY_ORDER;
}

/**
 * Sensitivity per event — DERIVED from the metadata it carries. Linking binds a
 * buyer identity to an order, and an edit reveals WHICH parts of the order moved
 * (never the values) → `medium`. Plain lifecycle facts are `low`. Never `high`:
 * no order event carries PII/tokens/prices by design.
 */
const ORDER_SENSITIVITY: Record<OrderAuditEventKey, AuditSensitivity> = {
  "order.created": "low",
  "order.updated": "medium",
  "order.status_changed": "low",
  "order.customer_linked": "medium",
};

/** Sensitivity for a raw event type. Unknown types are `medium` (never
 * under-classified) rather than dropped. */
export function orderAuditSensitivity(raw: string): AuditSensitivity {
  const key = resolveOrderEventKey(raw);
  return key ? ORDER_SENSITIVITY[key] : "medium";
}

/** Localized event label. An unrecognized type gets the explicit unknown-event
 * label, NOT "Other". */
export function orderAuditEventLabel(raw: string, dict: Dictionary): string {
  const key = resolveOrderEventKey(raw);
  return key ? dict.audit.order.events[key] : dict.audit.unknownEvent;
}

export function orderAuditCategoryLabel(dict: Dictionary): string {
  return dict.audit.order.category;
}

// ── Initiator (honest channel; a NULL actor is NOT automatically "System") ──

/**
 * WHO started the action. `actor_user_id` is NULL on both anonymous token
 * channels, so the channel — not the null actor — is what the UI must show.
 * The DB helper refuses a token-channel event that carries an authenticated
 * actor, so an operator can never be recorded as a guest.
 */
export const ORDER_INITIATOR_KINDS = [
  "authenticated_user",
  "customer_link",
  "showcase_guest",
] as const;
export type OrderInitiatorKind = (typeof ORDER_INITIATOR_KINDS)[number];

export function isOrderInitiatorKind(v: unknown): v is OrderInitiatorKind {
  return (
    typeof v === "string" &&
    (ORDER_INITIATOR_KINDS as readonly string[]).includes(v)
  );
}

/** Localized initiator label, or null when the metadata carries no (or an
 * unrecognized) kind — the caller then shows nothing rather than guessing
 * "System". */
export function orderInitiatorLabel(
  raw: unknown,
  dict: Dictionary,
): string | null {
  return isOrderInitiatorKind(raw) ? dict.audit.order.initiator[raw] : null;
}

// ── Safe value allowlists (mirror the DB helper exactly) ───────────────────

/** The `changed_fields` allowlist for order.updated (NEVER the values). */
export const ORDER_AUDIT_FIELD_KEYS = ["items", "notes"] as const;
export type OrderAuditFieldKey = (typeof ORDER_AUDIT_FIELD_KEYS)[number];

export function isOrderAuditFieldKey(v: unknown): v is OrderAuditFieldKey {
  return (
    typeof v === "string" &&
    (ORDER_AUDIT_FIELD_KEYS as readonly string[]).includes(v)
  );
}

/** The safe, high-level stock effect of a status transition. Exact quantities,
 * products and stock levels stay in the order_inventory_movements ledger. */
export const ORDER_INVENTORY_EFFECTS = ["none", "reserved", "restored"] as const;
export type OrderInventoryEffect = (typeof ORDER_INVENTORY_EFFECTS)[number];

export function isOrderInventoryEffect(v: unknown): v is OrderInventoryEffect {
  return (
    typeof v === "string" &&
    (ORDER_INVENTORY_EFFECTS as readonly string[]).includes(v)
  );
}

/** How an order came to have a customer. */
export const ORDER_LINK_KINDS = ["existing_customer", "guest_conversion"] as const;
export type OrderLinkKind = (typeof ORDER_LINK_KINDS)[number];

export function isOrderLinkKind(v: unknown): v is OrderLinkKind {
  return (
    typeof v === "string" && (ORDER_LINK_KINDS as readonly string[]).includes(v)
  );
}

/** Whether the order had a real customer, a guest store, or neither, at creation. */
export const ORDER_CUSTOMER_KINDS = ["existing", "guest", "none"] as const;
export type OrderCustomerKind = (typeof ORDER_CUSTOMER_KINDS)[number];

const ORDER_STATUSES: readonly OrderStatus[] = [
  "new",
  "confirmed",
  "preparing",
  "delivered",
  "cancelled",
];
function isOrderStatus(v: unknown): v is OrderStatus {
  return typeof v === "string" && (ORDER_STATUSES as readonly string[]).includes(v);
}

// ── Safe details renderer ─────────────────────────────────────────────────
// Renders ONLY allowlisted, validated values. An unknown event, an unexpected
// key, or a malformed value produces NO line rather than leaking anything raw.

/**
 * Localized, PII-safe detail lines for one order audit event. Never renders raw
 * metadata: every value is validated against its closed enum / bounded shape
 * first. Order statuses reuse the existing `dict.status.*` labels.
 */
export function renderOrderAuditDetails(
  event: { eventType: string; metadata: Record<string, unknown> },
  dict: Dictionary,
): string[] {
  const key = resolveOrderEventKey(event.eventType);
  if (!key) return [];
  const m = event.metadata ?? {};
  const t = dict.audit.order.details;
  const out: string[] = [];

  switch (key) {
    case "order.created": {
      const channel = orderInitiatorLabel(m.initiator_kind, dict);
      if (channel) out.push(interpolate(t.createdVia, { channel }));
      const count = m.item_count;
      if (typeof count === "number" && Number.isInteger(count) && count >= 0) {
        out.push(interpolate(t.lineCount, { count: String(count) }));
      }
      break;
    }
    case "order.updated": {
      const fields = Array.isArray(m.changed_fields)
        ? (m.changed_fields as unknown[]).filter(isOrderAuditFieldKey)
        : [];
      if (fields.length > 0) {
        out.push(
          interpolate(t.changed, {
            fields: fields.map((f) => dict.audit.order.fields[f]).join(", "),
          }),
        );
      }
      const before = m.item_count_before;
      const after = m.item_count_after;
      if (
        typeof before === "number" &&
        typeof after === "number" &&
        Number.isInteger(before) &&
        Number.isInteger(after)
      ) {
        out.push(
          interpolate(t.lineCountChange, {
            before: String(before),
            after: String(after),
          }),
        );
      }
      break;
    }
    case "order.status_changed": {
      const from = m.from_status;
      const to = m.to_status;
      if (isOrderStatus(from) && isOrderStatus(to)) {
        out.push(
          interpolate(t.statusChange, {
            from: dict.status[from],
            to: dict.status[to],
          }),
        );
      }
      // The safe stock effect only — never quantities. 'none' adds no line.
      const effect = m.inventory_effect;
      if (isOrderInventoryEffect(effect) && effect !== "none") {
        out.push(
          interpolate(t.inventory, {
            effect: dict.audit.order.inventoryEffect[effect],
          }),
        );
      }
      break;
    }
    case "order.customer_linked": {
      const kind = m.link_kind;
      if (isOrderLinkKind(kind)) {
        out.push(
          kind === "guest_conversion"
            ? t.linkedGuestConversion
            : t.linkedExisting,
        );
      }
      break;
    }
  }
  return out;
}

// ══ PURE DERIVATION MODEL (mock ⇄ Supabase parity) ════════════════════════
// The single source of truth for WHEN an order event fires and WHAT safe
// metadata it carries. The DB producers implement exactly this contract; the
// mock write paths call these functions directly, so neither mode can drift
// (and a no-op can never fabricate an event in either).

export interface DerivedOrderEvent {
  eventType: OrderAuditEventKey;
  metadata: Record<string, unknown>;
}

/** ONE order.created per successfully created order, on any channel. */
export function deriveOrderCreatedEvent(input: {
  source: string;
  initiatorKind: OrderInitiatorKind;
  customerKind: OrderCustomerKind;
  itemCount: number;
}): DerivedOrderEvent {
  return {
    eventType: "order.created",
    metadata: {
      source: input.source,
      initiator_kind: input.initiatorKind,
      initial_status: "new",
      customer_kind: input.customerKind,
      item_count: input.itemCount,
    },
  };
}

/**
 * ONE order.status_changed per REAL transition. Requesting the current status is
 * an effective no-op → null (no event), mirroring the RPC's early return.
 */
export function deriveOrderStatusEvent(
  from: OrderStatus,
  to: OrderStatus,
  inventoryEffect: OrderInventoryEffect,
): DerivedOrderEvent | null {
  if (from === to) return null;
  return {
    eventType: "order.status_changed",
    metadata: {
      from_status: from,
      to_status: to,
      inventory_effect: inventoryEffect,
    },
  };
}

/**
 * The inventory effect of a transition for a FULLY STOCK-TRACKED order. This is
 * the model MOCK uses (it keeps no reservation ledger).
 *
 * The DATABASE never guesses: update_order_status derives the effect from what
 * the movement ledger ACTUALLY recorded, so an order whose products are all
 * untracked legitimately reports 'none' where this model would say 'reserved'.
 * Supabase is authoritative; this is the demo/mock approximation.
 */
export function trackedInventoryEffect(
  from: OrderStatus,
  to: OrderStatus,
): OrderInventoryEffect {
  // Reservation happens once, on the only entry into `confirmed`.
  if (from === "new" && to === "confirmed") return "reserved";
  // Restoration happens once, on cancelling an order that had reserved.
  if (to === "cancelled" && (from === "confirmed" || from === "preparing")) {
    return "restored";
  }
  // confirmed → preparing (already reserved), preparing → delivered (no extra
  // deduction), new → cancelled (never reserved).
  return "none";
}

/** The authoritative before/after state an order edit is judged against. The
 * notes TEXT is compared but NEVER recorded. */
export interface OrderAuditSnapshot {
  /** product_id → total quantity (the effective line map). */
  items: Record<string, number>;
  notes: string | null;
}

function sameItems(
  a: Record<string, number>,
  b: Record<string, number>,
): boolean {
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && a[k] === b[k]);
}

/**
 * ONE order.updated per EFFECTIVE edit. A resubmission of identical lines +
 * notes changes nothing → null (no event), mirroring the RPC's change gate.
 * changed_fields is DERIVED from authoritative state — never client-supplied.
 */
export function deriveOrderUpdateEvent(
  before: OrderAuditSnapshot,
  after: OrderAuditSnapshot,
): DerivedOrderEvent | null {
  const changed: OrderAuditFieldKey[] = [];
  const itemsChanged = !sameItems(before.items, after.items);
  if (itemsChanged) changed.push("items");
  if ((before.notes ?? null) !== (after.notes ?? null)) changed.push("notes");
  if (changed.length === 0) return null;

  const metadata: Record<string, unknown> = { changed_fields: changed };
  if (itemsChanged) {
    metadata.item_count_before = Object.keys(before.items).length;
    metadata.item_count_after = Object.keys(after.items).length;
  }
  return { eventType: "order.updated", metadata };
}

/** ONE order.customer_linked when a previously-unlinked order gains a customer.
 * Recorded for the ORDER entity; M8G.2's customer.order_linked / customer.created
 * independently serve the CUSTOMER timeline (distinct entities — each row appears
 * in exactly one timeline, so neither shows the action twice). */
export function deriveOrderCustomerLinkedEvent(
  linkKind: OrderLinkKind,
): DerivedOrderEvent {
  return {
    eventType: "order.customer_linked",
    metadata: { link_kind: linkKind },
  };
}
