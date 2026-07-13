/**
 * Order + document data access. Mock by default; Supabase branches are
 * server-only local dev (see ./supabase-context for the access model).
 *
 * M3A adds the first WRITES — orders only:
 * - createOrderRequest: checkout → atomic DB RPC (order + snapshotted
 *   lines, server-computed money, real MDF-#### number).
 * - updateOrderStatus: validated pipeline transition (history rows come
 *   from the DB trigger).
 * In mock mode both emulate the demo behavior and persist nothing.
 *
 * ⚠️ Documents: invoice_draft rows are DRAFT previews — never legal tax
 * invoices (docs/DOCUMENTS_AND_INVOICES_GUIDE.md). No documents are
 * created by these writes — document generation is M5.
 */
import {
  customers as mockCustomers,
  documentById,
  documents,
  orderById,
  orders,
} from "@/lib/mock";
import { orderSubtotal } from "@/lib/catalog-helpers";
import {
  ORDERS_EXPORT_CAP,
  orderMatchesSearch,
  orderSourceFacet,
  totalPagesFor,
  type OrderListRow,
  type OrdersListResult,
  type OrdersQuery,
} from "@/lib/orders-query";
import { tenantDateRangeUtc } from "@/lib/tenant-day";
import {
  ORDER_STATUS_TRANSITIONS,
  type Order,
  type OrderDocument,
  type OrderStatus,
} from "@/lib/types";
import {
  deriveOrderCreatedEvent,
  deriveOrderStatusEvent,
  trackedInventoryEffect,
  type DerivedOrderEvent,
} from "@/lib/order-audit";

import { getDataMode } from "./mode";
import { getTenantTimeZone } from "./supplier";

export type OrderSource = "sales_visit" | "remote_customer" | "admin";

// ── Mock-mode Order audit log (M8H.1) ─────────────────────────────────────
// Mock persists no orders, but it must obey the SAME audit contract as Supabase:
// exactly ONE event per EFFECTIVE mutation and NONE for a no-op, a rejected, or
// an unsupported one. The pure derivation model in @/lib/order-audit is the
// single source of truth for both modes — Supabase records into audit_events
// (transactionally, inside the RPC), mock records here so the contract stays
// observable and testable. No PII/tokens/prices/line items are ever recorded.

export interface MockOrderAuditEntry {
  orderId: string;
  eventType: string;
  metadata: Record<string, unknown>;
}

const mockOrderAuditLog: MockOrderAuditEntry[] = [];

function recordMockOrderAudit(orderId: string, event: DerivedOrderEvent): void {
  mockOrderAuditLog.push({
    orderId,
    eventType: event.eventType,
    metadata: event.metadata,
  });
}

/** Mock-mode audit rows recorded so far (read-only; tests assert against this). */
export function readMockOrderAuditLog(): readonly MockOrderAuditEntry[] {
  return mockOrderAuditLog;
}

/** Clear the mock audit log (test isolation). */
export function resetMockOrderAuditLog(): void {
  mockOrderAuditLog.length = 0;
}

export interface CreateOrderInput {
  customerId: string | null;
  items: { productId: string; quantity: number }[];
  notes?: string;
  source: OrderSource;
}

export interface CreateOrderResult {
  orderId: string;
  /** Internal warehouse/admin number (MDF-N). */
  orderNumber: string;
  /** Customer-facing public ref (MDF-XXXXXXXX). Same value as orderNumber in
   * mock mode (no separate internal sequence there). */
  publicRef: string;
}

export async function listOrders(): Promise<Order[]> {
  if (getDataMode() === "supabase") {
    return (await import("./supabase-reads")).sbListOrders();
  }
  return orders;
}

export async function getOrder(id: string): Promise<Order | undefined> {
  if (getDataMode() === "supabase") {
    return (await import("./supabase-reads")).sbGetOrder(id);
  }
  return orderById.get(id);
}

// ── Orders server-side search + pagination (M8F.1) ────────────────────────

/** Paginated, filtered Orders list. Supabase runs it server-side under RLS;
 * mock reproduces the same filter/sort/paginate contract over the demo array. */
export async function searchOrders(query: OrdersQuery): Promise<OrdersListResult> {
  if (getDataMode() === "supabase") {
    return (await import("./supabase-reads")).sbSearchOrders(query);
  }
  return mockSearchOrders(query, await getTenantTimeZone());
}

/** ALL rows matching the SAME filters, up to `cap` (pagination ignored) — for
 * the CSV export, so it never exports only the current page. */
export async function listOrdersForExport(
  query: OrdersQuery,
  cap: number = ORDERS_EXPORT_CAP,
): Promise<OrderListRow[]> {
  if (getDataMode() === "supabase") {
    return (await import("./supabase-reads")).sbListOrdersForExport(query, cap);
  }
  return filterMockOrders(query, await getTenantTimeZone()).slice(
    0,
    Math.max(0, cap),
  );
}

const mockCustomerById = new Map(mockCustomers.map((c) => [c.id, c]));

function toMockListRow(order: Order): OrderListRow {
  const c = order.customerId ? mockCustomerById.get(order.customerId) : undefined;
  // Every real order carries a buyer snapshot (name+phone) recorded at creation
  // (_order_create_core / the guest RPC). The mock order fixtures predate that
  // field, so synthesize it from the linked customer for KNOWN orders — keeping
  // mock search snapshot-based and identical to supabase. (No `guest` flag, so
  // the source facet + display are unaffected.)
  const customerSnapshot =
    order.customerSnapshot ??
    (c ? { name: c.name, phone: c.phone ?? undefined } : undefined);
  return {
    id: order.id,
    number: order.number,
    publicRef: order.publicRef ?? null,
    status: order.status,
    source: order.source,
    createdAt: order.createdAt,
    customerId: order.customerId,
    customerName: c?.name ?? null,
    customerPhone: c?.phone ?? null,
    customerSnapshot,
    itemCount: order.items.length,
    subtotalAmount: orderSubtotal(order),
  };
}

/** ALL matching mock rows, filtered + deterministically sorted (created_at
 * DESC, then id DESC) — mirrors the supabase filters/sort/search semantics. */
function filterMockOrders(query: OrdersQuery, timeZone: string): OrderListRow[] {
  const statusSet = new Set(query.statuses);
  // TENANT-timezone calendar-day bounds from the SAME builder the supabase query
  // uses (inclusive `from` start, next-day-start EXCLUSIVE upper) — so the two
  // data modes cannot drift, and neither can survive a DST transition wrongly.
  const { gteIso, ltIso } = tenantDateRangeUtc(
    query.dateFrom,
    query.dateTo,
    timeZone,
  );
  const fromMs = gteIso ? Date.parse(gteIso) : NaN;
  const toMs = ltIso ? Date.parse(ltIso) : NaN;

  return orders
    .map(toMockListRow)
    .filter((r) => statusSet.size === 0 || statusSet.has(r.status))
    .filter((r) => query.source === "all" || orderSourceFacet(r) === query.source)
    .filter((r) => !query.customerId || r.customerId === query.customerId)
    .filter((r) => {
      if (Number.isNaN(fromMs) && Number.isNaN(toMs)) return true;
      const t = Date.parse(r.createdAt);
      if (Number.isNaN(t)) return false;
      if (!Number.isNaN(fromMs) && t < fromMs) return false;
      if (!Number.isNaN(toMs) && t >= toMs) return false;
      return true;
    })
    .filter((r) => orderMatchesSearch(r, query.search))
    .sort(
      (a, b) =>
        b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
    );
}

function mockSearchOrders(
  query: OrdersQuery,
  timeZone: string,
): OrdersListResult {
  const all = filterMockOrders(query, timeZone);
  const total = all.length;
  const pageSize = query.pageSize;
  const totalPages = totalPagesFor(total, pageSize);
  // Normalize an out-of-range page to the last page (no redirect, no loop).
  const page = Math.min(Math.max(1, query.page), totalPages);
  const offset = (page - 1) * pageSize;
  return {
    rows: all.slice(offset, offset + pageSize),
    total,
    page,
    pageSize,
    totalPages,
  };
}

export async function listDocuments(): Promise<OrderDocument[]> {
  if (getDataMode() === "supabase") {
    return (await import("./supabase-reads")).sbListDocuments();
  }
  return documents;
}

export async function getDocument(
  id: string,
): Promise<OrderDocument | undefined> {
  if (getDataMode() === "supabase") {
    return (await import("./supabase-reads")).sbGetDocument(id);
  }
  return documentById.get(id);
}

export async function listDocumentsForOrder(
  orderId: string,
): Promise<OrderDocument[]> {
  if (getDataMode() === "supabase") {
    return (await import("./supabase-reads")).sbListDocumentsForOrder(orderId);
  }
  return documents.filter((doc) => doc.orderId === orderId);
}

// ── Writes (M3A) ──────────────────────────────────────────────────────────

/**
 * Create an order request from cart lines. Supabase mode: atomic DB RPC —
 * prices/totals come from live product data, never from the caller.
 * Mock mode: demo behavior — a plausible order number, nothing persisted
 * (matches the M0 checkout exactly).
 */
export async function createOrderRequest(
  input: CreateOrderInput,
): Promise<CreateOrderResult> {
  if (getDataMode() === "supabase") {
    return (await import("./supabase-writes")).sbCreateOrderRequest(input);
  }
  const demoNumber = `MDF-${1048 + Math.floor(Math.random() * 40)}`;
  const orderId = "demo-order";
  // M8H.1: ONE order.created, exactly like the RPC. This is the authenticated
  // path (the token/showcase channels are Supabase-only and do not run in mock),
  // so the initiator is honest. Safe channel facts only — never items or notes.
  recordMockOrderAudit(
    orderId,
    deriveOrderCreatedEvent({
      source: input.source,
      initiatorKind: "authenticated_user",
      customerKind: input.customerId ? "existing" : "none",
      itemCount: new Set(input.items.map((i) => i.productId)).size,
    }),
  );
  return {
    orderId,
    orderNumber: demoNumber,
    publicRef: demoNumber,
  };
}

/**
 * Move an order along the status pipeline. Supabase mode: validated DB
 * RPC (invalid transitions are rejected; history via trigger). Mock
 * mode: validates the same transition matrix, persists nothing.
 */
export async function updateOrderStatus(
  orderId: string,
  nextStatus: OrderStatus,
): Promise<{ orderId: string; oldStatus: OrderStatus; newStatus: OrderStatus }> {
  if (getDataMode() === "supabase") {
    return (await import("./supabase-writes")).sbUpdateOrderStatus(
      orderId,
      nextStatus,
    );
  }
  const order = orderById.get(orderId);
  if (!order) throw new Error(`[madaf/data] unknown order ${orderId}`);
  if (
    nextStatus !== order.status &&
    !ORDER_STATUS_TRANSITIONS[order.status].includes(nextStatus)
  ) {
    // Invalid transition → the mutation is rejected, so NO audit event.
    throw new Error(
      `[madaf/data] invalid transition ${order.status} -> ${nextStatus}`,
    );
  }
  // M8H.1: ONE order.status_changed per REAL transition. Requesting the current
  // status derives null (an effective no-op) → no event, mirroring the RPC.
  const event = deriveOrderStatusEvent(
    order.status,
    nextStatus,
    trackedInventoryEffect(order.status, nextStatus),
  );
  if (event) recordMockOrderAudit(orderId, event);
  return { orderId, oldStatus: order.status, newStatus: nextStatus };
}

/** M7I.3 — owner/admin edit an order's lines (+ notes). Supabase-only; the RPC
 * re-snapshots items, recomputes totals and reconciles reserved inventory. */
export async function updateOrderItems(
  orderId: string,
  items: { productId: string; quantity: number }[],
  notes?: string,
): Promise<{ orderId: string }> {
  if (getDataMode() !== "supabase") {
    throw new Error("[madaf/data] updateOrderItems is a Supabase-only write.");
  }
  return (await import("./supabase-writes")).sbUpdateOrderItems(
    orderId,
    items,
    notes,
  );
}

/** M7I.1 — owner/admin promote a guest order's store to a permanent customer. */
export async function createCustomerFromOrder(
  orderId: string,
): Promise<{ customerId: string }> {
  if (getDataMode() !== "supabase") {
    throw new Error("[madaf/data] createCustomerFromOrder is a Supabase-only write.");
  }
  return (await import("./supabase-writes")).sbCreateCustomerFromOrder(orderId);
}

/** M8B.3 — owner/admin link a guest order to an EXISTING customer (duplicate
 * guard alternative to creating a new one). Snapshot preserved. */
export async function linkOrderToCustomer(
  orderId: string,
  customerId: string,
): Promise<void> {
  if (getDataMode() !== "supabase") {
    throw new Error("[madaf/data] linkOrderToCustomer is a Supabase-only write.");
  }
  return (await import("./supabase-writes")).sbLinkOrderToCustomer(
    orderId,
    customerId,
  );
}
