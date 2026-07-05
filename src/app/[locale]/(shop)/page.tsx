import {
  ArrowRight,
  ClipboardList,
  FileText,
  Languages,
  LayoutDashboard,
  Link2,
  ShoppingBag,
  Tablet,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card } from "@/components/ui/card";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";

/** Localized landing — explains the demo and routes the three roles. */
export default async function LandingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const dict = getDictionary(locale);

  const roleCards = [
    {
      ...dict.landing.roles.rep,
      icon: Tablet,
      href: `/${locale}/catalog`,
    },
    {
      ...dict.landing.roles.owner,
      icon: Link2,
      href: `/${locale}/catalog`,
    },
    {
      ...dict.landing.roles.admin,
      icon: LayoutDashboard,
      href: `/${locale}/admin`,
    },
  ];

  const featureIcons = [ShoppingBag, Languages, ClipboardList, FileText];

  return (
    <div>
      {/* Hero */}
      <section className="border-b border-line bg-gradient-to-b from-brand-50 via-background to-background">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center px-4 py-16 text-center sm:px-6 sm:py-24">
          <span className="rounded-full border border-brand-200 bg-surface px-4 py-1.5 text-xs font-semibold text-brand-700">
            {dict.landing.heroBadge}
          </span>
          <h1 className="mt-6 max-w-3xl text-4xl font-bold leading-tight tracking-tight text-ink sm:text-5xl">
            {dict.landing.heroTitle}
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-relaxed text-ink-soft sm:text-lg">
            {dict.landing.heroSubtitle}
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link
              href={`/${locale}/catalog`}
              className="inline-flex h-13 items-center justify-center gap-2 rounded-field bg-brand-600 px-8 text-base font-semibold text-white shadow-sm transition-colors hover:bg-brand-700"
            >
              {dict.landing.ctaCatalog}
              <ArrowRight className="size-5 rtl:-scale-x-100" aria-hidden />
            </Link>
            <Link
              href={`/${locale}/admin`}
              className="inline-flex h-13 items-center justify-center gap-2 rounded-field border border-line-strong bg-surface px-8 text-base font-medium text-ink transition-colors hover:bg-surface-sunken"
            >
              {dict.landing.ctaAdmin}
            </Link>
          </div>
        </div>
      </section>

      {/* Roles */}
      <section className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6">
        <h2 className="text-center text-2xl font-bold tracking-tight text-ink">
          {dict.landing.rolesTitle}
        </h2>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {roleCards.map((role) => {
            const Icon = role.icon;
            return (
              <Card
                key={role.title}
                className="flex flex-col gap-3 p-6 transition-shadow hover:shadow-float"
              >
                <span className="flex size-12 items-center justify-center rounded-field bg-brand-50 text-brand-700">
                  <Icon className="size-6" aria-hidden />
                </span>
                <h3 className="text-lg font-semibold text-ink">{role.title}</h3>
                <p className="flex-1 text-sm leading-relaxed text-ink-soft">
                  {role.desc}
                </p>
                <Link
                  href={role.href}
                  className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700 hover:text-brand-800"
                >
                  {role.cta}
                  <ArrowRight className="size-4 rtl:-scale-x-100" aria-hidden />
                </Link>
              </Card>
            );
          })}
        </div>
      </section>

      {/* Features */}
      <section className="border-t border-line bg-surface">
        <div className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6">
          <h2 className="text-center text-2xl font-bold tracking-tight text-ink">
            {dict.landing.featuresTitle}
          </h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {dict.landing.features.map((feature, index) => {
              const Icon = featureIcons[index % featureIcons.length];
              return (
                <div
                  key={feature.title}
                  className="flex flex-col gap-2.5 rounded-card border border-line bg-background p-5"
                >
                  <Icon className="size-6 text-brand-600" aria-hidden />
                  <h3 className="text-sm font-semibold text-ink">
                    {feature.title}
                  </h3>
                  <p className="text-sm leading-relaxed text-ink-muted">
                    {feature.desc}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}
