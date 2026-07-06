import "server-only";

/**
 * sales_rep → customer assignments (M4D) — SERVER ONLY, owner/admin.
 * Reads via the owner/admin-gated `list_rep_assignments` RPC; writes via
 * `assign_customer_to_rep` / `unassign_customer_from_rep`. Every call is
 * scoped to the SELECTED tenant (getDataContext) and re-verified server-side
 * by `authorize_tenant`.
 */
import { getDataContext } from "@/lib/auth/session";

export interface RepAssignment {
  userId: string;
  customerId: string;
}

export async function listRepAssignments(): Promise<RepAssignment[]> {
  const { client, tenantId } = await getDataContext();
  const { data, error } = await client.rpc("list_rep_assignments", {
    p_tenant_id: tenantId,
  });
  if (error || !data) return [];
  return data.map((r) => ({ userId: r.user_id, customerId: r.customer_id }));
}

export async function assignCustomerToRep(input: {
  userId: string;
  customerId: string;
}): Promise<void> {
  const { client, tenantId } = await getDataContext();
  const { error } = await client.rpc("assign_customer_to_rep", {
    p_tenant_id: tenantId,
    p_user_id: input.userId,
    p_customer_id: input.customerId,
  });
  if (error) {
    throw new Error(`[madaf/data] assignCustomerToRep failed: ${error.message}`);
  }
}

export async function unassignCustomerFromRep(input: {
  userId: string;
  customerId: string;
}): Promise<void> {
  const { client, tenantId } = await getDataContext();
  const { error } = await client.rpc("unassign_customer_from_rep", {
    p_tenant_id: tenantId,
    p_user_id: input.userId,
    p_customer_id: input.customerId,
  });
  if (error) {
    throw new Error(
      `[madaf/data] unassignCustomerFromRep failed: ${error.message}`,
    );
  }
}
