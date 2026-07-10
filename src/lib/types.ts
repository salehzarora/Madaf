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
  /** Optional brand logo (tenant-scoped). Shown as an avatar on chips. */
  logoUrl?: string;
}

export const PACKAGE_UNITS = ["carton", "pack", "unit"] as const;
export type PackageType = (typeof PACKAGE_UNITS)[number];

export const BASE_UNITS = [
  "bottles",
  "cans",
  "packs",
  "units",
  "bags",
  "jars",
  "bars",
  "rolls",
  "tubs",
] as const;
export type BaseUnit = (typeof BASE_UNITS)[number];

export type Availability = "inStock" | "lowStock" | "outOfStock";

export interface ProductTranslation {
  name: string;
  description?: string;
}

export interface Product {
  id: string;
  sku: string;
  /** EAN/UPC barcode — admin-entered, optional (M8A: carried on the domain
   * type so the edit form can prefill it; it was silently wiped before). */
  barcode?: string;
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
  /**
   * Real product photo for DISPLAY — an external URL or a short-lived
   * signed Storage URL. Absent → gradient placeholder.
   */
  imageUrl?: string;
  /**
   * The RAW stored image reference (a Storage object path) when the image
   * lives in the bucket — persist THIS on edit, never the signed
   * `imageUrl` (which expires). Undefined for external image URLs.
   */
  imageStoragePath?: string;
  /** VAT rate for estimates (0.18 default). Present on DB-backed products. */
  vatRate?: number;
  /** Whether the product is sellable/visible in the catalog (DB-backed). */
  isActive?: boolean;
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
  /** Street address (optional; supabase surfaces it, mock may omit). */
  address?: string;
  /** Internal supplier note about the shop (optional; not shown to customers). */
  notes?: string;
}

export interface InventoryItem {
  productId: string;
  /** Stock counted in whole packages. */
  stockPackages: number;
  /** Warehouse shelf location, e.g. "A-03". */
  location: string;
  /** Nearest expiry date (ISO) — only for trackExpiry products. */
  nearestExpiry?: string;
  /**
   * Per-row low-stock threshold (DB-backed). Mock uses the global
   * LOW_STOCK_THRESHOLD constant, so this is absent in mock mode.
   */
  lowStockThreshold?: number;
}

/**
 * Machine reasons on the stock-movement ledger (DB
 * `order_inventory_movements.reason`). Order-driven reasons come from the
 * M7H/M7I lifecycle; `manual_*` reasons come from adjust_inventory_stock
 * (M8B). The UI maps known reasons to labels and falls back to the raw
 * string for anything unknown.
 */
export const INVENTORY_MOVEMENT_REASONS = [
  "order_reserved",
  "order_reservation_released",
  "order_edit_adjustment",
  "order_delivered", // legacy M7H rows (pre-reservation lifecycle)
  "manual_stock_count",
  "manual_damaged_goods",
  "manual_returned_goods",
  "manual_supplier_delivery",
  "manual_correction",
  "manual_other",
] as const;
export type InventoryMovementReason =
  (typeof INVENTORY_MOVEMENT_REASONS)[number];

/** One append-only stock-movement ledger row (M8B admin history view). */
export interface InventoryMovement {
  id: string;
  productId: string | null;
  /** NULL for manual adjustments (no order). */
  orderId: string | null;
  /** Packages; negative = deducted, positive = returned/added. */
  quantityDelta: number;
  /** Machine reason — usually an InventoryMovementReason. */
  reason: string;
  /** Free-text note (manual adjustments only). */
  note?: string;
  createdAt: string;
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

/**
 * Free-form buyer snapshot (DB `orders.customer_snapshot`). Present for GUEST
 * showcase orders (M7I) — the order has NO linked customer (`customerId` is
 * empty) and `guest` is true. Sales-visit / shop orders leave this undefined
 * (their customer is a real row). Never a pricing/authorization source.
 */
export interface OrderCustomerSnapshot {
  name?: string;
  contactName?: string;
  phone?: string;
  email?: string;
  address?: string;
  city?: { ar?: string; he?: string; en?: string };
  guest?: boolean;
}

export interface Order {
  id: string;
  /** Internal sequential number, e.g. "MDF-1042" — admin/warehouse only. */
  number: string;
  /**
   * Customer-facing random reference, e.g. "MDF-A7K2P9QX" (M7E). Non-sequential
   * so it never leaks order volume. Shown to customers instead of `number`;
   * optional (supabase mode always sets it; mock orders may omit it).
   */
  publicRef?: string;
  customerId: string;
  /** M7I — guest store details when `customerId` is empty (guest showcase order). */
  customerSnapshot?: OrderCustomerSnapshot;
  items: OrderItem[];
  status: OrderStatus;
  /** ISO date-time the order request was placed. */
  createdAt: string;
  notes?: string;
}

export type DocumentType = "order" | "delivery" | "invoiceDraft";

/**
 * Document lifecycle status (DB `document_status`). invoice_draft can NEVER
 * be "generated" in this phase (a DB CHECK forbids it) — it stays "draft".
 */
export type DocumentStatus = "draft" | "generated" | "voided";

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
  /** ISO date the document row was created. */
  date: string;
  /** Lifecycle status (DB-backed). Absent in mock mode. */
  status?: DocumentStatus;
  /** ISO time the stored PDF was last generated (M5B). Absent until stored. */
  generatedAt?: string;
}

/** Israeli VAT rate used for ESTIMATES on drafts (18% since 2025). */
export const VAT_RATE = 0.18;
