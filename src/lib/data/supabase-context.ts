import "server-only";

/**
 * Shared Supabase service-role context — SERVER ONLY, and no longer on the
 * app's runtime data path.
 *
 * Since M4A the app reads and writes through cookie-bound *authenticated*
 * clients under RLS (src/lib/auth/session.ts). This service-role context is
 * retained only for local bootstrap/seed tooling, and FAILS CLOSED so it can
 * never leak against a real project:
 *   - requires SUPABASE_SERVICE_ROLE_KEY in .env.local (server env — the
 *     browser never sees it; this module refuses to load client-side),
 *   - refuses to run in production builds/servers,
 *   - refuses any NON-LOCAL Supabase URL (M3A.1): only 127.0.0.1/localhost/
 *     ::1 stacks are accepted,
 *   - callers must scope every query/RPC by the returned tenantId because
 *     the service role bypasses RLS.
 * `getServiceContext` has no importers in app code; a future cleanup phase
 * can delete it once the bootstrap tooling is fully self-contained.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";
import { getSupabaseEnv } from "@/lib/supabase/env";

/** The tenant seeded by supabase/seed.sql. */
const DEMO_TENANT_ID = "11111111-1111-4111-8111-111111111111";

/** Hostnames a local Supabase stack can live on — nothing else qualifies. */
const LOCAL_HOSTNAMES = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

/**
 * Hard guard (M3A.1): the temporary service-role context must never talk
 * to a hosted project. NODE_ENV=production is already refused above, but
 * a *development* server pointed at https://<ref>.supabase.co with a
 * service key would still expose real reads/writes through the public
 * Server Actions — so the URL itself must be local.
 */
function assertLocalSupabaseUrl(url: string): void {
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    throw new Error(
      `[madaf/data] NEXT_PUBLIC_SUPABASE_URL is not a valid URL: "${url}".`,
    );
  }
  if (!LOCAL_HOSTNAMES.has(hostname.toLowerCase())) {
    throw new Error(
      "[madaf/data] Madaf temporary service-role mode only supports local " +
        `Supabase URLs. NEXT_PUBLIC_SUPABASE_URL is "${url}" — hosted ` +
        "projects (e.g. https://<ref>.supabase.co) are refused until the " +
        "M4 auth milestone. Point it at the local stack " +
        "(http://127.0.0.1:55321, from `supabase status`) or run in mock " +
        "mode.",
    );
  }
}

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
  assertLocalSupabaseUrl(url);
  const client = createClient<Database>(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const tenantId = process.env.MADAF_SUPABASE_TENANT_ID ?? DEMO_TENANT_ID;
  cached = { client, tenantId };
  return cached;
}
