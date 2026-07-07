import "server-only";

/**
 * DEV / MOCK phone-OTP testing path (M7B) — SERVER-ONLY, fail-closed.
 *
 * ⚠️ This is a LOCAL/DEV testing convenience ONLY. It lets you sign in with a
 * pre-configured fake phone number + fake code WITHOUT sending a real SMS,
 * for experiments and UI testing. It exists so the phone-OTP UX can be
 * exercised with zero backend (mock mode).
 *
 * HARD SECURITY RULES (all enforced below, fail-closed):
 *  - Disabled by default. Requires `MADAF_DEV_PHONE_OTP_ENABLED=true`.
 *  - NEVER active when `NODE_ENV=production` (i.e. never in a prod build).
 *  - NEVER active against a non-local hosted Supabase project (the URL, if
 *    set, must be 127.0.0.1 / localhost).
 *  - Only the explicitly-listed `MADAF_DEV_PHONE_OTP_ALLOWED_NUMBERS` work.
 *  - The code must equal `MADAF_DEV_PHONE_OTP_CODE` exactly.
 *  - The code is read ONLY here on the server; it is NEVER `NEXT_PUBLIC` and
 *    never sent to the browser.
 *  - It is consulted ONLY on the non-Supabase (mock) data path. In Supabase
 *    mode the app always uses real `signInWithOtp`/`verifyOtp` — this module
 *    invents NO session and grants NO tenant access. Mock mode has no
 *    database, no RLS, and no real session, so a mock "success" merely opens
 *    the already-open demo admin: there is no production bypass.
 *
 * See docs/AUTH_AND_ACCESS_MODEL.md § phone OTP.
 */

/** A local Supabase URL (loopback only). Anything else is treated as hosted. */
function isLocalSupabaseUrl(url: string): boolean {
  return /^https?:\/\/(127\.0\.0\.1|localhost|0\.0\.0\.0)(:\d+)?(\/|$)/i.test(
    url.trim(),
  );
}

/** The configured fake code (trimmed), or "" when unset. Server-only. */
function devOtpCode(): string {
  return (process.env.MADAF_DEV_PHONE_OTP_CODE ?? "").trim();
}

/** The explicit allow-list of fake E.164 numbers (never a real number). */
export function devPhoneOtpNumbers(): string[] {
  return (process.env.MADAF_DEV_PHONE_OTP_ALLOWED_NUMBERS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * True only when EVERY gate is satisfied. Any missing/blank flag → false.
 * This is the single source of truth for whether the fake path may run.
 */
export function devPhoneOtpEnabled(): boolean {
  if (process.env.MADAF_DEV_PHONE_OTP_ENABLED !== "true") return false;
  // Never in a production build.
  if (process.env.NODE_ENV === "production") return false;
  // Never against a non-local hosted Supabase project.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (url && !isLocalSupabaseUrl(url)) return false;
  // Must have a code and at least one explicitly-allowed number.
  if (devOtpCode().length === 0) return false;
  if (devPhoneOtpNumbers().length === 0) return false;
  return true;
}

/** True when `phone` is an explicitly-allowed dev number AND the path is on. */
export function isDevPhoneAllowed(phone: string): boolean {
  return devPhoneOtpEnabled() && devPhoneOtpNumbers().includes(phone);
}

/**
 * Verify a dev fake OTP: the path must be enabled, the phone must be
 * allow-listed, and the code must match exactly. Fails closed otherwise.
 */
export function verifyDevPhoneOtp(phone: string, code: string): boolean {
  if (!isDevPhoneAllowed(phone)) return false;
  const expected = devOtpCode();
  return expected.length > 0 && typeof code === "string" && code === expected;
}
