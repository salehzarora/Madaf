"use client";

/**
 * Browser-side Supabase client (M4A) — cookie-bound via @supabase/ssr, so
 * it shares the same session the server reads. Uses the PUBLIC anon key
 * only; the service-role key never reaches the browser.
 *
 * Most auth happens through Server Actions (src/lib/actions/auth.ts); this
 * exists for client components that need the session directly (e.g. a
 * future realtime feature). RLS denies the anon key all tenant data by
 * design until a user signs in.
 */
import { createBrowserClient } from "@supabase/ssr";

import type { Database } from "./database.types";
import { getSupabaseEnv } from "./env";

export function getSupabaseBrowserClient() {
  const { url, anonKey } = getSupabaseEnv();
  return createBrowserClient<Database>(url, anonKey);
}
