import { notFound } from "next/navigation";
import { DashboardTop } from "@/components/dashboard/dashboard-top";
import { PeriodAnalytics } from "@/components/dashboard/period-analytics";
import { DashboardRangeControl } from "@/components/dashboard/dashboard-range-control";
import { DashboardWidgets } from "@/components/dashboard/dashboard-widgets";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { getSessionContext } from "@/lib/auth/session";
import { getDashboardMetrics, getDataMode, getTenantTimeZone, searchOrders } from "@/lib/data";
import { countPendingSignupRequests } from "@/lib/data/customer-signup";
import { parseOrdersQuery } from "@/lib/orders-query";
import { resolveDashboardRange, type DashboardSearchParams } from "@/lib/dashboard-range";
import { getDashboardPeriodMetrics } from "@/lib/data/dashboard-period";
import { getDashboardThumbnails } from "@/lib/data/dashboard-thumbnails";
import { tenantToday } from "@/lib/time";

/** Admin dashboard V3: selected-period analytics and current operational state.
 * Both aggregate responses are bounded and computed in the database in Supabase
 * mode, so totals never depend on paginated order history. Recent activity stays
 * the global latest six; thumbnails enrich only visible product IDs. */
export default async function AdminDashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<DashboardSearchParams>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const dict = getDictionary(locale);
  const timeZone = await getTenantTimeZone();
  const now = new Date();
  const range = resolveDashboardRange(await searchParams, timeZone, now);

  // Keep current inventory/backlog separate from selected-period order cohorts.
  const [metrics, recentResult, period] = await Promise.all([
    getDashboardMetrics(),
    searchOrders(parseOrdersQuery({ pageSize: "6" })),
    getDashboardPeriodMetrics(range),
  ]);
  const recent = recentResult.rows;
  const widgetMetrics = { ...metrics, topProducts: period.topProducts, topShops: period.topShops };
  const thumbnails = await getDashboardThumbnails(widgetMetrics);

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
      <DashboardTop locale={locale} dict={dict} metrics={metrics} period={period} pendingSignups={canSeeSignups ? pendingSignups : null} rangeControl={<DashboardRangeControl key={`${range.key}:${range.from}:${range.to}`} action={`/${locale}/admin`} range={range.key} from={range.from} to={range.to} today={tenantToday(timeZone, now)} labels={dict.admin.dashboard.range} invalid={range.invalid} />} />

      <PeriodAnalytics period={period} range={range} locale={locale} dict={dict} />

      <DashboardWidgets metrics={widgetMetrics} recent={recent} locale={locale} dict={dict} timeZone={timeZone} thumbnails={thumbnails} rangeAware />
    </div>
  );
}
