import "server-only";

/**
 * Tenant team (members + invitations) data access (M4B) — SERVER ONLY,
 * authenticated. Reads run under RLS / SECURITY DEFINER list RPCs; every
 * mutation goes through a validated RPC (owner/admin gates, last-owner
 * protection, no self-promotion, email-verified acceptance). The raw invite
 * token is generated in the Server Action and only its hash reaches here.
 */
import { getDataContext } from "@/lib/auth/session";
import type { TenantRole } from "@/lib/auth/session";

export interface TenantMember {
  userId: string;
  email: string;
  role: TenantRole;
  createdAt: string;
}

export type InviteStatus = "pending" | "accepted" | "revoked" | "expired";

export interface TenantInvite {
  id: string;
  email: string;
  role: TenantRole;
  tokenPreview: string | null;
  expiresAt: string | null;
  acceptedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  /** Derived server-side (no time-dependent client rendering). */
  status: InviteStatus;
}

function inviteStatus(
  acceptedAt: string | null,
  revokedAt: string | null,
  expiresAt: string | null,
): InviteStatus {
  if (acceptedAt) return "accepted";
  if (revokedAt) return "revoked";
  if (expiresAt && Date.parse(expiresAt) < Date.now()) return "expired";
  return "pending";
}

/** Roster with emails — via the owner/admin-gated SECURITY DEFINER RPC. */
export async function listTenantMembers(): Promise<TenantMember[]> {
  const { client, tenantId } = await getDataContext();
  const { data, error } = await client.rpc("list_tenant_members", {
    p_tenant_id: tenantId,
  });
  if (error || !data) return [];
  return data.map((r) => ({
    userId: r.user_id,
    email: r.email,
    role: r.role,
    createdAt: r.created_at,
  }));
}

/** Tenant invitations for the SELECTED tenant (owner/admin, RLS-scoped). */
export async function listTenantInvites(): Promise<TenantInvite[]> {
  const { client, tenantId } = await getDataContext();
  const { data, error } = await client
    .from("tenant_invitations")
    .select(
      "id, email, role, token_preview, expires_at, accepted_at, revoked_at, created_at",
    )
    // Owner/admin of MULTIPLE tenants (M4C) would otherwise see all their
    // tenants' invites via RLS — scope to the current tenant explicitly.
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });
  if (error || !data) return [];
  return data.map((r) => ({
    id: r.id,
    email: r.email,
    role: r.role,
    tokenPreview: r.token_preview,
    expiresAt: r.expires_at,
    acceptedAt: r.accepted_at,
    revokedAt: r.revoked_at,
    createdAt: r.created_at,
    status: inviteStatus(r.accepted_at, r.revoked_at, r.expires_at),
  }));
}

export async function insertTenantInvite(input: {
  email: string;
  role: "admin" | "sales_rep";
  tokenHash: string;
  tokenPreview: string;
  expiresAt?: string;
}): Promise<string> {
  const { client, tenantId } = await getDataContext();
  const { data, error } = await client.rpc("create_tenant_invite", {
    p_tenant_id: tenantId,
    p_email: input.email,
    p_role: input.role,
    p_token_hash: input.tokenHash,
    p_token_preview: input.tokenPreview,
    ...(input.expiresAt ? { p_expires_at: input.expiresAt } : {}),
  });
  if (error || !data) {
    throw new Error(
      `[madaf/data] insertTenantInvite failed: ${error?.message ?? "no id"}`,
    );
  }
  return data as string;
}

export async function revokeTenantInvite(inviteId: string): Promise<void> {
  const { client, tenantId } = await getDataContext();
  const { error } = await client.rpc("revoke_tenant_invite", {
    p_tenant_id: tenantId,
    p_invite_id: inviteId,
  });
  if (error) {
    throw new Error(`[madaf/data] revokeTenantInvite failed: ${error.message}`);
  }
}

export async function updateMemberRole(input: {
  userId: string;
  role: "admin" | "sales_rep";
}): Promise<void> {
  const { client, tenantId } = await getDataContext();
  const { error } = await client.rpc("update_tenant_member_role", {
    p_tenant_id: tenantId,
    p_user_id: input.userId,
    p_new_role: input.role,
  });
  if (error) {
    throw new Error(`[madaf/data] updateMemberRole failed: ${error.message}`);
  }
}

export async function removeMember(userId: string): Promise<void> {
  const { client, tenantId } = await getDataContext();
  const { error } = await client.rpc("remove_tenant_member", {
    p_tenant_id: tenantId,
    p_user_id: userId,
  });
  if (error) {
    throw new Error(`[madaf/data] removeMember failed: ${error.message}`);
  }
}

/**
 * Accept an invite with the RAW token (hashed server-side). Returns the
 * error's SQLSTATE on failure so the caller can localize the reason
 * (MDF04 expired, MDF06 email mismatch, MDF07 already a member, …).
 */
export async function acceptInvite(
  rawToken: string,
): Promise<{ ok: true } | { ok: false; code: string | null }> {
  const { client } = await getDataContext();
  const { error } = await client.rpc("accept_tenant_invite", {
    p_token: rawToken,
  });
  if (error) return { ok: false, code: error.code ?? null };
  return { ok: true };
}
