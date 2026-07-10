import { notFound, redirect } from "next/navigation";
import { BusinessProfileForm } from "@/components/admin/business-profile-form";
import { ShelfRule } from "@/components/ui/shelf-rule";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { getSessionContext } from "@/lib/auth/session";
import { getDataMode, getSupplier } from "@/lib/data";

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
    </div>
  );
}
