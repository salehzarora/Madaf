import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AvailabilityBadge } from "@/components/availability-badge";
import { ProductDetailActions } from "@/components/product-detail-actions";
import { ProductImage } from "@/components/product-image";
import { StorefrontProductTile } from "@/components/storefront-product-tile";
import { Badge } from "@/components/ui/badge";
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
    <div className="storefront-product-page">
      <Link
        href={`/${locale}/catalog`}
        className="storefront-product-back"
      >
        <ArrowRight className="size-4 ltr:-scale-x-100" aria-hidden />
        {dict.product.backToCatalog}
      </Link>

      <div className="storefront-product-layout">
        <ProductImage
          product={product}
          category={category}
          presentation="storefront"
          fillPhoto
          className="storefront-detail-media"
        />

        <div className="storefront-product-info">
          <div className="storefront-product-heading">
            <div className="storefront-product-identity">
              {manufacturer ? (
                <p className="storefront-product-brand">
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
            <h1 className="storefront-product-name">
              {productName(product, locale)}
            </h1>
            <p className="storefront-product-package">
              {packageLabel(product, dict)}
            </p>
          </div>

          <div className="storefront-product-status">
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

          <div className="storefront-product-purchase">
            <p className="storefront-product-price">
              <bdi dir="ltr">{formatCurrency(product.wholesalePrice, locale)}</bdi>
              <span>
                / {dict.packaging[product.packageType]}
              </span>
            </p>
            <p className="storefront-product-unit-price">
              <bdi dir="ltr">{formatCurrency(
                product.wholesalePrice / product.unitsPerPackage,
                locale,
              )}</bdi>{" "}
              / {dict.units[product.baseUnit]}
            </p>
            <div className="storefront-product-controls">
              <ProductDetailActions
                product={product}
                locale={locale}
                dict={dict}
              />
            </div>
          </div>

          <dl className="storefront-product-specs">
            {specs.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>

      {/* Related */}
      {related.length > 0 ? (
        <section className="storefront-product-related">
          <h2>{dict.product.related}</h2>
          <div className="storefront-related-grid">
            {related.map((rel) => (
              <StorefrontProductTile
                key={rel.id}
                product={rel}
                manufacturer={rel.manufacturerId === manufacturer?.id ? manufacturer : undefined}
                locale={locale}
                dict={dict}
              />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
