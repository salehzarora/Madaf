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
