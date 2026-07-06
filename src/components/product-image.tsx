import { Package } from "lucide-react";
import type { Category, Product } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Product art — "Madaf Ledger": a neutral photo-placeholder (faint package
 * glyph on warm paper) with the unit size as a mono shelf-label tag. Category
 * identity lives on a separate color dot in the card body, not on the art.
 * A real uploaded/URL photo wins over the placeholder.
 */
export function ProductImage({
  product,
  className,
  iconClassName,
  showSizeTag = true,
}: {
  product: Product;
  /** Accepted for API compatibility; identity is a dot in the card body now. */
  category?: Category;
  className?: string;
  iconClassName?: string;
  /** The unit-size shelf tag — turn off for tiny thumbnails. */
  showSizeTag?: boolean;
}) {
  const sizeTag =
    showSizeTag && product.unitSize ? (
      <span
        dir="ltr"
        className="absolute bottom-2 end-2 rounded-badge bg-ink px-1.5 py-0.5 font-mono text-[11px] font-semibold text-background"
      >
        {product.unitSize}
      </span>
    ) : null;

  // Real photo (uploaded or URL) wins over the placeholder.
  if (product.imageUrl) {
    return (
      <div
        aria-hidden
        className={cn("relative overflow-hidden bg-surface-sunken", className)}
      >
        {/* Plain <img>: sources are signed Storage URLs / arbitrary hosts. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={product.imageUrl}
          alt=""
          loading="lazy"
          className="size-full object-cover"
        />
        {sizeTag}
      </div>
    );
  }

  return (
    <div
      aria-hidden
      className={cn(
        "relative flex items-center justify-center overflow-hidden bg-[#F0ECE2]",
        className,
      )}
    >
      <Package
        className={cn("size-10 text-ink/[.16]", iconClassName)}
        strokeWidth={1.5}
        aria-hidden
      />
      {sizeTag}
    </div>
  );
}
