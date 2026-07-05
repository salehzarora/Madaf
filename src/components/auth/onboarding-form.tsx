"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { localeNames, locales, type Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/types";
import { createTenantAction } from "@/lib/actions/tenant";

export function OnboardingForm({
  locale,
  dict,
}: {
  locale: Locale;
  dict: Dictionary;
}) {
  const t = dict.access.onboarding;
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFailed(false);
    const fd = new FormData(event.currentTarget);
    setPending(true);
    try {
      const result = await createTenantAction({
        nameAr: String(fd.get("nameAr") ?? ""),
        nameHe: String(fd.get("nameHe") ?? ""),
        nameEn: String(fd.get("nameEn") ?? ""),
        defaultLocale: String(fd.get("defaultLocale") ?? "he"),
      });
      if (result.ok) {
        router.replace(`/${locale}/admin`);
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
        <Label htmlFor="ob-he">{t.nameHe}</Label>
        <Input id="ob-he" name="nameHe" dir="rtl" lang="he" required />
      </div>
      <div>
        <Label htmlFor="ob-ar">{t.nameAr}</Label>
        <Input id="ob-ar" name="nameAr" dir="rtl" lang="ar" required />
      </div>
      <div>
        <Label htmlFor="ob-en">{t.nameEn}</Label>
        <Input id="ob-en" name="nameEn" dir="ltr" lang="en" required />
      </div>
      <div>
        <Label htmlFor="ob-locale">{t.defaultLocale}</Label>
        <Select id="ob-locale" name="defaultLocale" defaultValue={locale}>
          {locales.map((l) => (
            <option key={l} value={l}>
              {localeNames[l]}
            </option>
          ))}
        </Select>
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
        {pending ? t.creating : t.create}
      </Button>
    </form>
  );
}
