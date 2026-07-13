import "server-only";

/**
 * Authenticated session + tenant-membership context (M4A · multi-tenant in
 * M4C) — SERVER ONLY.
 *
 * One cookie-bound Supabase client per request (deduped with React `cache`),
 * plus the caller's auth user and their tenant memberships resolved from
 * `tenant_users` via `list_memberships()`.
 *
 * A user MAY belong to several tenants (M4C). The "current" membership is the
 * one named by the selected-tenant cookie — but ONLY if that value is one of
 * the caller's real memberships; otherwise it falls back to the first
 * membership deterministically. This is the source of truth for the
 * authenticated data path: reads run under RLS filtered to the current
 * tenant, and writes call the authenticated RPCs with that tenant id, which
 * the DB re-verifies against membership. No service-role key is involved.
 */
import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { LocalizedText } from "@/lib/types";
import type { Database } from "@/lib/supabase/database.types";
import { createServerAuthClient } from "@/lib/supabase/server-auth";
import { DEFAULT_TENANT_TIME_ZONE, resolveTenantTimeZone } from "@/lib/time";
import { readSelectedTenant } from "./selected-tenant";

export type TenantRole = Database["public"]["Enums"]["tenant_role"];

export interface Membership {
  tenantId: string;
  role: TenantRole;
  /** Tenant display name — used by the tenant switcher / current indicator. */
  name: LocalizedText;
  /**
   * M8H.2 — the tenant's IANA timezone (e.g. Asia/Jerusalem). It rides along on
   * `list_memberships()`, which already runs exactly ONCE per request inside the
   * React-cached session context, so every business time on the page is formatted
   * without a single extra query (and never from the browser's timezone).
   */
  timezone: string;
}

export interface SessionContext {
  client: SupabaseClient<Database>;
  userId: string | null;
  email: string | null;
  /** Phone (E.164) when the user signed in with phone OTP (M7B). */
  phone: string | null;
  /** Every tenant the user belongs to (for the switcher). */
  memberships: Membership[];
  /** The currently-selected membership (verified), or null. */
  membership: Membership | null;
}

/** A uuid that matches no tenant — used so anon reads filter to zero rows. */
export const NO_TENANT = "00000000-0000-0000-0000-000000000000";

export const getSessionContext = cache(async (): Promise<SessionContext> => {
  const client = await createServerAuthClient();
  const {
    data: { user },
  } = await client.auth.getUser();

  let memberships: Membership[] = [];
  let membership: Membership | null = null;

  if (user) {
    const { data } = await client.rpc("list_memberships");
    memberships = (data ?? []).map((r) => ({
      tenantId: r.tenant_id,
      role: r.role,
      name: { ar: r.name_ar, he: r.name_he, en: r.name_en },
      // A corrupt/unknown stored zone resolves to UTC and is logged — never the
      // server machine's zone and never the device's.
      timezone: resolveTenantTimeZone(r.timezone),
    }));
    if (memberships.length > 0) {
      // Honour the cookie ONLY if it names a real membership; else fall back
      // to the first (deterministic) tenant.
      const selected = await readSelectedTenant();
      membership =
        memberships.find((m) => m.tenantId === selected) ?? memberships[0];
    }
  }

  return {
    client,
    userId: user?.id ?? null,
    email: user?.email ?? null,
    phone: user?.phone ?? null,
    memberships,
    membership,
  };
});

/** Reads/writes context: the request client + the effective (selected) tenant. */
export async function getDataContext(): Promise<{
  client: SupabaseClient<Database>;
  tenantId: string;
}> {
  const { client, membership } = await getSessionContext();
  return { client, tenantId: membership?.tenantId ?? NO_TENANT };
}

/**
 * M8H.2 — the authoritative timezone for ALL business-facing time on this
 * request. It comes from the SELECTED tenant's membership (already loaded by the
 * cached session context — no extra query, no N+1) and is therefore
 * server-derived: the browser's timezone never has any authority here.
 *
 * Mock mode has no session; the data layer supplies the demo tenant's zone.
 * A membership-less (anon/onboarding) caller gets the product's default rather
 * than the machine's zone.
 */
export async function getTenantTimeZone(): Promise<string> {
  const { membership } = await getSessionContext();
  return membership?.timezone ?? DEFAULT_TENANT_TIME_ZONE;
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
