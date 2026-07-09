"use client";

import { LogIn, UserPlus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/types";
import { signInAction, signUpAction } from "@/lib/actions/auth";

export function LoginForm({
  locale,
  dict,
  next,
}: {
  locale: Locale;
  dict: Dictionary;
  /** Safe (server-validated) same-locale path to return to after sign-in. */
  next?: string;
}) {
  const t = dict.access.login;
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFailed(false);
    const fd = new FormData(event.currentTarget);
    const email = String(fd.get("email") ?? "");
    const password = String(fd.get("password") ?? "");
    setPending(true);
    try {
      if (mode === "signup") {
        const result = await signUpAction({ email, password });
        if (result.ok) {
          // Honor a validated return path first (M8A): an email-invited
          // teammate signing up must land back on the invite page, not be
          // derailed into creating their own tenant. Without one, a fresh
          // account has no membership → onboarding.
          router.replace(next ?? `/${locale}/onboarding`);
          router.refresh();
          return;
        }
      } else {
        const result = await signInAction({ email, password });
        if (result.ok) {
          router.replace(next ?? `/${locale}/admin`);
          router.refresh();
          return;
        }
      }
    } catch {
      // fall through
    }
    setPending(false);
    setFailed(true);
  }

  const isSignup = mode === "signup";

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div>
        <Label htmlFor="login-email">{t.email}</Label>
        <Input
          id="login-email"
          name="email"
          type="email"
          autoComplete="email"
          mono
          dir="ltr"
          required
        />
      </div>
      <div>
        <div className="flex items-baseline justify-between">
          <Label htmlFor="login-password">{t.password}</Label>
          {!isSignup ? (
            <Link
              href={`/${locale}/reset-password`}
              className="mb-1.5 rounded-sm text-xs font-medium text-brand-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
            >
              {t.forgotPassword}
            </Link>
          ) : null}
        </div>
        <Input
          id="login-password"
          name="password"
          type="password"
          autoComplete={isSignup ? "new-password" : "current-password"}
          dir="ltr"
          minLength={isSignup ? 8 : undefined}
          required
        />
      </div>
      {failed ? (
        <p
          role="alert"
          className="rounded-field bg-danger-soft px-3 py-2 text-sm font-medium text-danger"
        >
          {isSignup ? t.signUpError : t.error}
        </p>
      ) : null}
      <Button type="submit" size="lg" disabled={pending} className="mt-1 w-full">
        {isSignup ? (
          <UserPlus className="size-4 rtl:-scale-x-100" aria-hidden />
        ) : (
          <LogIn className="size-4 rtl:-scale-x-100" aria-hidden />
        )}
        {isSignup
          ? pending
            ? t.signingUp
            : t.signUp
          : pending
            ? t.signingIn
            : t.signIn}
      </Button>
      <button
        type="button"
        onClick={() => {
          setMode(isSignup ? "signin" : "signup");
          setFailed(false);
        }}
        className="rounded-sm text-center text-sm font-medium text-brand-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
      >
        {isSignup ? t.haveAccount : t.noAccount}
      </button>
    </form>
  );
}
