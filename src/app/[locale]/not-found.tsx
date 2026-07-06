import Link from "next/link";
import { LogoMark } from "@/components/logo";
import { Card, CardContent } from "@/components/ui/card";
import { ShelfRule } from "@/components/ui/shelf-rule";

/**
 * Locale-scoped 404. `not-found` gets no params, so it speaks all three
 * languages at once — acceptable for a rare screen in the mock phase.
 */
export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-background px-6 py-12">
      <Card className="w-full max-w-sm text-center">
        <CardContent className="flex flex-col items-center gap-6">
          <span className="flex size-14 items-center justify-center rounded-card bg-surface-sunken">
            <LogoMark className="size-9 opacity-80" />
          </span>
          <div className="space-y-2">
            <p className="text-2xl font-bold text-ink" dir="rtl" lang="he">
              העמוד לא נמצא
            </p>
            <p
              className="text-lg font-semibold text-ink-soft"
              dir="rtl"
              lang="ar"
            >
              الصفحة غير موجودة
            </p>
            <p className="text-base text-ink-soft" lang="en">
              Page not found
            </p>
          </div>
          <ShelfRule className="w-full" />
          <Link
            href="/he"
            className="inline-flex h-11 items-center rounded-field bg-brand-600 px-5 text-sm font-bold text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.12),0_1px_2px_rgb(25_22_18/0.2)] transition-colors hover:bg-brand-700 active:bg-brand-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
          >
            מדף · مدف · Madaf
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}
