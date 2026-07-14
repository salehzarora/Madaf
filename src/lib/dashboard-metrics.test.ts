/**
 * PILOT-READINESS-BATCH-C · C1 — computeDashboardMetrics (the pure reference).
 *
 * The dashboard's metric DEFINITIONS live in one pure function used directly by
 * mock mode; the get_dashboard_metrics RPC reproduces them in SQL (pgTAP:
 * supabase/tests/dashboard_metrics.test.sql). This suite pins the definitions on
 * the SAME hand-computed dataset as that pgTAP, so the two provably agree:
 * status counts, today/month count + ex-VAT revenue, guest-pending, tenant-local
 * trend (incl. a UTC-date-crossing order), top products (line revenue), top
 * shops (subtotal), active counts and the low-stock summary.
 *
 * Runner: `npm run test:dashboard-metrics`.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { computeDashboardMetrics } from "@/lib/data/dashboard";
import type {
  Customer,
  InventoryItem,
  Order,
  OrderStatus,
  Product,
} from "@/lib/types";

const TZ = "Asia/Jerusalem"; // UTC+3 in July

function product(id: string, name: string, isActive = true): Product {
  return {
    id,
    sku: id,
    translations: {
      ar: { name: `${name}-ar` },
      he: { name: `${name}-he` },
      en: { name },
    },
    categoryId: "c1",
    manufacturerId: "m1",
    packageType: "carton",
    unitsPerPackage: 1,
    baseUnit: "units",
    wholesalePrice: 10,
    availability: "inStock",
    vatRate: 0.18,
    isActive,
  };
}

function customer(id: string, name: string, isActive = true): Customer {
  return { id, name, type: "grocery", city: { ar: "", he: "", en: "" }, isActive } as Customer;
}

function order(
  id: string,
  status: OrderStatus,
  customerId: string,
  createdAt: string,
  items: { productId: string; quantity: number; unitPrice: number }[],
  guest = false,
): Order {
  return {
    id,
    number: `MDF-${id}`,
    status,
    customerId,
    createdAt,
    items: items.map((it, i) => ({
      id: `${id}-${i}`,
      productId: it.productId,
      quantity: it.quantity,
      unitPrice: it.unitPrice,
    })),
    customerSnapshot: guest ? { name: "Guest", guest: true } : undefined,
  } as unknown as Order;
}

function inv(
  productId: string,
  stockPackages: number,
  location: string,
): InventoryItem {
  return { productId, stockPackages, lowStockThreshold: 10, location } as InventoryItem;
}

const products = [
  product("pA", "ProdA"),
  product("pB", "ProdB"),
  product("pC", "ProdC"),
  product("pX", "ProdInactive", false),
];
const customers = [
  customer("cust1", "Shop One"),
  customer("cust2", "Shop Two"),
  customer("cust3", "Shop Three", false),
];
// Order matters: computeDashboardMetrics keeps inventory array order for the
// low-stock widget list (mirrors sbListInventory's warehouse_location order).
const inventory = [
  inv("pA", 5, "A1"),
  inv("pB", 0, "B1"),
  inv("pC", 50, "C1"),
  inv("pX", 0, "D1"),
];
const orders = [
  order("1", "new", "cust1", "2026-07-15T08:00:00Z", [{ productId: "pA", quantity: 1, unitPrice: 100 }]),
  order("2", "confirmed", "cust1", "2026-07-15T09:00:00Z", [{ productId: "pB", quantity: 1, unitPrice: 200 }]),
  order("3", "delivered", "cust2", "2026-07-14T12:00:00Z", [{ productId: "pA", quantity: 1, unitPrice: 50 }]),
  order("4", "cancelled", "cust2", "2026-07-15T07:00:00Z", [{ productId: "pB", quantity: 1, unitPrice: 999 }]),
  order("5", "new", "", "2026-07-15T06:00:00Z", [{ productId: "pA", quantity: 1, unitPrice: 30 }], true),
  order("6", "preparing", "cust1", "2026-07-14T10:00:00Z", [{ productId: "pB", quantity: 1, unitPrice: 75 }]),
  // o7 crosses the UTC date: 21:30Z on 07-14 is 00:30 on 07-15 in Jerusalem.
  order("7", "new", "cust1", "2026-07-14T21:30:00Z", [{ productId: "pA", quantity: 1, unitPrice: 10 }]),
];

const m = computeDashboardMetrics({
  orders,
  customers,
  products,
  inventory,
  timeZone: TZ,
  monthPrefix: "2026-07",
  today: "2026-07-15",
});

test("status counts (all statuses) + total", () => {
  assert.deepEqual(m.statusCounts, {
    new: 3,
    confirmed: 1,
    preparing: 1,
    delivered: 1,
    cancelled: 1,
  });
  assert.equal(m.totalOrders, 7);
});

test("today = tenant-local day incl. the UTC-crossing order; ex-VAT revenue", () => {
  assert.equal(m.today.count, 4, "o1,o2,o5,o7 (o7 is tenant-local 07-15)");
  assert.equal(m.today.revenue, 340, "100+200+30+10");
});

test("month = tenant-local month, non-cancelled; ex-VAT revenue", () => {
  assert.equal(m.month.count, 6);
  assert.equal(m.month.revenue, 465, "100+200+50+30+75+10");
});

test("guest pending = new + no customer + snapshot.guest", () => {
  assert.equal(m.guestPending, 1);
});

test("trend = tenant-local days with non-cancelled orders, ascending", () => {
  assert.deepEqual(m.trend, [
    { day: "2026-07-14", total: 125 },
    { day: "2026-07-15", total: 340 },
  ]);
});

test("top products by line revenue (cancelled excluded)", () => {
  assert.equal(m.topProducts.length, 2);
  assert.equal(m.topProducts[0].productId, "pB");
  assert.equal(m.topProducts[0].revenue, 275, "200+75, not the cancelled 999");
  assert.equal(m.topProducts[0].name.en, "ProdB");
  assert.equal(m.topProducts[1].productId, "pA");
  assert.equal(m.topProducts[1].revenue, 190, "100+50+30+10");
});

test("top shops by subtotal (linked customers only)", () => {
  assert.equal(m.topShops.length, 2);
  assert.deepEqual(
    m.topShops.map((s) => [s.customerId, s.name, s.total, s.count]),
    [
      ["cust1", "Shop One", 385, 4],
      ["cust2", "Shop Two", 50, 1],
    ],
  );
});

test("active product/shop counts exclude inactive rows", () => {
  assert.equal(m.activeProductCount, 3);
  assert.equal(m.activeShopCount, 2);
});

test("low stock: active products below threshold; out-of-stock; ≤4 items", () => {
  assert.equal(m.lowStock.count, 2, "pA(5<10) + pB(0<10); pX inactive excluded");
  assert.equal(m.lowStock.outOfStockCount, 1, "pB at 0");
  assert.equal(m.lowStock.items.length, 2);
  assert.equal(m.lowStock.items[0].productId, "pA");
  assert.equal(m.lowStock.items[0].stock, 5);
  assert.equal(m.lowStock.items[0].location, "A1");
  assert.equal(m.lowStock.items[0].name.en, "ProdA");
  assert.equal(m.lowStock.items[1].productId, "pB");
  assert.equal(m.lowStock.items[1].stock, 0);
});

test("top-N tie-break is deterministic (matches the RPC's product_id/customer_id key)", () => {
  // Two products AND two shops with EXACTLY equal revenue/total → the old stable
  // JS sort left ordering implementation-defined; the fix pins a deterministic
  // secondary key (product_id / customer_id ascending) in both the mock and the
  // RPC, so repeated loads (and the two modes) always agree.
  const tied = computeDashboardMetrics({
    orders: [
      order("1", "new", "cust2", "2026-07-15T08:00:00Z", [{ productId: "pB", quantity: 1, unitPrice: 100 }]),
      order("2", "new", "cust1", "2026-07-15T08:00:00Z", [{ productId: "pA", quantity: 1, unitPrice: 100 }]),
    ],
    customers,
    products,
    inventory: [],
    timeZone: TZ,
    monthPrefix: "2026-07",
    today: "2026-07-15",
  });
  // Equal revenue 100 each → ascending id: pA before pB.
  assert.deepEqual(tied.topProducts.map((p) => p.productId), ["pA", "pB"]);
  // Equal total 100 each → ascending id: cust1 before cust2.
  assert.deepEqual(tied.topShops.map((s) => s.customerId), ["cust1", "cust2"]);
});

test("zero-data: empty inputs yield safe zeros/empties (no crash)", () => {
  const z = computeDashboardMetrics({
    orders: [],
    customers: [],
    products: [],
    inventory: [],
    timeZone: TZ,
    monthPrefix: "2026-07",
    today: "2026-07-15",
  });
  assert.equal(z.totalOrders, 0);
  assert.equal(z.today.revenue, 0);
  assert.deepEqual(z.trend, []);
  assert.deepEqual(z.topProducts, []);
  assert.deepEqual(z.topShops, []);
  assert.equal(z.lowStock.count, 0);
});
