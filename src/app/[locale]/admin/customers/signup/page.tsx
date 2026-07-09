import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SignupManager } from "@/components/admin/signup-manager";
import { ShelfRule } from "@/components/ui/shelf-rule";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { getSessionContext } from "@/lib/auth/session";
import { getDataMode } from "@/lib/data";
import {
  listSignupLinks,
  listSignupRequests,
} from "@/lib/data/customer-signup";

/**
 * New-store signup management (M7G) — owner/admin only, Supabase mode only.
 * Generate/copy/revoke tenant-scoped signup links and review the pending
 * store requests they produce (approve → creates the customer; reject).
 */
export default async function CustomerSignupPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  if (getDataMode() !== "supabase") notFound();
  const role = (await getSessionContext()).membership?.role;
  if (role !== "owner" && role !== "admin") notFound();

  const dict = getDictionary(locale);
  const t = dict.admin.customers.signup;
  const [links, requests] = await Promise.all([
    listSignupLinks(),
    listSignupRequests(),
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
        initialRequests={requests}
      />
    </div>
  );
}
