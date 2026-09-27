import { notFound } from "next/navigation";
import { DashboardTop } from "@/components/dashboard/dashboard-top";
import { DashboardAnalytics } from "@/components/dashboard/dashboard-analytics";
import { DashboardWidgets } from "@/components/dashboard/dashboard-widgets";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { getSessionContext } from "@/lib/auth/session";
import { getDashboardMetrics, getDataMode, getTenantTimeZone, searchOrders } from "@/lib/data";
import { countPendingSignupRequests } from "@/lib/data/customer-signup";
import { parseOrdersQuery } from "@/lib/orders-query";

/** Admin dashboard v2 — KPIs, trend + status, widgets, recent activity.
 *
 * C1 (Batch C): all aggregates come from ONE bounded `getDashboardMetrics()`
 * read (a tenant-scoped DB aggregate in supabase mode; the same definitions over
 * the mock arrays in demo mode) instead of loading the ENTIRE order history and
 * summing in JS — so a tenant past the PostgREST 1000-row ceiling can no longer
 * see silently-truncated totals. Recent activity is a bounded 6-order page. */
export default async function AdminDashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const dict = getDictionary(locale);

  // ONE bounded aggregate + a bounded 6-order "recent" page + the tenant zone.
  const [metrics, recentResult, timeZone] = await Promise.all([
    getDashboardMetrics(),
    searchOrders(parseOrdersQuery({ pageSize: "6" })),
    getTenantTimeZone(), // M8H.2 — server-derived tenant zone for dashboard times
  ]);
  const recent = recentResult.rows;

  // Pending store-signup requests — supabase owner/admin only (mock has no
  // signups). An EXACT server-side count (no signup rows / PII loaded, correct
  // above the PostgREST 1000-row ceiling) — Batch C bounded-read correction.
  const isSupabase = getDataMode() === "supabase";
  const dashRole = isSupabase
    ? (await getSessionContext()).membership?.role
    : null;
  const canSeeSignups =
    isSupabase && (dashRole === "owner" || dashRole === "admin");
  const pendingSignups = canSeeSignups
    ? await countPendingSignupRequests()
    : 0;

  return (
    <div className="mx-auto flex w-full max-w-[1096px] flex-col gap-4">
      <DashboardTop locale={locale} dict={dict} metrics={metrics} pendingSignups={canSeeSignups ? pendingSignups : null} />

      <DashboardAnalytics metrics={metrics} locale={locale} dict={dict} />

      <DashboardWidgets metrics={metrics} recent={recent} locale={locale} dict={dict} timeZone={timeZone} />
    </div>
  );
}
