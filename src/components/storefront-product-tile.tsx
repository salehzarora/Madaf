import { EffectivePrice } from "@/components/effective-price";
import Link from "next/link";
import { ProductImage } from "@/components/product-image";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/types";
import { packageLabel, productName } from "@/lib/catalog-helpers";
import type { Manufacturer, Product } from "@/lib/types";

/** Navigation only: shared media, without ProductCard's ordering controls. */
export function StorefrontProductTile({ product, manufacturer, locale, dict }: {
  product: Product;
  manufacturer?: Manufacturer;
  locale: Locale;
  dict: Dictionary;
}) {
  const name = productName(product, locale);
  return (
    <Link href={`/${locale}/product/${product.id}`} className="storefront-product-tile" aria-label={name}>
      <ProductImage product={product} presentation="storefront" className="storefront-tile-media" />
      <div className="storefront-tile-copy">
        {manufacturer?.name[locale] ? <p className="storefront-tile-brand">{manufacturer.name[locale]}</p> : null}
        <h3 className="storefront-tile-name" title={name}>{name}</h3>
        <p className="storefront-tile-package">{packageLabel(product, dict)}</p>
        <p className="storefront-tile-price"><bdi dir="ltr"><EffectivePrice productId={product.id} locale={locale} /></bdi></p>
      </div>
    </Link>
  );
}
