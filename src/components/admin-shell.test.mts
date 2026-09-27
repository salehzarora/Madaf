/** Native dialog inertness/layout are verified in Chromium/WebKit. JSDOM only
 * supplies showModal/close, geometry and media events for lifecycle assertions. */
/* eslint-disable react/no-children-prop -- .mts uses createElement with the required, typed ReactNode prop. */
import { dom } from "@/test-support/jsdom-env";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, mock, test } from "node:test";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { getDictionary } from "@/i18n/dictionaries";
import { dirFor, locales, type Locale } from "@/i18n/config";
import type { AdminSession } from "@/components/admin-shell";

let pathname = "/en/admin";
let width = 390;
const calls: unknown[][] = [];
const listeners = new Set<(event: MediaQueryListEvent) => void>();
const cleanups: (() => void)[] = [];
const originalRects = dom.window.HTMLElement.prototype.getClientRects;
const originalMedia = window.matchMedia;
const originalScroll = window.scrollTo;
const proto = dom.window.HTMLDialogElement.prototype;
const showModal = Object.getOwnPropertyDescriptor(proto, "showModal");
const closeDialog = Object.getOwnPropertyDescriptor(proto, "close");
mock.module("next/navigation", { namedExports: {
  usePathname: () => pathname,
  useRouter: () => ({ refresh: () => calls.push(["refresh"]), replace: (url: string) => calls.push(["replace", url]) }),
} });
mock.module("@/lib/actions/tenant", { namedExports: {
  selectTenantAction: async (value: unknown) => { calls.push(["tenant", value]); return { ok: true }; },
} });
mock.module("@/lib/actions/auth", { namedExports: {
  signOutAction: async (locale: string) => { calls.push(["logout", locale]); },
} });
const { AdminShell } = await import("@/components/admin-shell");
const session: AdminSession = {
  email: "operator@example.invalid", role: "owner", tenantName: "Synthetic supplier",
  currentTenantId: "tenant-a", tenants: [{ id: "tenant-a", name: "Synthetic supplier" }],
};

beforeEach(() => {
  pathname = "/en/admin"; width = 390; calls.length = 0; listeners.clear();
  Object.defineProperty(proto, "showModal", { configurable: true, value: function(this: HTMLDialogElement) { this.open = true; } });
  Object.defineProperty(proto, "close", { configurable: true, value: function(this: HTMLDialogElement) { this.open = false; this.dispatchEvent(new dom.window.Event("close")); } });
  dom.window.HTMLElement.prototype.getClientRects = function() {
    if ((this.closest(".admin-shell-sidebar") && width < 1280) || (this.closest(".admin-shell-mobile-header, .admin-shell-bottom-nav") && width >= 1280)) return [] as unknown as DOMRectList;
    return [{ width: 44, height: 44 }] as unknown as DOMRectList;
  };
  window.matchMedia = ((query: string) => {
    assert.equal(query, "(min-width: 1280px)");
    return {
      get matches() { return width >= 1280; },
      addEventListener: (_: string, fn: (event: MediaQueryListEvent) => void) => listeners.add(fn),
      removeEventListener: (_: string, fn: (event: MediaQueryListEvent) => void) => listeners.delete(fn),
    } as unknown as MediaQueryList;
  }) as typeof window.matchMedia;
  window.scrollTo = ((...args: unknown[]) => { calls.push(["scroll", ...args]); }) as typeof window.scrollTo;
});
afterEach(() => {
  cleanups.splice(0).reverse().forEach((fn) => fn());
  window.matchMedia = originalMedia; window.scrollTo = originalScroll;
  dom.window.HTMLElement.prototype.getClientRects = originalRects;
  if (showModal) Object.defineProperty(proto, "showModal", showModal); else Reflect.deleteProperty(proto, "showModal");
  if (closeDialog) Object.defineProperty(proto, "close", closeDialog); else Reflect.deleteProperty(proto, "close");
  document.body.removeAttribute("style"); document.documentElement.removeAttribute("style");
});
function mount(locale: Locale = "en", identity: AdminSession | null = session) {
  const container = document.createElement("div"); container.dir = dirFor(locale); document.body.append(container);
  const root = createRoot(container);
  const dict = getDictionary(locale);
  const render = (nextSession = identity) => act(() => root.render(React.createElement(AdminShell, { locale, dict, session: nextSession ?? undefined, children: React.createElement("section", { "data-legacy-body": true }, "Existing route body") })));
  render();
  let disposed = false;
  const unmount = () => { if (!disposed) { act(() => root.unmount()); container.remove(); disposed = true; } };
  cleanups.push(unmount);
  const find = <T extends Element = HTMLElement>(selector: string): T => { const value = container.querySelector<T>(selector); assert.ok(value, selector); return value; };
  return { container, dict, render, unmount, find };
}
function click(element: Element) { act(() => element.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }))); }
function resize(next: number) { act(() => { width = next; listeners.forEach((fn) => fn({ matches: width >= 1280 } as MediaQueryListEvent)); }); }
async function flush() { await act(async () => { await Promise.resolve(); }); }

test("existing client boundary stays in AdminShell, server gate remains server-side", () => {
  const shell = readFileSync(new URL("./admin-shell.tsx", import.meta.url), "utf8");
  const layout = readFileSync(new URL("../app/[locale]/admin/layout.tsx", import.meta.url), "utf8");
  assert.match(shell, /^"use client"/);
  assert.doesNotMatch(shell, /@\/lib\/(?:data|supabase)|getDashboardMetrics/);
  assert.doesNotMatch(layout, /["']use client["']/);
});
for (const locale of locales) {
  test(`${locale}: all admin routes keep V3 chrome and unchanged children`, () => {
    const view = mount(locale);
    for (const route of ["", "/products", "/orders", "/manufacturers", "/customers", "/inventory", "/documents", "/team", "/settings/business", "/settings/tax"]) {
      pathname = `/${locale}/admin${route}`; view.render();
      assert.ok(view.find(".admin-v3"));
      assert.equal(view.find("main > [data-legacy-body]").textContent, "Existing route body");
      const hrefs = [...view.find(".admin-shell-sidebar").querySelectorAll(".admin-shell-nav-link")].map((a) => a.getAttribute("href"));
      assert.deepEqual(hrefs, ["", "/products", "/manufacturers", "/orders", "/inventory", "/customers", "/documents", "/team", "/settings/business", "/settings/tax"].map((path) => `/${locale}/admin${path}`).concat(`/${locale}/catalog`));
    }
  });
  test(`${locale}: tenant, account, translated locale links and five bottom tabs`, () => {
    pathname = `/${locale}/admin/orders`;
    const view = mount(locale);
    assert.match(view.find(".admin-shell-sidebar").textContent ?? "", /Synthetic supplier/);
    assert.equal(view.find(".admin-shell-topbar .admin-shell-email").getAttribute("dir"), "ltr");
    assert.equal(view.find(".admin-shell-role").textContent, view.dict.access.session.roles.owner);
    assert.deepEqual([...view.find(".admin-shell-topbar .admin-shell-locales").querySelectorAll("a")].map((a) => a.getAttribute("href")), locales.map((l) => `/${l}/admin/orders`));
    assert.equal(view.find(".admin-shell-topbar .admin-shell-locales").getAttribute("aria-label"), view.dict.common.language);
    assert.deepEqual([...view.find(".admin-shell-bottom-nav").children].map((a) => a.textContent), [view.dict.nav.dashboard, view.dict.nav.orders, view.dict.nav.products, view.dict.nav.customers, view.dict.common.menu]);
    assert.equal(view.find(".admin-shell-bottom-nav [aria-current='page']").getAttribute("href"), `/${locale}/admin/orders`);
  });
}
for (const role of ["owner", "admin", "sales_rep"] as const) {
  test(`${role}: navigation visibility preserves role rules`, () => {
    const view = mount("en", { ...session, role });
    const nav = view.find(".admin-shell-sidebar");
    assert.equal(Boolean(nav.querySelector('[href="/en/admin/team"]')), role !== "sales_rep");
    assert.equal(Boolean(nav.querySelector('[href="/en/admin/settings/business"]')), role !== "sales_rep");
    assert.equal(Boolean(nav.querySelector('[href="/en/admin/settings/tax"]')), role !== "sales_rep");
    assert.ok(nav.querySelector('[href="/en/admin/products"]'));
  });
}
test("mock retains settings, hides Team and session controls", () => {
  const { container } = mount("en", null);
  assert.ok(container.querySelector('[href="/en/admin/settings/tax"]'));
  assert.equal(container.querySelector('[href="/en/admin/team"]'), null);
  assert.equal(container.querySelector(".admin-shell-logout"), null);
  assert.ok(container.querySelector(".admin-shell-demo"));
});
test("Dashboard uses exact matching; sections retain prefix matching", () => {
  const view = mount();
  assert.equal(view.find(".admin-shell-sidebar [aria-current='page']").getAttribute("href"), "/en/admin");
  for (const suffix of ["/orders/order-1", "/products/new", "/customers/customer-1/edit"]) {
    pathname = `/en/admin${suffix}`; view.render();
    assert.equal(view.find(".admin-shell-sidebar [aria-current='page']").getAttribute("href"), `/en/admin/${suffix.split("/")[1]}`);
    assert.equal(view.find('.admin-shell-sidebar a[href="/en/admin"]').getAttribute("aria-current"), null);
  }
});
for (const opener of [".admin-shell-menu-trigger", ".admin-shell-bottom-nav button"]) {
  test(`${opener}: dialog naming, initial focus, Escape/cancel, opener restoration`, async () => {
    const view = mount(); const trigger = view.find<HTMLButtonElement>(opener); trigger.focus(); click(trigger);
    const dialog = view.find<HTMLDialogElement>("dialog");
    assert.ok(dialog.open); assert.equal(trigger.getAttribute("aria-expanded"), "true");
    assert.equal(trigger.getAttribute("aria-controls"), dialog.id);
    assert.equal(view.find(`#${CSSescape(dialog.getAttribute("aria-labelledby")!)}`).textContent, view.dict.common.menu);
    assert.equal(document.activeElement, view.find("[data-admin-drawer-close]"));
    assert.equal(document.body.style.position, "fixed");
    act(() => dialog.dispatchEvent(new dom.window.Event("cancel", { cancelable: true })));
    await flush();
    assert.equal(dialog.open, false); assert.equal(trigger.getAttribute("aria-expanded"), "false");
    assert.equal(document.activeElement, trigger); assert.equal(document.body.style.position, "");
    assert.equal(listeners.size, 0);
  });
}
function CSSescape(id: string) { return id.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`); }
test("Tab and Shift+Tab wrap among live drawer controls", () => {
  const view = mount(); click(view.find(".admin-shell-menu-trigger"));
  const first = view.find<HTMLElement>("[data-admin-drawer-close]");
  const last = view.find<HTMLElement>("dialog .admin-shell-logout button");
  first.focus(); act(() => first.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true })));
  assert.equal(document.activeElement, last);
  act(() => last.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })));
  assert.equal(document.activeElement, first);
});
test("close button and backdrop dismiss", () => {
  const view = mount(); click(view.find(".admin-shell-menu-trigger")); click(view.find("[data-admin-drawer-close]"));
  assert.equal(view.find<HTMLDialogElement>("dialog").open, false);
  click(view.find(".admin-shell-menu-trigger"));
  act(() => view.find("dialog").dispatchEvent(new dom.window.MouseEvent("click", { clientX: 900, bubbles: true })));
  assert.equal(view.find<HTMLDialogElement>("dialog").open, false);
});
test("1279 permits drawer; 1280 closes and restores focus to desktop active link", async () => {
  width = 1279; const view = mount(); click(view.find(".admin-shell-menu-trigger"));
  assert.ok(view.find<HTMLDialogElement>("dialog").open);
  resize(1280); await flush();
  assert.equal(view.find<HTMLDialogElement>("dialog").open, false);
  assert.equal(document.body.style.position, "");
  assert.equal(document.activeElement, view.find(".admin-shell-sidebar a[aria-current='page']"));
  click(view.find(".admin-shell-menu-trigger")); assert.equal(view.find<HTMLDialogElement>("dialog").open, false);
  resize(1279); click(view.find(".admin-shell-menu-trigger")); assert.ok(view.find<HTMLDialogElement>("dialog").open);
});
test("pathname/tenant changes close drawer and restore pre-existing scroll styles", async () => {
  document.body.style.setProperty("overflow", "auto", "important");
  document.documentElement.style.setProperty("scrollbar-gutter", "auto");
  const view = mount(); click(view.find(".admin-shell-menu-trigger"));
  pathname = "/en/admin/products"; view.render(); await flush();
  assert.equal(view.find<HTMLDialogElement>("dialog").open, false);
  assert.equal(calls.filter((call) => call[0] === "scroll").length, 0, "route change must not overwrite destination scroll");
  assert.equal(document.body.style.getPropertyValue("overflow"), "auto");
  assert.equal(document.body.style.getPropertyPriority("overflow"), "important");
  assert.equal(document.documentElement.style.scrollbarGutter, "auto");
  pathname = "/en/admin"; view.render(); assert.equal(view.find<HTMLDialogElement>("dialog").open, false);
  click(view.find(".admin-shell-menu-trigger")); view.render({ ...session, currentTenantId: "tenant-b" }); await flush();
  assert.equal(view.find<HTMLDialogElement>("dialog").open, false);
  assert.equal(listeners.size, 0);
});
test("same-route dismissal restores the saved scroll offset", async () => {
  const previous = Object.getOwnPropertyDescriptor(window, "scrollY");
  Object.defineProperty(window, "scrollY", { configurable: true, value: 240 });
  try {
    const view = mount(); click(view.find(".admin-shell-menu-trigger"));
    assert.equal(document.body.style.insetBlockStart, "-240px");
    click(view.find("[data-admin-drawer-close]")); await flush();
    assert.ok(calls.some((call) => call[0] === "scroll" && call[2] === 240));
  } finally {
    if (previous) Object.defineProperty(window, "scrollY", previous);
  }
});
test("unmount releases scroll locking and media listener", () => {
  const view = mount(); click(view.find(".admin-shell-menu-trigger")); view.unmount();
  assert.equal(document.body.style.position, ""); assert.equal(document.documentElement.style.overflow, ""); assert.equal(listeners.size, 0);
});
test("existing tenant and logout actions remain connected", async () => {
  const view = mount("en", { ...session, tenants: [...session.tenants, { id: "tenant-b", name: "Second supplier" }] });
  click(view.find(".admin-shell-menu-trigger"));
  click(view.find("dialog .admin-shell-tenant-switch button"));
  const choices = view.find("dialog").querySelectorAll('[role="option"]');
  await act(async () => click(choices[1]));
  assert.ok(calls.some((call) => call[0] === "tenant" && JSON.stringify(call[1]) === JSON.stringify({ tenantId: "tenant-b", locale: "en" })));
  await act(async () => click(view.find("dialog .admin-shell-logout button")));
  assert.ok(calls.some((call) => call[0] === "logout" && call[1] === "en"));
  assert.ok(calls.some((call) => call[0] === "replace" && call[1] === "/en/login"));
});
