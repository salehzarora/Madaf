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
import { documentById, documents, orderById, orders } from "@/lib/mock";
import {
  ORDER_STATUS_TRANSITIONS,
  type Order,
  type OrderDocument,
  type OrderStatus,
} from "@/lib/types";

import { getDataMode } from "./mode";

export type OrderSource = "sales_visit" | "remote_customer" | "admin";

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
  return {
    orderId: "demo-order",
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
    throw new Error(
      `[madaf/data] invalid transition ${order.status} -> ${nextStatus}`,
    );
  }
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
