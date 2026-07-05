"use client";

/**
 * Browser-side Supabase client (lazy singleton).
 *
 * Not used by any M0 surface — the UI still runs on src/lib/mock/*. This
 * exists so M2 client components have one blessed way to reach Supabase.
 * Auth session wiring (cookie-bound clients via @supabase/ssr) is an M4
 * concern; until then this is an anonymous client and RLS denies it all
 * tenant data by design.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "./database.types";
import { getSupabaseEnv } from "./env";

let browserClient: SupabaseClient<Database> | undefined;

export function getSupabaseBrowserClient(): SupabaseClient<Database> {
  if (!browserClient) {
    const { url, anonKey } = getSupabaseEnv();
    browserClient = createClient<Database>(url, anonKey);
  }
  return browserClient;
}
