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
import { listCategories, listProducts } from "@/lib/data";

/**
 * Landing — product-first: a live mini catalog in the hero, category
 * tiles into the catalog, then the three flows. Presentation stays on the server.
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
    <div className="storefront-landing">
      {/* Hero — copy + live catalog preview */}
      <section className="storefront-landing-hero">
        <div className="storefront-landing-hero-inner">
          <div className="storefront-landing-hero-copy">
            <span className="storefront-landing-badge">
              {dict.landing.heroBadge}
            </span>
            <h1>
              {dict.landing.heroTitle}
            </h1>
            <p className="storefront-landing-subtitle">
              {dict.landing.heroSubtitle}
            </p>
            <div className="storefront-landing-actions">
              <Link
                href={`/${locale}/catalog`}
                className="storefront-landing-cta storefront-landing-cta-primary"
              >
                {dict.landing.ctaCatalog}
                <ArrowRight className="size-5 rtl:-scale-x-100" aria-hidden />
              </Link>
              <Link
                href={`/${locale}/admin`}
                className="storefront-landing-cta storefront-landing-cta-secondary"
              >
                {dict.landing.ctaAdmin}
              </Link>
            </div>
          </div>

          <div className="storefront-landing-hero-preview">
            <MiniCatalogPreview locale={locale} dict={dict} />
          </div>
        </div>
      </section>

      {/* Category tiles — straight into the shelves */}
      <section className="storefront-landing-section storefront-landing-categories">
        <div className="storefront-landing-section-heading">
          <h2>
            {dict.landing.browseByCategory}
          </h2>
          <Link
            href={`/${locale}/catalog`}
            className="storefront-landing-view-all"
          >
            {dict.common.viewAll}
          </Link>
        </div>
        <div className="storefront-landing-category-grid">
          {categories.map((category) => {
            const count = products.filter(
              (p) => p.categoryId === category.id,
            ).length;
            return (
              <Link
                key={category.id}
                href={`/${locale}/catalog`}
                className="storefront-landing-category"
              >
                <span className="storefront-landing-category-icon" aria-hidden>
                  {category.icon}
                </span>
                <span className="storefront-landing-category-name">
                  {category.name[locale]}
                </span>
                <span className="storefront-landing-category-count">
                  {count} {dict.nav.products}
                </span>
              </Link>
            );
          })}
        </div>
      </section>

      {/* Roles — the three flows */}
      <section className="storefront-landing-roles">
        <div className="storefront-landing-section">
          <h2>
            {dict.landing.rolesTitle}
          </h2>
          <div className="storefront-landing-role-grid">
            {roleCards.map((role) => {
              const Icon = role.icon;
              return (
                <Link
                  key={role.title}
                  href={role.href}
                  className="storefront-landing-role"
                >
                  <span className="storefront-landing-icon">
                    <Icon className="size-6" aria-hidden />
                  </span>
                  <h3>{role.title}</h3>
                  <p>
                    {role.desc}
                  </p>
                  <span className="storefront-landing-role-cta">
                    {role.cta}
                    <ArrowRight
                      className="size-4 rtl:-scale-x-100"
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
      <section className="storefront-landing-section storefront-landing-features">
        <h2>
          {dict.landing.featuresTitle}
        </h2>
        <div className="storefront-landing-feature-grid">
          {dict.landing.features.map((feature, index) => {
            const Icon = featureIcons[index % featureIcons.length];
            return (
              <div
                key={feature.title}
                className="storefront-landing-feature"
              >
                <span className="storefront-landing-icon">
                  <Icon className="size-5" aria-hidden />
                </span>
                <h3>{feature.title}</h3>
                <p>
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
