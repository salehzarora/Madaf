import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AdminShell, type AdminSession } from "@/components/admin-shell";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { getSessionContext } from "@/lib/auth/session";
import { getDataMode } from "@/lib/data";

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
    const { userId, email, membership, memberships } = await getSessionContext();
    if (!userId) redirect(`/${locale}/login`);
    if (!membership) redirect(`/${locale}/onboarding`);

    session = {
      email,
      role: membership.role,
      tenantName: membership.name[locale],
      currentTenantId: membership.tenantId,
      tenants: memberships.map((m) => ({ id: m.tenantId, name: m.name[locale] })),
    };
  }

  return (
    <AdminShell locale={locale} dict={dict} session={session}>
      {children}
    </AdminShell>
  );
}
