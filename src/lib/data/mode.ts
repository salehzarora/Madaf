/**
 * Backend mode boundary.
 *
 * The app has exactly two data modes:
 *
 * - `"mock"` (default): everything reads from the typed TS modules in
 *   src/lib/mock/*. No database, no env vars, no network — this is how
 *   the demo runs and it must keep working with zero .env.local.
 * - `"supabase"` (M2, read-only, LOCAL DEV ONLY): reads go to the local
 *   Supabase stack through the server-only module ./supabase-reads. It
 *   requires SUPABASE_SERVICE_ROLE_KEY in .env.local and refuses to run
 *   in production — real authenticated access arrives with M4.
 *
 * Switch via NEXT_PUBLIC_MADAF_DATA_MODE in .env.local (see .env.example).
 * Anything other than the exact string "supabase" means mock — a missing
 * or misspelled value can never accidentally hit a database.
 *
 * The supabase branch is loaded with a dynamic import so mock mode never
 * bundles @supabase/supabase-js, and so the server-only guard inside
 * supabase-reads.ts can protect against client-side usage.
 */

export type DataMode = "mock" | "supabase";

export function getDataMode(): DataMode {
  return process.env.NEXT_PUBLIC_MADAF_DATA_MODE === "supabase"
    ? "supabase"
    : "mock";
}
