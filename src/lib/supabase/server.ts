import "server-only";

/**
 * Server-side Supabase client factories — currently UNUSED / reserved.
 *
 * As of M4A the live data path runs on cookie-bound clients:
 *   - authenticated server client → src/lib/supabase/server-auth.ts
 *   - browser client              → src/lib/supabase/client.ts
 * and reads/writes go through src/lib/auth/session.ts under RLS. Nothing
 * imports the factories below. They are kept only as trusted-script /
 * bootstrap helpers, and are hardened to FAIL CLOSED: the service-role
 * factory refuses production and any non-local Supabase URL, mirroring the
 * guard on the (also service-role) local-dev context in
 * src/lib/data/supabase-context.ts. The service-role key must never reach
 * the browser.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "./database.types";
import { getSupabaseEnv } from "./env";

/** Hostnames a local Supabase stack can live on — nothing else qualifies. */
const LOCAL_HOSTNAMES = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

/**
 * The service role bypasses RLS; it must never talk to a hosted project.
 * A dev server pointed at https://<ref>.supabase.co with a service key would
 * expose real reads/writes — so the URL itself must be local.
 */
function assertLocalSupabaseUrl(url: string): void {
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    throw new Error(
      `[madaf/supabase] NEXT_PUBLIC_SUPABASE_URL is not a valid URL: "${url}".`,
    );
  }
  if (!LOCAL_HOSTNAMES.has(hostname.toLowerCase())) {
    throw new Error(
      "[madaf/supabase] The service-role client only supports LOCAL Supabase " +
        `URLs. NEXT_PUBLIC_SUPABASE_URL is "${url}" — hosted projects ` +
        "(e.g. https://<ref>.supabase.co) are refused. Point it at the local " +
        "stack (http://127.0.0.1:55321, from `supabase status`).",
    );
  }
}

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
 * Fails closed: never in the browser, never in production, never against a
 * non-local Supabase URL, and never without SUPABASE_SERVICE_ROLE_KEY (which
 * lives in .env.local only — never in the repo, never in the browser).
 */
export function createSupabaseServiceRoleClient(): SupabaseClient<Database> {
  if (typeof window !== "undefined") {
    throw new Error(
      "createSupabaseServiceRoleClient() must never run in the browser — " +
        "the service-role key bypasses RLS.",
    );
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "[madaf/supabase] The service-role client is local-development only. " +
        "The production data path is cookie-bound authenticated clients + " +
        "RLS (src/lib/supabase/server-auth.ts). Never ship the service-role " +
        "key to a hosted environment.",
    );
  }
  const { url } = getSupabaseEnv();
  assertLocalSupabaseUrl(url);
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
