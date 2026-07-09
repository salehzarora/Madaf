"use client";

import { CheckCircle2, Store } from "lucide-react";
import { useState, useTransition } from "react";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/types";
import { submitSignupRequestAction } from "@/lib/actions/customer-signup";

/**
 * Anonymous new-store signup form (M7G). A prospective store opens the
 * supplier's tokenized link and submits its details — NO login, NO catalog,
 * no tenant data. The submission lands as a PENDING request the supplier
 * reviews. The token is validated server-side by the submit action/RPC.
 */
export function StoreSignupForm({
  locale,
  dict,
  token,
}: {
  locale: Locale;
  dict: Dictionary;
  token: string;
}) {
  const t = dict.access.signup;
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);
  const [error, setError] = useState(false);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(false);
    const fd = new FormData(event.currentTarget);
    const city = (fd.get("city") as string) || undefined;
    startTransition(async () => {
      const result = await submitSignupRequestAction({
        token,
        store: {
          name: fd.get("name"),
          contactName: fd.get("contactName") || undefined,
          phone: fd.get("phone") || undefined,
          email: fd.get("email") || undefined,
          // The single city input is stored under the visitor's language.
          [locale === "ar" ? "cityAr" : locale === "en" ? "cityEn" : "cityHe"]:
            city,
          address: fd.get("address") || undefined,
          notes: fd.get("notes") || undefined,
        },
      });
      if (result.ok) setDone(true);
      else setError(true);
    });
  }

  if (done) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-4 py-16 text-center">
        <CheckCircle2 className="size-14 text-success" aria-hidden />
        <h1 className="mt-4 text-2xl font-extrabold tracking-tight text-ink">
          {t.successTitle}
        </h1>
        <p className="mt-2 text-sm text-ink-soft">{t.successBody}</p>
      </main>
    );
  }

  return (
    <div className="min-h-dvh bg-surface-sunken">
      <header className="border-b border-line bg-surface-warm">
        <div className="mx-auto flex max-w-lg items-center gap-3 px-4 py-4">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-field bg-brand-50 text-brand-700">
            <Store className="size-5" aria-hidden />
          </span>
          <h1 className="text-lg font-bold tracking-tight text-ink">
            {t.title}
          </h1>
          <div className="ms-auto">
            <LocaleSwitcher current={locale} />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-lg px-4 py-6">
        <p className="rounded-field bg-info-soft px-4 py-3 text-sm text-info">
          {t.intro}
        </p>

        <form onSubmit={onSubmit} className="mt-5 flex flex-col gap-4">
          <div>
            <Label htmlFor="su-name">{t.storeName}</Label>
            <Input id="su-name" name="name" required maxLength={200} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="su-contact">
                {t.contactName} · {dict.common.optional}
              </Label>
              <Input id="su-contact" name="contactName" maxLength={200} />
            </div>
            <div>
              <Label htmlFor="su-phone">
                {t.phone} · {dict.common.optional}
              </Label>
              <Input id="su-phone" name="phone" dir="ltr" maxLength={40} />
            </div>
            <div>
              <Label htmlFor="su-email">{t.email}</Label>
              <Input id="su-email" name="email" type="email" dir="ltr" maxLength={254} />
            </div>
            <div>
              <Label htmlFor="su-city">
                {t.city} · {dict.common.optional}
              </Label>
              <Input id="su-city" name="city" maxLength={120} />
            </div>
          </div>
          <div>
            <Label htmlFor="su-address">
              {t.address} · {dict.common.optional}
            </Label>
            <Input id="su-address" name="address" maxLength={300} />
          </div>
          <div>
            <Label htmlFor="su-notes">
              {t.notes} · {dict.common.optional}
            </Label>
            <Textarea id="su-notes" name="notes" maxLength={2000} />
          </div>

          {error ? (
            <p
              role="alert"
              className="rounded-field bg-danger-soft px-3 py-2 text-sm font-medium text-danger"
            >
              {t.error}
            </p>
          ) : null}

          <Button type="submit" size="lg" disabled={pending}>
            {pending ? t.submitting : t.submit}
          </Button>
        </form>
      </main>
    </div>
  );
}
