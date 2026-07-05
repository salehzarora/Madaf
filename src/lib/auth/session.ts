import "server-only";

/**
 * Authenticated session + tenant-membership context (M4A) — SERVER ONLY.
 *
 * One cookie-bound Supabase client per request (deduped with React
 * `cache`), plus the caller's auth user and (single) tenant membership
 * resolved from `tenant_users` via the `current_membership()` RPC.
 *
 * This is the source of truth for the authenticated/supabase data path:
 * reads run under RLS (a member sees only their tenant; anon sees zero
 * rows) and writes call the authenticated RPCs, which re-derive the
 * tenant from membership server-side. No service-role key is involved.
 *
 * M4A assumes a single membership per user; multi-tenant switching is M4B.
 */
import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";
import { createServerAuthClient } from "@/lib/supabase/server-auth";

export type TenantRole = Database["public"]["Enums"]["tenant_role"];

export interface Membership {
  tenantId: string;
  role: TenantRole;
}

export interface SessionContext {
  client: SupabaseClient<Database>;
  userId: string | null;
  email: string | null;
  membership: Membership | null;
}

/** A uuid that matches no tenant — used so anon reads filter to zero rows. */
export const NO_TENANT = "00000000-0000-0000-0000-000000000000";

export const getSessionContext = cache(async (): Promise<SessionContext> => {
  const client = await createServerAuthClient();
  const {
    data: { user },
  } = await client.auth.getUser();

  let membership: Membership | null = null;
  if (user) {
    const { data } = await client.rpc("current_membership");
    const row = data?.[0];
    if (row) membership = { tenantId: row.tenant_id, role: row.role };
  }

  return {
    client,
    userId: user?.id ?? null,
    email: user?.email ?? null,
    membership,
  };
});

/** Reads/writes context: the request client + the effective tenant id. */
export async function getDataContext(): Promise<{
  client: SupabaseClient<Database>;
  tenantId: string;
}> {
  const { client, membership } = await getSessionContext();
  return { client, tenantId: membership?.tenantId ?? NO_TENANT };
}

export async function getCurrentUser(): Promise<{
  id: string;
  email: string | null;
} | null> {
  const { userId, email } = await getSessionContext();
  return userId ? { id: userId, email } : null;
}

export async function getCurrentMembership(): Promise<Membership | null> {
  return (await getSessionContext()).membership;
}
