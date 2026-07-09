import { CheckCircle2, LayoutDashboard } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card } from "@/components/ui/card";
import { ShelfRule } from "@/components/ui/shelf-rule";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";

/**
 * Post-checkout confirmation. The CUSTOMER-FACING public ref arrives via ?n=
 * (checkout passes result.publicRef, never the internal sequential number).
 */
export default async function OrderSuccessPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ n?: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const { n } = await searchParams;
  const dict = getDictionary(locale);
  const publicRef = n ?? "MDF-DEMO0000";

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col items-center px-4 py-14 text-center sm:px-6">
      <span className="flex size-20 items-center justify-center rounded-full bg-success-soft">
        <CheckCircle2 className="size-11 text-success" aria-hidden />
      </span>

      <h1 className="mt-6 text-3xl font-bold tracking-tight text-ink">
        {dict.orderSuccess.title}
      </h1>
      <p className="mt-2 text-base text-ink-soft">
        {dict.orderSuccess.subtitle}
      </p>

      <Card className="mt-6 w-full max-w-sm p-5 text-start">
        <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-soft">
          {dict.orderSuccess.orderNumberLabel}
        </p>
        <p
          className="mt-1 font-mono text-2xl font-bold tracking-wide text-brand-700"
          dir="ltr"
        >
          {publicRef}
        </p>
        <ShelfRule className="mt-4" />
      </Card>

      <div className="mt-8 w-full max-w-sm text-start">
        <h2 className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-soft">
          {dict.orderSuccess.whatNext}
        </h2>
        <ol className="mt-3 flex flex-col gap-3">
          {dict.orderSuccess.steps.map((step, index) => (
            <li key={step} className="flex items-start gap-3">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-50 text-sm font-bold text-brand-700">
                {index + 1}
              </span>
              <p className="pt-0.5 text-sm leading-relaxed text-ink-soft">
                {step}
              </p>
            </li>
          ))}
        </ol>
      </div>

      <div className="mt-10 flex flex-col gap-3 sm:flex-row">
        <Link
          href={`/${locale}/catalog`}
          className="inline-flex h-12 items-center justify-center rounded-field bg-brand-600 px-6 text-sm font-bold text-white transition-colors hover:bg-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
        >
          {dict.orderSuccess.backToCatalog}
        </Link>
        <Link
          href={`/${locale}/admin/orders`}
          className="inline-flex h-12 items-center justify-center gap-2 rounded-field border border-line-strong bg-surface px-6 text-sm font-medium text-ink transition-colors hover:bg-surface-sunken focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
        >
          <LayoutDashboard className="size-4" aria-hidden />
          {dict.nav.admin}
        </Link>
      </div>

      <p className="mt-6 max-w-sm text-xs leading-relaxed text-ink-muted">
        {dict.orderSuccess.adminHint}
      </p>
    </div>
  );
}
