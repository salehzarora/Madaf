import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AvailabilityBadge } from "@/components/availability-badge";
import { ProductDetailActions } from "@/components/product-detail-actions";
import { ProductImage } from "@/components/product-image";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { packageLabel, productName } from "@/lib/catalog-helpers";
import {
  getCategory,
  getManufacturer,
  getProduct,
  listProducts,
} from "@/lib/data";
import { formatCurrency } from "@/lib/format";

export async function generateStaticParams() {
  const products = await listProducts();
  return products.map((product) => ({ id: product.id }));
}

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
    [dict.product.sku, <span key="sku" dir="ltr">{product.sku}</span>],
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
            {manufacturer ? (
              <p className="text-sm font-medium text-ink-muted">
                {manufacturer.name[locale]}
              </p>
            ) : null}
            <h1 className="mt-1 text-3xl font-bold tracking-tight text-ink">
              {productName(product, locale)}
            </h1>
            <p className="mt-2 text-sm text-ink-soft">
              {packageLabel(product, dict)}
            </p>
          </div>

          <div className="flex items-center gap-3">
            <AvailabilityBadge
              availability={product.availability}
              dict={dict.availability}
            />
            {product.trackExpiry ? (
              <span className="rounded-full bg-surface-sunken px-2.5 py-0.5 text-xs font-medium text-ink-soft">
                {dict.catalog.expiryTracked}
              </span>
            ) : null}
          </div>

          <div className="rounded-card border border-line bg-surface p-5 shadow-card">
            <p className="text-3xl font-bold tracking-tight text-ink">
              {formatCurrency(product.wholesalePrice, locale)}
              <span className="ms-2 text-sm font-normal text-ink-muted">
                / {dict.packaging[product.packageType]}
              </span>
            </p>
            <p className="mt-1 text-sm text-ink-muted">
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
          </div>

          <dl className="divide-y divide-line rounded-card border border-line bg-surface text-sm shadow-card">
            {specs.map(([label, value]) => (
              <div
                key={label}
                className="flex items-center justify-between gap-4 px-5 py-3"
              >
                <dt className="text-ink-muted">{label}</dt>
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
