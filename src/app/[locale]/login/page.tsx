import { notFound, redirect } from "next/navigation";
import { LoginForm } from "@/components/auth/login-form";
import { LogoMark } from "@/components/logo";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
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

/** Supplier sign-in (Supabase mode only). Mock mode has no auth. */
export default async function LoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ next?: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  if (getDataMode() !== "supabase") notFound();

  const next = safeNext((await searchParams).next, locale);

  const { userId, membership } = await getSessionContext();
  if (userId && membership) redirect(next ?? `/${locale}/admin`);
  if (userId && !membership) redirect(`/${locale}/onboarding`);

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
            <LoginForm locale={locale} dict={dict} next={next ?? undefined} />
          </div>
        </div>
      </div>
    </div>
  );
}
