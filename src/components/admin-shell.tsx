"use client";

import {
  Boxes, Building2, Factory, FileText, LayoutDashboard, Menu,
  Package, Receipt, ShoppingBag, Store, Users, X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { LogoutButton } from "@/components/auth/logout-button";
import { TenantSwitcher } from "@/components/auth/tenant-switcher";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { LogoMark } from "@/components/logo";
import { dirFor, type Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/types";

const DESKTOP_QUERY = "(min-width: 1280px)";

/** Signed-in supplier identity supplied by the unchanged server AdminLayout. */
export interface AdminSession {
  email: string | null;
  role: keyof Dictionary["access"]["session"]["roles"];
  tenantName: string;
  logoUrl?: string;
  currentTenantId: string;
  tenants: { id: string; name: string }[];
}

/** Shared Admin V3 chrome. Children keep their existing Ledger presentation;
 * no dashboard data or authorization moves into this existing client boundary. */
export function AdminShell({ locale, dict, session, children }: {
  locale: Locale;
  dict: Dictionary;
  session?: AdminSession;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const routeKey = `${pathname}:${session?.currentTenantId ?? "mock"}`;
  const [drawerRoute, setDrawerRoute] = useState<string | null>(null);
  const open = drawerRoute === routeKey;
  const rootRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const returnFocusRef = useRef<HTMLButtonElement | null>(null);
  const currentRouteRef = useRef(routeKey);
  const dialogId = useId();
  const headingId = useId();

  useEffect(() => { currentRouteRef.current = routeKey; }, [routeKey]);

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    const root = rootRef.current;
    if (!dialog || !root) return;
    const body = document.body;
    const page = document.documentElement;
    const { scrollX, scrollY } = window;
    const styles = [
      { element: body, properties: ["position", "inset-block-start", "inset-inline-start", "inline-size", "overflow"] },
      { element: page, properties: ["overflow", "scrollbar-gutter"] },
    ].flatMap(({ element, properties }) => properties.map((property) => ({
      element, property, value: element.style.getPropertyValue(property),
      priority: element.style.getPropertyPriority(property),
    })));

    // Fixed-body locking also prevents background touch scrolling in WebKit.
    page.style.scrollbarGutter = "stable";
    page.style.overflow = "hidden";
    body.style.position = "fixed";
    body.style.insetBlockStart = `${-scrollY}px`;
    body.style.insetInlineStart = `${dirFor(locale) === "rtl" ? scrollX : -scrollX}px`;
    body.style.inlineSize = "100%";
    body.style.overflow = "hidden";
    dialog.showModal();
    dialog.querySelector<HTMLButtonElement>("[data-admin-drawer-close]")?.focus({ preventScroll: true });

    const desktop = window.matchMedia(DESKTOP_QUERY);
    function layoutChange(event: MediaQueryListEvent) {
      if (event.matches) setDrawerRoute(null);
    }
    desktop.addEventListener("change", layoutChange);

    return () => {
      desktop.removeEventListener("change", layoutChange);
      if (dialog.open) dialog.close();
      for (const { element, property, value, priority } of styles) {
        if (value) element.style.setProperty(property, value, priority);
        else element.style.removeProperty(property);
      }
      queueMicrotask(() => {
        // Let route effects settle: navigation owns destination scroll AND focus.
        if (!root.isConnected || currentRouteRef.current !== routeKey) return;
        const previousScroll = page.style.getPropertyValue("scroll-behavior");
        const previousPriority = page.style.getPropertyPriority("scroll-behavior");
        page.style.setProperty("scroll-behavior", "auto", "important");
        window.scrollTo(scrollX, scrollY);
        if (previousScroll) page.style.setProperty("scroll-behavior", previousScroll, previousPriority);
        else page.style.removeProperty("scroll-behavior");
        const visible = (element: HTMLElement | null): element is HTMLElement =>
          Boolean(element?.isConnected && element.getClientRects().length);
        const trigger = returnFocusRef.current;
        if (visible(trigger)) trigger.focus({ preventScroll: true });
        else root.querySelector<HTMLElement>(".admin-shell-sidebar a[aria-current='page']")?.focus({ preventScroll: true });
      });
    };
  }, [open, locale, routeKey]);

  const base = `/${locale}/admin`;
  const canManageTeam = session?.role === "owner" || session?.role === "admin";
  const canManageSettings = !session || session.role === "owner" || session.role === "admin";
  const mainNav = [
    { href: base, label: dict.nav.dashboard, icon: LayoutDashboard, exact: true },
    { href: `${base}/products`, label: dict.nav.products, icon: Package },
    { href: `${base}/manufacturers`, label: dict.nav.manufacturers, icon: Factory },
    { href: `${base}/orders`, label: dict.nav.orders, icon: ShoppingBag },
    { href: `${base}/inventory`, label: dict.nav.inventory, icon: Boxes },
    { href: `${base}/customers`, label: dict.nav.customers, icon: Store },
    { href: `${base}/documents`, label: dict.nav.documents, icon: FileText },
    ...(canManageTeam ? [{ href: `${base}/team`, label: dict.nav.team, icon: Users }] : []),
  ];
  const settingsNav = canManageSettings ? [
    { href: `${base}/settings/business`, label: dict.admin.settings.business.navLabel, icon: Building2 },
    { href: `${base}/settings/tax`, label: dict.nav.settings, icon: Receipt },
  ] : [];
  function isActive(item: { href: string; exact?: boolean }) {
    return item.exact ? pathname === item.href : pathname.startsWith(item.href);
  }
  const activeLabel = [...mainNav, ...settingsNav].find(isActive)?.label ?? dict.nav.dashboard;
  const close = () => setDrawerRoute(null);
  function openDrawer(trigger: HTMLButtonElement) {
    if (window.matchMedia(DESKTOP_QUERY).matches) return;
    returnFocusRef.current = trigger;
    setDrawerRoute(routeKey);
  }

  const logoBlock = (
    <Link href={base} onClick={close} className="admin-shell-brand">
      <LogoMark className="admin-shell-logo" />
      <span><strong>{dict.meta.appNameNative}</strong><small>{dict.admin.title}</small></span>
    </Link>
  );
  const identity = session ? (
    <div className="admin-shell-identity">
      <span className="admin-shell-avatar" aria-hidden>{(session.email ?? "?").slice(0, 1).toUpperCase()}</span>
      <div><p className="admin-shell-email" dir="ltr">{session.email}</p><p className="admin-shell-role">{dict.access.session.roles[session.role]}</p></div>
    </div>
  ) : null;
  const tenant = (
    <div className="admin-shell-tenant">
      {session ? session.tenants.length > 1 ? (
        <div className="admin-shell-tenant-switch">
          <TenantSwitcher locale={locale} currentTenantId={session.currentTenantId} currentName={session.tenantName} tenants={session.tenants} label={dict.access.tenant.switch} />
        </div>
      ) : (
        <div className="admin-shell-tenant-name">
          {session.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={session.logoUrl} alt="" />
          ) : <span className="admin-shell-tenant-initial" aria-hidden>{session.tenantName.slice(0, 1)}</span>}
          <span>{session.tenantName}</span>
        </div>
      ) : <span className="admin-shell-demo">{dict.common.demoBadge}</span>}
    </div>
  );
  function navLinks(items: typeof mainNav) {
    return items.map((item) => {
      const Icon = item.icon;
      return <Link key={item.href} href={item.href} onClick={close} aria-current={isActive(item) ? "page" : undefined} className="admin-shell-nav-link">
        <Icon aria-hidden /><span>{item.label}</span>
      </Link>;
    });
  }
  const navList = (
    <nav className="admin-shell-navigation" aria-label={dict.admin.title}>
      <div className="admin-shell-nav-group">{navLinks(mainNav)}</div>
      {settingsNav.length > 0 ? <div className="admin-shell-nav-group admin-shell-settings">{navLinks(settingsNav)}</div> : null}
      <Link href={`/${locale}/catalog`} onClick={close} className="admin-shell-nav-link admin-shell-exit"><X aria-hidden /><span>{dict.nav.exitAdmin}</span></Link>
    </nav>
  );

  return (
    <div ref={rootRef} className="admin-v3">
      <aside className="admin-shell-sidebar">
        <div className="admin-shell-band-top">{logoBlock}{tenant}</div>
        {navList}
      </aside>

      <div className="admin-shell-column">
        <header className="admin-shell-mobile-header">
          <button type="button" onClick={(event) => openDrawer(event.currentTarget)} aria-label={dict.common.menu} aria-haspopup="dialog" aria-expanded={open} aria-controls={dialogId} className="admin-shell-menu-trigger"><Menu aria-hidden /></button>
          {logoBlock}
          <span className="admin-shell-page-context">{activeLabel}</span>
        </header>
        <header className="admin-shell-topbar">
          <div className="admin-shell-context"><p>{session?.tenantName ?? dict.common.demoBadge}</p><strong>{activeLabel}</strong></div>
          <div className="admin-shell-topbar-actions">
            <LocaleSwitcher current={locale} label={dict.common.language} className="admin-shell-locales" />
            {identity}
            {session ? <div className="admin-shell-logout"><LogoutButton locale={locale} label={dict.access.session.logout} /></div> : null}
          </div>
        </header>
        <main className="admin-shell-content">{children}</main>
      </div>

      <nav className="admin-shell-bottom-nav" aria-label={dict.admin.title}>
        {[
          { href: base, label: dict.nav.dashboard, icon: LayoutDashboard, exact: true },
          { href: `${base}/orders`, label: dict.nav.orders, icon: ShoppingBag },
          { href: `${base}/products`, label: dict.nav.products, icon: Package },
          { href: `${base}/customers`, label: dict.nav.customers, icon: Store },
        ].map((item) => {
          const Icon = item.icon;
          return <Link key={item.href} href={item.href} aria-current={isActive(item) ? "page" : undefined} className="admin-shell-tab"><Icon aria-hidden /><span>{item.label}</span></Link>;
        })}
        <button type="button" onClick={(event) => openDrawer(event.currentTarget)} aria-haspopup="dialog" aria-expanded={open} aria-controls={dialogId} className="admin-shell-tab"><Menu aria-hidden /><span>{dict.common.menu}</span></button>
      </nav>

      <dialog ref={dialogRef} id={dialogId} aria-labelledby={headingId} aria-modal="true" dir={dirFor(locale)} tabIndex={-1} className="admin-shell-drawer"
        onCancel={(event) => { event.preventDefault(); close(); }}
        onClose={(event) => { if (!event.currentTarget.open) close(); }}
        onClick={(event) => {
          if (event.target !== event.currentTarget) return;
          const rect = event.currentTarget.getBoundingClientRect();
          if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close();
        }}
        onKeyDown={(event) => {
          if (event.key !== "Tab") return;
          const targets = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, [tabindex]'))
            .filter((element) => element.tabIndex >= 0 && !element.matches(":disabled") && !element.closest('[inert], [aria-hidden="true"]') && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden");
          const first = targets[0];
          const last = targets[targets.length - 1];
          const active = document.activeElement;
          if (!first) { event.preventDefault(); event.currentTarget.focus(); }
          else if (!targets.some((element) => element === active) || (event.shiftKey && active === first) || (!event.shiftKey && active === last)) {
            event.preventDefault(); (event.shiftKey ? last : first).focus();
          }
        }}>
        {open ? <>
          <div className="admin-shell-band-top">
            <div className="admin-shell-drawer-heading"><h2 id={headingId}>{dict.common.menu}</h2><button type="button" data-admin-drawer-close onClick={close} aria-label={dict.common.close}><X aria-hidden /></button></div>
            {logoBlock}{tenant}
          </div>
          {navList}
          <div className="admin-shell-drawer-footer">
            {identity}
            <div className="admin-shell-drawer-actions">
              <LocaleSwitcher current={locale} label={dict.common.language} className="admin-shell-locales" />
              {session ? <div className="admin-shell-logout"><LogoutButton locale={locale} label={dict.access.session.logout} /></div> : null}
            </div>
          </div>
        </> : null}
      </dialog>
    </div>
  );
}
