import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { DashboardWidgets } from "./dashboard-widgets";
import { locales, type Locale } from "@/i18n/config";
import { getDictionary, interpolate } from "@/i18n/dictionaries";
import { formatCurrency, formatNumber } from "@/lib/format";
import { formatTenantDateTime } from "@/lib/time";
import type { DashboardMetrics } from "@/lib/data/dashboard";
import type { OrderListRow } from "@/lib/orders-query";

const names = (name: string) => ({ ar: `${name} عربي`, he: `${name} עברית`, en: `${name} English` });
const metrics: Pick<DashboardMetrics, "lowStock" | "topShops" | "topProducts"> = {
  lowStock: { count: 17, outOfStockCount: 3, items: [
    { productId: "p1", name: names("One"), location: "A-12", stock: 43, threshold: 100 },
    { productId: "p2", name: names("Two"), location: "B-02", stock: 0, threshold: 10 },
    { productId: "p3", name: names("Three"), location: "", stock: 1, threshold: 200 },
    { productId: "p4", name: names("Four"), location: "C-01", stock: 6, threshold: 9 },
  ] },
  topShops: Array.from({ length: 4 }, (_, i) => ({ customerId: `s${i}`, name: `متجر שלום Shop ${i}`, total: 800 - i * 100, count: 9 - i })),
  topProducts: Array.from({ length: 5 }, (_, i) => ({ productId: `p${i}`, name: names(`Product ${i}`), revenue: 100 - i * 25 })),
};
const statuses = ["new", "confirmed", "preparing", "delivered", "cancelled", "new"] as const;
const recent: OrderListRow[] = statuses.map((status, i) => ({
  id: `order-${i}`, number: `MDF-${900 + i}`, publicRef: null, status,
  createdAt: "2026-07-01T22:30:00Z", customerId: i ? "" : "shop",
  customerName: i === 0 ? "Live customer" : i === 3 ? "" : null,
  customerPhone: null, customerSnapshot: i < 2 || i === 3 ? { name: "Guest snapshot", guest: true } : undefined,
  itemCount: i + 1, subtotalAmount: 98765.43 + i,
}));
function render(locale: Locale = "en", values = metrics, orders = recent, zone = "Asia/Jerusalem") {
  return new JSDOM(renderToStaticMarkup(createElement(DashboardWidgets, { metrics: values, recent: orders, locale, dict: getDictionary(locale), timeZone: zone }))).window.document;
}
const text = (el: Element | null) => { assert.ok(el); return el.textContent!; };

for (const locale of locales) {
  test(`${locale}: stock rows preserve sample order, individual thresholds, locations and exact values`, () => {
    const doc = render(locale); const rows = [...doc.querySelectorAll(".dashboard-stock-row")];
    assert.equal(rows.length, 4);
    rows.forEach((row, i) => {
      const item = metrics.lowStock.items[i];
      assert.equal(text(row.querySelector(".dashboard-widget-name")), item.name[locale]);
      assert.equal(text(row.querySelector(".dashboard-stock-count")), `${formatNumber(item.stock, locale)} / ${formatNumber(item.threshold, locale)}`);
      assert.equal(row.querySelector(".dashboard-stock-location")?.textContent ?? "", item.location);
    });
    assert.equal(doc.querySelector('#dashboard-stock-title')?.closest('section')?.querySelector('a')?.getAttribute('href'), `/${locale}/admin/inventory?low=1`);
  });
  test(`${locale}: top shops retain supplied rank, stored names, order counts and exact ILS`, () => {
    const doc = render(locale); const rows = [...doc.querySelectorAll(".dashboard-shop-list > li")];
    assert.equal(rows.length, 4);
    rows.forEach((row, i) => {
      const item = metrics.topShops[i];
      assert.equal(text(row.querySelector(".dashboard-rank")), String(i + 1));
      assert.equal(text(row.querySelector(".dashboard-widget-name")), item.name);
      assert.equal(text(row.querySelector(".dashboard-widget-meta")), interpolate(getDictionary(locale).admin.dashboard.ordersCount, { count: item.count }));
      assert.equal(text(row.querySelector(".dashboard-widget-amount")), formatCurrency(item.total, locale));
      assert.equal(row.querySelector('a'), null);
    });
  });
  test(`${locale}: product ranks, localized names, zero revenue and proportions remain exact`, () => {
    const rows = [...render(locale).querySelectorAll(".dashboard-product-list > li")];
    assert.equal(rows.length, 5);
    rows.forEach((row, i) => {
      assert.equal(text(row.querySelector(".dashboard-rank")), String(i + 1));
      assert.equal(text(row.querySelector(".dashboard-widget-name")), metrics.topProducts[i].name[locale]);
      assert.equal(text(row.querySelector(".dashboard-widget-amount")), formatCurrency(metrics.topProducts[i].revenue, locale));
      assert.equal((row.querySelector('.dashboard-widget-progress > span') as HTMLElement).style.inlineSize, `${100 - i * 25}%`);
    });
  });
  test(`${locale}: six recent links expose every field in one responsive representation`, () => {
    const dict = getDictionary(locale); const rows = [...render(locale).querySelectorAll('.dashboard-recent-row')];
    assert.equal(rows.length, 6);
    rows.forEach((row, i) => {
      const order = recent[i];
      assert.equal(row.getAttribute('href'), `/${locale}/admin/orders/${order.id}`);
      assert.equal(text(row.querySelector('.dashboard-recent-ref')), order.number);
      assert.equal(row.querySelector('.dashboard-recent-ref')?.getAttribute('dir'), 'ltr');
      assert.equal(text(row.querySelector('.dashboard-recent-customer')), i === 0 ? 'Live customer' : i === 1 ? 'Guest snapshot' : i === 3 ? '' : '—');
      assert.equal(row.querySelector('time')?.getAttribute('datetime'), order.createdAt);
      assert.equal(text(row.querySelector('time')), formatTenantDateTime(order.createdAt, locale, 'Asia/Jerusalem').replace(/[\u200e\u200f\u061c]/g, ''));
      assert.ok(text(row.querySelector('.dashboard-recent-meta')).includes(interpolate(dict.admin.orders.detail.itemsCount, { count: order.itemCount })));
      assert.equal(text(row.querySelector('.dashboard-recent-amount')), formatCurrency(order.subtotalAmount, locale));
      assert.equal(text(row.querySelector('.dashboard-recent-status')), dict.status[order.status]);
      assert.equal(row.querySelector('.dashboard-recent-status')?.getAttribute('data-status'), order.status);
      assert.equal(row.querySelectorAll('[hidden]').length, 0);
    });
  });
  test(`${locale}: all four empty states are localized and retain only existing actions`, () => {
    const doc = render(locale, { lowStock: { count: 0, outOfStockCount: 0, items: [] }, topShops: [], topProducts: [] }, []);
    const labels = getDictionary(locale).admin.dashboard.widgets;
    assert.deepEqual([...doc.querySelectorAll('.dashboard-widget-empty')].map(text), [labels.noLowStock, labels.noShops, labels.noProducts, labels.noOrders]);
    assert.equal(doc.querySelectorAll('.dashboard-widgets a').length, 2);
    assert.ok(doc.querySelector(`a[href="/${locale}/admin/orders"]`));
    assert.equal(doc.querySelectorAll('.dashboard-widget-progress').length, 0);
  });
}
test('stock progress has no positive floor and zero stock has explicit warning text', () => {
  const doc = render(); const rows = [...doc.querySelectorAll('.dashboard-stock-row')];
  assert.equal((rows[0].querySelector('.dashboard-widget-progress > span') as HTMLElement).style.inlineSize, '43%');
  assert.equal((rows[1].querySelector('.dashboard-widget-progress > span') as HTMLElement).style.inlineSize, '0%');
  assert.equal((rows[2].querySelector('.dashboard-widget-progress > span') as HTMLElement).style.inlineSize, '0.5%');
  assert.equal(doc.querySelectorAll('.dashboard-stock-row[data-empty]').length, 1);
  assert.equal(text(rows[1].querySelector('.dashboard-stock-warning')), getDictionary('en').availability.outOfStock);
});
test('rendering clamps progress without changing stock numbers and handles zero threshold', () => {
  const fixture = structuredClone(metrics); fixture.lowStock.items[0].stock = 120; fixture.lowStock.items[1].threshold = 0;
  const rows = [...render('en', fixture).querySelectorAll('.dashboard-stock-row')];
  assert.equal((rows[0].querySelector('.dashboard-widget-progress > span') as HTMLElement).style.inlineSize, '100%');
  assert.equal(text(rows[0].querySelector('.dashboard-stock-count')), '120 / 100');
  assert.equal((rows[1].querySelector('.dashboard-widget-progress > span') as HTMLElement).style.inlineSize, '0%');
});
test('large values and long names remain full text without invented thumbnails or actions', () => {
  const fixture = structuredClone(metrics); fixture.topShops[0].name = 'متجر שלום '.repeat(20); fixture.topShops[0].total = 987654321.98;
  const doc = render('en', fixture);
  assert.equal(text(doc.querySelector('.dashboard-shop-list .dashboard-widget-name')), fixture.topShops[0].name);
  assert.equal(text(doc.querySelector('.dashboard-shop-list .dashboard-widget-amount')), formatCurrency(987654321.98, 'en'));
  assert.equal(doc.querySelectorAll('img,button').length, 0);
  assert.equal(doc.querySelectorAll('a').length, 8);
});
test('supplied product ranking is not filtered or sorted by presentation', () => {
  const fixture = structuredClone(metrics); fixture.topProducts.reverse();
  assert.deepEqual([...render('en', fixture).querySelectorAll('.dashboard-product-list .dashboard-widget-name')].map(text), fixture.topProducts.map(p => p.name.en));
});
test('recent timestamps use the explicit tenant zone across calendar-day boundaries', () => {
  const jerusalem = text(render().querySelector('.dashboard-recent-meta time'));
  const losAngeles = text(render('en', metrics, recent, 'America/Los_Angeles').querySelector('.dashboard-recent-meta time'));
  assert.notEqual(jerusalem, losAngeles);
  assert.equal(jerusalem, formatTenantDateTime(recent[0].createdAt, 'en', 'Asia/Jerusalem'));
  assert.equal(losAngeles, formatTenantDateTime(recent[0].createdAt, 'en', 'America/Los_Angeles'));
});
