/**
 * PILOT-READINESS-BATCH-C · C2 — source guards proving the Movements order
 * reference no longer depends on a full Orders read, and resolves refs with a
 * SINGLE targeted, chunked lookup (no N+1). The behavioural proof (over live
 * PostgREST) is in src/lib/data/movement-order-refs.live.test.ts.
 *
 * Runner: `npm run test:movement-order-refs`.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const stripComments = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const read = (rel: string): string =>
  stripComments(readFileSync(join(process.cwd(), "src", rel), "utf8"));

test("guard: the movements page no longer reads the full Orders list", () => {
  const page = read("app/[locale]/admin/inventory/movements/page.tsx");
  assert.doesNotMatch(page, /\blistOrders\b/, "must not call listOrders()");
  assert.doesNotMatch(page, /orders=\{/, "must not pass an orders prop to the table");
});

test("guard: MovementsTable takes no orders prop and reads the hydrated ref", () => {
  const table = read("components/admin/movements-table.tsx");
  assert.doesNotMatch(table, /orders:\s*Order\[\]/, "no orders prop in the signature");
  assert.doesNotMatch(table, /orderById/, "no full-Orders map");
  // The table shows the reference carried on the movement itself.
  assert.match(table, /m\.orderNumber/, "renders the hydrated order number");
  assert.match(table, /m\.orderPublicRef/, "…and the hydrated public ref (CSV)");
});

test("guard: sbSearchInventoryMovements hydrates refs with ONE targeted call (no N+1)", () => {
  const reads = read("lib/data/supabase-reads.ts");
  // The reader resolves refs for the whole page's ids in a single helper call,
  // NOT one lookup per movement.
  assert.match(
    reads,
    /sbOrderRefsForIds\(\s*client,\s*tenantId,\s*rows\.map\(\(m\) => m\.orderId\)/,
    "one bounded ref lookup for the whole page's order ids",
  );
  // The helper chunks a bounded id set (never a thousands-long IN list) and only
  // ever reads the orders it was asked for — never the full table.
  assert.match(reads, /MOVEMENT_ORDER_REF_CHUNK = 200/, "a bounded chunk size");
  assert.match(
    reads,
    /for \(let i = 0; i < ids\.length; i \+= MOVEMENT_ORDER_REF_CHUNK\)/,
    "chunked .in() traversal",
  );
});
