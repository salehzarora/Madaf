import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AdminShell, type AdminSession } from "@/components/admin-shell";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { getSessionContext } from "@/lib/auth/session";
import {
  getDataMode,
  getSupplier,
  listCategories,
  listManufacturers,
} from "@/lib/data";
import { ShopDataProvider } from "@/lib/shop-data-context";

/**
 * Admin chrome — sidebar dashboard layout for all /admin pages.
 *
 * In Supabase mode this is the auth gate: an authenticated tenant member is
 * required. No session → login; session but no membership → onboarding. The
 * shell shows the current tenant + a switcher when the user belongs to more
 * than one. In mock mode the demo admin stays open (no auth).
 */
export default async function AdminLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const dict = getDictionary(locale);

  let session: AdminSession | undefined;
  if (getDataMode() === "supabase") {
    const { userId, email, phone, membership, memberships } =
      await getSessionContext();
    if (!userId) redirect(`/${locale}/login`);
    if (!membership) redirect(`/${locale}/onboarding`);

    // Business logo for the top bar (M8E.1) — signed on read; best-effort so a
    // signing hiccup never blocks the admin chrome (falls back to the initial).
    let logoUrl: string | undefined;
    try {
      logoUrl = (await getSupplier()).logoUrl;
    } catch {
      logoUrl = undefined;
    }

    session = {
      // Phone-OTP users have no email — show their phone as the identity.
      email: email ?? phone,
      role: membership.role,
      tenantName: membership.name[locale],
      logoUrl,
      currentTenantId: membership.tenantId,
      tenants: memberships.map((m) => ({ id: m.tenantId, name: m.name[locale] })),
    };
  }

  // M8F.2 — admin routes hydrate ONLY the bounded category/manufacturer
  // reference lists (needed by the product filters + forms), NEVER the full
  // product/customer/inventory collections. The paginated Products list fetches
  // just its current page; the few admin pages that genuinely need the full
  // catalog (e.g. the single-document preview) provide it locally on their own
  // route. Category/manufacturer reads are complete + tenant-scoped (RLS).
  const [categories, manufacturers] = await Promise.all([
    listCategories(),
    listManufacturers(),
  ]);

  return (
    <ShopDataProvider
      products={[]}
      categories={categories}
      manufacturers={manufacturers}
      customers={[]}
    >
      <AdminShell locale={locale} dict={dict} session={session}>
        {children}
      </AdminShell>
    </ShopDataProvider>
  );
}
