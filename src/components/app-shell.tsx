import { LayoutDashboard } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { CartLink } from "@/components/cart-link";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { LogoMark, LogoWordmark } from "@/components/logo";
import { StorefrontCatalogLink } from "@/components/storefront-catalog-link";
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
      <header className="sticky top-0 z-40 flex h-[var(--storefront-header-height)] shrink-0 flex-col border-b border-line bg-surface-warm/95 backdrop-blur">
        {/* Bottle-green shelf edge */}
        <div className="h-1 shrink-0 bg-band" aria-hidden />
        <div className="mx-auto flex min-h-0 w-full max-w-[1720px] flex-1 items-center gap-2 px-4 sm:gap-3 sm:px-6">
          <Link
            href={`/${locale}`}
            className="flex min-h-11 shrink-0 items-center gap-2.5 rounded-field focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
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
            <StorefrontCatalogLink locale={locale} label={dict.nav.catalog} />
          </nav>

          <div className="ms-auto flex shrink-0 items-center gap-1 sm:gap-2">
            <CartLink locale={locale} label={dict.nav.cart} />
            <Link
              href={`/${locale}/admin`}
              aria-label={dict.nav.admin}
              className="inline-flex size-11 items-center justify-center gap-2 rounded-field text-sm font-semibold text-ink-soft transition-colors hover:bg-surface-sunken hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 lg:w-auto lg:px-3"
            >
              <LayoutDashboard className="size-5" aria-hidden />
              <span className="hidden lg:inline">{dict.nav.admin}</span>
            </Link>
            <LocaleSwitcher current={locale} label={dict.common.language} className="hidden sm:flex [&_a]:inline-flex [&_a]:min-h-11 [&_a]:items-center" />
            <LocaleSwitcher current={locale} label={dict.common.language} variant="compact" className="sm:hidden" />
          </div>
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
