import { ArrowRight, Phone, Store, User } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { CustomerLinksManager } from "@/components/admin/customer-links-manager";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { getSessionContext } from "@/lib/auth/session";
import { getCustomer, getDataMode } from "@/lib/data";
import { listCustomerLinks } from "@/lib/data/customer-links";

/** Shop detail + private order-link management (links are Supabase-mode). */
export default async function AdminCustomerDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  if (!isLocale(locale)) notFound();
  const dict = getDictionary(locale);
  const t = dict.access.links;

  const customer = await getCustomer(id);
  if (!customer) notFound();

  // Private-link management is owner/admin only. A sales_rep only reaches
  // customers assigned to them (RLS-scoped getCustomer), and even then does
  // not manage links.
  const isSupabase = getDataMode() === "supabase";
  const role = isSupabase ? (await getSessionContext()).membership?.role : null;
  // Explicit owner/admin allowlist (never default-allow on a null membership);
  // RLS is the real gate (M4D.2 SELECT policy returns 0 rows for anyone else).
  const canManageLinks = role === "owner" || role === "admin";
  const links = isSupabase && canManageLinks ? await listCustomerLinks(id) : [];

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
      <div>
        <Link
          href={`/${locale}/admin/customers`}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-muted transition-colors hover:text-ink"
        >
          <ArrowRight className="size-4 rtl:-scale-x-100" aria-hidden />
          {t.backToCustomers}
        </Link>
      </div>

      {/* Shop header */}
      <Card className="p-5 sm:p-6">
        <div className="flex items-start gap-4">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-field bg-brand-50 text-brand-700">
            <Store className="size-6" aria-hidden />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight text-ink">
                {customer.name}
              </h1>
              <Badge tone="neutral">
                {dict.admin.customers.types[customer.type]}
              </Badge>
            </div>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-ink-soft">
              <span className="inline-flex items-center gap-1.5">
                <User className="size-4 text-ink-muted" aria-hidden />
                {customer.contactName}
              </span>
              <span className="inline-flex items-center gap-1.5" dir="ltr">
                <Phone className="size-4 text-ink-muted" aria-hidden />
                {customer.phone}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Store className="size-4 text-ink-muted" aria-hidden />
                {customer.city[locale]}
              </span>
            </div>
          </div>
        </div>
      </Card>

      {/* Private links — owner/admin only */}
      {!isSupabase || canManageLinks ? (
        <Card className="p-5 sm:p-6">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-ink">{t.title}</h2>
            <p className="mt-0.5 text-sm text-ink-muted">{t.subtitle}</p>
          </div>
          {isSupabase ? (
            <CustomerLinksManager
              locale={locale}
              dict={dict}
              customerId={id}
              initialLinks={links}
            />
          ) : (
            <p className="rounded-field bg-surface-sunken px-4 py-3 text-sm text-ink-soft">
              {t.mockNote}
            </p>
          )}
        </Card>
      ) : null}
    </div>
  );
}
