import { notFound } from "next/navigation";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { LogoMark, LogoWordmark } from "@/components/logo";
import { Card } from "@/components/ui/card";
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
    <div className="flex min-h-dvh items-center justify-center bg-surface-sunken px-4 py-12">
      <Card className="w-full max-w-sm p-6 sm:p-8">
        <div className="mb-6 flex items-center gap-2.5">
          <LogoMark />
          <LogoWordmark
            appName={dict.meta.appName}
            appNameNative={dict.meta.appNameNative}
          />
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-ink">
          {t.requestTitle}
        </h1>
        <div className="mt-6">
          <ResetPasswordForm locale={locale} dict={dict} />
        </div>
      </Card>
    </div>
  );
}
