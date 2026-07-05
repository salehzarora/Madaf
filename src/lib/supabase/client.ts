"use client";

/**
 * Browser-side Supabase client (lazy singleton) — RESERVED for M4+.
 *
 * Nothing imports this: the M2 architecture keeps ALL data access on the
 * server (client components receive props / ShopDataProvider context and
 * never talk to Supabase). This factory exists for the M4 auth milestone
 * (sign-in flows need a browser client); until then it stays unused, and
 * RLS denies the anon key all tenant data by design.
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
