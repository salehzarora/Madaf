"use client";

import {
  Boxes,
  FileText,
  LayoutDashboard,
  Menu,
  Package,
  ShoppingBag,
  Store,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { LogoMark, LogoWordmark } from "@/components/logo";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/types";
import { cn } from "@/lib/utils";

/**
 * Admin shell — SaaS dashboard layout with a start-side sidebar (RTL-aware:
 * sidebar sits on the right in he/ar) and a collapsible drawer on mobile.
 */
export function AdminShell({
  locale,
  dict,
  children,
}: {
  locale: Locale;
  dict: Dictionary;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const base = `/${locale}/admin`;
  const nav = [
    { href: base, label: dict.nav.dashboard, icon: LayoutDashboard, exact: true },
    { href: `${base}/products`, label: dict.nav.products, icon: Package },
    { href: `${base}/orders`, label: dict.nav.orders, icon: ShoppingBag },
    { href: `${base}/inventory`, label: dict.nav.inventory, icon: Boxes },
    { href: `${base}/customers`, label: dict.nav.customers, icon: Store },
    { href: `${base}/documents`, label: dict.nav.documents, icon: FileText },
  ];

  function isActive(item: (typeof nav)[number]): boolean {
    return item.exact
      ? pathname === item.href
      : pathname.startsWith(item.href);
  }

  const sidebar = (
    <nav className="flex flex-1 flex-col gap-1 p-3">
      {nav.map((item) => {
        const Icon = item.icon;
        const active = isActive(item);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setOpen(false)}
            className={cn(
              "flex h-11 items-center gap-3 rounded-field px-3 text-sm font-medium transition-colors",
              active
                ? "bg-brand-600 text-white shadow-sm"
                : "text-ink-soft hover:bg-surface-sunken hover:text-ink",
            )}
          >
            <Icon className="size-5 shrink-0" aria-hidden />
            {item.label}
          </Link>
        );
      })}
      <div className="mt-auto border-t border-line pt-3">
        <Link
          href={`/${locale}/catalog`}
          onClick={() => setOpen(false)}
          className="flex h-11 items-center gap-3 rounded-field px-3 text-sm font-medium text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink"
        >
          <X className="size-5 shrink-0" aria-hidden />
          {dict.nav.exitAdmin}
        </Link>
      </div>
    </nav>
  );

  return (
    <div className="flex min-h-dvh flex-col">
      {/* Top bar */}
      <header className="sticky top-0 z-40 border-b border-line bg-surface">
        <div className="flex h-16 items-center gap-3 px-4 sm:px-6">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? dict.common.close : "Menu"}
            className="flex size-11 items-center justify-center rounded-field text-ink-soft transition-colors hover:bg-surface-sunken lg:hidden"
          >
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
          <Link href={base} className="flex items-center gap-2.5">
            <LogoMark />
            <LogoWordmark
              appName={dict.admin.title}
              appNameNative={dict.admin.title}
              className="hidden sm:flex"
            />
          </Link>
          <span className="rounded-full bg-accent-100 px-2.5 py-1 text-xs font-semibold text-accent-800">
            {dict.common.demoBadge}
          </span>
          <div className="ms-auto">
            <LocaleSwitcher current={locale} />
          </div>
        </div>
      </header>

      <div className="flex flex-1">
        {/* Desktop sidebar (start side — right in RTL) */}
        <aside className="sticky top-16 hidden h-[calc(100dvh-4rem)] w-60 shrink-0 flex-col border-e border-line bg-surface lg:flex">
          {sidebar}
        </aside>

        {/* Mobile drawer */}
        {open ? (
          <div className="fixed inset-0 z-30 lg:hidden">
            <div
              className="absolute inset-0 bg-ink/30"
              onClick={() => setOpen(false)}
              aria-hidden
            />
            <aside className="absolute inset-y-0 start-0 flex w-72 flex-col border-e border-line bg-surface pt-20 shadow-float">
              {sidebar}
            </aside>
          </div>
        ) : null}

        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
