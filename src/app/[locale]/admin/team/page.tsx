import { notFound, redirect } from "next/navigation";
import { RepAssignments } from "@/components/admin/rep-assignments";
import { TeamManager } from "@/components/admin/team-manager";
import { Card } from "@/components/ui/card";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { getSessionContext } from "@/lib/auth/session";
import { getDataMode, listCustomers } from "@/lib/data";
import { listRepAssignments } from "@/lib/data/rep-assignments";
import { listTenantInvites, listTenantMembers } from "@/lib/data/team";

/** Tenant team management — owner/admin only (Supabase mode). */
export default async function AdminTeamPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  // Team management is an authenticated feature; there is no team in mock.
  if (getDataMode() !== "supabase") notFound();

  const { userId, membership } = await getSessionContext();
  if (!userId) redirect(`/${locale}/login`);
  if (!membership) redirect(`/${locale}/onboarding`);
  // Only owner/admin manage the team; sales_rep has no access.
  if (membership.role === "sales_rep") notFound();

  const dict = getDictionary(locale);
  const t = dict.access.team;

  const [members, invites, customers, assignments] = await Promise.all([
    listTenantMembers(),
    listTenantInvites(),
    listCustomers(),
    listRepAssignments(),
  ]);

  const reps = members
    .filter((m) => m.role === "sales_rep")
    .map((m) => ({ userId: m.userId, email: m.email }));
  const customerOptions = customers.map((c) => ({ id: c.id, name: c.name }));

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink">{t.title}</h1>
        <p className="mt-1 text-sm text-ink-muted">{t.subtitle}</p>
      </div>
      <Card className="p-5 sm:p-6">
        <TeamManager
          locale={locale}
          dict={dict}
          currentUserId={userId}
          currentUserRole={membership.role}
          initialMembers={members}
          initialInvites={invites}
        />
      </Card>
      <RepAssignments
        locale={locale}
        dict={dict}
        reps={reps}
        customers={customerOptions}
        assignments={assignments}
      />
    </div>
  );
}
