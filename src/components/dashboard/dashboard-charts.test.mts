import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { DashboardAnalytics } from "./dashboard-analytics";
import { StatusDonut } from "./status-donut";
import { getDictionary } from "@/i18n/dictionaries";
import { locales, type Locale } from "@/i18n/config";
import { formatCurrency, formatNumber } from "@/lib/format";
import { formatDateOnly } from "@/lib/time";
import type { DashboardMetrics } from "@/lib/data/dashboard";

const sample: Pick<DashboardMetrics, "trend" | "statusCounts" | "totalOrders"> = {
  trend: [{ day: "2023-01-04", total: 1250 }, { day: "2024-01-04", total: 7000.25 }, { day: "2024-09-19", total: 0 }],
  statusCounts: { new: 16, confirmed: 3, preparing: 4, delivered: 8, cancelled: 2 }, totalOrders: 33,
};
function render(locale: Locale, metrics = sample) {
  return new JSDOM(renderToStaticMarkup(createElement(DashboardAnalytics, { locale, metrics, dict: getDictionary(locale) }))).window.document;
}
const text = (node: Element | null) => { assert.ok(node); return node.textContent; };

for (const locale of locales) {
  test(`${locale}: sparse old dates preserve chronology, full values and recorded-date context`, () => {
    const doc = render(locale);
    const d = getDictionary(locale).admin.dashboard;
    const points = [...doc.querySelectorAll(".dashboard-trend-point")];
    assert.equal(points.length, 3, "missing days are not invented");
    points.forEach((point, i) => {
      const data = sample.trend[i];
      assert.equal(point.querySelector("time")?.getAttribute("datetime"), data.day);
      const dateLabel = formatDateOnly(data.day, locale).replace(/[\u200e\u200f\u061c]/g, "");
      assert.equal(text(point.querySelector(".sr-only time")), dateLabel);
      assert.equal(text(point.querySelector(".sr-only bdi")), formatCurrency(data.total, locale));
      assert.equal(text(point.querySelector(".dashboard-trend-date")), dateLabel);
      assert.doesNotMatch(dateLabel, /[\u200e\u200f\u061c]/, "numeric LTR date labels must not carry conflicting direction marks");
    });
    assert.equal(text(doc.querySelector(".dashboard-trend-value")), `${formatNumber(1.3, locale)}K`);
    assert.equal(text(doc.querySelector(".dashboard-chart-latest span")), d.charts.latestRecorded);
    assert.equal(doc.querySelector(".dashboard-chart-latest time")?.getAttribute("datetime"), "2024-09-19");
    assert.equal(text(doc.querySelector(".dashboard-analytics-header p")), d.trendSub);
    assert.ok(!text(doc.body).includes(d.today), "old sample must never be called today");
    assert.equal(doc.querySelectorAll("[data-peak]").length, 1);
    assert.ok(points[1].querySelector("[data-peak]"), "highest value gets the emphasis, not automatically latest");
  });
  test(`${locale}: 14 populated dates have complete compact and exact representations`, () => {
    const data = structuredClone(sample);
    data.trend = Array.from({ length: 14 }, (_, i) => ({ day: `2024-${String(i % 7 + 1).padStart(2, "0")}-${i < 7 ? "01" : "20"}`, total: (i + 1) * 1000 })).sort((a,b) => a.day.localeCompare(b.day));
    const doc = render(locale, data);
    const dates = [...doc.querySelectorAll(".dashboard-trend-point .sr-only time")].map(n => n.getAttribute("datetime"));
    assert.deepEqual(dates, data.trend.map(p => p.day));
    assert.equal(doc.querySelectorAll(".dashboard-trend-value").length, 14);
    assert.ok(parseFloat((doc.querySelector(".dashboard-trend-plot") as HTMLElement).style.minInlineSize) >= 14 * 86);
    const rows = [...doc.querySelectorAll(".dashboard-chart-details tbody tr")];
    assert.equal(rows.length, 14);
    rows.forEach((row, i) => assert.equal(text(row.querySelector("td bdi")), formatCurrency(data.trend[i].total, locale)));
  });
  test(`${locale}: named keyboard scroller and exact-value disclosure have native semantics`, () => {
    const doc = render(locale);
    const labels = getDictionary(locale).admin.dashboard.charts;
    const region = doc.querySelector(".dashboard-trend-scroll");
    assert.equal(region?.getAttribute("role"), "region");
    assert.equal(region?.getAttribute("tabindex"), "0");
    assert.equal(region?.getAttribute("aria-label"), labels.scrollLabel);
    assert.equal(text(doc.querySelector("details summary")), labels.exactValues);
    assert.deepEqual([...doc.querySelectorAll("thead th")].map(text), [labels.date, labels.value]);
    assert.equal(doc.querySelector("[role='img']"), null, "chart semantics are not flattened into an image");
    assert.equal(doc.querySelectorAll(".dashboard-trend-point [title]").length, 0, "full values do not depend on tooltips");
  });
  test(`${locale}: one date, zero values and empty series stay distinct`, () => {
    const one = structuredClone(sample); one.trend = [{ day: "2022-12-31", total: 0 }];
    const doc = render(locale, one);
    assert.equal(doc.querySelectorAll(".dashboard-trend-point").length, 1);
    assert.equal(text(doc.querySelector(".dashboard-trend-value")), "0");
    assert.equal((doc.querySelector(".dashboard-trend-bar") as HTMLElement).style.blockSize, "0%");
    assert.equal(doc.querySelector("[data-peak]"), null);
    assert.equal(text(doc.querySelector(".sr-only bdi")), formatCurrency(0, locale));
    one.trend = [];
    const empty = render(locale, one);
    assert.equal(text(empty.querySelector(".dashboard-chart-empty")), getDictionary(locale).admin.dashboard.charts.trendEmpty);
    assert.equal(empty.querySelector(".dashboard-trend-scroll, .dashboard-chart-latest, details"), null);
  });
  test(`${locale}: large currency is complete in accessible text and exact table`, () => {
    const data = structuredClone(sample); data.trend = [{ day: "2024-01-01", total: 987654321.98 }];
    const doc = render(locale, data);
    const amount = formatCurrency(data.trend[0].total, locale);
    assert.equal(text(doc.querySelector(".sr-only bdi")), amount);
    assert.equal(text(doc.querySelector("td bdi")), amount);
    assert.equal(doc.querySelector("td bdi")?.getAttribute("dir"), "ltr");
    assert.doesNotMatch(doc.body.innerHTML, /NaN|Infinity/);
  });
  test(`${locale}: all five categories keep exact counts and center total`, () => {
    const doc = render(locale);
    const dict = getDictionary(locale);
    const statuses = ["new", "confirmed", "preparing", "delivered", "cancelled"] as const;
    const rows = [...doc.querySelectorAll(".dashboard-donut-legend li")];
    assert.deepEqual(rows.map(n => n.getAttribute("data-status")), statuses);
    assert.deepEqual(rows.map(n => text(n.querySelector(".dashboard-donut-label"))), statuses.map(s => dict.status[s]));
    assert.deepEqual(rows.map(n => text(n.querySelector("bdi"))), statuses.map(s => formatNumber(sample.statusCounts[s], locale)));
    assert.equal(text(doc.querySelector(".dashboard-donut-center bdi")), formatNumber(33, locale));
    assert.equal(text(doc.querySelector(".dashboard-donut-center span")), dict.admin.dashboard.charts.totalOrders);
    assert.equal(doc.querySelector(".dashboard-donut svg")?.getAttribute("aria-hidden"), "true");
  });
  test(`${locale}: zero total keeps a neutral ring, all zero legend rows and calm explanation`, () => {
    const data = structuredClone(sample);
    data.statusCounts = { new: 0, confirmed: 0, preparing: 0, delivered: 0, cancelled: 0 }; data.totalOrders = 0;
    const doc = render(locale, data);
    assert.equal(doc.querySelectorAll(".dashboard-donut-track").length, 1);
    assert.equal(doc.querySelectorAll(".dashboard-donut-segment").length, 0);
    assert.equal(text(doc.querySelector(".dashboard-donut-center bdi")), "0");
    assert.deepEqual([...doc.querySelectorAll(".dashboard-donut-legend bdi")].map(text), ["0", "0", "0", "0", "0"]);
    assert.equal(text(doc.querySelector(".dashboard-donut-empty")), getDictionary(locale).admin.dashboard.charts.statusEmpty);
    assert.doesNotMatch(doc.body.innerHTML, /NaN|Infinity/);
  });
  test(`${locale}: no invented chart controls or growth claims`, () => {
    const doc = render(locale);
    assert.equal(doc.querySelector("select,input,button"), null);
    assert.doesNotMatch(text(doc.body), /[+−-]\s*\d+\s*%/);
    assert.ok(!text(doc.body).includes(getDictionary(locale).admin.metrics.monthRevenue));
  });
}
test("tiny positive shares are proportional and zero-count categories stay in the legend", () => {
  const data = structuredClone(sample);
  data.statusCounts = { new: 999, confirmed: 1, preparing: 0, delivered: 0, cancelled: 0 }; data.totalOrders = 1000;
  const doc = render("en", data);
  const arcs = [...doc.querySelectorAll(".dashboard-donut-segment")];
  assert.equal(arcs.length, 2);
  const lengths = arcs.map(n => parseFloat(n.getAttribute("stroke-dasharray")!));
  assert.ok(lengths[1] > 0);
  assert.ok(Math.abs(lengths[0] / lengths[1] - 999) < .000001);
  assert.ok(Math.abs(lengths.reduce((a,b) => a+b,0) - 2 * Math.PI * 62) < .000001);
  assert.equal(doc.querySelectorAll(".dashboard-donut-legend li").length, 5);
  data.statusCounts.new = 1000; data.statusCounts.confirmed = 0;
  const single = render("en", data).querySelector(".dashboard-donut-segment")!;
  assert.ok(Math.abs(parseFloat(single.getAttribute("stroke-dasharray")!) - 2 * Math.PI * 62) < .000001);
});
test("zero-total guard never paints arcs even for an inconsistent supplied count", () => {
  const html = renderToStaticMarkup(createElement(StatusDonut, { segments: [{ status: "new", label: "New", count: 1 }], total: 0, totalLabel: "Orders", emptyLabel: "No orders", locale: "en" }));
  assert.equal(new JSDOM(html).window.document.querySelector(".dashboard-donut-segment"), null);
});
test("analytics remain server-compatible and keep native motion-free presentation", () => {
  for (const name of ["trend-chart", "status-donut", "dashboard-analytics", "analytics-card"]) {
    const source = readFileSync(new URL(`./${name}.tsx`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /["']use client["']|useEffect|useState|isToday|new Date\(/);
  }
});
