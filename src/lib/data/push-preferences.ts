import "server-only";
import { createHash } from "node:crypto";
import { getSessionContext } from "@/lib/auth/session";
import { getDataMode } from "./mode";
import { defaultPushPreferences, type PushPreferences } from "@/lib/push/preferences";

/** Opaque view identity, not authorization. A stale view must never save into a
 * newly selected supplier/account before its router refresh has completed. */
export function pushPreferenceScope(userId: string, tenantId: string): string {
  return createHash("sha256").update(`${userId}:${tenantId}`).digest("hex");
}

async function preferenceContext() {
  const context = await getSessionContext();
  if (!context.userId || !context.membership || context.membership.role === "sales_rep") {
    throw new Error("preferences_unavailable");
  }
  return { client: context.client, tenantId: context.membership.tenantId,
    scope: pushPreferenceScope(context.userId, context.membership.tenantId) };
}

export async function getPushPreferences(): Promise<PushPreferences> {
  if (getDataMode() !== "supabase") return { ...defaultPushPreferences };
  const { client, tenantId } = await preferenceContext();
  const { data, error } = await client.rpc("get_my_push_preferences", { p_tenant_id: tenantId }).single();
  if (error || !data) throw new Error("preferences_unavailable");
  return data;
}

export async function savePushPreferences(value: PushPreferences, expectedScope: string): Promise<void> {
  if (getDataMode() !== "supabase") throw new Error("preferences_demo");
  const { client, tenantId, scope } = await preferenceContext();
  if (expectedScope !== scope) throw new Error("preferences_stale");
  const { error } = await client.rpc("save_my_push_preferences", {
    p_tenant_id: tenantId, p_new_order: value.new_order, p_signup_request: value.signup_request,
    p_low_stock: value.low_stock, p_order_status: value.order_status,
  });
  if (error) throw new Error("preferences_unavailable");
}
