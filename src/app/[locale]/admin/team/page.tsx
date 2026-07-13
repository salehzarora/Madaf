import { notFound, redirect } from "next/navigation";
import { RepAssignments } from "@/components/admin/rep-assignments";
import { TeamManager } from "@/components/admin/team-manager";
import { ShelfRule } from "@/components/ui/shelf-rule";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { getSessionContext } from "@/lib/auth/session";
import { getDataMode, getTenantTimeZone, listCustomers } from "@/lib/data";
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
        <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-muted">
          {dict.nav.admin}
        </p>
        <h1 className="mt-1 text-[28px] font-extrabold tracking-[-0.02em] text-ink">
          {t.title}
        </h1>
        <p className="mt-0.5 text-sm text-ink-muted">{t.subtitle}</p>
        <ShelfRule className="mt-4" />
      </div>
      <TeamManager
        locale={locale}
        dict={dict}
        currentUserId={userId}
        currentUserRole={membership.role}
        initialMembers={members}
        initialInvites={invites}
        timeZone={await getTenantTimeZone()}
      />
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
