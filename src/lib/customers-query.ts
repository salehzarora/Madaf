/**
 * Shared, PURE parser/serializer for the admin Customers list URL state.
 *
 * The URL is the single source of truth for the customers search + facets
 * (lifecycle, private-link, and — M8G.1 — acquisition origin). This is the ONE
 * place that reads/normalizes those params and serializes them back, so the
 * page (SSR seed), the filter controls, and shared/deep links all agree on the
 * exact semantics. No `window`, no env, no server-only imports — it runs on the
 * server (page) and the client (filter controls) and is unit tested directly.
 *
 * The list pages with a client "load more" (offset is ephemeral, never in the
 * URL), so there is no page param: any filter CHANGE navigates to a URL without
 * pagination and the server re-renders from the first page — i.e. changing a
 * filter always resets the load state.
 *
 * Param names (existing customers deep-link params are preserved):
 *   q       free-text search (name / contact / phone / address / city). Capped.
 *   status  lifecycle facet: active | inactive (omitted = all).
 *   link    private-link facet: has | none (omitted = all; Supabase-only).
 *   origin  acquisition-origin facet (M8G.1): one of CUSTOMER_ORIGINS
 *           (omitted = all).
 */
import {
  isCustomerOrigin,
  type CustomerOrigin,
  type CustomerQuery,
} from "@/lib/types";

/** Free-text term cap (mirrors the existing customers search .slice(0, 120)). */
export const CUSTOMERS_SEARCH_MAX = 120;

export type CustomerStatusFacet = "all" | "active" | "inactive";
export type CustomerLinkFacet = "all" | "has" | "none";
/** Origin facet is "all" (no filter) or one concrete origin. */
export type CustomerOriginFacet = "all" | CustomerOrigin;

/** Normalized Customers list query state (the parsed URL). */
export interface CustomersQuery {
  /** Trimmed, length-capped free-text term; "" = no search. */
  search: string;
  /** Lifecycle facet; "all" = no filter. */
  status: CustomerStatusFacet;
  /** Private-link facet; "all" = no filter. */
  link: CustomerLinkFacet;
  /** Acquisition-origin facet; "all" = no filter. */
  origin: CustomerOriginFacet;
}

type RawParams = Record<string, string | string[] | undefined>;

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function normalizeStatus(value: string | undefined): CustomerStatusFacet {
  return value === "active" || value === "inactive" ? value : "all";
}

function normalizeLink(value: string | undefined): CustomerLinkFacet {
  return value === "has" || value === "none" ? value : "all";
}

/** Invalid/unknown origin values normalize safely to "all" (no filter). */
function normalizeOrigin(value: string | undefined): CustomerOriginFacet {
  return isCustomerOrigin(value) ? value : "all";
}

/**
 * Parse + normalize raw URL search params into a safe CustomersQuery. Never
 * throws; every invalid/absent value falls back to a safe default (no filter).
 */
export function parseCustomersQuery(raw: RawParams): CustomersQuery {
  return {
    search: (first(raw.q) ?? "").trim().slice(0, CUSTOMERS_SEARCH_MAX),
    status: normalizeStatus(first(raw.status)),
    link: normalizeLink(first(raw.link)),
    origin: normalizeOrigin(first(raw.origin)),
  };
}

/** True when any facet (not pagination) narrows the list. */
export function hasActiveFilters(q: CustomersQuery): boolean {
  return (
    q.search !== "" ||
    q.status !== "all" ||
    q.link !== "all" ||
    q.origin !== "all"
  );
}

/**
 * Serialize a CustomersQuery to URLSearchParams, OMITTING defaults (empty
 * search, "all" facets). `patch` overrides fields — pass the changed facet(s)
 * to build a filter-change URL. There is no page/offset param, so the result
 * always starts from the first page (load state resets on navigation).
 */
export function customersQueryToParams(
  q: CustomersQuery,
  patch: Partial<CustomersQuery> = {},
): URLSearchParams {
  const merged: CustomersQuery = { ...q, ...patch };
  const params = new URLSearchParams();
  if (merged.search) params.set("q", merged.search);
  if (merged.status !== "all") params.set("status", merged.status);
  if (merged.link !== "all") params.set("link", merged.link);
  if (merged.origin !== "all") params.set("origin", merged.origin);
  return params;
}

/**
 * Build a filter CHANGE query: applies the patch, COMPOSING against the passed
 * query so unrelated facets are preserved. (No page field to reset — the list
 * has no URL pagination; a changed filter re-renders from the first page.)
 */
export function withFilterChange(
  q: CustomersQuery,
  patch: Partial<CustomersQuery>,
): CustomersQuery {
  return { ...q, ...patch };
}

/**
 * Convert the normalized URL state into the data-layer CustomerQuery contract
 * (omitted facets = no filter). This is the single mapping used by the page and
 * the search action, so Mock and Supabase see identical filter intent.
 */
export function toCustomerQuery(q: CustomersQuery): CustomerQuery {
  const query: CustomerQuery = {};
  const term = q.search.trim();
  if (term) query.q = term;
  if (q.status !== "all") query.status = q.status;
  if (q.link !== "all") query.hasLink = q.link === "has";
  if (q.origin !== "all") query.origin = q.origin;
  return query;
}
