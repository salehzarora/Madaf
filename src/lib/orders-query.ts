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
import { parseDateOnlyStrict } from "@/lib/time";
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
/**
 * Per-request page size for the server-side CSV export. Deliberately BELOW the
 * PostgREST `max_rows` ceiling (1000 by default, and never assumed to be exactly
 * 1000) so no single request can be silently clamped — the batch LOOP, not one
 * giant `.range(0, cap)`, is what reaches the cap. This is the fix for the
 * silent-truncation defect where a single `.range(0, 5000)` returned only the
 * first `max_rows` rows while `capped` (which compared against 5000) never fired.
 */
export const ORDERS_EXPORT_BATCH = 500;

/** The internal, server-side export cursor: the (immutable) sort key of the last
 * row returned so far. `created_at` is set once at order creation and never
 * updated by any order RPC; `id` is the immutable uuid PK — so the cursor can
 * never point at a moved row. Carries nothing else (no tenant, no filter, no
 * secret); it is never client-supplied. */
export interface OrdersExportCursor {
  createdAt: string;
  id: string;
}

/** A row shape the keyset collector can derive its cursor from. */
export interface ExportCursorRow {
  id: string;
  created_at: string;
}

/**
 * Collect up to `cap` export rows with STABLE KEYSET pagination (not offset).
 *
 * Offset/range paging skipped rows under an ordinary concurrent filter change:
 * if a page-1 row leaves the active filter before page 2, every later row shifts
 * left, so `offset = 500` now points PAST a still-matching row, which the export
 * silently omitted. Keyset traversal fixes this: each page fetches rows strictly
 * OLDER than the last row already returned —
 *   created_at < cursor.created_at
 *   OR (created_at = cursor.created_at AND id < cursor.id)
 * ordered `created_at DESC, id DESC` — so removing an earlier row cannot move the
 * window; the next page always continues exactly after the last returned row.
 *
 * Termination is a SHORT or EMPTY page (the keyset naturally returns nothing past
 * the end — no over-range request, so no PostgREST 416/PGRST103 special case is
 * needed) or reaching `cap`; `maxPages` is a defensive backstop. Dedupe by id
 * remains as DEFENCE-IN-DEPTH only — with a unique (created_at, id) key a stable
 * keyset cannot re-emit a returned row — and it never drives progression: the
 * cursor always advances to the DB's actual last row, even if that row was a
 * duplicate, so a deduped row can never stall the traversal.
 *
 * PURE + INJECTABLE: the real Supabase export and its tests run this SAME
 * algorithm (tests pass a fake keyset page reader), so there is no test-only
 * duplicate of the cursor/cap logic.
 *
 * SNAPSHOT NOTE (honest): this is NOT a database snapshot. A row inserted ahead
 * of the current cursor after the export starts may or may not appear depending
 * on timing. What IS guaranteed: no row that remains in the traversed keyset
 * sequence is skipped merely because earlier rows were inserted or removed, and
 * no row is duplicated.
 */
export async function collectExportRows<T extends ExportCursorRow>(
  fetchPage: (
    cursor: OrdersExportCursor | null,
    limit: number,
  ) => Promise<readonly T[]>,
  cap: number,
  batchSize: number = ORDERS_EXPORT_BATCH,
): Promise<T[]> {
  const out: T[] = [];
  const seen = new Set<string>();
  const safeCap = Math.max(0, Math.trunc(cap));
  if (safeCap === 0) return out;
  const step = Math.max(1, Math.min(batchSize, ORDERS_EXPORT_BATCH));
  const maxPages = Math.ceil(safeCap / step) + 2;
  let cursor: OrdersExportCursor | null = null;
  for (let page = 0; page < maxPages && out.length < safeCap; page += 1) {
    const want = Math.min(step, safeCap - out.length);
    const rows = await fetchPage(cursor, want);
    if (rows.length === 0) break; // no rows past the cursor ⇒ exhausted
    for (const row of rows) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      out.push(row);
      if (out.length >= safeCap) break;
    }
    // Advance the cursor to the DB's ACTUAL last row of this page (keyset
    // progression), regardless of dedupe — traversal continues from where the
    // query left off, never from the last NEW row.
    const last = rows[rows.length - 1];
    cursor = { createdAt: last.created_at, id: last.id };
    if (rows.length < want) break; // short page ⇒ the filtered set is exhausted
  }
  return out;
}
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

/**
 * The three date-filter states an Orders URL can be in. `none` and `invalid` MUST
 * NOT look the same: collapsing an impossible date into "no dates supplied" is
 * precisely how `?from=2026-02-30` came to list — and export — EVERY order instead
 * of the one day the operator asked for. Invalid stays observable until the request
 * is refused or canonically redirected.
 */
export type OrdersDateFilterState = "none" | "valid" | "invalid";

/** Normalized Orders list query state (the parsed URL). */
export interface OrdersQuery {
  /**
   * `none`    — no date params supplied (the legitimate unfiltered state).
   * `valid`   — both supplied dates (or the one supplied date) are real.
   * `invalid` — at least one supplied date is impossible. NOTHING may be queried:
   *             not the list, not the exact count, not the export.
   */
  dateFilter: OrdersDateFilterState;
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

/**
 * A date param, or null. STRICT: `2026-02-30` is shaped like a date but is not one.
 *
 * The previous check was shape + `Date.parse(\`${v}T00:00:00\`)`, and `Date.parse`
 * accepts impossible days — so an URL carrying `from=2026-02-30` survived parsing
 * as if it were a real active filter, and the downstream converter then returned
 * null for it, quietly turning a bounded query into an unbounded one.
 */
function normalizeDate(value: string | undefined): string | null {
  return parseDateOnlyStrict(typeof value === "string" ? value.trim() : value);
}

/** `?from=` (a cleared date input) means ABSENT, not malformed. Anything else that
 * was actually typed and is not a real date is `invalid` and must fail closed. */
function emptyToUndefined(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  return value.trim() === "" ? undefined : value;
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

  // ── The date filter: none / valid / INVALID ──────────────────────────────
  // An impossible date makes the WHOLE supplied date filter invalid — one bad side
  // never leaves the valid half applied alone (a broken `from` beside a valid `to`
  // would silently mean "everything up to that day", WIDENING a bounded request).
  //
  // Crucially, invalid is NOT collapsed into "no dates". They are different states
  // and the callers must treat them differently: `none` queries happily; `invalid`
  // queries NOTHING. An empty string is treated as absent — the shape `?from=` is
  // how a cleared date input serializes, and it means "no filter", not "malformed".
  const rawFrom = emptyToUndefined(first(raw.from));
  const rawTo = emptyToUndefined(first(raw.to));
  const parsedFrom = normalizeDate(rawFrom);
  const parsedTo = normalizeDate(rawTo);
  const suppliedButBad =
    (rawFrom !== undefined && parsedFrom === null) ||
    (rawTo !== undefined && parsedTo === null);

  const dateFilter: OrdersDateFilterState = suppliedButBad
    ? "invalid"
    : rawFrom === undefined && rawTo === undefined
      ? "none"
      : "valid";
  // The bounds are carried ONLY in the `valid` state; in `invalid` they are null so
  // that any caller which ignores `dateFilter` still cannot build a half-range —
  // but it is `dateFilter` that must stop it querying at all.
  const dateFrom = dateFilter === "valid" ? parsedFrom : null;
  const dateTo = dateFilter === "valid" ? parsedTo : null;

  const page = clampInt(first(raw.page), 1, 1, ORDERS_MAX_PAGE);
  const pageSize = clampInt(
    first(raw.pageSize),
    ORDERS_PAGE_SIZE,
    1,
    ORDERS_MAX_PAGE_SIZE,
  );

  return {
    dateFilter,
    search,
    statuses,
    source,
    customerId,
    dateFrom,
    dateTo,
    page,
    pageSize,
  };
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
export { nextCalendarDay, parseDateOnlyStrict, tenantToday } from "@/lib/time";
