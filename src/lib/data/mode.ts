/**
 * Backend mode boundary.
 *
 * The app has exactly two data modes:
 *
 * - `"mock"` (default): everything reads from the typed TS modules in
 *   src/lib/mock/*. No database, no env vars, no network — this is how
 *   the demo runs and it must keep working with zero .env.local.
 * - `"supabase"` (LOCAL DEV ONLY): reads AND the M3A order writes
 *   (checkout, status changes) go to the local Supabase stack through
 *   the server-only modules ./supabase-reads and ./supabase-writes,
 *   both built on the shared service context in ./supabase-context. It
 *   requires SUPABASE_SERVICE_ROLE_KEY in .env.local and refuses to run
 *   in production — real authenticated access arrives with M4.
 *
 * Switch via NEXT_PUBLIC_MADAF_DATA_MODE in .env.local (see .env.example).
 * Anything other than the exact string "supabase" means mock — a missing
 * or misspelled value can never accidentally hit a database.
 *
 * The supabase branches are loaded with dynamic imports so mock mode
 * never bundles @supabase/supabase-js, and so the server-only guard in
 * supabase-context.ts protects against client-side usage.
 */

export type DataMode = "mock" | "supabase";

export function getDataMode(): DataMode {
  return process.env.NEXT_PUBLIC_MADAF_DATA_MODE === "supabase"
    ? "supabase"
    : "mock";
}
