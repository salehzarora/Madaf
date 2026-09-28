import "server-only";
import { getSessionContext } from "@/lib/auth/session";
import { getDataMode } from "@/lib/data/mode";
import type { DeviceInput } from "@/lib/push/device-input";
import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { INSTALLATION_COOKIE, UUID } from "@/lib/push/device-input";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

export async function pushSession() {
  if (getDataMode() !== "supabase") return null;
  const context = await getSessionContext();
  if (!context.userId || !context.membership) return null;
  // getUser above is authoritative. Claims only partition the in-memory sync
  // cache across sign-ins; they never grant permissions or supply tenant IDs.
  const { data } = await context.client.auth.getClaims();
  const sid = data?.claims.session_id;
  if (typeof sid !== "string") return null;
  return { ...context, tenantId: context.membership.tenantId,
    scope: createHash("sha256").update(`${context.userId}:${sid}:${context.membership.tenantId}`).digest("hex") };
}
export async function registerPushDevice(session: NonNullable<Awaited<ReturnType<typeof pushSession>>>, input: DeviceInput) {
  const { error } = await session.client.rpc("register_push_device", {
    p_tenant_id: session.tenantId, p_installation_id: input.installationId,
    p_fcm_token: input.token, p_locale: input.locale, p_enabled: input.enabled,
  });
  if (error) throw new Error("push_registration_failed"); // Never surface a token-bearing DB error.
}
export async function disablePushDevice(session: NonNullable<Awaited<ReturnType<typeof pushSession>>>, installationId: string) {
  const { error } = await session.client.rpc("disable_my_push_device", { p_installation_id: installationId });
  if (error) throw new Error("push_unregister_failed");
}

export async function disableCurrentPushAssociation(client: SupabaseClient<Database>) {
  const id = (await cookies()).get(INSTALLATION_COOKIE)?.value;
  if (!id || !UUID.test(id)) return;
  const { error } = await client.rpc("disable_my_push_device", { p_installation_id: id });
  if (error) throw new Error("push_unregister_failed");
}
