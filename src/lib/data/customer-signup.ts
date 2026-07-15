import "server-only";

/**
 * New-store SELF-SIGNUP data path (M7G) — SERVER ONLY.
 *
 * Owner/admin issue a tenant-scoped tokenized "join" link; a prospective
 * store opens it (no login, no catalog) and submits its details through an
 * anon SECURITY DEFINER RPC; the submission lands as a PENDING request the
 * owner/admin approves (→ a real customers row). Only token_hash is stored;
 * the raw token is generated in the action and returned once. Supabase-mode
 * only (mock has no auth/tenant).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";
import { createServerAuthClient } from "@/lib/supabase/server-auth";

import { getDataContext } from "@/lib/auth/session";

import { getProductImageStorageClient } from "./product-image-storage";
import { hashToken } from "./token";

export type SignupLinkStatus = "active" | "revoked" | "expired";

export interface SignupLink {
  id: string;
  label: string | null;
  tokenPreview: string | null;
  status: SignupLinkStatus;
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

export type SignupRequestStatus = "pending" | "approved" | "rejected";

export interface SignupRequest {
  id: string;
  name: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  city: { ar: string; he: string; en: string };
  address: string | null;
  notes: string | null;
  status: SignupRequestStatus;
  approvedCustomerId: string | null;
  createdAt: string;
}

function linkStatus(
  revokedAt: string | null,
  expiresAt: string | null,
): SignupLinkStatus {
  if (revokedAt) return "revoked";
  if (expiresAt && new Date(expiresAt).getTime() <= Date.now()) return "expired";
  return "active";
}

function requestStatus(
  approvedAt: string | null,
  rejectedAt: string | null,
): SignupRequestStatus {
  if (approvedAt) return "approved";
  if (rejectedAt) return "rejected";
  return "pending";
}

/**
 * GET-time liveness check for a /join/<token> link (M8A). Before this, a
 * dead (revoked/expired/unknown) link rendered the FULL signup form and the
 * visitor only learned after typing everything. Checked server-side by
 * token_hash on the trusted service client (anon has no table access).
 *
 * FAIL-OPEN by design: if the service client is unavailable (no key), we
 * render the form anyway — the submit RPC re-validates the token in-DB, so
 * this check is purely a UX gate, never the security boundary.
 */
export async function isSignupLinkAlive(rawToken: string): Promise<boolean> {
  try {
    const client = getProductImageStorageClient();
    const { data, error } = await client
      .from("customer_signup_links")
      .select("expires_at")
      .eq("token_hash", hashToken(rawToken))
      .is("revoked_at", null)
      .maybeSingle();
    if (error) return true; // fail-open (submit re-validates)
    if (!data) return false; // unknown or revoked
    return !data.expires_at || new Date(data.expires_at).getTime() > Date.now();
  } catch {
    return true; // no service key locally — fail-open
  }
}

// ── Owner/admin: create / revoke / list links ─────────────────────────────

export async function insertSignupLink(input: {
  tokenHash: string;
  tokenPreview?: string;
  label?: string;
  expiresAt?: string;
}): Promise<{ linkId: string }> {
  const { client, tenantId } = await getDataContext();
  const { data, error } = await client.rpc("insert_customer_signup_link", {
    p_tenant_id: tenantId,
    p_token_hash: input.tokenHash,
    ...(input.tokenPreview ? { p_token_preview: input.tokenPreview } : {}),
    ...(input.label ? { p_label: input.label } : {}),
    ...(input.expiresAt ? { p_expires_at: input.expiresAt } : {}),
  });
  if (error) throw new Error(`[madaf/data] insertSignupLink: ${error.message}`);
  return { linkId: data as string };
}

export async function revokeSignupLink(linkId: string): Promise<void> {
  const { client, tenantId } = await getDataContext();
  const { error } = await client.rpc("revoke_customer_signup_link", {
    p_tenant_id: tenantId,
    p_link_id: linkId,
  });
  if (error) throw new Error(`[madaf/data] revokeSignupLink: ${error.message}`);
}

export async function listSignupLinks(): Promise<SignupLink[]> {
  const { client, tenantId } = await getDataContext();
  const { data, error } = await client
    .from("customer_signup_links")
    .select("id, label, token_preview, expires_at, revoked_at, last_used_at, created_at")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`[madaf/data] listSignupLinks: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: r.id,
    label: r.label,
    tokenPreview: r.token_preview,
    status: linkStatus(r.revoked_at, r.expires_at),
    expiresAt: r.expires_at,
    revokedAt: r.revoked_at,
    lastUsedAt: r.last_used_at,
    createdAt: r.created_at,
  }));
}

// ── Owner/admin: list / approve / reject requests ─────────────────────────

/** Shared DB→domain mapping for a signup-request row, so the full list and the
 * bounded page (below) can never drift on shape or derived status. */
type SignupRequestRow = Pick<
  Database["public"]["Tables"]["customer_signup_requests"]["Row"],
  | "id"
  | "name"
  | "contact_name"
  | "phone"
  | "email"
  | "city_ar"
  | "city_he"
  | "city_en"
  | "address"
  | "notes"
  | "approved_at"
  | "rejected_at"
  | "approved_customer_id"
  | "created_at"
>;

function mapSignupRequestRow(r: SignupRequestRow): SignupRequest {
  return {
    id: r.id,
    name: r.name,
    contactName: r.contact_name,
    phone: r.phone,
    email: r.email,
    city: { ar: r.city_ar ?? "", he: r.city_he ?? "", en: r.city_en ?? "" },
    address: r.address,
    notes: r.notes,
    status: requestStatus(r.approved_at, r.rejected_at),
    approvedCustomerId: r.approved_customer_id,
    createdAt: r.created_at,
  };
}

/**
 * FULL tenant signup-request list (all statuses, newest-first). NOTE: this is a
 * row-list read subject to the PostgREST `max_rows` ceiling — do NOT use it to
 * derive a count (use countPendingSignupRequests) or to render the management
 * surface (use listSignupRequestsPage, which is bounded + paginated). Retained
 * for callers that genuinely need the small unbounded list.
 */
export async function listSignupRequests(): Promise<SignupRequest[]> {
  const { client, tenantId } = await getDataContext();
  const { data, error } = await client
    .from("customer_signup_requests")
    .select(
      "id, name, contact_name, phone, email, city_ar, city_he, city_en, address, notes, approved_at, rejected_at, approved_customer_id, created_at",
    )
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`[madaf/data] listSignupRequests: ${error.message}`);
  return (data ?? []).map(mapSignupRequestRow);
}

/** Default rows per signup-requests page — mirrors the Orders/Customers/Products
 * convention (50). */
export const SIGNUP_REQUESTS_PAGE_SIZE = 50;
/** Hard upper bound so a crafted pageSize can never request an unbounded list. */
export const SIGNUP_REQUESTS_MAX_PAGE_SIZE = 100;

/** One bounded page of signup requests + the exact filtered total. */
export interface SignupRequestsPage {
  rows: SignupRequest[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/**
 * BOUNDED, page-numbered signup-requests read — the management-page replacement
 * for the capped listSignupRequests(). COUNT FIRST (head, no rows) → derive
 * totalPages → CLAMP the requested page, so an out-of-range ?page (stale/shared/
 * hand-edited link) normalizes to the last page instead of a PostgREST 416, and
 * the list never silently truncates at the PostgREST `max_rows` ceiling. Orders
 * newest-first with a unique-id tie-break (`created_at DESC, id DESC`) so offset
 * paging is skip-/dup-free. ALL statuses (pending + approved/rejected history) —
 * this is the review/audit surface, not just the pending queue.
 *
 * Takes an explicit client + server-derived tenant so it is injectable for a
 * live PostgREST test while staying the SINGLE production query (mirrors
 * sbCountPendingSignupRequests / sbSearchOrders). The "signup_requests: owner/
 * admin read" RLS policy is the authorization boundary (a sales_rep / non-member
 * / cross-tenant caller pages zero rows); `tenantId` is server-derived — the
 * client never chooses it.
 */
export async function sbListSignupRequestsPage(
  client: SupabaseClient<Database>,
  tenantId: string,
  page = 1,
  pageSize = SIGNUP_REQUESTS_PAGE_SIZE,
): Promise<SignupRequestsPage> {
  const size = Math.min(
    Math.max(
      1,
      Math.trunc(Number.isFinite(pageSize) ? pageSize : SIGNUP_REQUESTS_PAGE_SIZE),
    ),
    SIGNUP_REQUESTS_MAX_PAGE_SIZE,
  );
  const { count, error: countError } = await client
    .from("customer_signup_requests")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId);
  if (countError) {
    throw new Error(`[madaf/data] listSignupRequestsPage: ${countError.message}`);
  }
  const total = count ?? 0;
  const totalPages = total <= 0 ? 1 : Math.max(1, Math.ceil(total / size));
  if (total === 0) {
    return { rows: [], total: 0, page: 1, pageSize: size, totalPages };
  }
  const requested = Number.isFinite(page) ? Math.trunc(page) : 1;
  const current = Math.min(Math.max(1, requested), totalPages);
  const offset = (current - 1) * size; // < total ⇒ always a satisfiable range
  const { data, error } = await client
    .from("customer_signup_requests")
    .select(
      "id, name, contact_name, phone, email, city_ar, city_he, city_en, address, notes, approved_at, rejected_at, approved_customer_id, created_at",
    )
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(offset, offset + size - 1);
  if (error) {
    throw new Error(`[madaf/data] listSignupRequestsPage: ${error.message}`);
  }
  return {
    rows: (data ?? []).map(mapSignupRequestRow),
    total,
    page: current,
    pageSize: size,
    totalPages,
  };
}

/** App-facing bounded requests page — supplies the server-derived tenant; the
 * client never chooses it. Used by the signup management page. */
export async function listSignupRequestsPage(
  page = 1,
  pageSize = SIGNUP_REQUESTS_PAGE_SIZE,
): Promise<SignupRequestsPage> {
  const { client, tenantId } = await getDataContext();
  return sbListSignupRequestsPage(client, tenantId, page, pageSize);
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Targeted single-request read for the M8B.3 approval duplicate-guard. Replaces
 * a capped `listSignupRequests().find(...)`: an old request beyond the PostgREST
 * `max_rows` window could be omitted, silently skipping the duplicate check.
 * Projects ONLY the fields the guard consumes (name, phone) — no full-row PII.
 * A non-UUID id returns undefined WITHOUT querying (avoids a uuid-cast error), so
 * a bad/missing target simply defers to approve_customer_signup_request — the
 * authoritative tenant/role/state gate.
 *
 * Injectable (explicit client + server-derived tenant) so it is live-testable
 * while staying the single production query; the "signup_requests: owner/admin
 * read" RLS policy is the authorization boundary. Mirrors sbGetCustomer.
 */
export async function sbGetSignupRequestForApproval(
  client: SupabaseClient<Database>,
  tenantId: string,
  requestId: string,
): Promise<{ id: string; name: string; phone: string | null } | undefined> {
  if (!UUID_RE.test(requestId)) return undefined;
  const { data, error } = await client
    .from("customer_signup_requests")
    .select("id, name, phone")
    .eq("tenant_id", tenantId)
    .eq("id", requestId)
    .maybeSingle();
  if (error) {
    throw new Error(`[madaf/data] getSignupRequestForApproval: ${error.message}`);
  }
  return data ? { id: data.id, name: data.name, phone: data.phone } : undefined;
}

/** App-facing targeted approval read — supplies the server-derived tenant; the
 * client never chooses it. */
export async function getSignupRequestForApproval(
  requestId: string,
): Promise<{ id: string; name: string; phone: string | null } | undefined> {
  const { client, tenantId } = await getDataContext();
  return sbGetSignupRequestForApproval(client, tenantId, requestId);
}

/**
 * PILOT-C1 (Batch C correction) — the EXACT pending-signup count query, taking
 * an explicit client + server-derived tenant so it is injectable for tests
 * while remaining the SINGLE production query (no duplicated count logic).
 *
 * `head: true` returns NO rows (no name/phone/email/notes — no signup PII); the
 * `count: "exact"` total comes back in the Content-Range header, so it is
 * correct ABOVE the PostgREST max_rows ceiling — a row-list read would silently
 * truncate and undercount once processed rows displace older pending ones.
 *
 * Pending = neither approved nor rejected (the table has no status column).
 * Tenant-scoped + the "signup_requests: owner/admin read" RLS policy is the
 * authorization boundary: a sales_rep / non-member / cross-tenant caller counts
 * zero. `tenantId` is server-derived; the client never chooses it.
 */
export async function sbCountPendingSignupRequests(
  client: SupabaseClient<Database>,
  tenantId: string,
): Promise<number> {
  const { count, error } = await client
    .from("customer_signup_requests")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .is("approved_at", null)
    .is("rejected_at", null);
  if (error) {
    throw new Error(
      `[madaf/data] countPendingSignupRequests: ${error.message}`,
    );
  }
  return count ?? 0;
}

/** Exact count of PENDING signup requests for the current tenant — used by the
 * Dashboard card instead of loading (and JS-filtering) signup rows. Throws on a
 * read failure (the page's existing error contract), never a silent 0. */
export async function countPendingSignupRequests(): Promise<number> {
  const { client, tenantId } = await getDataContext();
  return sbCountPendingSignupRequests(client, tenantId);
}

export async function approveSignupRequest(
  requestId: string,
): Promise<{ customerId: string }> {
  const { client, tenantId } = await getDataContext();
  const { data, error } = await client.rpc("approve_customer_signup_request", {
    p_tenant_id: tenantId,
    p_request_id: requestId,
  });
  if (error) throw new Error(`[madaf/data] approveSignupRequest: ${error.message}`);
  return { customerId: data as string };
}

export async function rejectSignupRequest(requestId: string): Promise<void> {
  const { client, tenantId } = await getDataContext();
  const { error } = await client.rpc("reject_customer_signup_request", {
    p_tenant_id: tenantId,
    p_request_id: requestId,
  });
  if (error) throw new Error(`[madaf/data] rejectSignupRequest: ${error.message}`);
}

// ── Anon visitor: submit a store request via the raw token ────────────────

export interface SignupSubmitInput {
  name: string;
  contactName?: string;
  phone?: string;
  email?: string;
  cityAr?: string;
  cityHe?: string;
  cityEn?: string;
  address?: string;
  notes?: string;
}

/** Returns true on success; false on any failure (invalid/expired/revoked
 * token, rate-limited, over the per-link cap, or a rejected field). Neutral
 * to the visitor — no detail is leaked. */
export async function submitSignupRequest(
  rawToken: string,
  input: SignupSubmitInput,
): Promise<boolean> {
  const client = await createServerAuthClient();
  // Raw token over the wire; the DB re-hashes + validates it (never stored).
  const { data, error } = await client.rpc("submit_customer_signup_request", {
    p_token: rawToken,
    p_name: input.name,
    ...(input.contactName ? { p_contact_name: input.contactName } : {}),
    ...(input.phone ? { p_phone: input.phone } : {}),
    ...(input.email ? { p_email: input.email } : {}),
    ...(input.cityAr ? { p_city_ar: input.cityAr } : {}),
    ...(input.cityHe ? { p_city_he: input.cityHe } : {}),
    ...(input.cityEn ? { p_city_en: input.cityEn } : {}),
    ...(input.address ? { p_address: input.address } : {}),
    ...(input.notes ? { p_notes: input.notes } : {}),
  });
  if (error) return false;
  return data === true;
}
