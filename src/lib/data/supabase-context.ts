import "server-only";

/**
 * Shared Supabase service context for the M2/M3 dev data paths —
 * SERVER ONLY.
 *
 * There is no auth yet, and RLS (correctly) gives the anon key zero
 * rows. Rather than loosening RLS or shipping keys to the browser, the
 * local-dev supabase mode runs on a server-side service-role client
 * pinned to the demo tenant:
 *   - requires SUPABASE_SERVICE_ROLE_KEY in .env.local (server env — the
 *     browser never sees it; this module refuses to load client-side),
 *   - refuses to run in production builds/servers,
 *   - callers must scope every query/RPC by the returned tenantId
 *     because the service role bypasses RLS.
 * M4 replaces this with cookie-bound authenticated clients + RLS, at
 * which point this module is deleted.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";
import { getSupabaseEnv } from "@/lib/supabase/env";

/** The tenant seeded by supabase/seed.sql. */
const DEMO_TENANT_ID = "11111111-1111-4111-8111-111111111111";

export type Db = SupabaseClient<Database>;

let cached: { client: Db; tenantId: string } | undefined;

export function getServiceContext(): { client: Db; tenantId: string } {
  if (cached) return cached;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "[madaf/data] Supabase data mode is local-development only until the " +
        "M4 auth milestone (authenticated clients + RLS). Build and run in " +
        "mock mode instead.",
    );
  }
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new Error(
      "[madaf/data] Supabase data mode needs SUPABASE_SERVICE_ROLE_KEY in " +
        ".env.local (local stack key — run `supabase status`). Without " +
        "auth (M4) the anon key correctly sees zero rows under RLS, so " +
        "local-dev access goes through a server-only, demo-tenant-scoped " +
        "service-role client. See supabase/README.md.",
    );
  }
  const { url } = getSupabaseEnv();
  const client = createClient<Database>(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const tenantId = process.env.MADAF_SUPABASE_TENANT_ID ?? DEMO_TENANT_ID;
  cached = { client, tenantId };
  return cached;
}
