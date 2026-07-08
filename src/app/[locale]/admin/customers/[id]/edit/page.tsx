import { notFound } from "next/navigation";
import { CustomerForm } from "@/components/admin/customer-form";
import { ShelfRule } from "@/components/ui/shelf-rule";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { getCustomer, getDataMode } from "@/lib/data";

/**
 * Edit a store/customer. Supabase mode only — in mock mode there is nothing
 * to persist, so the route is not exposed (the detail page hides the edit
 * link). Access (owner/admin) is enforced by update_customer server-side.
 */
export default async function EditCustomerPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  if (!isLocale(locale)) notFound();
  if (getDataMode() !== "supabase") notFound();

  const customer = await getCustomer(id);
  if (!customer) notFound();
  const dict = getDictionary(locale);
  const t = dict.admin.customers.form;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
      <div>
        <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-muted">
          {dict.nav.admin}
        </p>
        <h1 className="mt-1 text-[28px] font-extrabold tracking-[-0.02em] text-ink">
          {t.editTitle}
        </h1>
        <p className="mt-0.5 text-sm text-ink-muted">{t.editSubtitle}</p>
        <ShelfRule className="mt-4" />
      </div>
      <CustomerForm locale={locale} dict={dict} customer={customer} />
    </div>
  );
}
