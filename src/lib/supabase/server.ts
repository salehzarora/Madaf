/**
 * Server-side Supabase clients (RSC / Server Actions / Route Handlers).
 *
 * Not used by any M0 surface — the UI still runs on src/lib/mock/*. M2
 * read paths should create one client per request via
 * `createSupabaseServerClient()`.
 *
 * Auth: cookie-bound user sessions (@supabase/ssr) arrive with M4. Until
 * then the anon-key client sees nothing (RLS deny-by-default), which is
 * the intended posture while the demo UI is public.
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
