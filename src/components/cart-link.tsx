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
      className={cn(
        "relative inline-flex h-11 items-center gap-2 rounded-field px-3 text-sm font-medium text-ink-soft transition-colors hover:bg-surface-sunken hover:text-ink",
        className,
      )}
    >
      <ShoppingCart className="size-5" aria-hidden />
      <span className="hidden sm:inline">{label}</span>
      {hydrated && totalPackages > 0 ? (
        <span className="absolute -top-0.5 end-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-accent-500 px-1 text-[11px] font-bold text-white">
          {totalPackages > 99 ? "99+" : totalPackages}
        </span>
      ) : null}
    </Link>
  );
}
