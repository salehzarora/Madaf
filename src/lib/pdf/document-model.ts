/**
 * Shared, dependency-free model for M5A document PDFs.
 *
 * This module holds ONLY types + tiny maps so both the data layer (which
 * builds the source) and the server-only renderer (which draws the PDF) can
 * import it without pulling pdfkit into a client bundle. No "server-only"
 * marker here on purpose — server components import the type map for UI.
 */
import type {
  DocumentType,
  LocalizedText,
  PackageType,
  Supplier,
} from "@/lib/types";

/** The three SAFE document types (order request, delivery note, DRAFT invoice). */
export const DOCUMENT_TYPES: readonly DocumentType[] = [
  "order",
  "delivery",
  "invoiceDraft",
] as const;

/** App DocumentType → DB document_type enum (order_request/…/invoice_draft). */
export const DOCUMENT_TYPE_TO_DB: Record<
  DocumentType,
  "order_request" | "delivery_note" | "invoice_draft"
> = {
  order: "order_request",
  delivery: "delivery_note",
  invoiceDraft: "invoice_draft",
};

/** Narrows an arbitrary string to a supported DocumentType (route allowlist). */
export function isDocumentType(value: string): value is DocumentType {
  return (DOCUMENT_TYPES as readonly string[]).includes(value);
}

/** Buyer identity captured from the order (customer_snapshot), never live. */
export interface DocumentCustomer {
  name: string;
  city: LocalizedText;
  phone: string;
  contactName: string;
}

/** One rendered line — sourced from order_items SNAPSHOTS, not live catalog. */
export interface DocumentLineItem {
  name: LocalizedText;
  packageUnit: PackageType;
  packageQuantity: number;
  /** Quantity in packages. */
  quantity: number;
  /** Package price (ILS, excl. VAT) captured at order time. */
  unitPrice: number;
  /** quantity × unitPrice (ILS, excl. VAT). */
  lineTotal: number;
}

/**
 * Everything the renderer needs, assembled server-side from order snapshots
 * (never from client input). Totals come from the order row, not recomputed
 * from the caller.
 */
export interface OrderDocumentSource {
  supplier: Supplier;
  orderNumber: string;
  /** ISO date the order was placed. */
  orderDate: string;
  notes?: string;
  customer: DocumentCustomer | null;
  items: DocumentLineItem[];
  totals: {
    subtotal: number;
    vatTotal: number;
    total: number;
    currency: string;
  };
}
