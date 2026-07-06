import { LogIn } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AcceptInviteForm } from "@/components/auth/accept-invite-form";
import { LogoMark, LogoWordmark } from "@/components/logo";
import { Card } from "@/components/ui/card";
import { ShelfRule } from "@/components/ui/shelf-rule";
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
        <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-muted">
          {dict.nav.team}
        </p>
        <h1 className="mt-1 text-[28px] font-extrabold tracking-[-0.02em] text-ink">
          {t.title}
        </h1>
        <p className="mt-0.5 text-sm text-ink-muted">{t.body}</p>
        <ShelfRule className="mt-4" />

        <div className="mt-6">
          {userId ? (
            <>
              <p className="mb-4 text-sm text-ink-soft">
                {t.signedInAs}{" "}
                <span
                  className="font-mono text-[13px] font-semibold text-ink"
                  dir="ltr"
                >
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
                className="flex h-12 w-full items-center justify-center gap-2 rounded-field bg-brand-600 text-base font-bold text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.12),0_1px_2px_rgb(25_22_18/0.2)] transition-colors hover:bg-brand-700 active:bg-brand-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
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
