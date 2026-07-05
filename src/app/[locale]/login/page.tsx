import { notFound, redirect } from "next/navigation";
import { LoginForm } from "@/components/auth/login-form";
import { LogoMark, LogoWordmark } from "@/components/logo";
import { Card } from "@/components/ui/card";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { getSessionContext } from "@/lib/auth/session";
import { getDataMode } from "@/lib/data";

/** Supplier sign-in (Supabase mode only). Mock mode has no auth. */
export default async function LoginPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  if (getDataMode() !== "supabase") notFound();

  const { userId, membership } = await getSessionContext();
  if (userId && membership) redirect(`/${locale}/admin`);
  if (userId && !membership) redirect(`/${locale}/onboarding`);

  const dict = getDictionary(locale);
  const t = dict.access.login;

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
        <h1 className="text-2xl font-bold tracking-tight text-ink">{t.title}</h1>
        <p className="mt-1 text-sm text-ink-muted">{t.subtitle}</p>
        <div className="mt-6">
          <LoginForm locale={locale} dict={dict} />
        </div>
      </Card>
    </div>
  );
}
