"use server";

/**
 * Auth Server Actions (M4A sign-in/out · M4C sign-up · M7B phone OTP) — via
 * the cookie-bound Supabase server client. The session lives in httpOnly
 * cookies; no token ever reaches client JS. Supabase mode only — mock mode
 * has no auth. (Password reset runs client-side on /reset-password because
 * the recovery token arrives in the URL fragment.)
 *
 * M7B makes **phone OTP the primary** method (`sendPhoneOtpAction` /
 * `verifyPhoneOtpAction`). In Supabase mode these call ONLY `signInWithOtp`
 * / `verifyOtp` — real Supabase Auth, real session, unchanged RLS. In mock
 * mode (no backend) they consult the fail-closed DEV fake-OTP path
 * (`src/lib/auth/dev-otp.ts`), which invents no session and grants no tenant
 * access. Email/password stays as a secondary dev/local fallback.
 */
import { revalidatePath } from "next/cache";

import { verifyDevPhoneOtp, isDevPhoneAllowed } from "@/lib/auth/dev-otp";
import { normalizePhoneE164 } from "@/lib/auth/phone";
import { emailPasswordAuthAllowed } from "@/lib/config/auth";
import { getDataMode } from "@/lib/data";
import { createServerAuthClient } from "@/lib/supabase/server-auth";

export interface AuthResult {
  ok: boolean;
}

/** Phone-OTP send result. `dev` marks the mock/dev fake path (no real SMS). */
export interface OtpSendResult {
  ok: boolean;
  dev?: boolean;
}

function isEmail(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 254 &&
    /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)
  );
}

/**
 * Step 1 — request an OTP for a phone number.
 *
 * Supabase mode: `signInWithOtp({ phone })` (real SMS in hosted; local test
 * numbers configured in supabase/config.toml [auth.sms.test_otp] don't send).
 * Mock mode: the fail-closed dev fake path — succeeds only for an
 * allow-listed dev number when the dev path is explicitly enabled.
 */
export async function sendPhoneOtpAction(input: {
  phone: string;
}): Promise<OtpSendResult> {
  try {
    const phone = normalizePhoneE164(input.phone ?? "");
    if (!phone) return { ok: false };

    if (getDataMode() !== "supabase") {
      // No backend: only the explicitly-configured dev fake number is allowed.
      return isDevPhoneAllowed(phone) ? { ok: true, dev: true } : { ok: false };
    }

    const client = await createServerAuthClient();
    const { error } = await client.auth.signInWithOtp({ phone });
    if (error) return { ok: false };
    return { ok: true };
  } catch {
    // Never log the phone number or any OTP material (avoid leaking PII).
    console.error("[madaf/actions] sendPhoneOtpAction failed");
    return { ok: false };
  }
}

/**
 * Step 2 — verify the OTP code and establish the session.
 *
 * Supabase mode: `verifyOtp({ phone, token, type: "sms" })` sets the httpOnly
 * session cookies; tenant/membership routing then proceeds unchanged. Mock
 * mode: the fail-closed dev fake path — the phone must be allow-listed and
 * the code must equal the configured dev code; no session is created (mock
 * admin is already open, so no access is granted beyond the demo).
 */
export async function verifyPhoneOtpAction(input: {
  phone: string;
  token: string;
}): Promise<AuthResult> {
  try {
    const phone = normalizePhoneE164(input.phone ?? "");
    const token = typeof input.token === "string" ? input.token.trim() : "";
    if (!phone || token.length < 4 || token.length > 12) return { ok: false };

    if (getDataMode() !== "supabase") {
      return verifyDevPhoneOtp(phone, token) ? { ok: true } : { ok: false };
    }

    const client = await createServerAuthClient();
    const { error } = await client.auth.verifyOtp({
      phone,
      token,
      type: "sms",
    });
    if (error) return { ok: false };
    return { ok: true };
  } catch {
    console.error("[madaf/actions] verifyPhoneOtpAction failed");
    return { ok: false };
  }
}

export async function signInAction(input: {
  email: string;
  password: string;
}): Promise<AuthResult> {
  try {
    // Server-enforced policy (M7B.1): email/password is OFF by default in
    // phone-primary production. Reject with a generic error — no config leak.
    if (!emailPasswordAuthAllowed()) return { ok: false };
    if (!isEmail(input.email)) return { ok: false };
    if (typeof input.password !== "string" || input.password.length < 6) {
      return { ok: false };
    }
    const client = await createServerAuthClient();
    const { error } = await client.auth.signInWithPassword({
      email: input.email,
      password: input.password,
    });
    if (error) return { ok: false };
    return { ok: true };
  } catch (error) {
    console.error("[madaf/actions] signInAction failed:", error);
    return { ok: false };
  }
}

/**
 * Sign up a new supplier user (local dev has email confirmations OFF, so a
 * session is created immediately). A fresh account has no tenant membership,
 * so the caller sends them to onboarding.
 */
export async function signUpAction(input: {
  email: string;
  password: string;
}): Promise<AuthResult> {
  try {
    // Same server-enforced policy as signInAction (M7B.1).
    if (!emailPasswordAuthAllowed()) return { ok: false };
    if (!isEmail(input.email)) return { ok: false };
    if (typeof input.password !== "string" || input.password.length < 8) {
      return { ok: false };
    }
    const client = await createServerAuthClient();
    const { error } = await client.auth.signUp({
      email: input.email,
      password: input.password,
    });
    if (error) return { ok: false };
    return { ok: true };
  } catch (error) {
    console.error("[madaf/actions] signUpAction failed:", error);
    return { ok: false };
  }
}

export async function signOutAction(locale: string): Promise<AuthResult> {
  try {
    const client = await createServerAuthClient();
    await client.auth.signOut();
    if (typeof locale === "string" && /^[a-z]{2}$/.test(locale)) {
      revalidatePath(`/${locale}`, "layout");
    }
    return { ok: true };
  } catch (error) {
    console.error("[madaf/actions] signOutAction failed:", error);
    return { ok: false };
  }
}
