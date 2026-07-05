/**
 * Order + document data access.
 *
 * M1: mock-backed. M2/M3 mapping notes:
 * - Order.number       ← orders.order_number (new numbers come from the
 *                        next_order_number() SQL function, not the client)
 * - OrderItem.unitPrice ← order_items.unit_price_snapshot (line totals are
 *                        stored, not recomputed)
 * - Status changes are plain UPDATEs on orders.status — the DB trigger
 *   writes order_status_history automatically.
 * - OrderDocument.type mapping: order → order_request, delivery →
 *   delivery_note, invoiceDraft → invoice_draft. Document rows are stored
 *   (documents table), no longer derived on the fly; the derivation rules
 *   live in the seed and move server-side in M5.
 *   ⚠️ invoice_draft is a DRAFT preview — never a legal tax invoice
 *   (docs/DOCUMENTS_AND_INVOICES_GUIDE.md).
 */
import { documentById, documents, orderById, orders } from "@/lib/mock";
import type { Order, OrderDocument } from "@/lib/types";

import { getDataMode, supabaseNotWiredYet } from "./mode";

export async function listOrders(): Promise<Order[]> {
  if (getDataMode() === "supabase") supabaseNotWiredYet("listOrders");
  return orders;
}

export async function getOrder(id: string): Promise<Order | undefined> {
  if (getDataMode() === "supabase") supabaseNotWiredYet("getOrder");
  return orderById.get(id);
}

export async function listDocuments(): Promise<OrderDocument[]> {
  if (getDataMode() === "supabase") supabaseNotWiredYet("listDocuments");
  return documents;
}

export async function getDocument(
  id: string,
): Promise<OrderDocument | undefined> {
  if (getDataMode() === "supabase") supabaseNotWiredYet("getDocument");
  return documentById.get(id);
}
