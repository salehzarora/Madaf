/**
 * Backend mode boundary.
 *
 * The app has exactly two data modes:
 *
 * - `"mock"` (default): everything reads from the typed TS modules in
 *   src/lib/mock/*. No database, no env vars, no network — this is how the
 *   M0 demo runs and it must keep working untouched.
 * - `"supabase"`: reads go to the local Supabase stack through
 *   src/lib/supabase/*. The schema exists (M1), but the read/write paths
 *   land in M2/M3 — until then supabase mode fails loudly instead of
 *   silently showing mock data.
 *
 * Switch via NEXT_PUBLIC_MADAF_DATA_MODE in .env.local (see .env.example).
 * Anything other than the exact string "supabase" means mock — a missing
 * or misspelled value can never accidentally hit a database.
 */

export type DataMode = "mock" | "supabase";

export function getDataMode(): DataMode {
  return process.env.NEXT_PUBLIC_MADAF_DATA_MODE === "supabase"
    ? "supabase"
    : "mock";
}

/**
 * Placeholder for Supabase-backed reads until M2 wires them.
 * Fails loudly so a half-configured environment is obvious.
 */
export function supabaseNotWiredYet(what: string): never {
  throw new Error(
    `[madaf/data] ${what} is not wired to Supabase yet — the M1 schema ` +
      "exists, but read paths land in M2 (docs/FUTURE_BACKEND_HANDOFF.md). " +
      "Run in mock mode (NEXT_PUBLIC_MADAF_DATA_MODE=mock or unset) until then.",
  );
}
