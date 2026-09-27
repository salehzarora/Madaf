import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveDashboardRange } from "./dashboard-range";
import { computeDashboardPeriod } from "./data/dashboard-period";
import { computeDashboardMetrics } from "./data/dashboard";
import { dashboardThumbnailIds } from "./data/dashboard-thumbnails";
import type { Order, Product, Customer } from "./types";

const zone = "Asia/Jerusalem", now = new Date("2026-07-15T10:30:00Z");
test("default is 30 tenant-local calendar days, ending after today", () => {
  const r = resolveDashboardRange({}, zone, now);
  assert.equal(r.key, "30d"); assert.equal(r.start, "2026-06-15T21:00:00Z"); assert.equal(r.end, "2026-07-15T21:00:00Z"); assert.equal(r.boundaries.length, 31);
});
for (const [key, count, bucket] of [["24h", 24, "hour"], ["48h", 48, "hour"], ["7d", 7, "day"], ["30d", 30, "day"], ["3m", 13, "week"]] as const) {
  test(`${key}: bounded contiguous ${bucket} buckets`, () => {
    const r = resolveDashboardRange({ range: key }, zone, now);
    assert.equal(r.bucket, bucket); assert.equal(r.boundaries.length - 1, count);
    assert.equal(r.boundaries[0], r.start); assert.equal(r.boundaries.at(-1), r.end);
    assert.ok(r.boundaries.every((b, i, a) => !i || Date.parse(b) > Date.parse(a[i - 1])));
    if (bucket === "hour") assert.equal(Date.parse(r.end) - Date.parse(r.start), count * 3600000);
  });
}
test("valid custom includes final tenant date; long span uses bounded weekly buckets", () => {
  const r = resolveDashboardRange({ range: "custom", from: "2026-01-01", to: "2026-07-15" }, zone, now);
  assert.equal(r.key, "custom"); assert.equal(r.bucket, "week"); assert.ok(r.boundaries.length < 54);
  assert.equal(r.start, "2025-12-31T22:00:00Z"); assert.equal(r.end, "2026-07-15T21:00:00Z");
});
for (const params of [{ range: "nope" }, { range: ["7d", "30d"] }, { range: "custom", from: "2026-02-30", to: "2026-03-02" }, { range: "custom", from: "2026-07-16", to: "2026-07-15" }, { range: "custom", from: "2024-01-01", to: "2026-07-15" }, { range: "custom", from: ["2026-07-01"], to: "2026-07-15" }, { range: "custom", from: "2026-07-01", to: "2027-01-01" }]) {
  test(`invalid range fails closed: ${JSON.stringify(params)}`, () => { const r = resolveDashboardRange(params, zone, now); assert.equal(r.key, "30d"); assert.equal(r.invalid, true); assert.equal(r.boundaries.length, 31); });
}
test("DST calendar days use real start/end; repeated hours stay distinct", () => {
  const spring = resolveDashboardRange({ range: "custom", from: "2026-03-27", to: "2026-03-27" }, zone, now);
  assert.equal(Date.parse(spring.end) - Date.parse(spring.start), 23 * 3600000);
  const fall = resolveDashboardRange({ range: "24h" }, "America/New_York", new Date("2026-11-01T12:00:00Z"));
  assert.equal(new Set(fall.boundaries).size, 25);
  const gap = resolveDashboardRange({ range: "custom", from: "2026-09-06", to: "2026-09-06" }, "America/Santiago", new Date("2026-09-10T12:00:00Z"));
  assert.equal(Date.parse(gap.end) - Date.parse(gap.start), 23 * 3600000);
});
test("a skipped whole calendar date falls back instead of sending an empty interval", () => {
  const r = resolveDashboardRange({ range: "custom", from: "2011-12-30", to: "2011-12-30" }, "Pacific/Apia", now);
  assert.equal(r.key, "30d"); assert.equal(r.invalid, true); assert.equal(r.boundaries.length, 31);
});
const input = {
  orders: [
    { id: "before", createdAt: "2026-07-13T20:59:59Z", status: "new", customerId: "c", items: [] },
    { id: "start", createdAt: "2026-07-13T21:00:00Z", status: "new", customerId: "c", items: [{ productId: "p", quantity: 2, unitPrice: 10 }] },
    { id: "cancel", createdAt: "2026-07-14T09:00:00Z", status: "cancelled", customerId: "c", items: [{ productId: "p", quantity: 9, unitPrice: 100 }] },
    { id: "end", createdAt: "2026-07-14T21:00:00Z", status: "delivered", customerId: "c", items: [{ productId: "p", quantity: 1, unitPrice: 50 }] },
  ] as Order[], products: [{ id: "p", translations: { ar: { name: "P" }, he: { name: "P" }, en: { name: "P" } } }] as Product[], customers: [{ id: "c", name: "Shop" }] as Customer[], inventory: [], timeZone: zone, today: "2026-07-15", monthPrefix: "2026-07",
};
test("period sums respect half-open bounds, cancellation, rank and zero buckets", () => {
  const r = resolveDashboardRange({ range: "custom", from: "2026-07-14", to: "2026-07-14" }, zone, now);
  const p = computeDashboardPeriod(input, r);
  assert.equal(p.totalOrders, 2); assert.equal(p.count, 1); assert.equal(p.revenue, 20);
  assert.equal(p.statusCounts.cancelled, 1); assert.equal(p.buckets[0].open, 1); assert.equal(p.buckets[0].new, 1);
  assert.equal(p.topProducts[0].revenue, 20); assert.equal(p.topShops[0].total, 20);
  const empty = computeDashboardPeriod(input, resolveDashboardRange({ range: "24h" }, zone, new Date("2026-07-20T00:00:00Z")));
  assert.equal(empty.buckets.length, 24); assert.ok(empty.buckets.every(b => b.count === 0 && b.revenue === 0));
  assert.equal(computeDashboardMetrics(input).totalOrders, 4, "current-state source remains global");
});
test("more than 1000 orders are fully aggregated without growing the DTO", () => {
  const p = computeDashboardPeriod({ ...input, orders: Array.from({ length: 1001 }, () => input.orders[1]) }, resolveDashboardRange({ range: "7d" }, zone, now));
  assert.equal(p.count, 1001); assert.equal(p.revenue, 20020); assert.equal(p.buckets.length, 7); assert.equal(p.topProducts.length, 1);
});
test("thumbnail IDs are deduplicated and capped to the visible 5+4 rows", () => {
  const m = computeDashboardMetrics(input);
  m.topProducts = Array.from({ length: 100 }, (_, i) => ({ productId: `p${i}`, name: { ar: "", he: "", en: "" }, revenue: 1 }));
  m.lowStock.items = Array.from({ length: 100 }, (_, i) => ({ productId: `p${i + 3}`, name: { ar: "", he: "", en: "" }, stock: 1, threshold: 2, location: "" }));
  assert.deepEqual(dashboardThumbnailIds(m), ["p0", "p1", "p2", "p3", "p4", "p5", "p6"]);
});
