import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AvailabilityBadge } from "@/components/availability-badge";
import { ProductDetailActions } from "@/components/product-detail-actions";
import { ProductImage } from "@/components/product-image";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { packageLabel, productName } from "@/lib/catalog-helpers";
import { categoryDot } from "@/lib/category-style";
import {
  getCategory,
  getManufacturer,
  getProduct,
  listProducts,
} from "@/lib/data";
import { formatCurrency } from "@/lib/format";

// This page reads authenticated, tenant-scoped Supabase data through the
// cookie-bound client, so it MUST render dynamically per request — never
// statically generated or cached. No generateStaticParams (its mere presence
// marks the route SSG/`●` in the build); force-dynamic keeps it `ƒ`.
export const dynamic = "force-dynamic";

export default async function ProductPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  if (!isLocale(locale)) notFound();
  const product = await getProduct(id);
  // Inactive products (supabase mode) are removed from the storefront —
  // not just the list — so a bookmarked/shared link can't order them.
  if (!product || product.isActive === false) notFound();

  const dict = getDictionary(locale);
  const [category, manufacturer, products] = await Promise.all([
    getCategory(product.categoryId),
    // A product may legitimately have no manufacturer.
    product.manufacturerId
      ? getManufacturer(product.manufacturerId)
      : Promise.resolve(undefined),
    listProducts(),
  ]);
  if (!category) notFound();
  const related = products
    .filter((p) => p.categoryId === product.categoryId && p.id !== product.id)
    .slice(0, 4);

  const specs: [string, React.ReactNode][] = [
    ...(manufacturer
      ? ([[dict.product.manufacturer, manufacturer.name[locale]]] as [
          string,
          React.ReactNode,
        ][])
      : []),
    [dict.product.category, `${category.icon} ${category.name[locale]}`],
    [dict.product.packageInfo, packageLabel(product, dict)],
    [
      dict.product.pricePerUnit,
      formatCurrency(product.wholesalePrice / product.unitsPerPackage, locale),
    ],
    [
      dict.product.sku,
      <span key="sku" dir="ltr" className="font-mono">
        {product.sku}
      </span>,
    ],
  ];

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <Link
        href={`/${locale}/catalog`}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-muted transition-colors hover:text-ink"
      >
        <ArrowRight className="size-4 ltr:-scale-x-100" aria-hidden />
        {dict.product.backToCatalog}
      </Link>

      <div className="mt-5 grid gap-8 lg:grid-cols-2">
        <ProductImage
          product={product}
          category={category}
          className="aspect-[4/3] w-full rounded-card border border-line shadow-card"
          iconClassName="text-7xl"
        />

        <div className="flex flex-col gap-4">
          <div>
            <div className="flex items-center justify-between gap-2">
              {manufacturer ? (
                <p className="truncate text-[11px] font-bold uppercase tracking-[0.06em] text-brand-700">
                  {manufacturer.name[locale]}
                </p>
              ) : (
                <span />
              )}
              <span
                className="size-2.5 shrink-0 rounded-[3px]"
                style={{ backgroundColor: categoryDot(category.id) }}
                aria-hidden
              />
            </div>
            <h1 className="mt-1 text-[28px] font-extrabold tracking-[-0.02em] text-ink">
              {productName(product, locale)}
            </h1>
            <p className="mt-1 text-sm text-ink-soft">
              {packageLabel(product, dict)}
            </p>
          </div>

          <div className="flex items-center gap-3">
            <AvailabilityBadge
              availability={product.availability}
              dict={dict.availability}
            />
            {product.trackExpiry ? (
              <Badge tone="warning" dashed dot>
                {dict.catalog.expiryTracked}
              </Badge>
            ) : null}
          </div>

          <Card className="p-5">
            <p className="text-3xl font-extrabold tabular-nums tracking-tight text-ink">
              {formatCurrency(product.wholesalePrice, locale)}
              <span className="ms-2 text-sm font-normal text-ink-muted">
                / {dict.packaging[product.packageType]}
              </span>
            </p>
            <p className="mt-1 text-sm text-ink-soft">
              {formatCurrency(
                product.wholesalePrice / product.unitsPerPackage,
                locale,
              )}{" "}
              / {dict.units[product.baseUnit]}
            </p>
            <div className="mt-5">
              <ProductDetailActions
                product={product}
                locale={locale}
                dict={dict}
              />
            </div>
          </Card>

          <dl className="divide-y divide-line-hair rounded-card border border-line bg-surface text-sm shadow-card">
            {specs.map(([label, value]) => (
              <div
                key={label}
                className="flex items-center justify-between gap-4 px-5 py-3"
              >
                <dt className="text-ink-soft">{label}</dt>
                <dd className="font-medium text-ink">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>

      {/* Related */}
      {related.length > 0 ? (
        <section className="mt-12">
          <h2 className="text-lg font-bold text-ink">{dict.product.related}</h2>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4">
            {related.map((rel) => (
              <Link
                key={rel.id}
                href={`/${locale}/product/${rel.id}`}
                className="group overflow-hidden rounded-card border border-line bg-surface shadow-card transition-shadow hover:shadow-float"
              >
                <ProductImage
                  product={rel}
                  category={category}
                  className="aspect-[4/3] w-full"
                />
                <div className="p-3">
                  <p className="line-clamp-2 text-sm font-medium text-ink group-hover:text-brand-700">
                    {productName(rel, locale)}
                  </p>
                  <p className="mt-1 text-sm font-bold text-ink">
                    {formatCurrency(rel.wholesalePrice, locale)}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
