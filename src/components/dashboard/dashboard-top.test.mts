import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { beforeEach, mock, test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { locales } from "@/i18n/config";
import { getDictionary, interpolate } from "@/i18n/dictionaries";
import { formatCurrency, formatNumber } from "@/lib/format";
import { parseOrdersQuery } from "@/lib/orders-query";
import type { OrderListRow } from "@/lib/orders-query";
import type { DashboardMetrics } from "@/lib/data/dashboard";

const sample: DashboardMetrics = {
  statusCounts: { new: 16, confirmed: 3, preparing: 4, delivered: 8, cancelled: 2 },
  totalOrders: 33, today: { count: 7, revenue: 12345.67 }, month: { count: 29, revenue: 987654.32 },
  guestPending: 6, activeProductCount: 51, activeShopCount: 42,
  lowStock: { count: 9, outOfStockCount: 2, items: [] },
  trend: [{ day: "2025-01-02", total: 55 }], topProducts: [], topShops: [],
};
let metrics = structuredClone(sample);
let recentRows: OrderListRow[] = [];
let mode = "supabase";
let role: string | null = "owner";
let signups = 11;
let countError = false;
const reads: string[] = [];
let receivedRange: { key: string; from: string; to: string } | undefined;
let periodNew: number | undefined;
mock.module("server-only", { namedExports: {} });
mock.module("@/lib/data/dashboard-period", { namedExports: { getDashboardPeriodMetrics: async (range: { key: string; from: string; to: string }) => {
  receivedRange = range;
  reads.push("period");
  return { statusCounts: { ...metrics.statusCounts, new: periodNew ?? metrics.statusCounts.new }, totalOrders: metrics.totalOrders, count: metrics.month.count, revenue: metrics.month.revenue, topProducts: metrics.topProducts, topShops: metrics.topShops,
    buckets: [{ start: "2025-01-02T00:00:00Z", end: "2025-01-03T00:00:00Z", new: 1, open: 2, count: 2, revenue: 55 }, { start: "2025-01-03T00:00:00Z", end: "2025-01-04T00:00:00Z", new: 2, open: 3, count: 3, revenue: 65 }] };
} } });
mock.module("@/lib/data/dashboard-thumbnails", { namedExports: { getDashboardThumbnails: async () => { reads.push("thumbnails"); return {}; } } });
mock.module("next/navigation", { namedExports: { notFound: () => { throw new Error("not-found"); } } });
mock.module("@/lib/auth/session", { namedExports: { getSessionContext: async () => { reads.push("session"); return { membership: role ? { role } : null }; } } });
mock.module("@/lib/data", { namedExports: {
  getDataMode: () => mode,
  getDashboardMetrics: async () => { reads.push("metrics"); return metrics; },
  getTenantTimeZone: async () => { reads.push("zone"); return "Asia/Jerusalem"; },
  searchOrders: async (query: unknown) => { assert.deepEqual(query, parseOrdersQuery({ pageSize: "6" })); reads.push("recent"); return { rows: recentRows }; },
} });
mock.module("@/lib/data/customer-signup", { namedExports: { countPendingSignupRequests: async () => {
  reads.push("signups");
  assert.ok(mode === "supabase" && (role === "owner" || role === "admin"), "protected read only after authorization");
  if (countError) throw new Error("protected-count-failed");
  return signups;
} } });
const { default: Page } = await import("@/app/[locale]/admin/page");
beforeEach(() => { metrics = structuredClone(sample); recentRows = []; mode = "supabase"; role = "owner"; signups = 11; countError = false; reads.length = 0; receivedRange = undefined; periodNew = undefined; });
async function render(locale = "en") {
  return new JSDOM(renderToStaticMarkup(await Page({ params: Promise.resolve({ locale }), searchParams: Promise.resolve({}) }))).window.document;
}
const text = (node: Element | null) => { assert.ok(node); return node.textContent; };

for (const locale of locales) {
  test(`${locale}: all primary/secondary values keep the actual aggregate meanings`, async () => {
    const doc = await render(locale);
    const t = getDictionary(locale).admin;
    const primary = [...doc.querySelectorAll(".dashboard-kpi")];
    assert.deepEqual(primary.map(n => text(n.querySelector("h2"))), [t.metrics.newOrders, t.metrics.openOrders, t.dashboard.range.periodRevenue, t.metrics.lowStock]);
    assert.deepEqual(primary.map(n => text(n.querySelector(".dashboard-stat-value bdi"))), [formatNumber(16, locale), formatNumber(23, locale), formatCurrency(987654.32, locale), formatNumber(9, locale)]);
    assert.deepEqual([...doc.querySelectorAll(".dashboard-metric h2")].map(text), [t.metrics.todayOrders, t.metrics.todayValue, t.metrics.activeProducts, t.metrics.activeShops]);
    assert.deepEqual([...doc.querySelectorAll(".dashboard-metric .dashboard-stat-value bdi")].map(text), [formatNumber(7, locale), formatCurrency(12345.67, locale), formatNumber(51, locale), formatNumber(42, locale)]);
    assert.ok(text(primary[2]).includes(interpolate(t.dashboard.ordersCount, { count: formatNumber(29, locale) })));
    assert.equal(text(primary[3].querySelector(".dashboard-out-count bdi")), formatNumber(2, locale));
    assert.ok(text(primary[3]).includes(t.dashboard.range.current));
    assert.ok(primary[2].querySelector("polyline"), "period revenue has a period sparkline");
    assert.deepEqual(reads, ["zone", "metrics", "recent", "period", "thumbnails", "session", "signups"]);
  });
  test(`${locale}: true status shares have text counts and omit delivered/cancelled`, async () => {
    const doc = await render(locale);
    const dict = getDictionary(locale);
    const legend = [...doc.querySelectorAll(".dashboard-status-legend li")];
    assert.deepEqual(legend.map(n => text(n.querySelector("span"))), [dict.status.new, dict.status.confirmed, dict.status.preparing]);
    assert.deepEqual(legend.map(n => text(n.querySelector("bdi"))), [16, 3, 4].map(n => formatNumber(n, locale)));
    const bars = [...doc.querySelectorAll<HTMLElement>(".dashboard-status-bar span")];
    assert.deepEqual(bars.map(n => n.dataset.status), ["new", "confirmed", "preparing"]);
    bars.forEach((bar, i) => assert.ok(Math.abs(parseFloat(bar.style.width) - [16, 3, 4][i] / 23 * 100) < .0001));
    assert.equal(doc.querySelector(".dashboard-status-bar")?.getAttribute("aria-hidden"), "true");
  });
  test(`${locale}: heading actions and all operational destinations remain links`, async () => {
    const doc = await render(locale);
    const t = getDictionary(locale).admin;
    assert.equal(text(doc.querySelector("h1")), t.overviewTitle);
    assert.equal(text(doc.querySelector(".dashboard-intro p")), t.overviewSubtitle);
    assert.deepEqual([...doc.querySelectorAll(".dashboard-actions a")].map(n => [n.getAttribute("href"), n.textContent]), [
      [`/${locale}/admin/products/new`, t.actionNewProduct], [`/${locale}/admin/orders`, t.actionViewOrders], [`/${locale}/catalog`, t.actionOpenCatalog],
    ]);
    assert.deepEqual([...doc.querySelectorAll("a.dashboard-alert")].map(n => n.getAttribute("href")), [
      `/${locale}/admin/orders?status=new`, `/${locale}/admin/orders?status=confirmed,preparing`, `/${locale}/admin/orders?guest=true&status=new`, `/${locale}/admin/customers/signup`, `/${locale}/admin/inventory?low=1`,
    ]);
    assert.deepEqual([...doc.querySelectorAll(".dashboard-alert-count")].map(text), [16, 7, 6, 11, 9].map(n => formatNumber(n, locale)));
    assert.equal(doc.querySelectorAll("#dashboard-range option").length, 6);
    assert.doesNotMatch(text(doc.querySelector(".dashboard-top")), /[+−-]\s*\d+\s*%/);
    assert.equal(doc.querySelector(".dashboard-top .lucide-bell, .dashboard-top .lucide-search, .dashboard-top .lucide-calendar"), null);
  });
  test(`${locale}: full large ILS amounts remain intact and bidi-isolated`, async () => {
    metrics.month.revenue = 987654321.98; metrics.today.revenue = 123456789.12;
    const doc = await render(locale);
    const primary = doc.querySelectorAll(".dashboard-kpi .dashboard-stat-value bdi")[2];
    const secondary = doc.querySelectorAll(".dashboard-metric .dashboard-stat-value bdi")[1];
    assert.equal(text(primary), formatCurrency(987654321.98, locale));
    assert.equal(text(secondary), formatCurrency(123456789.12, locale));
    assert.equal(primary.getAttribute("dir"), "ltr"); assert.equal(secondary.getAttribute("dir"), "ltr");
  });
  test(`${locale}: zero states retain calm explanations without badges or invented segments`, async () => {
    metrics.statusCounts = { new: 0, confirmed: 0, preparing: 0, delivered: 0, cancelled: 0 };
    metrics.totalOrders = 0; metrics.today = { count: 0, revenue: 0 }; metrics.month = { count: 0, revenue: 0 };
    metrics.guestPending = 0; metrics.activeProductCount = 0; metrics.activeShopCount = 0;
    metrics.lowStock = { count: 0, outOfStockCount: 0, items: [] }; metrics.trend = []; signups = 0;
    const doc = await render(locale);
    const a = getDictionary(locale).admin.dashboard.alerts;
    assert.deepEqual([...doc.querySelectorAll(".dashboard-alert-subtitle")].map(text), [a.needsConfirmationNone, a.preparingNone, a.guestOrdersNone, a.signupRequestsNone, a.lowStockNone]);
    assert.equal(doc.querySelectorAll(".dashboard-alert-count, .dashboard-status-bar span").length, 0);
    assert.equal(doc.querySelectorAll(".dashboard-stat-value").length, 8);
    assert.deepEqual([...doc.querySelectorAll(".dashboard-status-legend bdi")].map(text), ["0", "0", "0"]);
    assert.equal(doc.querySelectorAll(".dashboard-alert[data-quiet]").length, 5);
  });
}
for (const scenario of [
  { mode: "supabase", role: "owner", visible: true }, { mode: "supabase", role: "admin", visible: true },
  { mode: "supabase", role: "sales_rep", visible: false }, { mode: "supabase", role: null, visible: false },
  { mode: "mock", role: "owner", visible: false },
]) {
  test(`${scenario.mode}/${scenario.role}: signup visibility and protected read agree`, async () => {
    mode = scenario.mode; role = scenario.role;
    const doc = await render();
    assert.equal(Boolean(doc.querySelector('a[href="/en/admin/customers/signup"]')), scenario.visible);
    assert.equal(reads.includes("signups"), scenario.visible);
    assert.equal(reads.includes("session"), mode === "supabase");
    assert.equal(doc.querySelectorAll(".dashboard-alert-grid > *").length, scenario.visible ? 5 : 4);
    assert.ok(doc.querySelector('.dashboard-actions a[href="/en/admin/products/new"]'), "existing action visibility unchanged");
  });
}
test("protected count errors are not converted into a reassuring zero", async () => {
  countError = true;
  await assert.rejects(render(), /protected-count-failed/);
});
test("invalid locale stops before all reads", async () => {
  await assert.rejects(render("invalid"), /not-found/); assert.deepEqual(reads, []);
});
test("page and presentation retain server compatibility", () => {
  for (const path of ["../../app/[locale]/admin/page.tsx", "./dashboard-top.tsx", "./kpi-card.tsx", "./operational-alert-card.tsx", "../metric-card.tsx"]) {
    assert.doesNotMatch(readFileSync(new URL(path, import.meta.url), "utf8"), /["']use client["']|useEffect|useState|usePathname/);
  }
});

test("real server page binds the existing trend/status aggregates without a month-total chart header", async () => {
  const doc = await render();
  assert.equal(doc.querySelector(".dashboard-trend-point time")?.getAttribute("datetime"), "2025-01-02T00:00:00Z");
  assert.equal(text(doc.querySelector(".dashboard-trend-point .sr-only bdi")), formatCurrency(55, "en"));
  assert.equal(text(doc.querySelector(".dashboard-donut-center bdi")), "33");
  assert.ok(!text(doc.querySelector(".dashboard-analytics")).includes(formatCurrency(metrics.month.revenue, "en")));
  assert.deepEqual(reads, ["zone", "metrics", "recent", "period", "thumbnails", "session", "signups"]);
});

test("real server page passes bounded operational data and all six lean recent rows unchanged", async () => {
  metrics.lowStock.items = [{ productId: "stock", name: { ar: "منتج", he: "מוצר", en: "Stock product" }, location: "A-01", stock: 0, threshold: 7 }];
  metrics.topProducts = [{ productId: "historic", name: { ar: "قديم", he: "היסטורי", en: "Historical product" }, revenue: 123.45 }];
  metrics.topShops = [{ customerId: "shop", name: "Stored shop name", total: 345.67, count: 8 }];
  recentRows = Array.from({ length: 6 }, (_, i) => ({ id: `recent-${i}`, number: `MDF-${i}`, publicRef: null, customerId: "", customerName: null, customerPhone: null, customerSnapshot: { name: `Guest ${i}`, guest: true }, createdAt: "2026-07-01T22:30:00Z", itemCount: 3, subtotalAmount: 555.55 + i, status: "preparing" }));
  const doc = await render();
  assert.equal(text(doc.querySelector('.dashboard-stock-count')), '0 / 7');
  assert.equal(text(doc.querySelector('.dashboard-product-list .dashboard-widget-name')), 'Historical product');
  assert.equal(text(doc.querySelector('.dashboard-shop-list .dashboard-widget-name')), 'Stored shop name');
  const rows = [...doc.querySelectorAll('.dashboard-recent-row')];
  assert.equal(rows.length, 6);
  rows.forEach((row, i) => {
    assert.equal(row.getAttribute('href'), `/en/admin/orders/recent-${i}`);
    assert.equal(text(row.querySelector('.dashboard-recent-customer')), `Guest ${i}`);
    assert.equal(text(row.querySelector('.dashboard-recent-amount')), formatCurrency(555.55 + i, 'en'));
  });
  assert.deepEqual(reads, ["zone", "metrics", "recent", "period", "thumbnails", "session", "signups"]);
});

for (const query of [{ range: "24h" }, { range: "48h" }, { range: "7d" }, { range: "3m" }, { range: "custom", from: "2026-07-01", to: "2026-07-15" }]) {
  test(`server page awaits and applies searchParams: ${query.range}`, async () => {
    periodNew = 2;
    const doc = new JSDOM(renderToStaticMarkup(await Page({ params: Promise.resolve({ locale: "en" }), searchParams: Promise.resolve(query) }))).window.document;
    assert.equal(receivedRange?.key, query.range);
    assert.equal(doc.querySelector("option[selected]")?.getAttribute("value"), query.range);
    assert.equal(doc.querySelector(".dashboard-kpi .dashboard-stat-value bdi")?.textContent, "2");
    assert.equal(doc.querySelector(".dashboard-alert-count")?.textContent, "16", "backlog remains global");
    assert.equal(doc.querySelectorAll(".dashboard-kpi .dashboard-stat-value bdi")[3].textContent, "9", "stock remains current");
    assert.equal(doc.querySelectorAll(".dashboard-sparkline").length, 3);
    if(query.range === "custom") { assert.equal(receivedRange?.from, query.from); assert.equal(receivedRange?.to, query.to); }
  });
}
