import { notFound, redirect } from "next/navigation";
import { OnboardingForm } from "@/components/auth/onboarding-form";
import { LogoMark } from "@/components/logo";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { getSessionContext } from "@/lib/auth/session";
import { getDataMode } from "@/lib/data";

/** Create a supplier for a signed-in user who has no membership yet. */
export default async function OnboardingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  if (getDataMode() !== "supabase") notFound();

  const { userId, membership } = await getSessionContext();
  if (!userId) redirect(`/${locale}/login`);
  if (membership) redirect(`/${locale}/admin`);

  const dict = getDictionary(locale);
  const t = dict.access.onboarding;

  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-band px-4 py-12">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[repeating-linear-gradient(0deg,transparent,transparent_118px,rgb(244_241_232/0.06)_118px,rgb(244_241_232/0.06)_120px)]"
      />
      <div className="relative w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <LogoMark className="size-9" />
          <span className="flex items-baseline gap-1.5">
            <span className="text-lg font-bold tracking-tight text-band-ink">
              {dict.meta.appNameNative}
            </span>
            {dict.meta.appNameNative !== dict.meta.appName ? (
              <span className="text-sm font-medium text-band-muted">
                {dict.meta.appName}
              </span>
            ) : null}
          </span>
        </div>
        <div className="rounded-2xl bg-surface-parchment p-8 shadow-float">
          <h1 className="text-[22px] font-extrabold tracking-[-0.01em] text-ink">
            {t.title}
          </h1>
          <p className="mt-1 text-sm text-ink-soft">{t.subtitle}</p>
          <div className="mt-6">
            <OnboardingForm locale={locale} dict={dict} />
          </div>
        </div>
      </div>
    </div>
  );
}
