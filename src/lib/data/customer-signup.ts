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
import { createServerAuthClient } from "@/lib/supabase/server-auth";

import { getDataContext } from "@/lib/auth/session";

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
  return (data ?? []).map((r) => ({
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
  }));
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
