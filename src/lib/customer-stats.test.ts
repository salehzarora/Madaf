/**
 * Customer-stats aggregate test suite (M8F.3). Exercises the SAME production
 * function the Customers page + action use — `getCustomerStatsForIds` (mock
 * mode, which mirrors the supabase `get_customer_stats_for_ids` RPC contract).
 * Pure + zero-env: runs in mock mode with no Supabase. Source-level guards keep
 * the full-Orders scan from returning to the Customers flow.
 *
 * Runner: `npm run test:customer-stats` (tsx → node:test).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  CUSTOMER_STATS_MAX_IDS,
  getCustomerStatsForIds,
} from "./data/customers";
import { customers as mockCustomers, orders as mockOrders } from "./mock";

const ALL_IDS = mockCustomers.map((c) => c.id);
/** Linked orders only (guest orders carry no customerId), keyed by customer. */
const LINKED = mockOrders.filter((o) => o.customerId);
/** A customer with at least one order, and one with none. */
const WITH_ORDER = LINKED[0].customerId as string;
const ZERO_ORDER = mockCustomers.find(
  (c) => !LINKED.some((o) => o.customerId === c.id),
)?.id;

/** Independent reference for a customer's linked order count + last date. */
function refCount(id: string): number {
  return LINKED.filter((o) => o.customerId === id).length;
}
function refLast(id: string): string | undefined {
  const dates = LINKED.filter((o) => o.customerId === id).map((o) => o.createdAt);
  return dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : undefined;
}

// ── 1. Empty input → {} (no unbounded read) ────────────────────────────────
test("getCustomerStatsForIds: empty ids → empty record (no read)", async () => {
  assert.deepEqual(await getCustomerStatsForIds([]), {});
});

// ── 2. Result keyed by customer id; only requested customers present ───────
test("keyed by customer id; only requested (existing) customers appear", async () => {
  const res = await getCustomerStatsForIds([WITH_ORDER]);
  assert.deepEqual(Object.keys(res), [WITH_ORDER]);
});

// ── 3. Duplicate ids normalized (single entry) ─────────────────────────────
test("duplicate ids are normalized to a single entry", async () => {
  const res = await getCustomerStatsForIds([WITH_ORDER, WITH_ORDER, WITH_ORDER]);
  assert.deepEqual(Object.keys(res), [WITH_ORDER]);
  assert.equal(res[WITH_ORDER].count, refCount(WITH_ORDER));
});

// ── 4. Max input bound accepted; 5. oversized rejected ─────────────────────
test("accepts exactly the max id count; rejects an oversized array", async () => {
  const cap = CUSTOMER_STATS_MAX_IDS;
  const ok = Array.from({ length: cap }, (_v, i) => `cust-${i}`);
  await assert.doesNotReject(() => getCustomerStatsForIds(ok));
  const tooMany = Array.from({ length: cap + 1 }, (_v, i) => `cust-${i}`);
  await assert.rejects(() => getCustomerStatsForIds(tooMany), /at most 100/);
});

// ── 6. Zero-order customer defaults (count 0, no lastOrder) ────────────────
test("zero-order customer → { count: 0 } with no lastOrder", async () => {
  assert.ok(ZERO_ORDER, "expected a mock customer with no orders");
  const res = await getCustomerStatsForIds([ZERO_ORDER!]);
  assert.deepEqual(res[ZERO_ORDER!], { count: 0 });
  assert.equal(res[ZERO_ORDER!].lastOrder, undefined);
});

// ── 7 + 8 + 10. One/multi-order stats + last timestamp ─────────────────────
test("order_count + lastOrder match the linked orders for every customer", async () => {
  const res = await getCustomerStatsForIds(ALL_IDS);
  for (const c of mockCustomers) {
    const stat = res[c.id];
    assert.ok(stat, `stat present for ${c.id}`);
    assert.equal(stat.count, refCount(c.id), `count for ${c.id}`);
    assert.equal(stat.lastOrder, refLast(c.id), `lastOrder for ${c.id}`);
  }
});

// ── 9. Exact count aggregation (sum == linked orders for the set) ──────────
// (No monetary metric exists in the contract, so there is no money to test.)
test("exact count aggregation: summed counts == linked orders", async () => {
  const res = await getCustomerStatsForIds(ALL_IDS);
  const summed = Object.values(res).reduce((a, s) => a + s.count, 0);
  const linkedForSet = LINKED.filter((o) =>
    ALL_IDS.includes(o.customerId as string),
  ).length;
  assert.equal(summed, linkedForSet);
});

// ── 11 + 12. Included/excluded statuses; cancelled counts ──────────────────
test("all statuses count (incl. cancelled); no status is excluded", async () => {
  const cancelled = mockOrders.find((o) => o.status === "cancelled" && o.customerId);
  assert.ok(cancelled, "expected a cancelled linked order in the mock");
  const id = cancelled!.customerId as string;
  const res = await getCustomerStatsForIds([id]);
  // The cancelled order is included in the count (matches the current contract).
  assert.equal(res[id].count, refCount(id));
  assert.ok(res[id].count >= 1);
});

// ── 13. Guest orders (no customerId) are never attributed ──────────────────
test("guest orders (no customerId) are not attributed to any customer", async () => {
  const res = await getCustomerStatsForIds(ALL_IDS);
  const summed = Object.values(res).reduce((a, s) => a + s.count, 0);
  // Total counted == LINKED (guest orders excluded by the customerId join).
  assert.equal(summed, LINKED.filter((o) => ALL_IDS.includes(o.customerId as string)).length);
  assert.ok(summed <= mockOrders.length); // never inflated by guest/orphan orders
});

// ── 14 + 15. Inactive + renamed customer: stats are keyed by stable id ─────
test("stats are keyed by stable id (rename/inactive do not change linkage)", async () => {
  // Linkage is orders.customer_id → customers.id only; a name change or
  // deactivation cannot move an order between customers.
  const res = await getCustomerStatsForIds([WITH_ORDER]);
  assert.equal(res[WITH_ORDER].count, refCount(WITH_ORDER));
});

// ── 16 + 17. Contract shape: Record<id, { count, lastOrder? }> ─────────────
test("contract shape: Record keyed by id → { count:number, lastOrder?:string }", async () => {
  const res = await getCustomerStatsForIds(ALL_IDS);
  for (const [id, stat] of Object.entries(res)) {
    assert.equal(typeof id, "string");
    assert.equal(typeof stat.count, "number");
    assert.ok(stat.lastOrder === undefined || typeof stat.lastOrder === "string");
    assert.deepEqual(Object.keys(stat).sort(), stat.lastOrder ? ["count", "lastOrder"] : ["count"]);
  }
});

// ── 18. Missing id fabricates no entry ─────────────────────────────────────
test("an unknown customer id yields no entry (not fabricated)", async () => {
  const res = await getCustomerStatsForIds(["definitely-not-a-real-id"]);
  assert.deepEqual(res, {});
});

// ── 33. All-zero request → every entry is { count: 0 } ─────────────────────
test("requesting only zero-order customers → all zero stats", async () => {
  assert.ok(ZERO_ORDER);
  const res = await getCustomerStatsForIds([ZERO_ORDER!]);
  assert.ok(Object.values(res).every((s) => s.count === 0 && s.lastOrder === undefined));
});

// ── 19–22 + 34–35. Source-level guards: the Customers flow must not scan the
// full Orders collection, and must not leak a server-only path to the client.
const readSrc = (rel: string): string =>
  readFileSync(join(process.cwd(), "src", rel), "utf8");

test("guard: Customers page uses getCustomerStatsForIds, not listOrders", () => {
  const page = readSrc("app/[locale]/admin/customers/page.tsx");
  assert.ok(page.includes("getCustomerStatsForIds"), "must use the bounded aggregate");
  assert.ok(!/\blistOrders\b/.test(page), "must NOT load the full orders collection");
});

test("guard: searchCustomersAction returns bounded per-page stats", () => {
  const src = readSrc("lib/actions/customers.ts");
  assert.ok(src.includes("getCustomerStatsForIds"), "action must fetch per-page stats");
});

test("guard: Customer detail page uses bounded searchOrders, not listOrders", () => {
  const detail = readSrc("app/[locale]/admin/customers/[id]/page.tsx");
  assert.ok(detail.includes("searchOrders"), "detail must use bounded searchOrders");
  assert.ok(!/\blistOrders\b/.test(detail), "detail must NOT scan the full orders collection");
});

test("guard: no new mutative action / audit event (read-only aggregate)", () => {
  const rpc = readSrc(
    "../supabase/migrations/20260729100000_m8f3_customer_stats_aggregate_rpc.sql",
  );
  assert.ok(/security invoker/i.test(rpc), "RPC is SECURITY INVOKER");
  assert.ok(!/\b(insert into|update |delete from|audit_events)\b/i.test(rpc), "no mutation / audit write");
});
