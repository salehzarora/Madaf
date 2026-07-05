/**
 * Madaf domain model (M0 — mock phase).
 *
 * These types are the contract the future backend agent maps onto real
 * tables (see docs/FUTURE_BACKEND_HANDOFF.md). Keep them boring and
 * serializable — no classes, no Date objects, ISO strings only.
 */
import type { Locale } from "@/i18n/config";

export type { Locale };

/** A string in all three UI languages. */
export type LocalizedText = Record<Locale, string>;

/** The supplier operating this catalog (single-tenant in the mock phase). */
export interface Supplier {
  id: string;
  /** Display/brand name. */
  name: LocalizedText;
  /** Legal name used on documents. */
  legalName: string;
  /** Company registration number (ח.פ). Mock value in this phase. */
  companyId: string;
  phone: string;
  address: LocalizedText;
}

export interface Category {
  id: string;
  name: LocalizedText;
  /** Small pictogram used on chips and placeholder images. */
  icon: string;
  /** Base hue (0-360) for generated product placeholder gradients. */
  hue: number;
}

export interface Manufacturer {
  id: string;
  name: LocalizedText;
}

export type PackageType = "carton" | "pack" | "unit";

export type BaseUnit =
  | "bottles"
  | "cans"
  | "packs"
  | "units"
  | "bags"
  | "jars"
  | "bars"
  | "rolls"
  | "tubs";

export type Availability = "inStock" | "lowStock" | "outOfStock";

export interface ProductTranslation {
  name: string;
  description?: string;
}

export interface Product {
  id: string;
  sku: string;
  translations: Record<Locale, ProductTranslation>;
  categoryId: string;
  manufacturerId: string;
  /** How the product is sold wholesale: carton / pack / single unit. */
  packageType: PackageType;
  /** Sellable units inside one package (24 bottles, 12 cans…). */
  unitsPerPackage: number;
  baseUnit: BaseUnit;
  /** Consumer-facing size of one unit, e.g. "330ml", "70g". */
  unitSize?: string;
  /** Price of ONE package in ILS, excluding VAT. */
  wholesalePrice: number;
  availability: Availability;
  /** Dairy & short-shelf-life goods get expiry tracking in inventory. */
  trackExpiry?: boolean;
}

export type CustomerType = "grocery" | "kiosk" | "supermarket" | "minimarket";

/** A shop the supplier sells to. */
export interface Customer {
  id: string;
  /** Shop names are proper nouns — shown as-is in every locale. */
  name: string;
  type: CustomerType;
  city: LocalizedText;
  phone: string;
  contactName: string;
}

export interface InventoryItem {
  productId: string;
  /** Stock counted in whole packages. */
  stockPackages: number;
  /** Warehouse shelf location, e.g. "A-03". */
  location: string;
  /** Nearest expiry date (ISO) — only for trackExpiry products. */
  nearestExpiry?: string;
}

export interface CartItem {
  productId: string;
  /** Quantity in packages. */
  quantity: number;
}

export type OrderStatus =
  | "new"
  | "confirmed"
  | "preparing"
  | "delivered"
  | "cancelled";

export const ORDER_STATUSES: OrderStatus[] = [
  "new",
  "confirmed",
  "preparing",
  "delivered",
  "cancelled",
];

/**
 * Valid pipeline transitions (M3A). Enforced by the update_order_status
 * DB function; mirrored here so the UI can disable impossible steps.
 * delivered/cancelled are terminal.
 */
export const ORDER_STATUS_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  new: ["confirmed", "cancelled"],
  confirmed: ["preparing", "cancelled"],
  preparing: ["delivered", "cancelled"],
  delivered: [],
  cancelled: [],
};

export interface OrderItem {
  productId: string;
  /** Quantity in packages. */
  quantity: number;
  /** Package price (ILS, excl. VAT) captured at order time. */
  unitPrice: number;
}

export interface Order {
  id: string;
  /** Human-facing number, e.g. "MDF-1042". */
  number: string;
  customerId: string;
  items: OrderItem[];
  status: OrderStatus;
  /** ISO date-time the order request was placed. */
  createdAt: string;
  notes?: string;
}

export type DocumentType = "order" | "delivery" | "invoiceDraft";

/**
 * A previewable document derived from an order.
 * IMPORTANT (legal): "invoiceDraft" is a draft preview only — never a legal
 * tax invoice in this phase. See docs/DOCUMENTS_AND_INVOICES_GUIDE.md.
 */
export interface OrderDocument {
  id: string;
  type: DocumentType;
  orderId: string;
  /** Document number, e.g. "DOC-1042-D". */
  number: string;
  /** ISO date the document was generated. */
  date: string;
}

/** Israeli VAT rate used for ESTIMATES on drafts (18% since 2025). */
export const VAT_RATE = 0.18;
