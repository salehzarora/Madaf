import { notFound, redirect } from "next/navigation";
import { NotificationSettings } from "@/components/admin/notification-settings";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { getSessionContext } from "@/lib/auth/session";
import { getDataMode } from "@/lib/data/mode";
import { getPushPreferences, pushPreferenceScope } from "@/lib/data/push-preferences";

export const dynamic = "force-dynamic";
export default async function NotificationSettingsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const live = getDataMode() === "supabase";
  let scope = "mock";
  if (live) {
    const { userId, membership } = await getSessionContext();
    if (!userId) redirect(`/${locale}/login`);
    if (!membership) redirect(`/${locale}/onboarding`);
    if (membership.role === "sales_rep") notFound();
    scope = pushPreferenceScope(userId, membership.tenantId);
  }
  const initial = await getPushPreferences();
  const text = getDictionary(locale).notificationSettings;
  return <div className="mx-auto flex w-full min-w-0 max-w-2xl flex-col gap-5">
    <header><h1 className="text-2xl font-extrabold text-[var(--admin-navy)]">{text.title}</h1>
      <p className="mt-2 text-sm leading-relaxed text-[var(--admin-muted)]">{text.description}</p></header>
    <NotificationSettings key={scope} initial={initial} text={text} live={live} scope={scope} />
  </div>;
}
