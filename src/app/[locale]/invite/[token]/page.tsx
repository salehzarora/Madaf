import { LogIn } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AcceptInviteForm } from "@/components/auth/accept-invite-form";
import { LogoMark, LogoWordmark } from "@/components/logo";
import { Card } from "@/components/ui/card";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { getSessionContext } from "@/lib/auth/session";
import { getDataMode } from "@/lib/data";

/**
 * Tenant-team invite acceptance (Supabase mode only). Logged out → prompt to
 * sign in with the invited email (returning here). Logged in → accept; the
 * RPC verifies the email match and invite validity server-side.
 */
export default async function InvitePage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale, token } = await params;
  if (!isLocale(locale)) notFound();
  if (getDataMode() !== "supabase") notFound();

  const dict = getDictionary(locale);
  const t = dict.access.invite;
  const { userId, email } = await getSessionContext();

  return (
    <div className="flex min-h-dvh items-center justify-center bg-surface-sunken px-4 py-12">
      <Card className="w-full max-w-sm p-6 sm:p-8">
        <div className="mb-6 flex items-center gap-2.5">
          <LogoMark />
          <LogoWordmark
            appName={dict.meta.appName}
            appNameNative={dict.meta.appNameNative}
          />
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-ink">{t.title}</h1>
        <p className="mt-1 text-sm text-ink-muted">{t.body}</p>

        <div className="mt-6">
          {userId ? (
            <>
              <p className="mb-4 text-sm text-ink-soft">
                {t.signedInAs}{" "}
                <span className="font-semibold text-ink" dir="ltr">
                  {email}
                </span>
              </p>
              <AcceptInviteForm locale={locale} dict={dict} token={token} />
            </>
          ) : (
            <>
              <p className="mb-4 text-sm text-ink-soft">{t.loginRequired}</p>
              <Link
                href={`/${locale}/login?next=${encodeURIComponent(
                  `/${locale}/invite/${token}`,
                )}`}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-field bg-brand-600 text-base font-medium text-white shadow-sm transition-colors hover:bg-brand-700"
              >
                <LogIn className="size-4 rtl:-scale-x-100" aria-hidden />
                {t.loginCta}
              </Link>
            </>
          )}
        </div>
      </Card>
    </div>
  );
}
