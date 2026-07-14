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
  /** Business contact email (M8E.4). Optional; blank when unset. */
  email?: string;
  /** Business logo for display — an external http(s) URL or a short-lived
   * signed Storage URL (M8E.4). Absent → the app LogoMark is used. */
  logoUrl?: string;
  /** RAW stored logo reference (Storage object path) when the logo lives in
   * the private bucket — persist THIS on edit, never the signed `logoUrl`. */
  logoStoragePath?: string;
  /** Default VAT rate for INTERNAL/DRAFT display only (fraction in [0,1)).
   * NON-LEGAL estimate input (M8E.4); falls back to VAT_RATE when unset. */
  displayVatRate?: number;
  /**
   * M8H.2 — the tenant's IANA timezone (e.g. `Asia/Jerusalem`). ALL business
   * times are displayed in it, and operator-picked calendar dates are resolved
   * against it. Never a fixed UTC offset (an offset cannot express DST).
   */
  timezone: string;
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
  /** Optional brand logo (tenant-scoped). An external http(s) URL or a
   * short-lived signed Storage URL. Shown as an avatar on chips. */
  logoUrl?: string;
  /** The RAW stored logo reference (a Storage object path) when the logo lives
   * in the private bucket — persist THIS on edit, never the signed `logoUrl`
   * (which expires). Undefined for external logo URLs (M8E.3). */
  logoStoragePath?: string;
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

/**
 * M8G.1 — immutable acquisition origin: HOW a customer first entered Madaf.
 * Closed vocabulary, one precise definition each, set once by the DB create
 * path and never rewritten by edits/lifecycle/orders. NOT the recent order
 * source, a preferred channel, the last editor, or a marketing label.
 *   manual           — owner/admin created it directly (create_customer)
 *   signup           — a self-signup / "join" request was approved
 *   guest_conversion — a guest showcase order was promoted to a customer
 *   legacy_unknown   — origin not reliably determinable (historical/seed rows)
 */
export const CUSTOMER_ORIGINS = [
  "manual",
  "signup",
  "guest_conversion",
  "legacy_unknown",
] as const;
export type CustomerOrigin = (typeof CUSTOMER_ORIGINS)[number];

export function isCustomerOrigin(value: unknown): value is CustomerOrigin {
  return (
    typeof value === "string" &&
    (CUSTOMER_ORIGINS as readonly string[]).includes(value)
  );
}

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
  /** M8C lifecycle — false blocks the store's private links + new links.
   * Optional: mock rows omit it (implicitly active). */
  isActive?: boolean;
  /** M8G.1 immutable acquisition origin. DB-backed (NOT NULL); mock rows set it
   * explicitly. Absent only on legacy in-memory rows → treated as
   * legacy_unknown by the UI. */
  origin?: CustomerOrigin;
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

/** Date-range presets for the movements ledger (M8C → tenant-local in M8H.2). */
export const MOVEMENT_DATE_PRESETS = [
  "all",
  "today",
  "7d",
  "month",
  "custom",
] as const;
export type MovementDatePreset = (typeof MOVEMENT_DATE_PRESETS)[number];

/**
 * Server-side movement-search filters (M8D; tenant-local dates in M8H.2). All
 * optional; omitted = no filter. `productIds` is resolved from the search term
 * client-side.
 *
 * The date filter is expressed as a PRESET plus (for "custom") tenant-local
 * CALENDAR DATES — never as UTC instants. The browser used to compute the
 * instants itself off its own clock, which made "today" mean today *for the
 * viewer's device*; the server now resolves both the preset and the calendar
 * dates in the TENANT's timezone. The client cannot supply an instant at all.
 */
export interface MovementQuery {
  /** Inclusive lower bound — a CONCRETE tenant-local calendar date (YYYY-MM-DD),
   * already resolved and anchored by the Server Action. Never a preset, never an
   * instant, so the same range can be re-queried for page 2 and for the export. */
  dateFrom?: string;
  /** INCLUSIVE upper bound as a tenant-local YYYY-MM-DD (the whole local day is
   * covered via a next-day-start EXCLUSIVE instant). */
  dateTo?: string;
  reason?: string;
  direction?: "in" | "out" | "manual";
  /** undefined = no product filter; [] = matched nothing → zero rows. */
  productIds?: string[];
}

/** Server-side customer-list filters (M8E.2). All optional; omitted = no
 * filter. Search runs across name / contact / phone / address / city. */
export interface CustomerQuery {
  /** Free-text term matched (ILIKE) across name, contact, phone, address, city. */
  q?: string;
  /** Lifecycle facet; omitted = all. */
  status?: "active" | "inactive";
  /** true = only stores with a live private link; false = only stores without
   * one; omitted = no link filter. (Supabase only — mock has no link data.) */
  hasLink?: boolean;
  /** M8G.1 acquisition-origin facet; omitted = all origins. */
  origin?: CustomerOrigin;
}

/** One append-only stock-movement ledger row (M8B admin history view). */
export interface InventoryMovement {
  id: string;
  productId: string | null;
  /** NULL for manual adjustments (no order). */
  orderId: string | null;
  /**
   * The referenced order's human number / public ref, HYDRATED from a targeted
   * lookup of only the orders referenced by the returned movements (Batch C) —
   * never a full Orders scan, so an order beyond the first PostgREST page still
   * resolves. `undefined` when there is no order, or the order is
   * inaccessible/missing under RLS (the UI shows "—").
   */
  orderNumber?: string;
  orderPublicRef?: string;
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
  /** How the order arrived: sales_visit (admin/rep flow), remote_customer
   * (tokenized shop link OR showcase guest), admin. Optional (mock omits). */
  source?: "sales_visit" | "remote_customer" | "admin";
  /** M7I — guest store details when `customerId` is empty (guest showcase order). */
  customerSnapshot?: OrderCustomerSnapshot;
  items: OrderItem[];
  status: OrderStatus;
  /** ISO date-time the order request was placed. */
  createdAt: string;
  notes?: string;
  /** Server-stored order totals (ILS, ex-VAT subtotal + VAT estimate + total),
   * frozen at order time (M8E.5). Present in supabase mode so the document
   * HTML preview shows the SAME totals the PDF renders from; mock orders omit
   * them (the preview recomputes with the tenant display VAT rate). */
  subtotal?: number;
  vatTotal?: number;
  total?: number;
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
