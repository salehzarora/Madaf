/**
 * Shared, PURE parser/normalizer for the admin Orders list URL state (M8F.1).
 *
 * The URL is the single source of truth for search, filters, and page. This
 * module is the ONE place that reads/normalizes those params and serializes
 * them back, so the page (SSR), the pagination/filter links, and the CSV export
 * all agree on the exact semantics. No `window`, no env, no server-only imports
 * — it runs on the server (page) and the client (links/export) and is unit
 * tested directly.
 *
 * Param names (existing dashboard/deep-link params are preserved):
 *   q        free-text search (order_number, public_ref, customer/guest
 *            name+phone). Trimmed, capped.
 *   status   comma-separated OrderStatus group (e.g. confirmed,preparing).
 *   source   facet: all|sales_visit|shop_link|guest.
 *   guest    legacy alias: guest=true ⇒ source facet "guest" (dashboard card).
 *   customer a specific customer id to scope to.
 *   from,to  inclusive calendar-date range (YYYY-MM-DD) on created_at.
 *   page     1-based page number.
 */
import {
  ORDER_STATUSES,
  type OrderCustomerSnapshot,
  type OrderStatus,
} from "@/lib/types";

/** Default rows per page — mirrors the customers/movements convention (50). */
export const ORDERS_PAGE_SIZE = 50;
/** Hard upper bound so a crafted ?pageSize can never request an unbounded list. */
export const ORDERS_MAX_PAGE_SIZE = 100;
/** Defensive filtered-export ceiling (unchanged from the old client export). */
export const ORDERS_EXPORT_CAP = 5000;
/** Free-text term cap (mirrors the customers search .slice(0, 120)). */
export const ORDERS_SEARCH_MAX = 120;
/** Absurd-offset guard: page can never exceed this (avoids a giant range()). */
const ORDERS_MAX_PAGE = 1_000_000;

export type OrderSourceFacet = "all" | "sales_visit" | "shop_link" | "guest";
export const ORDER_SOURCE_FACETS: readonly OrderSourceFacet[] = [
  "all",
  "sales_visit",
  "shop_link",
  "guest",
];
export function isOrderSourceFacet(v: unknown): v is OrderSourceFacet {
  return typeof v === "string" && (ORDER_SOURCE_FACETS as readonly string[]).includes(v);
}

/** Normalized Orders list query state (the parsed URL). */
export interface OrdersQuery {
  /** Trimmed, length-capped free-text term; "" = no search. */
  search: string;
  /** Selected status group; [] = all statuses. */
  statuses: OrderStatus[];
  /** Source facet; "all" = no source filter. */
  source: OrderSourceFacet;
  /** Specific customer scope, or null. */
  customerId: string | null;
  /** Inclusive lower date bound (YYYY-MM-DD) or null. */
  dateFrom: string | null;
  /** Inclusive upper date bound (YYYY-MM-DD) or null. */
  dateTo: string | null;
  /** 1-based page. */
  page: number;
  /** Bounded rows per page. */
  pageSize: number;
}

type RawParams = Record<string, string | string[] | undefined>;

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/** A plausible internal id (mirrors isPlausibleId used across the actions). */
function isPlausibleId(value: string): boolean {
  return value.length > 0 && value.length <= 64 && /^[A-Za-z0-9-]+$/.test(value);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function normalizeDate(value: string | undefined): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (!DATE_RE.test(v)) return null;
  // Reject impossible calendar dates (e.g. 2026-13-40) — Date.parse would NaN.
  return Number.isNaN(Date.parse(`${v}T00:00:00`)) ? null : v;
}

function normalizeStatuses(value: string | undefined): OrderStatus[] {
  if (typeof value !== "string" || value.trim() === "") return [];
  const seen = new Set<OrderStatus>();
  for (const part of value.split(",")) {
    const s = part.trim();
    if ((ORDER_STATUSES as string[]).includes(s)) seen.add(s as OrderStatus);
  }
  return [...seen];
}

function clampInt(value: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number.parseInt((value ?? "").trim(), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * Parse + normalize raw URL search params into a safe OrdersQuery. Never throws;
 * every invalid/absent value falls back to a safe default (no filter / page 1).
 */
export function parseOrdersQuery(raw: RawParams): OrdersQuery {
  const search = (first(raw.q) ?? "").trim().slice(0, ORDERS_SEARCH_MAX);
  const statuses = normalizeStatuses(first(raw.status));

  // Source facet: the legacy ?guest=true alias wins; else a whitelisted ?source.
  const rawSource = first(raw.source);
  const source: OrderSourceFacet =
    first(raw.guest) === "true"
      ? "guest"
      : isOrderSourceFacet(rawSource)
        ? rawSource
        : "all";

  const rawCustomer = (first(raw.customer) ?? "").trim();
  const customerId = rawCustomer && isPlausibleId(rawCustomer) ? rawCustomer : null;

  const dateFrom = normalizeDate(first(raw.from));
  const dateTo = normalizeDate(first(raw.to));

  const page = clampInt(first(raw.page), 1, 1, ORDERS_MAX_PAGE);
  const pageSize = clampInt(
    first(raw.pageSize),
    ORDERS_PAGE_SIZE,
    1,
    ORDERS_MAX_PAGE_SIZE,
  );

  return { search, statuses, source, customerId, dateFrom, dateTo, page, pageSize };
}

/** True when any filter (not pagination) narrows the list. */
export function hasActiveFilters(q: OrdersQuery): boolean {
  return (
    q.search !== "" ||
    q.statuses.length > 0 ||
    q.source !== "all" ||
    q.customerId !== null ||
    q.dateFrom !== null ||
    q.dateTo !== null
  );
}

/**
 * Serialize an OrdersQuery to URLSearchParams, OMITTING defaults (empty search,
 * all statuses, "all" source, no customer/dates, page 1). `patch` overrides
 * fields — pass `{ page: 1, ... }` (or omit page, which defaults to the query's)
 * when CHANGING a filter so the page resets. The canonical source form is
 * `source=<facet>` (the legacy `guest=true` alias is only READ, never written).
 */
export function ordersQueryToParams(
  q: OrdersQuery,
  patch: Partial<OrdersQuery> = {},
): URLSearchParams {
  const merged: OrdersQuery = { ...q, ...patch };
  const params = new URLSearchParams();
  if (merged.search) params.set("q", merged.search);
  if (merged.statuses.length > 0) params.set("status", merged.statuses.join(","));
  if (merged.source !== "all") params.set("source", merged.source);
  if (merged.customerId) params.set("customer", merged.customerId);
  if (merged.dateFrom) params.set("from", merged.dateFrom);
  if (merged.dateTo) params.set("to", merged.dateTo);
  if (merged.page > 1) params.set("page", String(merged.page));
  if (merged.pageSize !== ORDERS_PAGE_SIZE) {
    params.set("pageSize", String(merged.pageSize));
  }
  return params;
}

/**
 * Build a filter CHANGE query: applies the patch AND resets to page 1 (any
 * search/filter change restarts pagination). Use this for filter controls; use
 * `ordersQueryToParams(q, { page })` for pagination links (which keep filters).
 */
export function withFilterChange(
  q: OrdersQuery,
  patch: Partial<OrdersQuery>,
): OrdersQuery {
  return { ...q, ...patch, page: 1 };
}

/** total pages for a filtered count (always >= 1 so "page 1 of 1" reads right). */
export function totalPagesFor(total: number, pageSize: number): number {
  if (total <= 0) return 1;
  return Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
}

/**
 * A LEAN order row for the admin list + CSV export — resolved server-side so the
 * client never loads the full order collection or the full customer list. Only
 * the fields the table/export need (no items array; itemCount + subtotal are
 * precomputed). The internal `number` is admin-only (never a customer surface).
 */
export interface OrderListRow {
  id: string;
  /** Internal sequential order number (admin/warehouse only). */
  number: string;
  /** Customer-facing random reference. */
  publicRef: string | null;
  status: OrderStatus;
  /** DB source: sales_visit | remote_customer | admin (mock may omit). */
  source?: "sales_visit" | "remote_customer" | "admin";
  createdAt: string;
  /** Linked customer id ("" when guest/unlinked). */
  customerId: string;
  /** Live linked-customer display name (null for guest/unlinked). */
  customerName: string | null;
  /** Live linked-customer phone (null for guest/unlinked). */
  customerPhone: string | null;
  /** Guest/point-in-time buyer snapshot (name/phone/guest). */
  customerSnapshot?: OrderCustomerSnapshot;
  /** Number of order lines. */
  itemCount: number;
  /** Ex-VAT subtotal (ILS) — stored column in supabase, computed in mock. */
  subtotalAmount: number;
}

/** Paginated Orders list result — current-page rows + the exact filtered total. */
export interface OrdersListResult {
  rows: OrderListRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/**
 * Classify an order into a UI source FACET — the single source of truth mirrored
 * by the mock filter, the table's guest badge, and the export's source column.
 * Matches the supabase-side predicates: guest ⇔ remote + no linked customer;
 * shop_link ⇔ remote + linked customer; else sales_visit.
 */
export function orderSourceFacet(row: {
  source?: string;
  customerId: string;
  customerSnapshot?: { guest?: boolean };
}): Exclude<OrderSourceFacet, "all"> {
  if (row.customerSnapshot?.guest && !row.customerId) return "guest";
  if (row.source === "remote_customer") return "shop_link";
  return "sales_visit";
}

/**
 * Toggle a status in the filter and reset to page 1 — COMPOSING against the
 * passed query. The Orders table calls this with the LATEST intended query
 * (its optimistic state), so two quick toggles both land instead of the second
 * overwriting the first off a stale prop.
 */
export function toggleStatusFilter(q: OrdersQuery, status: OrderStatus): OrdersQuery {
  const next = new Set(q.statuses);
  if (next.has(status)) next.delete(status);
  else next.add(status);
  return withFilterChange(q, { statuses: [...next] });
}

/**
 * Does an order row match a free-text term? Mirrors the supabase `.or()` search
 * EXACTLY: internal order_number, customer-facing public_ref, and the buyer
 * name/phone RECORDED ON THE ORDER (customer_snapshot — populated for every
 * order at creation). Point-in-time by design; used by the mock data layer and
 * the tests so mock and supabase agree.
 */
export function orderMatchesSearch(
  row: {
    number: string;
    publicRef: string | null;
    customerSnapshot?: { name?: string; phone?: string };
  },
  term: string,
): boolean {
  const q = term.trim().toLowerCase();
  if (!q) return true;
  return [
    row.number,
    row.publicRef ?? "",
    row.customerSnapshot?.name ?? "",
    row.customerSnapshot?.phone ?? "",
  ]
    .join(" ")
    .toLowerCase()
    .includes(q);
}

// ── Tenant-timezone date bounds (M8F.1 → per-tenant in M8H.2) ──────────────
// A date the operator picks means a calendar day IN THE TENANT'S TIMEZONE, so
// "from 2026-07-05" covers the WHOLE of July 5 there — not UTC (which would clip
// the first local hours and hide orders the admin sees dated that day). URL values
// stay stable YYYY-MM-DD; the list, the exact count and the export all resolve
// their UTC bounds through ONE builder so they can never disagree.
//
// Only the CLIENT-SAFE pieces are re-exported here (this module is imported by the
// Orders table). The reverse conversion — calendar date → the UTC instant it BEGINS
// at — is server-only and lives in `@/lib/tenant-day`: local 00:00 does not exist
// in every zone on every date, so it needs a real timezone primitive, not offset
// math. M8F.1's single-pass offset arithmetic was an hour off on DST-transition
// days; a two-pass version was still wrong for zones that spring forward AT
// midnight. Both are gone.
export { nextCalendarDay, tenantToday } from "@/lib/time";
