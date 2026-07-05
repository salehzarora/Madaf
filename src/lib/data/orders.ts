/**
 * Order + document data access. Mock by default; Supabase branch is
 * server-only local dev (see ./supabase-reads for the access model).
 *
 * ⚠️ Documents: invoice_draft rows are DRAFT previews — never legal tax
 * invoices (docs/DOCUMENTS_AND_INVOICES_GUIDE.md). Order/document WRITES
 * are M3+ — nothing here mutates.
 */
import { documentById, documents, orderById, orders } from "@/lib/mock";
import type { Order, OrderDocument } from "@/lib/types";

import { getDataMode } from "./mode";

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
