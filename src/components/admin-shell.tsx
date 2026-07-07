"use client";

import {
  Boxes,
  Factory,
  FileText,
  LayoutDashboard,
  Menu,
  Package,
  Receipt,
  ShoppingBag,
  Store,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { LogoutButton } from "@/components/auth/logout-button";
import { TenantSwitcher } from "@/components/auth/tenant-switcher";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { LogoMark } from "@/components/logo";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/types";
import { cn } from "@/lib/utils";

/** Signed-in supplier identity shown in the admin top bar (Supabase mode). */
export interface AdminSession {
  email: string | null;
  /** Membership role — keyed into `dict.access.session.roles` for display. */
  role: keyof Dictionary["access"]["session"]["roles"];
  tenantName: string;
  /** Currently-selected tenant id + all memberships (for the switcher). */
  currentTenantId: string;
  tenants: { id: string; name: string }[];
}

/**
 * Admin shell — the "Madaf Ledger" layout: a deep bottle-green navigation
 * band on the inline start (right in he/ar) carrying the logo, tenant
 * switcher and nav; a warm top bar; a light content area. Mobile: a band top
 * bar + drawer + bottom tab bar. Dark chrome belongs to navigation only.
 */
export function AdminShell({
  locale,
  dict,
  session,
  children,
}: {
  locale: Locale;
  dict: Dictionary;
  session?: AdminSession;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const base = `/${locale}/admin`;
  // Team management is owner/admin only (Supabase mode); hidden otherwise.
  const canManageTeam = session?.role === "owner" || session?.role === "admin";
  // Tax settings (M6B, inert): owner/admin in Supabase mode; shown in the open
  // mock demo too (no session). Hidden for sales_rep. Nothing is issued there.
  const canManageSettings =
    !session || session.role === "owner" || session.role === "admin";
  const nav = [
    { href: base, label: dict.nav.dashboard, icon: LayoutDashboard, exact: true },
    { href: `${base}/products`, label: dict.nav.products, icon: Package },
    { href: `${base}/manufacturers`, label: dict.nav.manufacturers, icon: Factory },
    { href: `${base}/orders`, label: dict.nav.orders, icon: ShoppingBag },
    { href: `${base}/inventory`, label: dict.nav.inventory, icon: Boxes },
    { href: `${base}/customers`, label: dict.nav.customers, icon: Store },
    { href: `${base}/documents`, label: dict.nav.documents, icon: FileText },
    ...(canManageTeam
      ? [{ href: `${base}/team`, label: dict.nav.team, icon: Users }]
      : []),
    ...(canManageSettings
      ? [{ href: `${base}/settings/tax`, label: dict.nav.settings, icon: Receipt }]
      : []),
  ];

  function isActive(item: (typeof nav)[number]): boolean {
    return item.exact ? pathname === item.href : pathname.startsWith(item.href);
  }
  const activeLabel = nav.find(isActive)?.label ?? dict.nav.dashboard;

  const logoBlock = (
    <Link
      href={base}
      onClick={() => setOpen(false)}
      className="flex items-center gap-2.5 rounded-field p-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      <LogoMark className="size-9" />
      <span className="text-[17px] font-extrabold tracking-[-0.01em] text-band-ink">
        {dict.admin.title}
      </span>
    </Link>
  );

  const navList = (
    <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-3">
      {nav.map((item) => {
        const Icon = item.icon;
        const active = isActive(item);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setOpen(false)}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative flex h-[42px] items-center gap-3 rounded-field px-3 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
              active
                ? "bg-band-ink/10 font-bold text-band-ink"
                : "font-medium text-band-muted hover:bg-band-ink/[.08] hover:text-band-ink",
            )}
          >
            {active ? (
              <span
                className="absolute start-0 top-2 bottom-2 w-[3px] rounded-full bg-accent"
                aria-hidden
              />
            ) : null}
            <Icon className="size-5 shrink-0" aria-hidden />
            {item.label}
          </Link>
        );
      })}
      <div className="mt-auto pt-3">
        <Link
          href={`/${locale}/catalog`}
          onClick={() => setOpen(false)}
          className="flex h-11 items-center gap-3 rounded-field px-3 text-sm font-medium text-band-muted transition-colors hover:bg-band-ink/[.08] hover:text-band-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <X className="size-5 shrink-0" aria-hidden />
          {dict.nav.exitAdmin}
        </Link>
      </div>
    </nav>
  );

  const bandTop = (
    <div className="flex flex-col gap-3 border-b border-band-muted/15 p-4">
      {logoBlock}
      {session ? (
        session.tenants.length > 1 ? (
          <TenantSwitcher
            locale={locale}
            currentTenantId={session.currentTenantId}
            currentName={session.tenantName}
            tenants={session.tenants}
            label={dict.access.tenant.switch}
          />
        ) : (
          <span className="inline-flex max-w-full items-center gap-2 truncate rounded-field border border-band-muted/25 bg-band-ink/5 px-2.5 py-2 text-[13px] font-semibold text-band-ink">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-accent text-[12px] font-extrabold text-band">
              {session.tenantName.slice(0, 1)}
            </span>
            <span className="truncate">{session.tenantName}</span>
          </span>
        )
      ) : (
        <span className="inline-flex w-fit items-center gap-1.5 rounded-badge border border-dashed border-accent/40 bg-accent/10 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.08em] text-accent">
          {dict.common.demoBadge}
        </span>
      )}
    </div>
  );

  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      {/* Desktop band sidebar (inline start — right in he/ar) */}
      <aside className="sticky top-0 hidden h-dvh w-[248px] shrink-0 flex-col bg-band lg:flex">
        {bandTop}
        {navList}
      </aside>

      {/* Mobile band top bar */}
      <header className="sticky top-0 z-40 flex h-14 items-center gap-3 bg-band px-4 lg:hidden">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? dict.common.close : dict.common.menu}
          className="flex size-11 items-center justify-center rounded-field text-band-ink transition-colors hover:bg-band-ink/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
        {logoBlock}
      </header>

      {/* Mobile drawer */}
      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-ink/50"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <aside className="absolute inset-y-0 start-0 flex w-72 flex-col bg-band shadow-float">
            {bandTop}
            {navList}
          </aside>
        </div>
      ) : null}

      {/* Content column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Warm top bar (desktop) */}
        <header className="sticky top-0 z-30 hidden h-16 items-center gap-3 border-b border-line bg-surface-warm px-7 lg:flex">
          <div className="leading-tight">
            <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-muted">
              {session?.tenantName ?? dict.common.demoBadge}
            </p>
            <p className="text-sm font-bold text-ink">{activeLabel}</p>
          </div>
          <div className="ms-auto flex items-center gap-2.5">
            <LocaleSwitcher current={locale} />
            {session ? (
              <>
                <div className="hidden items-center gap-2.5 md:flex">
                  <span className="flex size-7 items-center justify-center rounded-lg bg-band text-[13px] font-bold text-accent">
                    {(session.email ?? "?").slice(0, 1).toUpperCase()}
                  </span>
                  <div className="text-end leading-tight">
                    <p
                      className="max-w-44 truncate font-mono text-[12px] font-medium text-ink"
                      dir="ltr"
                    >
                      {session.email}
                    </p>
                    <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-soft">
                      {dict.access.session.roles[session.role]}
                    </p>
                  </div>
                </div>
                <LogoutButton locale={locale} label={dict.access.session.logout} />
              </>
            ) : null}
          </div>
        </header>

        <main className="min-w-0 flex-1 px-4 pb-24 pt-6 sm:px-6 lg:px-8 lg:pb-8">
          {children}
        </main>
      </div>

      {/* Mobile bottom tab bar */}
      <nav className="fixed inset-x-0 bottom-0 z-40 flex items-stretch gap-1 rounded-t-2xl border-t border-band-muted/20 bg-band px-2 py-1.5 lg:hidden">
        {[
          { href: base, label: dict.nav.dashboard, icon: LayoutDashboard, exact: true },
          { href: `${base}/orders`, label: dict.nav.orders, icon: ShoppingBag },
          { href: `${base}/products`, label: dict.nav.products, icon: Package },
          { href: `${base}/customers`, label: dict.nav.customers, icon: Store },
        ].map((item) => {
          const Icon = item.icon;
          const active = item.exact
            ? pathname === item.href
            : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex flex-1 flex-col items-center gap-0.5 rounded-field py-1.5 text-[10px] font-semibold focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent",
                active ? "text-accent" : "text-band-muted",
              )}
            >
              <Icon className="size-[19px]" aria-hidden />
              <span className="truncate">{item.label}</span>
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex flex-1 flex-col items-center gap-0.5 rounded-field py-1.5 text-[10px] font-semibold text-band-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
        >
          <Menu className="size-[19px]" aria-hidden />
          <span>{dict.common.menu}</span>
        </button>
      </nav>
    </div>
  );
}
