/**
 * Backend mode boundary.
 *
 * The app has exactly two data modes:
 *
 * - `"mock"` (default): everything reads from the typed TS modules in
 *   src/lib/mock/*. No database, no env vars, no network — this is how
 *   the demo runs and it must keep working with zero .env.local.
 * - `"supabase"` (LOCAL DEV ONLY): the whole app runs on real Supabase Auth
 *   against the local stack. Reads and writes go through the server-only
 *   modules ./supabase-reads / ./supabase-writes on the cookie-bound
 *   AUTHENTICATED client (src/lib/auth/session.ts) under RLS — no
 *   service-role key is on the runtime path (it is bootstrap/local-only and
 *   fails closed on production + non-local URLs). Signed-in suppliers manage
 *   catalog/orders/team; customers order via private tokenized links.
 *
 * Switch via NEXT_PUBLIC_MADAF_DATA_MODE in .env.local (see .env.example).
 * Anything other than the exact string "supabase" means mock — a missing
 * or misspelled value can never accidentally hit a database.
 *
 * The supabase branches are loaded with dynamic imports so mock mode never
 * bundles @supabase/supabase-js, and so the server-only guards protect
 * against client-side usage.
 */

export type DataMode = "mock" | "supabase";

export function getDataMode(): DataMode {
  return process.env.NEXT_PUBLIC_MADAF_DATA_MODE === "supabase"
    ? "supabase"
    : "mock";
}
