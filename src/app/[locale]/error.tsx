"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useTransition } from "react";
import { ErrorBoundaryScreen } from "@/components/error-boundary-screen";

/**
 * Localized route-level error boundary (PILOT-READINESS-BATCH-A / A2).
 *
 * Catches any thrown server render below the `[locale]` layout (every admin and
 * shop page) and shows a calm, branded, localized, RETRYABLE screen instead of
 * Next's default unstyled English error page. The `[locale]` root layout itself
 * does no data fetching (fonts + static dictionary + <html> only), so it cannot
 * throw at runtime and a `global-error.tsx` is not needed for the pilot.
 *
 * RETRY: `reset()` alone re-renders the boundary but can replay the SAME cached
 * server tree — so the button would appear to work while re-showing the failure.
 * We wrap `router.refresh()` (invalidate + re-fetch the RSC tree from the server)
 * AND `reset()` (clear the boundary) in one `startTransition`, so the retry is a
 * genuine fresh server render. `useTransition`'s `pending` drives the busy state
 * and, since it settles when the transition finishes (or the boundary re-catches
 * a fresh error), the button can never get stuck in a permanent loading state —
 * and a click while pending is ignored, so a double-click can't stack refreshes.
 * (Next 16.2 also ships `unstable_retry`, which does the same re-fetch+re-render;
 * the stable refresh+reset pair is used here to avoid depending on an unstable
 * API for a pilot.)
 *
 * The raw `error` is logged to the console only — its message, stack, and digest
 * are NEVER rendered (the screen shows fixed safe copy).
 */
export default function LocaleError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();
  const params = useParams();
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    // Log for diagnostics only; never surfaced to the user.
    console.error("[madaf] route error boundary:", error);
  }, [error]);

  const rawLocale = Array.isArray(params?.locale)
    ? params?.locale[0]
    : params?.locale;

  function onRetry() {
    if (pending) return; // ignore a click while a refresh is already in flight
    startTransition(() => {
      router.refresh(); // re-fetch the failed server render from the server
      reset(); // clear the boundary so the fresh tree can mount
    });
  }

  return (
    <ErrorBoundaryScreen
      locale={typeof rawLocale === "string" ? rawLocale : "he"}
      onRetry={onRetry}
      retrying={pending}
    />
  );
}
