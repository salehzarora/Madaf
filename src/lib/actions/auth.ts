"use server";

/**
 * Auth Server Actions (M4A) — email/password sign-in + sign-out via the
 * cookie-bound Supabase server client. The session lives in httpOnly
 * cookies; no token ever reaches client JS. Supabase mode only — mock
 * mode has no auth (and no login page is reachable in mock).
 */
import { revalidatePath } from "next/cache";

import { createServerAuthClient } from "@/lib/supabase/server-auth";

export interface AuthResult {
  ok: boolean;
}

function isEmail(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 254 &&
    /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)
  );
}

export async function signInAction(input: {
  email: string;
  password: string;
}): Promise<AuthResult> {
  try {
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
