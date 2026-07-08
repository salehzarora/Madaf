import { notFound } from "next/navigation";
import { CustomerForm } from "@/components/admin/customer-form";
import { ShelfRule } from "@/components/ui/shelf-rule";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";

/** Create a store/customer. Mock mode shows the demo confirmation; Supabase
 * mode persists through create_customer (owner/admin only). */
export default async function NewCustomerPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
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
