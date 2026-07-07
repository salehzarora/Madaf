import { notFound, redirect } from "next/navigation";
import { TaxSettingsForm } from "@/components/admin/tax-settings-form";
import { ShelfRule } from "@/components/ui/shelf-rule";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { getSessionContext } from "@/lib/auth/session";
import { legalInvoicingStatus } from "@/lib/config/legal-invoicing";
import { getDataMode } from "@/lib/data";
import { getTenantTaxSettings } from "@/lib/data/tax-settings";

/**
 * Tax settings — owner/admin only (Supabase mode); a demo form in mock mode.
 *
 * ⚠️ INERT: this page ONLY edits a tenant's tax configuration. It issues no
 * tax invoices and exposes NO issue / allocation-number / provider / payment /
 * legal-download controls. Saving does not issue anything (the permanent
 * warning in the form says so, in all three languages).
 */
export default async function AdminTaxSettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const dict = getDictionary(locale);
  const live = getDataMode() === "supabase";

  // Supabase mode: real auth — owner/admin only, sales_rep blocked. Mock mode
  // is the open demo (no auth), rendered with an empty/disabled form.
  let initial = null;
  if (live) {
    const { userId, membership } = await getSessionContext();
    if (!userId) redirect(`/${locale}/login`);
    if (!membership) redirect(`/${locale}/onboarding`);
    if (membership.role === "sales_rep") notFound();
    initial = await getTenantTaxSettings();
  }

  // Server-only flag STATUS (booleans only — no secrets) for read-only display.
  const status = legalInvoicingStatus();
  const t = dict.admin.settings;

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
      <TaxSettingsForm
        locale={locale}
        dict={dict}
        initial={initial}
        status={status}
        live={live}
      />
    </div>
  );
}
