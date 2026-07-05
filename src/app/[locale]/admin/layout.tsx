import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AdminShell, type AdminSession } from "@/components/admin-shell";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { getSessionContext } from "@/lib/auth/session";
import { getDataMode, getSupplier } from "@/lib/data";

/**
 * Admin chrome — sidebar dashboard layout for all /admin pages.
 *
 * In Supabase mode this is the auth gate: an authenticated tenant member is
 * required. No session → login; session but no membership → onboarding. In
 * mock mode the demo admin stays open (no auth).
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
    const { userId, email, membership } = await getSessionContext();
    if (!userId) redirect(`/${locale}/login`);
    if (!membership) redirect(`/${locale}/onboarding`);

    const supplier = await getSupplier();
    session = {
      email,
      role: membership.role,
      tenantName: supplier.name[locale],
    };
  }

  return (
    <AdminShell locale={locale} dict={dict} session={session}>
      {children}
    </AdminShell>
  );
}
