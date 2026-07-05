/**
 * Typed access to Supabase environment variables.
 *
 * No secrets live in the repo (docs/FUTURE_BACKEND_HANDOFF.md ground rule):
 * values come from `.env.local` (gitignored) — copy `.env.example` and fill
 * in the keys printed by `supabase start`. Local development only in this
 * phase; there is no production Supabase project.
 */

export interface SupabaseEnv {
  url: string;
  anonKey: string;
}

/** True when the public Supabase env vars are present. */
export function hasSupabaseEnv(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

/**
 * Read the public Supabase config or fail with a actionable message.
 * Never called in mock mode (the default), so the app builds and runs
 * with no Supabase env at all.
 */
export function getSupabaseEnv(): SupabaseEnv {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "Supabase env vars missing: set NEXT_PUBLIC_SUPABASE_URL and " +
        "NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local (see .env.example and " +
        "supabase/README.md). The app runs without them in mock mode " +
        "(NEXT_PUBLIC_MADAF_DATA_MODE=mock).",
    );
  }
  return { url, anonKey };
}
