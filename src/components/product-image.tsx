import type { Category, Product } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Placeholder product visual — deterministic two-tone gradient derived from
 * the category hue + product id, with the category pictogram. Replaced by
 * real product photos when the backend phase adds storage.
 */
export function ProductImage({
  product,
  category,
  className,
  iconClassName,
}: {
  product: Product;
  category: Category;
  className?: string;
  iconClassName?: string;
}) {
  // Small deterministic hash so items in one category still differ.
  const hash = [...product.id].reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  const h1 = (category.hue + (hash % 18)) % 360;
  const h2 = (h1 + 28) % 360;

  return (
    <div
      aria-hidden
      className={cn(
        "flex items-center justify-center overflow-hidden",
        className,
      )}
      style={{
        background: `linear-gradient(135deg, hsl(${h1} 42% 88%) 0%, hsl(${h2} 38% 78%) 100%)`,
      }}
    >
      <span
        className={cn("select-none text-4xl opacity-80 drop-shadow-sm", iconClassName)}
      >
        {category.icon}
      </span>
    </div>
  );
}
