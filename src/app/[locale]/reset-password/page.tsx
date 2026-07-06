import { notFound } from "next/navigation";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { LogoMark } from "@/components/logo";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { getDataMode } from "@/lib/data";

/** Password reset (Supabase mode only). Request a link, or set a new password. */
export default async function ResetPasswordPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  if (getDataMode() !== "supabase") notFound();

  const dict = getDictionary(locale);
  const t = dict.access.reset;

  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-band px-4 py-12">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[repeating-linear-gradient(0deg,transparent,transparent_118px,rgb(244_241_232/0.06)_118px,rgb(244_241_232/0.06)_120px)]"
      />
      <div className="relative w-full max-w-sm">
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
            {t.requestTitle}
          </h1>
          <div className="mt-6">
            <ResetPasswordForm locale={locale} dict={dict} />
          </div>
        </div>
      </div>
    </div>
  );
}
