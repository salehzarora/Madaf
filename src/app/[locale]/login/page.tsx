import { notFound, redirect } from "next/navigation";
import { AuthPanel } from "@/components/auth/auth-panel";
import { LogoMark } from "@/components/logo";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { authPrimaryMethod, emailFallbackVisible } from "@/lib/config/auth";
import { devPhoneOtpEnabled } from "@/lib/auth/dev-otp";
import { getSessionContext } from "@/lib/auth/session";
import { getDataMode } from "@/lib/data";

/**
 * Only allow post-login redirects that stay inside this locale's subtree —
 * blocks open redirects (`//host`, `http://…`) via a returnable `?next=`.
 */
function safeNext(value: string | undefined, locale: string): string | null {
  if (typeof value !== "string") return null;
  const prefix = `/${locale}/`;
  if (!value.startsWith(prefix) || value.startsWith(`${prefix}/`)) return null;
  return value;
}

/**
 * Supplier sign-in. Supabase mode: real phone-OTP (primary) / email fallback.
 * Mock mode: normally has no auth (404) — but renders the phone-OTP UX when
 * the fail-closed DEV fake-OTP path is explicitly enabled, for local testing.
 */
export default async function LoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ next?: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const supabaseMode = getDataMode() === "supabase";
  const devOtp = devPhoneOtpEnabled();
  // Mock mode is authless; only render login there when the dev fake path is on.
  if (!supabaseMode && !devOtp) notFound();

  const next = safeNext((await searchParams).next, locale);

  // Only Supabase mode has a real session to route on.
  if (supabaseMode) {
    const { userId, membership } = await getSessionContext();
    if (userId && membership) redirect(next ?? `/${locale}/admin`);
    // Membershipless users still honor a validated `next` (M8A): an invite
    // return path must reach the invite page, not lose it to onboarding. A
    // next they can't use (e.g. /admin) bounces back to onboarding there.
    if (userId && !membership) redirect(next ?? `/${locale}/onboarding`);
  }

  const dict = getDictionary(locale);
  const t = dict.access.login;

  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-band px-4 py-12">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[repeating-linear-gradient(0deg,transparent,transparent_118px,rgb(244_241_232/0.06)_118px,rgb(244_241_232/0.06)_120px)]"
      />
      <div className="relative w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <LogoMark className="size-9" />
          <span className="flex items-baseline gap-1.5">
            <span className="text-lg font-bold tracking-tight text-band-ink">
              {dict.meta.appNameNative}
            </span>
            {dict.meta.appNameNative !== dict.meta.appName ? (
              <span className="text-sm font-medium text-band-muted">
                {dict.meta.appName}
              </span>
            ) : null}
          </span>
        </div>
        <div className="rounded-2xl bg-surface-parchment p-8 shadow-float">
          <h1 className="text-[22px] font-extrabold tracking-[-0.01em] text-ink">
            {t.title}
          </h1>
          <p className="mt-1 text-sm text-ink-soft">{t.subtitle}</p>
          <div className="mt-6">
            <AuthPanel
              locale={locale}
              dict={dict}
              next={next ?? undefined}
              primaryMethod={authPrimaryMethod()}
              emailFallbackVisible={emailFallbackVisible()}
              devNotice={devOtp}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
