"use client";

import { useEffect, useRef, useState } from "react";
import { LogoMark } from "@/components/logo";
import { ProductImage } from "@/components/product-image";
import type { Dictionary } from "@/i18n/types";
import type { Product } from "@/lib/types";

/** The catalog needs display identity only, not the full supplier record. */
export interface CatalogSupplierIdentity {
  name: string;
  logoUrl?: string;
}

/** Existing catalog art, capped at three images. The source order is stable;
 * images take precedence without assigning featured/promoted product status. */
function heroProducts(products: Product[]): Product[] {
  const pictured: Product[] = [];
  const placeholders: Product[] = [];
  for (const product of products) {
    if (product.imageUrl) pictured.push(product);
    else if (placeholders.length < 3) placeholders.push(product);
    if (pictured.length === 3) break;
  }
  return [...pictured, ...placeholders].slice(0, 3);
}

export function CatalogHero({
  supplier,
  products,
  dict,
}: {
  supplier: CatalogSupplierIdentity;
  products: Product[];
  dict: Dictionary;
}) {
  const [failedLogo, setFailedLogo] = useState<string | null>(null);
  const logoRef = useRef<HTMLImageElement>(null);
  const showLogo = supplier.logoUrl && failedLogo !== supplier.logoUrl;
  const art = heroProducts(products);

  // A failed image may finish before hydration, when onError cannot be replayed.
  useEffect(() => {
    const image = logoRef.current;
    if (image?.complete && image.naturalWidth === 0 && supplier.logoUrl) {
      setFailedLogo(supplier.logoUrl);
    }
  }, [supplier.logoUrl]);

  return (
    <section className="catalog-hero overflow-hidden rounded-card border border-line bg-surface-warm shadow-card">
      <div className="catalog-hero-copy relative z-10 min-w-0">
        <div className="flex min-w-0 items-center gap-3 sm:gap-4">
          <div className="catalog-hero-logo flex shrink-0 items-center justify-center overflow-hidden rounded-card border border-line bg-surface">
            {showLogo ? (
              // Signed Storage URLs/arbitrary logo hosts follow existing image handling.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                ref={logoRef}
                src={supplier.logoUrl}
                alt=""
                onError={() => setFailedLogo(supplier.logoUrl ?? null)}
                className="size-full object-contain p-1.5"
              />
            ) : (
              <LogoMark className="size-4/5" />
            )}
          </div>
          <div className="min-w-0">
            <span className="text-[11px] font-semibold text-brand-700">
              {dict.catalog.title}
            </span>
            <h1 className="catalog-hero-name text-xl font-extrabold leading-snug tracking-tight text-ink sm:text-2xl lg:text-[28px]">
              {supplier.name || dict.catalog.title}
            </h1>
          </div>
        </div>
        <p className="catalog-hero-title mt-4 text-xl font-extrabold leading-snug tracking-tight text-band sm:text-[28px] lg:text-[34px]">
          {dict.catalog.heroTitle}
        </p>
        <p className="catalog-hero-body mt-2 max-w-md text-sm leading-relaxed text-ink-soft">
          {dict.catalog.heroBody}
        </p>
        <p className="catalog-hero-note mt-4 text-xs font-medium text-ink-muted">
          {dict.catalog.subtitle}
        </p>
      </div>
      <div className="catalog-hero-visual relative overflow-hidden bg-band" aria-hidden>
        <div className="catalog-hero-halo absolute rounded-full border border-band-muted/20" />
        <div className="catalog-hero-shelf absolute rounded-full bg-accent/70" />
        {art.length > 0 ? art.map((product, index) => (
          <div
            key={product.id}
            data-position={index}
            className="catalog-hero-product absolute overflow-hidden rounded-card border border-surface/70 bg-surface-warm p-2 shadow-float"
          >
            <ProductImage
              product={product}
              className="aspect-[4/5] w-full rounded-field"
              iconClassName="size-16 text-ink/20"
            />
          </div>
        )) : (
          <LogoMark className="catalog-hero-empty absolute size-28 opacity-70" />
        )}
      </div>
    </section>
  );
}
