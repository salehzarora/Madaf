import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { getDictionary } from "@/i18n/dictionaries";
import { DashboardRangeControl } from "./dashboard-range-control";
import { KpiSparkline } from "./kpi-sparkline";
import { DashboardWidgets } from "./dashboard-widgets";
import { TrendChart } from "./trend-chart";
mock.module("server-only", { namedExports: {} });
const { resolveDashboardRange } = await import("@/lib/dashboard-range");
const { PeriodAnalytics } = await import("./period-analytics");
const doc = (element: ReturnType<typeof createElement>) => new JSDOM(renderToStaticMarkup(element)).window.document;
for (const locale of ["ar", "he", "en"] as const) {
  test(`${locale}: six native localized presets and custom date inputs`, () => {
    const labels = getDictionary(locale).admin.dashboard.range;
    const d = doc(createElement(DashboardRangeControl, { action: `/${locale}/admin`, range: "custom", from: "2026-07-01", to: "2026-07-15", today: "2026-07-15", labels, invalid: false }));
    assert.equal(d.querySelector('form')?.method, 'get'); assert.equal(d.querySelector('form')?.getAttribute('action'), `/${locale}/admin`);
    assert.deepEqual([...d.querySelectorAll('option')].map(o => o.textContent), Object.values(labels.presets));
    assert.equal(d.querySelectorAll('input[type=date][required]').length, 2);
    assert.equal(d.querySelector('input[name=from]')?.getAttribute('value'), '2026-07-01');
    assert.ok(d.querySelector('label[for=dashboard-range]')); assert.equal(d.querySelector('button')?.type, 'submit');
  });
}
test("invalid range renders explicit localized fallback feedback", () => {
  const labels = getDictionary('en').admin.dashboard.range;
  const d = doc(createElement(DashboardRangeControl, { action: '/en/admin', range: '30d', from: '2026-06-16', to: '2026-07-15', today: '2026-07-15', labels, invalid: true }));
  assert.equal(d.querySelector('[role=status]')?.textContent, labels.invalid);
});
for (const [values, direction] of [[[1, 3, 5], 'rising'], [[6, 3, 1], 'falling'], [[0, 0, 0], 'flat']] as const) {
  test(`sparkline truthfully renders ${direction}`, () => {
    const d = doc(createElement(KpiSparkline, { values: [...values], labels: getDictionary('en').admin.dashboard.range }));
    assert.equal(d.querySelector('.dashboard-sparkline')?.getAttribute('data-direction'), direction);
    assert.equal(d.querySelector('polyline')?.getAttribute('points')?.split(' ').length, values.length);
    assert.ok(d.querySelector('svg[role=img][aria-label]'));
    if (direction === 'flat') assert.equal(new Set(d.querySelector('polyline')!.getAttribute('points')!.split(' ').map(p => p.split(',')[1])).size, 1);
  });
}
test("real product URLs and branded fallback appear in both bounded widgets", () => {
  const name = { ar: 'P', he: 'P', en: 'P' };
  const d = doc(createElement(DashboardWidgets, { locale: 'en', dict: getDictionary('en'), timeZone: 'UTC', recent: [], thumbnails: { p: { imageUrl: '/product.png' } }, metrics: { topShops: [], topProducts: [{ productId: 'p', name, revenue: 10 }, { productId: 'q', name, revenue: 2 }], lowStock: { count: 2, outOfStockCount: 0, items: ['p', 'q'].map(productId => ({ productId, name, stock: 1, threshold: 2, location: '' })) } } }));
  assert.equal(d.querySelectorAll('.dashboard-product-thumbnail img[src="/product.png"]').length, 2);
  assert.equal(d.querySelectorAll('.dashboard-product-thumbnail .storefront-placeholder-brand').length, 2);
  assert.equal(d.querySelectorAll('.storefront-media-size').length, 0);
});
test("hourly chart exposes full local intervals and exact count/revenue table", () => {
  const range = resolveDashboardRange({ range: '24h' }, 'Asia/Jerusalem', new Date('2026-07-15T12:00:00Z'));
  const buckets = range.boundaries.slice(0, -1).map((start, i) => ({ start, end: range.boundaries[i + 1], new: i, open: i, count: i, revenue: i * 10 }));
  const d = doc(createElement(PeriodAnalytics, { locale: 'en', dict: getDictionary('en'), range, period: { buckets, topProducts: [], topShops: [], count: 1, revenue: 10, totalOrders: 1, statusCounts: { new: 1, confirmed: 0, preparing: 0, delivered: 0, cancelled: 0 } } }));
  assert.equal(d.querySelectorAll('.dashboard-trend-point').length, 24);
  assert.equal(d.querySelectorAll('.dashboard-bucket-details tbody tr').length, 24);
  assert.ok(d.querySelector('.dashboard-trend-date')!.textContent!.includes('15:00'));
});
test("dense overview keeps every interval but labels only one tied peak", () => {
  const days = Array.from({ length: 93 }, (_, i) => ({ day: new Date(Date.UTC(2026, 0, i + 1)).toISOString().slice(0, 10), total: 10 }));
  const d = doc(createElement(TrendChart, { days, locale: 'en', labels: getDictionary('en').admin.dashboard.charts, overview: true }));
  assert.equal(d.querySelectorAll('.dashboard-trend-point').length, 93);
  assert.equal(d.querySelectorAll('.dashboard-trend-value').length, 1);
  assert.equal(d.querySelectorAll('tbody tr').length, 93);
  assert.equal((d.querySelector('.dashboard-trend-plot') as HTMLElement).style.minInlineSize, '0');
});
test("repeated local DST hours remain distinct in the exact interval table", () => {
  const range = resolveDashboardRange({ range: '24h' }, 'America/New_York', new Date('2026-11-01T12:00:00Z'));
  const buckets = range.boundaries.slice(0, -1).map((start, i) => ({ start, end: range.boundaries[i + 1], new: 0, open: 0, count: 0, revenue: 0 }));
  const d = doc(createElement(PeriodAnalytics, { locale: 'en', dict: getDictionary('en'), range, period: { buckets, topProducts: [], topShops: [], count: 0, revenue: 0, totalOrders: 0, statusCounts: { new: 0, confirmed: 0, preparing: 0, delivered: 0, cancelled: 0 } } }));
  const intervals = [...d.querySelectorAll('.dashboard-bucket-details tbody th')].map(n => n.textContent!);
  assert.ok(intervals.some(label => label.includes('01:00 GMT-4') && label.includes('01:00 GMT-5')));
  assert.equal(new Set(intervals).size, 24);
});
