"use client";

import { KeyRound, MailCheck } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/types";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type Phase = "request" | "sent" | "update" | "done";

/**
 * Password reset (client-side): the recovery token arrives in the URL
 * fragment, which only the browser can read. When Supabase detects it, it
 * fires PASSWORD_RECOVERY and we switch to the "set a new password" form;
 * otherwise we show the "email me a link" request form.
 */
export function ResetPasswordForm({
  locale,
  dict,
}: {
  locale: Locale;
  dict: Dictionary;
}) {
  const t = dict.access.reset;
  const [phase, setPhase] = useState<Phase>("request");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setPhase("update");
    });
    return () => subscription.unsubscribe();
  }, []);

  async function onRequest(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(false);
    const fd = new FormData(event.currentTarget);
    const email = String(fd.get("email") ?? "");
    setPending(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const { error: err } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/${locale}/reset-password`,
      });
      if (!err) {
        setPhase("sent");
        return;
      }
    } catch {
      // fall through
    }
    setError(true);
    setPending(false);
  }

  async function onUpdate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(false);
    const fd = new FormData(event.currentTarget);
    const password = String(fd.get("password") ?? "");
    setPending(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const { error: err } = await supabase.auth.updateUser({ password });
      if (!err) {
        setPhase("done");
        return;
      }
    } catch {
      // fall through
    }
    setError(true);
    setPending(false);
  }

  if (phase === "sent") {
    return (
      <div className="text-center">
        <MailCheck className="mx-auto size-12 text-success" aria-hidden />
        <h2 className="mt-3 text-lg font-bold text-ink">{t.sentTitle}</h2>
        <p className="mt-1 text-sm text-ink-soft">{t.sentBody}</p>
        <Link
          href={`/${locale}/login`}
          className="mt-5 inline-block rounded-sm text-sm font-medium text-brand-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
        >
          {t.backToLogin}
        </Link>
      </div>
    );
  }

  if (phase === "done") {
    return (
      <div className="text-center">
        <KeyRound className="mx-auto size-12 text-success" aria-hidden />
        <h2 className="mt-3 text-lg font-bold text-ink">{t.updatedTitle}</h2>
        <p className="mt-1 text-sm text-ink-soft">{t.updatedBody}</p>
        <Link
          href={`/${locale}/login`}
          className="mt-5 inline-block rounded-sm text-sm font-medium text-brand-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
        >
          {t.backToLogin}
        </Link>
      </div>
    );
  }

  const errorBanner = error ? (
    <p
      role="alert"
      className="rounded-field bg-danger-soft px-3 py-2 text-sm font-medium text-danger"
    >
      {t.error}
    </p>
  ) : null;

  if (phase === "update") {
    return (
      <form onSubmit={onUpdate} className="flex flex-col gap-4">
        <p className="text-sm text-ink-soft">{t.newSubtitle}</p>
        <div>
          <Label htmlFor="reset-password">{t.newPassword}</Label>
          <Input
            id="reset-password"
            name="password"
            type="password"
            autoComplete="new-password"
            dir="ltr"
            minLength={8}
            required
          />
        </div>
        {errorBanner}
        <Button type="submit" size="lg" disabled={pending} className="mt-1 w-full">
          <KeyRound className="size-4" aria-hidden />
          {pending ? t.updating : t.update}
        </Button>
      </form>
    );
  }

  return (
    <form onSubmit={onRequest} className="flex flex-col gap-4">
      <p className="text-sm text-ink-soft">{t.requestSubtitle}</p>
      <div>
        <Label htmlFor="reset-email">{t.email}</Label>
        <Input
          id="reset-email"
          name="email"
          type="email"
          autoComplete="email"
          mono
          dir="ltr"
          required
        />
      </div>
      {errorBanner}
      <Button type="submit" size="lg" disabled={pending} className="mt-1 w-full">
        {pending ? t.sending : t.sendLink}
      </Button>
      <Link
        href={`/${locale}/login`}
        className="rounded-sm text-center text-sm font-medium text-brand-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
      >
        {t.backToLogin}
      </Link>
    </form>
  );
}
