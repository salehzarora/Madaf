"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { localeNames, locales, type Locale } from "@/i18n/config";
import { cn } from "@/lib/utils";

/**
 * Segmented locale switcher. Swaps the /[locale]/ prefix while keeping the
 * rest of the path (query params are dropped — documented limitation).
 */
export function LocaleSwitcher({
  current,
  className,
}: {
  current: Locale;
  className?: string;
}) {
  const pathname = usePathname();

  function hrefFor(target: Locale): string {
    const rest = pathname.replace(/^\/(ar|he|en)(?=\/|$)/, "");
    return `/${target}${rest}`;
  }

  return (
    <nav
      aria-label="Language"
      className={cn(
        "flex items-center rounded-full border border-line bg-surface-sunken p-1",
        className,
      )}
    >
      {locales.map((locale) => (
        <Link
          key={locale}
          href={hrefFor(locale)}
          aria-current={locale === current ? "true" : undefined}
          className={cn(
            "rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
            locale === current
              ? "bg-surface text-ink shadow-sm"
              : "text-ink-muted hover:text-ink",
          )}
        >
          {localeNames[locale]}
        </Link>
      ))}
    </nav>
  );
}
