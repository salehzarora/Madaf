import type { DocumentType, OrderDocument } from "@/lib/types";
import { orders } from "./orders";

/**
 * Documents derive from order lifecycle (mock rules):
 * - every order        → Order Request document
 * - preparing/delivered → Delivery Note
 * - delivered           → Tax Invoice DRAFT (preview only — never legal here)
 */
const TYPE_SUFFIX: Record<DocumentType, string> = {
  order: "O",
  delivery: "D",
  invoiceDraft: "I",
};

function docFor(orderId: string, type: DocumentType): OrderDocument {
  const order = orders.find((o) => o.id === orderId)!;
  const serial = order.number.replace("MDF-", "");
  return {
    id: `doc-${serial}-${TYPE_SUFFIX[type].toLowerCase()}`,
    type,
    orderId,
    number: `DOC-${serial}-${TYPE_SUFFIX[type]}`,
    date: order.createdAt,
  };
}

export const documents: OrderDocument[] = orders.flatMap((order) => {
  const result: OrderDocument[] = [docFor(order.id, "order")];
  if (order.status === "preparing" || order.status === "delivered") {
    result.push(docFor(order.id, "delivery"));
  }
  if (order.status === "delivered") {
    result.push(docFor(order.id, "invoiceDraft"));
  }
  return result;
});

export const documentById = new Map(documents.map((d) => [d.id, d]));
