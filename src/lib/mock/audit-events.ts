/**
 * Mock customer audit events (M8G.3) — demo data so the Customer Timeline
 * renders in mock mode with the SAME contract as Supabase (bounded page,
 * created_at DESC / id DESC order, cursor keyset, actor resolution, safe
 * details). Only the demo store `c01` has recorded activity; every other mock
 * store shows the honest legacy empty-state. No fake historical reconstruction
 * — these are illustrative demo rows, not inferred from other mock state.
 */

/** A mock audit_events row (mirrors the DB shape the timeline reads). */
export interface MockAuditEvent {
  /** bigint id as a string (monotonic; higher = later). */
  id: string;
  customerId: string;
  eventType: string;
  /** null → the acting user is unattributable (deleted). */
  actorUserId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

/** Demo events for store c01, newest first (id + created_at both descend). */
export const auditEvents: MockAuditEvent[] = [
  {
    id: "8",
    customerId: "c01",
    eventType: "customer.order_linked",
    actorUserId: "u-admin",
    metadata: { order_id: "o-1042", previous_linkage: "unlinked" },
    createdAt: "2026-07-10T09:15:00Z",
  },
  {
    id: "7",
    customerId: "c01",
    eventType: "customer.access_link.rotated",
    actorUserId: "u-owner",
    metadata: { link_id: "l-2", expires_at: "2026-12-31T00:00:00Z" },
    createdAt: "2026-07-08T14:30:00Z",
  },
  {
    id: "6",
    customerId: "c01",
    eventType: "customer.access_link.created",
    actorUserId: "u-owner",
    metadata: { link_id: "l-1" },
    createdAt: "2026-07-05T11:00:00Z",
  },
  {
    id: "5",
    customerId: "c01",
    eventType: "customer.activated",
    actorUserId: "u-admin",
    metadata: { before_active: false, after_active: true },
    createdAt: "2026-07-03T10:00:00Z",
  },
  {
    id: "4",
    customerId: "c01",
    eventType: "customer.deactivated",
    // Deleted actor → the timeline shows an explicit "unknown/former" label.
    actorUserId: null,
    metadata: { before_active: true, after_active: false },
    createdAt: "2026-07-02T16:20:00Z",
  },
  {
    id: "3",
    customerId: "c01",
    eventType: "customer.updated",
    actorUserId: "u-admin",
    metadata: {
      changed_fields: ["phone", "customer_type"],
      customer_type: { from: "grocery", to: "kiosk" },
    },
    createdAt: "2026-07-01T12:00:00Z",
  },
  {
    id: "2",
    customerId: "c01",
    eventType: "customer.updated",
    actorUserId: "u-owner",
    metadata: { changed_fields: ["name", "address"] },
    createdAt: "2026-06-20T08:45:00Z",
  },
  {
    id: "1",
    customerId: "c01",
    eventType: "customer.created",
    actorUserId: "u-owner",
    metadata: { origin: "manual", customer_type: "grocery" },
    createdAt: "2026-06-15T09:00:00Z",
  },
];

/** Demo roster (user_id → email) for resolving mock actor labels. u-admin is
 * intentionally absent to demonstrate the "former member" fallback for an
 * owner/admin viewer. */
export const auditActors = new Map<string, string>([
  ["u-owner", "owner@madaf.local"],
]);

// ── Order lifecycle audit events (M8H.3) ──────────────────────────────────
// Demo rows so the Order Timeline renders in mock mode with the SAME contract
// as Supabase (bounded page, created_at DESC / id DESC, cursor keyset, actor
// resolution, safe projection). Only orders o1043 / o1042 / o1041 have recorded
// activity; every other mock order shows the honest empty state. These are
// illustrative demo rows — NOT a reconstruction inferred from other mock state,
// and no creation event is fabricated for an order that has none.

/** A mock order audit_events row (mirrors the DB shape the timeline reads). */
export interface MockOrderAuditEvent {
  /** bigint id as a string (monotonic; higher = later). */
  id: string;
  orderId: string;
  eventType: string;
  /** null → no authenticated actor (the anonymous token channels), or the
   * acting user was deleted. The CHANNEL — not the null actor — is what the UI
   * shows, via metadata.initiator_kind. */
  actorUserId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

/** Demo order events, newest first (id + created_at both descend). */
export const orderAuditEvents: MockOrderAuditEvent[] = [
  // ── o1043 — a full lifecycle, ending in the LEGACY unrecognized event ────
  {
    // Mirrors the real row still present in supabase/seed.sql: an event_type
    // OUTSIDE the closed M8H.1 catalog, carrying `order_number` — a key no
    // current producer may write. The Timeline must show the explicit
    // "unrecognized event" label and project the metadata to {} (the order
    // number must never reach the client through an audit row).
    id: "16",
    orderId: "o1043",
    eventType: "order.delivered",
    actorUserId: "u-owner",
    metadata: { order_number: "MDF-1043" },
    createdAt: "2026-07-02T15:05:00Z",
  },
  {
    id: "15",
    orderId: "o1043",
    eventType: "order.status_changed",
    // Deleted actor → the timeline shows the explicit "unknown user" fallback.
    actorUserId: null,
    metadata: {
      from_status: "preparing",
      to_status: "delivered",
      inventory_effect: "none",
    },
    createdAt: "2026-07-02T14:30:00Z",
  },
  {
    id: "14",
    orderId: "o1043",
    eventType: "order.status_changed",
    actorUserId: "u-admin",
    metadata: {
      from_status: "confirmed",
      to_status: "preparing",
      inventory_effect: "none",
    },
    createdAt: "2026-07-02T09:10:00Z",
  },
  {
    id: "13",
    orderId: "o1043",
    eventType: "order.updated",
    actorUserId: "u-owner",
    metadata: {
      changed_fields: ["items", "notes"],
      item_count_before: 4,
      item_count_after: 5,
    },
    createdAt: "2026-07-01T15:40:00Z",
  },
  {
    id: "12",
    orderId: "o1043",
    eventType: "order.status_changed",
    actorUserId: "u-admin",
    metadata: {
      from_status: "new",
      to_status: "confirmed",
      inventory_effect: "reserved",
    },
    createdAt: "2026-07-01T11:20:00Z",
  },
  {
    id: "11",
    orderId: "o1043",
    eventType: "order.created",
    actorUserId: "u-owner",
    metadata: {
      source: "sales_visit",
      initiator_kind: "authenticated_user",
      initial_status: "new",
      customer_kind: "existing",
      item_count: 5,
    },
    createdAt: "2026-07-01T09:30:00Z",
  },

  // ── o1042 — a SHOWCASE GUEST order, later promoted to a real customer ────
  {
    id: "10",
    orderId: "o1042",
    eventType: "order.status_changed",
    actorUserId: "u-admin",
    metadata: {
      from_status: "preparing",
      to_status: "delivered",
      inventory_effect: "none",
    },
    createdAt: "2026-06-30T13:00:00Z",
  },
  {
    id: "9",
    orderId: "o1042",
    eventType: "order.customer_linked",
    actorUserId: "u-owner",
    metadata: { link_kind: "guest_conversion" },
    createdAt: "2026-06-29T15:30:00Z",
  },
  {
    id: "8",
    orderId: "o1042",
    eventType: "order.created",
    // An anonymous showcase guest: there is NO authenticated actor. The channel
    // is recorded honestly in initiator_kind — a null actor is never silently
    // rendered as "System".
    actorUserId: null,
    metadata: {
      source: "remote_customer",
      initiator_kind: "showcase_guest",
      initial_status: "new",
      customer_kind: "guest",
      item_count: 6,
    },
    createdAt: "2026-06-29T14:45:00Z",
  },

  // ── o1041 — ordered through a store's PRIVATE link, then cancelled ───────
  {
    id: "7",
    orderId: "o1041",
    eventType: "order.status_changed",
    actorUserId: "u-owner",
    metadata: {
      from_status: "confirmed",
      to_status: "cancelled",
      inventory_effect: "restored",
    },
    createdAt: "2026-06-28T08:05:00Z",
  },
  {
    id: "6",
    orderId: "o1041",
    eventType: "order.status_changed",
    actorUserId: "u-admin",
    metadata: {
      from_status: "new",
      to_status: "confirmed",
      inventory_effect: "reserved",
    },
    createdAt: "2026-06-27T12:15:00Z",
  },
  {
    id: "5",
    orderId: "o1041",
    eventType: "order.created",
    // Private customer-link channel: again no authenticated actor.
    actorUserId: null,
    metadata: {
      source: "remote_customer",
      initiator_kind: "customer_link",
      initial_status: "new",
      customer_kind: "existing",
      item_count: 2,
    },
    createdAt: "2026-06-27T10:10:00Z",
  },
];

// ── Product lifecycle audit events (M8I.1) ────────────────────────────────
// Demo rows so the Product Timeline renders with the SAME contract as Supabase
// (bounded page, created_at DESC / id DESC, cursor keyset, actor resolution, safe
// projection). The Product edit route is Supabase-only, so these serve parity +
// tests rather than an in-app mock surface. Only product p01 has recorded
// activity; every other mock product shows the honest empty state. Illustrative
// demo rows — NOT a reconstruction inferred from other mock state.

/** A mock product audit_events row (mirrors the DB shape the timeline reads). */
export interface MockProductAuditEvent {
  /** bigint id as a string (monotonic; higher = later). */
  id: string;
  productId: string;
  eventType: string;
  /** null → the acting user is unattributable (deleted). */
  actorUserId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

/** Demo product events for p01, newest first (id + created_at both descend). */
export const productAuditEvents: MockProductAuditEvent[] = [
  {
    id: "4",
    productId: "p01",
    eventType: "product.activated",
    actorUserId: "u-admin",
    metadata: { before_active: false, after_active: true },
    createdAt: "2026-07-06T10:00:00Z",
  },
  {
    id: "3",
    productId: "p01",
    eventType: "product.deactivated",
    // Deleted actor → the timeline shows the explicit "unknown/former" label.
    actorUserId: null,
    metadata: { before_active: true, after_active: false },
    createdAt: "2026-07-04T16:20:00Z",
  },
  {
    id: "2",
    productId: "p01",
    eventType: "product.updated",
    actorUserId: "u-admin",
    metadata: { changed_fields: ["wholesale_price", "package"] },
    createdAt: "2026-07-02T12:00:00Z",
  },
  {
    id: "1",
    productId: "p01",
    eventType: "product.created",
    actorUserId: "u-owner",
    metadata: {},
    createdAt: "2026-06-15T09:00:00Z",
  },
];
