"use client";

import Link from "next/link";
import { LogoMark } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ShelfRule } from "@/components/ui/shelf-rule";
import { dirFor, isLocale, type Locale } from "@/i18n/config";

/**
 * Presentational, localized route-error screen (PILOT-READINESS-BATCH-A / A2).
 *
 * This is the calm, branded fallback the `[locale]/error.tsx` boundary renders
 * when a server read throws. It is a SEPARATE component from the boundary itself
 * so it can be mounted-tested directly (the retry handler is injected as a prop,
 * exactly like the movements-table / order-timeline seams) without a Next router
 * provider.
 *
 * It deliberately imports NO application dictionary — a tiny per-locale message
 * map lives here so the error client chunk stays small and never pulls the full
 * ar/he/en dictionaries into the bundle. It renders in ONE resolved locale (the
 * route's), so unlike not-found.tsx it is not tri-script; direction is set from
 * that locale. It NEVER renders the raw error (no message/stack/digest) — only
 * the safe, calm copy below.
 */
const MESSAGES: Record<Locale, {
  title: string;
  body: string;
  retry: string;
  home: string;
}> = {
  ar: {
    title: "حدث خطأ ما",
    body: "تعذّر تحميل هذه الصفحة. قد تكون المشكلة مؤقتة — حاول مرة أخرى.",
    retry: "إعادة المحاولة",
    home: "العودة إلى الرئيسية",
  },
  he: {
    title: "משהו השתבש",
    body: "לא הצלחנו לטעון את העמוד. ייתכן שזו תקלה זמנית — נסו שוב.",
    retry: "נסה שוב",
    home: "חזרה לדף הבית",
  },
  en: {
    title: "Something went wrong",
    body: "We couldn't load this page. This may be temporary — please try again.",
    retry: "Try again",
    home: "Back to home",
  },
};

export function ErrorBoundaryScreen({
  locale: rawLocale,
  onRetry,
  retrying,
}: {
  /** The route locale; anything unexpected falls back to Hebrew (the default). */
  locale: string;
  /** Injected by the boundary: a genuine fresh server re-render (router.refresh
   * + reset), never a bare reset. */
  onRetry: () => void;
  retrying: boolean;
}) {
  const locale: Locale = isLocale(rawLocale) ? rawLocale : "he";
  const t = MESSAGES[locale];
  return (
    <main
      dir={dirFor(locale)}
      lang={locale}
      className="flex min-h-dvh flex-col items-center justify-center bg-background px-6 py-12"
    >
      <Card className="w-full max-w-sm text-center">
        <CardContent className="flex flex-col items-center gap-6">
          <span
            className="flex size-14 items-center justify-center rounded-card bg-surface-sunken"
            aria-hidden
          >
            <LogoMark className="size-9 opacity-80" />
          </span>
          {/* role=alert so the failure is announced; meaning is in text, never
              color/icon alone. */}
          <div role="alert" className="space-y-2">
            <h1 className="text-2xl font-bold text-ink">{t.title}</h1>
            <p className="text-sm leading-relaxed text-ink-soft">{t.body}</p>
          </div>
          <ShelfRule className="w-full" />
          <div className="flex w-full flex-col items-center gap-3">
            <Button
              type="button"
              onClick={onRetry}
              disabled={retrying}
              aria-busy={retrying}
              className="w-full"
            >
              {t.retry}
            </Button>
            <Link
              href={`/${locale}`}
              className="text-sm font-semibold text-brand-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
            >
              {t.home}
            </Link>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
