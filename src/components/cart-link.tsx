"use client";

import { ShoppingCart } from "lucide-react";
import Link from "next/link";
import { useCart } from "@/lib/cart-context";
import type { Locale } from "@/i18n/config";
import { cn } from "@/lib/utils";

/** Header cart button with live item count. */
export function CartLink({
  locale,
  label,
  className,
}: {
  locale: Locale;
  label: string;
  className?: string;
}) {
  const { totalPackages, hydrated } = useCart();

  return (
    <Link
      href={`/${locale}/cart`}
      aria-label={label}
      className={cn(
        "relative inline-flex h-11 items-center gap-2 rounded-field bg-ink px-3.5 text-sm font-bold text-background transition-colors hover:bg-band",
        className,
      )}
    >
      <ShoppingCart className="size-5" aria-hidden />
      <span className="hidden sm:inline">{label}</span>
      {hydrated && totalPackages > 0 ? (
        <span
          dir="ltr"
          className="absolute -top-1 -end-1 flex h-5 min-w-5 items-center justify-center rounded-badge bg-accent px-1 font-mono text-[11px] font-bold text-ink"
        >
          {totalPackages > 99 ? "99+" : totalPackages}
        </span>
      ) : null}
    </Link>
  );
}
