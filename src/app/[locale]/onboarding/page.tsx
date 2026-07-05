import { notFound, redirect } from "next/navigation";
import { OnboardingForm } from "@/components/auth/onboarding-form";
import { Card } from "@/components/ui/card";
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
    <div className="flex min-h-dvh items-center justify-center bg-surface-sunken px-4 py-12">
      <Card className="w-full max-w-md p-6 sm:p-8">
        <h1 className="text-2xl font-bold tracking-tight text-ink">{t.title}</h1>
        <p className="mt-1 text-sm text-ink-muted">{t.subtitle}</p>
        <div className="mt-6">
          <OnboardingForm locale={locale} dict={dict} />
        </div>
      </Card>
    </div>
  );
}
