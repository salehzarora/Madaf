"use client";

import { useState } from "react";
import { LoginForm } from "@/components/auth/login-form";
import { PhoneOtpForm } from "@/components/auth/phone-otp-form";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/types";
import type { AuthMethod } from "@/lib/config/auth";

/**
 * Login panel (M7B) — phone OTP is the primary method; email + password is a
 * secondary fallback shown only when `emailFallbackVisible` (always in dev;
 * in production only for email-primary deployments). A small toggle switches
 * between the two; tenant/membership routing is identical for both.
 */
export function AuthPanel({
  locale,
  dict,
  next,
  primaryMethod,
  emailFallbackVisible,
  devNotice = false,
}: {
  locale: Locale;
  dict: Dictionary;
  next?: string;
  primaryMethod: AuthMethod;
  emailFallbackVisible: boolean;
  devNotice?: boolean;
}) {
  const t = dict.access.login;
  const [method, setMethod] = useState<AuthMethod>(
    primaryMethod === "email" && emailFallbackVisible ? "email" : "phone",
  );

  return (
    <div className="flex flex-col gap-4">
      {method === "phone" ? (
        <PhoneOtpForm
          locale={locale}
          dict={dict}
          next={next}
          devNotice={devNotice}
        />
      ) : (
        <LoginForm locale={locale} dict={dict} next={next} />
      )}

      {emailFallbackVisible ? (
        <button
          type="button"
          onClick={() => setMethod(method === "phone" ? "email" : "phone")}
          className="rounded-sm text-center text-sm font-medium text-brand-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
        >
          {method === "phone" ? t.useEmail : t.usePhone}
        </button>
      ) : null}
    </div>
  );
}
