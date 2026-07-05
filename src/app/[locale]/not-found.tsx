import Link from "next/link";
import { LogoMark } from "@/components/logo";

/**
 * Locale-scoped 404. `not-found` gets no params, so it speaks all three
 * languages at once — acceptable for a rare screen in the mock phase.
 */
export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6 text-center">
      <LogoMark className="size-14 opacity-80" />
      <div className="space-y-2">
        <p className="text-2xl font-bold text-ink" dir="rtl" lang="he">
          העמוד לא נמצא
        </p>
        <p className="text-lg font-semibold text-ink-soft" dir="rtl" lang="ar">
          الصفحة غير موجودة
        </p>
        <p className="text-base text-ink-muted" lang="en">
          Page not found
        </p>
      </div>
      <Link
        href="/he"
        className="inline-flex h-11 items-center rounded-field bg-brand-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-brand-700"
      >
        מדף · مدف · Madaf
      </Link>
    </main>
  );
}
