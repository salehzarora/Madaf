import { notFound, redirect } from "next/navigation";
import { BusinessProfileForm } from "@/components/admin/business-profile-form";
import { SettingsTimeline } from "@/components/admin/settings-timeline";
import { TimezoneSettings } from "@/components/admin/timezone-settings";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ShelfRule } from "@/components/ui/shelf-rule";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { loadSettingsTimelineAction } from "@/lib/actions/settings-timeline";
import { getSessionContext } from "@/lib/auth/session";
import {
  getDataMode,
  getSettingsTimelinePage,
  getSupplier,
  getTenantTimeZone,
  safeInitialSettingsTimeline,
} from "@/lib/data";
import { TIME_ZONE_OPTIONS } from "@/lib/time-catalog";

/**
 * Business profile settings — owner/admin only (Supabase mode); a demo form in
 * mock mode. NON-LEGAL: edits the display identity (name/logo/contact/address)
 * + a display VAT rate for draft estimates. Issues nothing; legal_effective
 * stays false. Reads the tenant under RLS, so it must render per request.
 */
export const dynamic = "force-dynamic";

export default async function AdminBusinessSettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const dict = getDictionary(locale);
  const live = getDataMode() === "supabase";

  // Supabase: owner/admin only, sales_rep blocked. Mock: open demo.
  if (live) {
    const { userId, membership } = await getSessionContext();
    if (!userId) redirect(`/${locale}/login`);
    if (!membership) redirect(`/${locale}/onboarding`);
    if (membership.role === "sales_rep") notFound();
  }

  const initial = await getSupplier();
  const t = dict.admin.settings.business;

  // The Settings Activity read is OPTIONAL + isolated (owner/admin RLS): if it
  // fails, Settings editing must still render. Supabase mode only. Started
  // concurrently, never blocks the settings forms.
  const settingsTimeline = live
    ? await safeInitialSettingsTimeline(() => getSettingsTimelinePage())
    : null;
  const timeZone = await getTenantTimeZone();

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
      <div>
        <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-muted">
          {dict.nav.admin}
        </p>
        <h1 className="mt-1 text-[28px] font-extrabold tracking-[-0.02em] text-ink">
          {t.title}
        </h1>
        <p className="mt-0.5 text-sm text-ink-muted">{t.subtitle}</p>
        <ShelfRule className="mt-4" />
      </div>
      <BusinessProfileForm
        locale={locale}
        dict={dict}
        initial={initial}
        live={live}
      />
      <ShelfRule />
      {/* M8H.2 — the tenant timezone. This route is already owner/admin-only
          (sales_rep is 404'd above), so the control never renders for a rep, and
          the RPC re-verifies owner/admin server-side regardless. The option list
          is computed on the SERVER (bounded, canonical IANA + UTC — no browser
          API dependency and no query). */}
      <TimezoneSettings
        locale={locale}
        dict={dict}
        current={initial.timezone}
        options={TIME_ZONE_OPTIONS}
        live={live}
      />
      {live && settingsTimeline ? (
        <Card className="overflow-hidden">
          <CardHeader variant="strip">
            <CardTitle>{dict.audit.settings.timelineHeading}</CardTitle>
          </CardHeader>
          <CardContent>
            <SettingsTimeline
              locale={locale}
              dict={dict}
              initial={settingsTimeline}
              timeZone={timeZone}
              loadMore={loadSettingsTimelineAction}
            />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
