import "server-only";

/**
 * Auth method configuration (M7B) — SERVER-ONLY.
 *
 * Madaf's primary supplier/admin sign-in is **phone-number OTP**. Email +
 * password is retained as a secondary, dev/local fallback (the seeded demo
 * users are email-based) but is hidden by default in production.
 *
 * These flags NEVER change the tenant/RLS/security model: whichever method a
 * user signs in with, Supabase Auth still issues a session bound to an
 * `auth.users` id, and tenant membership / roles / RLS are resolved from
 * `tenant_users` exactly as before. Server-only — never `NEXT_PUBLIC`.
 */

export type AuthMethod = "phone" | "email";

/**
 * The primary login method shown first in the UI. Defaults to `phone`; set
 * `MADAF_AUTH_PRIMARY_METHOD=email` only for an email-first deployment.
 */
export function authPrimaryMethod(): AuthMethod {
  return process.env.MADAF_AUTH_PRIMARY_METHOD === "email" ? "email" : "phone";
}

/**
 * Whether the email + password form should be offered as a fallback on the
 * login screen. Always available in non-production (the demo users are
 * email-based); in production it appears only when email is the primary
 * method. Phone-primary production deployments therefore show phone OTP only.
 */
export function emailFallbackVisible(): boolean {
  if (authPrimaryMethod() === "email") return true;
  return process.env.NODE_ENV !== "production";
}
