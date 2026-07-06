import { LayoutDashboard } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { CartLink } from "@/components/cart-link";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { LogoMark, LogoWordmark } from "@/components/logo";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/types";

/**
 * Storefront shell — sticky top bar with brand, catalog nav, cart and
 * language switcher. Tablet-first: generous heights, large tap targets.
 */
export function AppShell({
  locale,
  dict,
  children,
}: {
  locale: Locale;
  dict: Dictionary;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-40 border-b border-line bg-surface-warm/95 backdrop-blur">
        {/* Bottle-green shelf edge */}
        <div className="h-1 bg-band" aria-hidden />
        <div className="mx-auto flex h-16 w-full max-w-[1720px] items-center gap-3 px-4 sm:px-6">
          <Link
            href={`/${locale}`}
            className="flex items-center gap-2.5"
            aria-label={dict.meta.appName}
          >
            <LogoMark />
            <LogoWordmark
              appName={dict.meta.appName}
              appNameNative={dict.meta.appNameNative}
              className="hidden sm:flex"
            />
          </Link>

          <nav className="ms-2 hidden items-center gap-1 md:flex">
            <Link
              href={`/${locale}/catalog`}
              className="rounded-field px-3 py-2 text-sm font-semibold text-ink-soft transition-colors hover:bg-surface-sunken hover:text-ink"
            >
              {dict.nav.catalog}
            </Link>
          </nav>

          <div className="ms-auto flex items-center gap-1.5 sm:gap-3">
            <CartLink locale={locale} label={dict.nav.cart} />
            <Link
              href={`/${locale}/admin`}
              aria-label={dict.nav.admin}
              className="inline-flex h-11 items-center gap-2 rounded-field px-3 text-sm font-semibold text-ink-soft transition-colors hover:bg-surface-sunken hover:text-ink"
            >
              <LayoutDashboard className="size-5" aria-hidden />
              <span className="hidden lg:inline">{dict.nav.admin}</span>
            </Link>
            <LocaleSwitcher current={locale} className="hidden sm:flex" />
          </div>
        </div>
        {/* Mobile locale row */}
        <div className="flex justify-center pb-2 sm:hidden">
          <LocaleSwitcher current={locale} />
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-line bg-band text-band-muted">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-2.5 px-4 py-7 text-center sm:px-6">
          <p className="text-sm font-semibold text-band-ink">
            {dict.meta.appNameNative} · {dict.meta.tagline}
          </p>
          <p className="rounded-badge border border-band-ink/15 bg-band-ink/5 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.06em]">
            {dict.common.mockNotice}
          </p>
        </div>
      </footer>
    </div>
  );
}
