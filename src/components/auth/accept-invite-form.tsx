"use client";

import { CheckCircle2, UserCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/types";
import {
  acceptInviteAction,
  type InviteFailReason,
} from "@/lib/actions/team";

export function AcceptInviteForm({
  locale,
  dict,
  token,
}: {
  locale: Locale;
  dict: Dictionary;
  token: string;
}) {
  const t = dict.access.invite;
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [reason, setReason] = useState<InviteFailReason | null>(null);

  async function onAccept() {
    setReason(null);
    setPending(true);
    try {
      const result = await acceptInviteAction({ token, locale });
      if (result.ok) {
        setDone(true);
        router.refresh();
        return;
      }
      setReason(result.reason);
    } catch {
      setReason("error");
    }
    setPending(false);
  }

  if (done) {
    return (
      <div className="text-center">
        <CheckCircle2 className="mx-auto size-12 text-success" aria-hidden />
        <h2 className="mt-3 text-lg font-bold text-ink">{t.successTitle}</h2>
        <p className="mt-1 text-sm text-ink-soft">{t.successBody}</p>
        <Button
          size="lg"
          onClick={() => {
            router.replace(`/${locale}/admin`);
            router.refresh();
          }}
          className="mt-5 w-full"
        >
          {t.goToAdmin}
        </Button>
      </div>
    );
  }

  const errorText: Record<InviteFailReason, string> = {
    wrongEmail: t.errorWrongEmail,
    alreadyMember: t.errorAlreadyMember,
    invalid: t.errorInvalid,
    error: t.errorGeneric,
  };

  return (
    <div className="flex flex-col gap-4">
      {reason ? (
        <p
          role="alert"
          className="rounded-field bg-danger-soft px-3 py-2 text-sm font-medium text-danger"
        >
          {errorText[reason]}
        </p>
      ) : null}
      <Button onClick={onAccept} disabled={pending} size="lg" className="w-full">
        <UserCheck className="size-4 rtl:-scale-x-100" aria-hidden />
        {pending ? t.accepting : t.accept}
      </Button>
      {reason === "wrongEmail" || reason === "alreadyMember" ? (
        <Link
          href={`/${locale}/admin`}
          className="rounded-sm text-center text-sm font-medium text-brand-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
        >
          {t.goToAdmin}
        </Link>
      ) : null}
    </div>
  );
}
