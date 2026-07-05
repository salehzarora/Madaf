import "server-only";

/**
 * Cookie-bound Supabase server client (M4A) — the authenticated data path.
 *
 * Built on @supabase/ssr so the user's session lives in httpOnly cookies
 * (never in JS). In an RSC the cookie store is read-only, so writes from
 * token refresh are swallowed here and performed instead by the proxy
 * (src/proxy.ts) on each request. Uses the PUBLIC anon key only — the
 * service-role key never touches this path.
 *
 * For an anonymous visitor (no session) this client acts as `anon`: RLS
 * gives zero tenant rows, and only the anon-granted token RPCs work. That
 * is exactly the posture the shop-link flow relies on.
 */
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import type { Database } from "@/lib/supabase/database.types";
import { getSupabaseEnv } from "@/lib/supabase/env";

export async function createServerAuthClient() {
  const cookieStore = await cookies();
  const { url, anonKey } = getSupabaseEnv();
  return createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // RSC render: cookie store is read-only. The proxy refreshes the
          // session on the next request, so this is safe to ignore.
        }
      },
    },
  });
}
