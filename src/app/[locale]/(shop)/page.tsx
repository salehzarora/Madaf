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
import { MiniCatalogPreview } from "@/components/mini-catalog-preview";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { categoryStyle } from "@/lib/category-style";
import { listCategories, listProducts } from "@/lib/data";
import { cn } from "@/lib/utils";

/**
 * Landing — product-first: a live mini catalog in the hero, category
 * tiles straight into filtered browsing energy, then the three flows.
 */
export default async function LandingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const dict = getDictionary(locale);
  const [categories, products] = await Promise.all([
    listCategories(),
    listProducts(),
  ]);

  const roleCards = [
    {
      ...dict.landing.roles.rep,
      icon: Tablet,
      href: `/${locale}/catalog`,
      accent: "bg-brand-600 text-white",
    },
    {
      ...dict.landing.roles.owner,
      icon: Link2,
      href: `/${locale}/catalog`,
      accent: "bg-sky-600 text-white",
    },
    {
      ...dict.landing.roles.admin,
      icon: LayoutDashboard,
      href: `/${locale}/admin`,
      accent: "bg-accent-500 text-white",
    },
  ];

  const featureIcons = [ShoppingBag, Languages, ClipboardList, FileText];

  return (
    <div>
      {/* Hero — copy + live catalog preview */}
      <section className="overflow-hidden border-b border-line bg-gradient-to-b from-brand-50 via-background to-background">
        <div className="mx-auto grid w-full max-w-6xl items-center gap-10 px-4 py-12 sm:px-6 lg:grid-cols-2 lg:gap-8 lg:py-16">
          <div className="text-center lg:text-start">
            <span className="inline-block rounded-full border border-brand-200 bg-surface px-4 py-1.5 text-xs font-semibold text-brand-700">
              {dict.landing.heroBadge}
            </span>
            <h1 className="mt-5 text-4xl font-extrabold leading-tight tracking-tight text-ink sm:text-5xl">
              {dict.landing.heroTitle}
            </h1>
            <p className="mt-4 text-base leading-relaxed text-ink-soft sm:text-lg">
              {dict.landing.heroSubtitle}
            </p>
            <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row lg:justify-start">
              <Link
                href={`/${locale}/catalog`}
                className="inline-flex h-13 items-center justify-center gap-2 rounded-field bg-brand-600 px-8 text-base font-bold text-white shadow-sm transition-colors hover:bg-brand-700"
              >
                {dict.landing.ctaCatalog}
                <ArrowRight className="size-5 rtl:-scale-x-100" aria-hidden />
              </Link>
              <Link
                href={`/${locale}/admin`}
                className="inline-flex h-13 items-center justify-center gap-2 rounded-field border border-line-strong bg-surface px-8 text-base font-semibold text-ink transition-colors hover:bg-surface-sunken"
              >
                {dict.landing.ctaAdmin}
              </Link>
            </div>
          </div>

          <div className="pb-8 lg:pb-2">
            <MiniCatalogPreview locale={locale} dict={dict} />
          </div>
        </div>
      </section>

      {/* Category tiles — straight into the shelves */}
      <section className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-xl font-bold tracking-tight text-ink">
            {dict.landing.browseByCategory}
          </h2>
          <Link
            href={`/${locale}/catalog`}
            className="text-sm font-semibold text-brand-700 hover:underline"
          >
            {dict.common.viewAll}
          </Link>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {categories.map((category) => {
            const style = categoryStyle(category.id);
            const count = products.filter(
              (p) => p.categoryId === category.id,
            ).length;
            return (
              <Link
                key={category.id}
                href={`/${locale}/catalog`}
                className={cn(
                  "flex flex-col items-center gap-1.5 rounded-card border px-3 py-5 text-center transition-all hover:-translate-y-0.5 hover:shadow-card",
                  style.tile,
                )}
              >
                <span className="text-3xl" aria-hidden>
                  {category.icon}
                </span>
                <span className={cn("text-sm font-bold", style.text)}>
                  {category.name[locale]}
                </span>
                <span className="text-xs text-ink-muted">
                  {count} {dict.nav.products}
                </span>
              </Link>
            );
          })}
        </div>
      </section>

      {/* Roles — the three flows */}
      <section className="border-t border-line bg-surface">
        <div className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6">
          <h2 className="text-center text-2xl font-bold tracking-tight text-ink">
            {dict.landing.rolesTitle}
          </h2>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {roleCards.map((role) => {
              const Icon = role.icon;
              return (
                <Link
                  key={role.title}
                  href={role.href}
                  className="group flex flex-col gap-3 rounded-card border border-line bg-background p-6 transition-all hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-float"
                >
                  <span
                    className={cn(
                      "flex size-12 items-center justify-center rounded-field shadow-sm",
                      role.accent,
                    )}
                  >
                    <Icon className="size-6" aria-hidden />
                  </span>
                  <h3 className="text-lg font-bold text-ink">{role.title}</h3>
                  <p className="flex-1 text-sm leading-relaxed text-ink-soft">
                    {role.desc}
                  </p>
                  <span className="inline-flex items-center gap-1.5 text-sm font-bold text-brand-700 group-hover:text-brand-800">
                    {role.cta}
                    <ArrowRight
                      className="size-4 transition-transform group-hover:translate-x-0.5 rtl:-scale-x-100 rtl:group-hover:-translate-x-0.5"
                      aria-hidden
                    />
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      {/* Features band */}
      <section className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6">
        <h2 className="text-center text-2xl font-bold tracking-tight text-ink">
          {dict.landing.featuresTitle}
        </h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {dict.landing.features.map((feature, index) => {
            const Icon = featureIcons[index % featureIcons.length];
            return (
              <div
                key={feature.title}
                className="flex flex-col gap-2.5 rounded-card border border-line bg-surface p-5 shadow-card"
              >
                <span className="flex size-10 items-center justify-center rounded-field bg-brand-50">
                  <Icon className="size-5 text-brand-700" aria-hidden />
                </span>
                <h3 className="text-sm font-bold text-ink">{feature.title}</h3>
                <p className="text-sm leading-relaxed text-ink-muted">
                  {feature.desc}
                </p>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
