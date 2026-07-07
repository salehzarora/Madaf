"use client";

import { ArrowLeft, MessageSquare, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/types";
import { sendPhoneOtpAction, verifyPhoneOtpAction } from "@/lib/actions/auth";
import { looksLikePhone, normalizePhoneE164 } from "@/lib/auth/phone";

const RESEND_SECONDS = 30;

/**
 * Phone-number OTP sign-in (M7B) — primary supplier/admin login UX.
 *
 * Two steps: enter phone → enter the code texted to it. On success the
 * existing tenant/membership routing takes over (admin layout sends a
 * member to the dashboard, a session with no membership to onboarding).
 *
 * The OTP code is verified server-side; it never lives in this bundle. When
 * `devNotice` is set, a clearly-labelled DEV banner is shown (real SMS is
 * off and only pre-configured test numbers work) — but the fake code itself
 * is NEVER exposed here.
 */
export function PhoneOtpForm({
  locale,
  dict,
  next,
  devNotice = false,
}: {
  locale: Locale;
  dict: Dictionary;
  next?: string;
  /** Show the "developer test mode" banner (no real SMS). */
  devNotice?: boolean;
}) {
  const t = dict.access.login.phone;
  const router = useRouter();
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [phone, setPhone] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => setCooldown((c) => (c > 0 ? c - 1 : 0)), 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  async function requestCode(raw: string): Promise<boolean> {
    const normalized = normalizePhoneE164(raw);
    if (!normalized) {
      setError(t.invalidPhone);
      return false;
    }
    setError(null);
    setPending(true);
    try {
      const result = await sendPhoneOtpAction({ phone: normalized });
      if (result.ok) {
        setPhone(normalized);
        setStep("code");
        setCooldown(RESEND_SECONDS);
        return true;
      }
      setError(t.sendError);
    } catch {
      setError(t.sendError);
    } finally {
      setPending(false);
    }
    return false;
  }

  async function onPhoneSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    await requestCode(String(fd.get("phone") ?? ""));
  }

  async function onCodeSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    const token = String(fd.get("code") ?? "").trim();
    setError(null);
    setPending(true);
    try {
      const result = await verifyPhoneOtpAction({ phone, token });
      if (result.ok) {
        router.replace(next ?? `/${locale}/admin`);
        router.refresh();
        return;
      }
      setError(t.verifyError);
    } catch {
      setError(t.verifyError);
    }
    setPending(false);
  }

  const errorBanner = error ? (
    <p
      role="alert"
      className="rounded-field bg-danger-soft px-3 py-2 text-sm font-medium text-danger"
    >
      {error}
    </p>
  ) : null;

  const devBanner = devNotice ? (
    <p className="rounded-field bg-warning-soft px-3 py-2 text-[13px] font-medium text-warning">
      {t.devNotice}
    </p>
  ) : null;

  if (step === "code") {
    return (
      <form onSubmit={onCodeSubmit} className="flex flex-col gap-4">
        {devBanner}
        <p className="text-sm text-ink-soft">
          {t.step2Subtitle}{" "}
          <span className="font-mono font-semibold text-ink" dir="ltr">
            {phone}
          </span>
        </p>
        <div>
          <Label htmlFor="otp-code">{t.codeLabel}</Label>
          <Input
            id="otp-code"
            name="code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={8}
            placeholder={t.codePlaceholder}
            mono
            dir="ltr"
            required
            autoFocus
          />
        </div>
        {errorBanner}
        <Button type="submit" size="lg" disabled={pending} className="mt-1 w-full">
          <ShieldCheck className="size-4" aria-hidden />
          {pending ? t.verifying : t.verify}
        </Button>
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => {
              setStep("phone");
              setError(null);
            }}
            className="inline-flex items-center gap-1 rounded-sm text-sm font-medium text-brand-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
          >
            <ArrowLeft className="size-3.5 rtl:-scale-x-100" aria-hidden />
            {t.changeNumber}
          </button>
          <button
            type="button"
            disabled={cooldown > 0 || pending}
            onClick={() => requestCode(phone)}
            className="rounded-sm text-sm font-medium text-brand-700 hover:underline disabled:cursor-not-allowed disabled:text-ink-muted disabled:no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
          >
            {cooldown > 0
              ? t.resendCountdown.replace("{seconds}", String(cooldown))
              : t.resend}
          </button>
        </div>
      </form>
    );
  }

  return (
    <form onSubmit={onPhoneSubmit} className="flex flex-col gap-4">
      {devBanner}
      <p className="text-sm text-ink-soft">{t.step1Subtitle}</p>
      <div>
        <Label htmlFor="otp-phone">{t.label}</Label>
        <Input
          id="otp-phone"
          name="phone"
          type="tel"
          autoComplete="tel"
          placeholder={t.placeholder}
          mono
          dir="ltr"
          required
          autoFocus
          onChange={(e) => {
            if (error && looksLikePhone(e.currentTarget.value)) setError(null);
          }}
        />
        <p className="mt-1.5 text-xs text-ink-muted">{t.hint}</p>
      </div>
      {errorBanner}
      <Button type="submit" size="lg" disabled={pending} className="mt-1 w-full">
        <MessageSquare className="size-4 rtl:-scale-x-100" aria-hidden />
        {pending ? t.sendingCode : t.sendCode}
      </Button>
    </form>
  );
}
