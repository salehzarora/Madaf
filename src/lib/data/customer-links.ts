import "server-only";

/**
 * Private shop-link management (M4A) — SERVER ONLY, authenticated
 * owner/admin. Reads run under RLS (members read their tenant's links);
 * create/revoke go through the SECURITY DEFINER RPCs. The raw token is
 * generated in the Server Action and only its hash reaches this layer.
 */
import { getDataContext } from "@/lib/auth/session";

export type LinkStatus = "active" | "revoked" | "expired";

export interface CustomerLink {
  id: string;
  label: string | null;
  tokenPreview: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  /** Derived server-side (avoids time-dependent rendering on the client). */
  status: LinkStatus;
}

function deriveStatus(
  revokedAt: string | null,
  expiresAt: string | null,
): LinkStatus {
  if (revokedAt) return "revoked";
  if (expiresAt && Date.parse(expiresAt) < Date.now()) return "expired";
  return "active";
}

export async function listCustomerLinks(
  customerId: string,
): Promise<CustomerLink[]> {
  const { client, tenantId } = await getDataContext();
  const { data, error } = await client
    .from("customer_access_links")
    .select(
      "id, label, token_preview, expires_at, revoked_at, last_used_at, created_at",
    )
    // Scope to the SELECTED tenant (M4C): a multi-tenant owner is RLS-allowed
    // to read every member tenant's links, so filter explicitly — matching
    // listTenantInvites and every sb* read.
    .eq("tenant_id", tenantId)
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false });
  if (error || !data) return [];
  return data.map((r) => ({
    id: r.id,
    label: r.label,
    tokenPreview: r.token_preview,
    expiresAt: r.expires_at,
    revokedAt: r.revoked_at,
    lastUsedAt: r.last_used_at,
    createdAt: r.created_at,
    status: deriveStatus(r.revoked_at, r.expires_at),
  }));
}

export async function insertCustomerLink(input: {
  customerId: string;
  tokenHash: string;
  tokenPreview: string;
  label?: string;
  expiresAt?: string;
}): Promise<string> {
  const { client, tenantId } = await getDataContext();
  const { data, error } = await client.rpc("insert_customer_access_link", {
    p_tenant_id: tenantId,
    p_customer_id: input.customerId,
    p_token_hash: input.tokenHash,
    p_token_preview: input.tokenPreview,
    ...(input.label ? { p_label: input.label } : {}),
    ...(input.expiresAt ? { p_expires_at: input.expiresAt } : {}),
  });
  if (error || !data) {
    throw new Error(
      `[madaf/data] insertCustomerLink failed: ${error?.message ?? "no id"}`,
    );
  }
  return data as string;
}

export async function revokeCustomerLink(linkId: string): Promise<void> {
  const { client, tenantId } = await getDataContext();
  const { error } = await client.rpc("revoke_customer_access_link", {
    p_tenant_id: tenantId,
    p_link_id: linkId,
  });
  if (error) {
    throw new Error(`[madaf/data] revokeCustomerLink failed: ${error.message}`);
  }
}
