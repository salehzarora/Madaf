import { Link2Off } from "lucide-react";
import { notFound } from "next/navigation";
import { StoreSignupForm } from "@/components/shop/store-signup-form";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { getDataMode } from "@/lib/data";
import { isSignupLinkAlive } from "@/lib/data/customer-signup";

import type { Metadata } from "next";

// The raw token in the URL IS the credential — a leaked link must not
// become search-indexable (M8A).
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/**
 * Anonymous new-store signup (M7G). A prospective store opens its supplier's
 * tokenized link with NO login and NO catalog exposure — the raw token is the
 * only credential and is validated server-side by the submit action/RPC.
 * M8A adds a GET-time liveness check so a dead link shows a clear invalid
 * screen instead of a form that can never submit (fail-open: if the check
 * can't run, the form renders and the submit RPC remains the boundary).
 * Supabase mode only (no tokens/tenants in mock).
 */
export default async function JoinPage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale, token } = await params;
  if (!isLocale(locale)) notFound();
  if (getDataMode() !== "supabase") notFound();

  const dict = getDictionary(locale);

  if (!(await isSignupLinkAlive(token))) {
    const t = dict.access.signup;
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-4 py-16 text-center">
        <Link2Off className="size-12 text-ink-muted" aria-hidden />
        <h1 className="mt-4 text-xl font-extrabold tracking-tight text-ink">
          {t.invalidTitle}
        </h1>
        <p className="mt-2 text-sm text-ink-soft">{t.invalidBody}</p>
      </main>
    );
  }

  return <StoreSignupForm locale={locale} dict={dict} token={token} />;
}
