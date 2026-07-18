import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ShowcaseLinkManager } from "@/components/admin/showcase-link-manager";
import { SignupManager } from "@/components/admin/signup-manager";
import { SignupTimeline } from "@/components/admin/signup-timeline";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ShelfRule } from "@/components/ui/shelf-rule";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { loadSignupTimelineAction } from "@/lib/actions/signup-timeline";
import { getSessionContext } from "@/lib/auth/session";
import {
  getDataMode,
  getSignupTimelinePage,
  getTenantTimeZone,
  safeInitialSignupTimeline,
} from "@/lib/data";
import { listShowcaseLinks } from "@/lib/data/catalog-showcase";
import {
  listSignupLinks,
  listSignupRequestsPage,
} from "@/lib/data/customer-signup";

/**
 * New-store signup management (M7G) — owner/admin only, Supabase mode only.
 * Generate/copy/revoke tenant-scoped signup links and review the pending
 * store requests they produce (approve → creates the customer; reject).
 */
export default async function CustomerSignupPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  // Next delivers a repeated query key as string[]; type + collapse accordingly.
  searchParams: Promise<{ page?: string | string[] }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  if (getDataMode() !== "supabase") notFound();
  const role = (await getSessionContext()).membership?.role;
  if (role !== "owner" && role !== "admin") notFound();

  const dict = getDictionary(locale);
  // M8H.2 — link expiries are absolute instants shown in the TENANT's zone.
  const timeZone = await getTenantTimeZone();
  const t = dict.admin.customers.signup;
  // Bounded, newest-first requests page (?page); the data layer clamps an
  // out-of-range page to the last one, so any positive integer is safe here.
  // A repeated ?page arrives as string[] — collapse to the first (mirrors the
  // `first()` helper the orders/products list pages use) before parsing.
  const { page: rawPage } = await searchParams;
  const pageParam = Array.isArray(rawPage) ? rawPage[0] : rawPage;
  const parsedPage = Number.parseInt((pageParam ?? "").trim(), 10);
  const requestsPageNo =
    Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;
  // The Signup Activity read is OPTIONAL + isolated (owner/admin RLS): if it
  // fails, signup management must still render. Started concurrently.
  const signupTimelinePromise = safeInitialSignupTimeline(() =>
    getSignupTimelinePage(),
  );
  const [links, requestsPage, showcaseLinks, signupTimeline] =
    await Promise.all([
      listSignupLinks(),
      listSignupRequestsPage(requestsPageNo),
      listShowcaseLinks(),
      signupTimelinePromise,
    ]);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      <div>
        <Link
          href={`/${locale}/admin/customers`}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-muted transition-colors hover:text-ink"
        >
          <ArrowRight className="size-4 ltr:-scale-x-100" aria-hidden />
          {dict.admin.customers.title}
        </Link>
        <h1 className="mt-2 text-[28px] font-extrabold tracking-[-0.02em] text-ink">
          {t.title}
        </h1>
        <p className="mt-0.5 text-sm text-ink-muted">{t.subtitle}</p>
        <ShelfRule className="mt-4" />
      </div>
      <SignupManager
        locale={locale}
        dict={dict}
        initialLinks={links}
        initialRequests={requestsPage.rows}
        requestsPage={requestsPage.page}
        requestsTotalPages={requestsPage.totalPages}
        timeZone={timeZone}
      />
      <Card className="overflow-hidden">
        <CardHeader variant="strip">
          <CardTitle>{dict.audit.signup.timelineHeading}</CardTitle>
        </CardHeader>
        <CardContent>
          <SignupTimeline
            locale={locale}
            dict={dict}
            initial={signupTimeline}
            timeZone={timeZone}
            loadMore={loadSignupTimelineAction}
          />
        </CardContent>
      </Card>
      <ShelfRule />
      <ShowcaseLinkManager
        locale={locale}
        dict={dict}
        timeZone={timeZone}
        initialLinks={showcaseLinks}
      />
    </div>
  );
}
