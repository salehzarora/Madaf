"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Locale } from "@/i18n/config";
import { cn } from "@/lib/utils";

/** Only the active navigation state needs to cross the shell's client boundary. */
export function StorefrontCatalogLink({ locale, label }: { locale: Locale; label: string }) {
  const pathname = usePathname();
  const catalogActive = pathname === `/${locale}/catalog`;

  return (
    <Link
      href={`/${locale}/catalog`}
      aria-current={catalogActive ? "page" : undefined}
      className={cn(
        "inline-flex min-h-11 items-center rounded-field px-3 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600",
        catalogActive ? "bg-brand-50 text-brand-800" : "text-ink-soft hover:bg-surface-sunken hover:text-ink",
      )}
    >
      {label}
    </Link>
  );
}
