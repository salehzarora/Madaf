"use client";

import { LogIn } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/types";
import { signInAction } from "@/lib/actions/auth";

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
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFailed(false);
    const fd = new FormData(event.currentTarget);
    setPending(true);
    try {
      const result = await signInAction({
        email: String(fd.get("email") ?? ""),
        password: String(fd.get("password") ?? ""),
      });
      if (result.ok) {
        router.replace(next ?? `/${locale}/admin`);
        router.refresh();
        return;
      }
    } catch {
      // fall through
    }
    setPending(false);
    setFailed(true);
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div>
        <Label htmlFor="login-email">{t.email}</Label>
        <Input
          id="login-email"
          name="email"
          type="email"
          autoComplete="email"
          dir="ltr"
          required
        />
      </div>
      <div>
        <Label htmlFor="login-password">{t.password}</Label>
        <Input
          id="login-password"
          name="password"
          type="password"
          autoComplete="current-password"
          dir="ltr"
          required
        />
      </div>
      {failed ? (
        <p
          role="alert"
          className="rounded-field bg-danger-soft px-3 py-2 text-sm font-medium text-danger"
        >
          {t.error}
        </p>
      ) : null}
      <Button type="submit" size="lg" disabled={pending} className="mt-1 w-full">
        <LogIn className="size-4 rtl:-scale-x-100" aria-hidden />
        {pending ? t.signingIn : t.signIn}
      </Button>
    </form>
  );
}
