/**
 * Server-side Supabase client factories — RESERVED for M3/M4.
 *
 * Nothing imports these yet: the M2 read path owns its own client inside
 * src/lib/data/supabase-reads.ts (server-only, dev-only, demo-tenant
 * scoped). These factories become relevant when M3 write paths and M4
 * cookie-bound auth sessions (@supabase/ssr) land. Until then the
 * anon-key client sees nothing (RLS deny-by-default) — the intended
 * posture while the demo UI is public.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "./database.types";
import { getSupabaseEnv } from "./env";

/** Anonymous server client — subject to RLS like any API consumer. */
export function createSupabaseServerClient(): SupabaseClient<Database> {
  const { url, anonKey } = getSupabaseEnv();
  return createClient<Database>(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Service-role client — BYPASSES Row Level Security.
 *
 * Local development / trusted scripts only (seeding helpers, admin jobs).
 * The key must never reach the browser; this guard makes misuse loud.
 */
export function createSupabaseServiceRoleClient(): SupabaseClient<Database> {
  if (typeof window !== "undefined") {
    throw new Error(
      "createSupabaseServiceRoleClient() must never run in the browser — " +
        "the service-role key bypasses RLS.",
    );
  }
  const { url } = getSupabaseEnv();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set. It lives in .env.local only " +
        "(local stack key printed by `supabase start`) — never in the repo.",
    );
  }
  return createClient<Database>(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
