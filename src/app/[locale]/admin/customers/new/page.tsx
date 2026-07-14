import { notFound, redirect } from "next/navigation";
import { CustomerForm } from "@/components/admin/customer-form";
import { ShelfRule } from "@/components/ui/shelf-rule";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { getSessionContext } from "@/lib/auth/session";
import { getDataMode } from "@/lib/data";

/** Create a store/customer. Mock mode shows the demo confirmation; Supabase
 * mode persists through create_customer (owner/admin only). */
// Reads the caller's tenant membership under RLS to gate by role, so it must
// render per request (mirrors the business-settings gate).
export const dynamic = "force-dynamic";

export default async function NewCustomerPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  // Creating a store is owner/admin only (enforced server-side by
  // create_customer). Gate the ROUTE too so a sales_rep can't reach the form by
  // navigating directly — the list already hides the "add store" CTA for them
  // (B1). Mock mode has no auth: it stays the open demo.
  if (getDataMode() === "supabase") {
    const { userId, membership } = await getSessionContext();
    if (!userId) redirect(`/${locale}/login`);
    if (!membership) redirect(`/${locale}/onboarding`);
    // Explicit owner/admin allowlist (never default-allow on any other role).
    if (membership.role !== "owner" && membership.role !== "admin") notFound();
  }

  const dict = getDictionary(locale);
  const t = dict.admin.customers.form;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
      <div>
        <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-muted">
          {dict.nav.admin}
        </p>
        <h1 className="mt-1 text-[28px] font-extrabold tracking-[-0.02em] text-ink">
          {t.newTitle}
        </h1>
        <p className="mt-0.5 text-sm text-ink-muted">{t.newSubtitle}</p>
        <ShelfRule className="mt-4" />
      </div>
      <CustomerForm locale={locale} dict={dict} />
    </div>
  );
}
