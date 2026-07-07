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
 * Whether email + password authentication is permitted AT ALL. This is the
 * SINGLE source of truth used by BOTH the UI (fallback visibility) and the
 * server actions (`signInAction`/`signUpAction`), so the browser can never
 * reach an endpoint the policy hides — M7B.1 blocker #2.
 *
 * Allowed when ANY of:
 *  - email is the primary method (`MADAF_AUTH_PRIMARY_METHOD=email`), or
 *  - explicitly enabled via the server-only `MADAF_EMAIL_AUTH_ENABLED=true`
 *    (e.g. an email-invite-heavy phone-primary production deployment), or
 *  - not a production build (dev/local: the seeded demo users are
 *    email-based and the email-invite limitation needs email sign-in).
 *
 * So a **phone-primary production** deployment with no explicit opt-in has
 * email/password fully OFF — the UI hides it AND the server actions reject it.
 * Server-only; never `NEXT_PUBLIC` (a missing/blank flag reads as false).
 */
export function emailPasswordAuthAllowed(): boolean {
  if (authPrimaryMethod() === "email") return true;
  if (process.env.MADAF_EMAIL_AUTH_ENABLED === "true") return true;
  return process.env.NODE_ENV !== "production";
}

/**
 * Whether the email + password form should be shown on the login screen.
 * Aliased to {@link emailPasswordAuthAllowed} so UI visibility and server
 * enforcement can never diverge.
 */
export function emailFallbackVisible(): boolean {
  return emailPasswordAuthAllowed();
}
