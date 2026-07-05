import { categoryStyle, type CategoryPattern } from "@/lib/category-style";
import type { Category, Product } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Retail placeholder art — category-specific gradient + drawn pattern
 * (bubbles for drinks, confetti for snacks, beans for coffee…) with the
 * unit size as a shelf-label tag. Deterministic per product, so the grid
 * looks stocked and varied, never random between renders.
 * Replaced by real photos when the backend phase adds storage.
 */

/** Tiny deterministic PRNG from the product id. */
function seeded(id: string): () => number {
  let h = 2166136261;
  for (const ch of id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

function Pattern({
  type,
  color,
  rand,
}: {
  type: CategoryPattern;
  color: string;
  rand: () => number;
}) {
  const items = [];
  const count = 9;

  for (let i = 0; i < count; i++) {
    // Loose 3×3 grid with jitter — covers the tile without bad overlaps.
    const x = ((i % 3) + 0.2 + rand() * 0.6) * 33.3;
    const y = (Math.floor(i / 3) + 0.2 + rand() * 0.6) * 25;
    const s = 2.5 + rand() * 4;
    const rot = Math.round(rand() * 360);

    switch (type) {
      case "bubbles":
        items.push(<circle key={i} cx={x} cy={y} r={s} fill={color} />);
        break;
      case "confetti":
        items.push(
          <rect
            key={i}
            x={x}
            y={y}
            width={s * 1.6}
            height={s * 1.6}
            rx={1}
            fill={color}
            transform={`rotate(${rot} ${x} ${y})`}
          />,
        );
        break;
      case "beans":
        items.push(
          <ellipse
            key={i}
            cx={x}
            cy={y}
            rx={s * 1.3}
            ry={s * 0.8}
            fill={color}
            transform={`rotate(${rot} ${x} ${y})`}
          />,
        );
        break;
      case "rings":
        items.push(
          <circle
            key={i}
            cx={x}
            cy={y}
            r={s}
            fill="none"
            stroke={color}
            strokeWidth={1.4}
          />,
        );
        break;
      case "waves":
        items.push(
          <path
            key={i}
            d={`M ${x - s * 2} ${y} q ${s} ${-s} ${s * 2} 0 q ${s} ${s} ${s * 2} 0`}
            fill="none"
            stroke={color}
            strokeWidth={1.6}
            strokeLinecap="round"
          />,
        );
        break;
      case "sparkles":
        items.push(
          <path
            key={i}
            d={`M ${x} ${y - s} L ${x + s * 0.35} ${y - s * 0.35} L ${x + s} ${y} L ${x + s * 0.35} ${y + s * 0.35} L ${x} ${y + s} L ${x - s * 0.35} ${y + s * 0.35} L ${x - s} ${y} L ${x - s * 0.35} ${y - s * 0.35} Z`}
            fill={color}
          />,
        );
        break;
    }
  }
  return <>{items}</>;
}

export function ProductImage({
  product,
  category,
  className,
  iconClassName,
  showSizeTag = true,
}: {
  product: Product;
  category: Category;
  className?: string;
  iconClassName?: string;
  /** The "330ml" shelf-label chip — turn off for tiny thumbnails. */
  showSizeTag?: boolean;
}) {
  const style = categoryStyle(category.id);
  const rand = seeded(product.id);
  // Per-product gradient angle & icon tilt: stocked shelves, not clones.
  const angle = 120 + Math.floor(rand() * 90);
  const tilt = Math.floor(rand() * 13) - 6;

  // Real photo (uploaded or URL) wins over the gradient placeholder.
  if (product.imageUrl) {
    return (
      <div
        aria-hidden
        className={cn("relative overflow-hidden bg-surface-sunken", className)}
      >
        {/* Plain <img>: sources are signed Storage URLs / arbitrary hosts,
            so next/image remote config would need to allow everything. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={product.imageUrl}
          alt=""
          loading="lazy"
          className="size-full object-cover"
        />
        {showSizeTag && product.unitSize ? (
          <span
            dir="ltr"
            className="absolute bottom-2 end-2 rounded-md bg-white/85 px-1.5 py-0.5 text-[11px] font-bold tracking-tight text-ink shadow-sm backdrop-blur-sm"
          >
            {product.unitSize}
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <div
      aria-hidden
      className={cn(
        "relative flex items-center justify-center overflow-hidden",
        className,
      )}
      style={{
        background: `linear-gradient(${angle}deg, ${style.from} 0%, ${style.to} 100%)`,
      }}
    >
      <svg
        viewBox="0 0 100 75"
        preserveAspectRatio="xMidYMid slice"
        className="absolute inset-0 size-full"
      >
        <Pattern type={style.pattern} color={style.patternColor} rand={rand} />
      </svg>

      <span
        className={cn(
          "relative select-none text-5xl drop-shadow-md",
          iconClassName,
        )}
        style={{ transform: `rotate(${tilt}deg)` }}
      >
        {category.icon}
      </span>

      {showSizeTag && product.unitSize ? (
        <span
          dir="ltr"
          className="absolute bottom-2 end-2 rounded-md bg-white/85 px-1.5 py-0.5 text-[11px] font-bold tracking-tight text-ink shadow-sm backdrop-blur-sm"
        >
          {product.unitSize}
        </span>
      ) : null}
    </div>
  );
}
