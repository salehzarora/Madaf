/**
 * Order-document SOURCE assembly for M5A PDF generation.
 *
 * Builds an OrderDocumentSource (supplier + order + SNAPSHOTTED lines +
 * server-side totals) that the server-only renderer draws into a PDF. Mock
 * by default; the Supabase branch reads the order through the authenticated
 * RLS client, so a sales_rep only reaches assigned-customer orders — an
 * inaccessible order returns undefined (→ the route replies 404), never
 * another customer's data.
 *
 * Faithful to snapshots: the Supabase path renders product names / package
 * units / prices / line totals from order_items snapshot columns and the
 * buyer from orders.customer_snapshot, so a document re-renders identically
 * even after the catalog or customer changes.
 */
import type { Locale } from "@/i18n/config";
import { customerById, orderById, productById, supplier } from "@/lib/mock";
import {
  DOCUMENT_TYPE_TO_DB,
  type OrderDocumentSource,
} from "@/lib/pdf/document-model";
import { VAT_RATE, type DocumentType, type LocalizedText } from "@/lib/types";

import { getDataMode } from "./mode";

export async function getOrderDocumentSource(
  orderId: string,
): Promise<OrderDocumentSource | undefined> {
  if (getDataMode() === "supabase") {
    return (await import("./supabase-reads")).sbGetOrderDocumentSource(orderId);
  }
  return mockOrderDocumentSource(orderId);
}

const DOC_SUFFIX: Record<DocumentType, string> = {
  order: "O",
  delivery: "D",
  invoiceDraft: "I",
};

/**
 * Record the document row and return its internal number + date. Supabase
 * mode goes through the create_order_document RPC (which enforces access +
 * the legal guardrails). Mock mode derives the same DOC-####-x number and
 * persists nothing (matching the demo's no-DB behavior).
 */
export async function recordOrderDocument(input: {
  orderId: string;
  orderNumber: string;
  orderDate: string;
  type: DocumentType;
  locale: Locale;
  legalNotice: string | null;
}): Promise<{
  documentId: string;
  documentNumber: string;
  documentDate: string;
  storagePath: string | null;
}> {
  if (getDataMode() === "supabase") {
    return (await import("./supabase-writes")).sbCreateOrderDocument({
      orderId: input.orderId,
      documentType: DOCUMENT_TYPE_TO_DB[input.type],
      documentLocale: input.locale,
      legalNotice: input.legalNotice,
    });
  }
  const serial = input.orderNumber.replace("MDF-", "");
  return {
    documentId: `doc-${serial}-${DOC_SUFFIX[input.type].toLowerCase()}`,
    documentNumber: `DOC-${serial}-${DOC_SUFFIX[input.type]}`,
    documentDate: input.orderDate,
    storagePath: null, // mock persists nothing
  };
}

/**
 * Reuse path (M5B.1): sign an already-stored PDF ONLY when its recorded
 * `storedPath` is exactly the expected DB-derived path — a short-lived signed
 * URL, or null (mock, not stored, or path mismatch → the route regenerates
 * through the trusted server path). Signing runs on the trusted service
 * client; the route has already verified order access.
 */
export async function signStoredDocument(input: {
  orderId: string;
  type: DocumentType;
  documentId: string;
  locale: Locale;
  storedPath: string | null;
  filename: string;
}): Promise<string | null> {
  if (getDataMode() !== "supabase") return null;
  return (await import("./document-storage")).sbSignStoredDocument({
    orderId: input.orderId,
    dbType: DOCUMENT_TYPE_TO_DB[input.type],
    documentId: input.documentId,
    locale: input.locale,
    storedPath: input.storedPath,
    filename: input.filename,
  });
}

/**
 * Upload the freshly-rendered PDF to private storage, record its metadata,
 * and return a short-lived signed URL. Null in mock mode (no storage) or on
 * failure — the route then streams the bytes it already has.
 */
export async function storeDocumentPdf(input: {
  orderId: string;
  type: DocumentType;
  documentId: string;
  locale: Locale;
  filename: string;
  bytes: Uint8Array;
  checksum: string;
}): Promise<string | null> {
  if (getDataMode() !== "supabase") return null;
  return (await import("./document-storage")).sbStoreDocument({
    orderId: input.orderId,
    dbType: DOCUMENT_TYPE_TO_DB[input.type],
    documentId: input.documentId,
    locale: input.locale,
    filename: input.filename,
    bytes: input.bytes,
    checksum: input.checksum,
  });
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Mock source — matches the demo checkout math (subtotal excl. VAT, VAT as
 * an 18% estimate). Persists nothing; the route generates a PDF on demand
 * and records no DB row in mock mode.
 */
function mockOrderDocumentSource(
  orderId: string,
): OrderDocumentSource | undefined {
  const order = orderById.get(orderId);
  if (!order) return undefined;
  const customer = customerById.get(order.customerId);

  const items = order.items.flatMap((item) => {
    const product = productById.get(item.productId);
    if (!product) return [];
    const name: LocalizedText = {
      ar: product.translations.ar.name,
      he: product.translations.he.name,
      en: product.translations.en.name,
    };
    return [
      {
        name,
        packageUnit: product.packageType,
        packageQuantity: product.unitsPerPackage,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        lineTotal: round2(item.quantity * item.unitPrice),
      },
    ];
  });

  const subtotal = round2(items.reduce((sum, i) => sum + i.lineTotal, 0));
  const vatTotal = round2(subtotal * VAT_RATE);
  const total = round2(subtotal + vatTotal);

  return {
    supplier,
    orderNumber: order.number,
    orderDate: order.createdAt,
    notes: order.notes,
    customer: customer
      ? {
          name: customer.name,
          city: customer.city,
          phone: customer.phone,
          contactName: customer.contactName,
        }
      : null,
    items,
    totals: { subtotal, vatTotal, total, currency: "ILS" },
  };
}
