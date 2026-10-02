import assert from "node:assert/strict";
import { test, mock, beforeEach } from "node:test";
let failed = false;
const calls: string[] = [];
const scheduled: unknown[] = [];
const client = {
  rpc(name: string) { calls.push(name); return { single: async () => {
    calls.push("commit-result"); return { data: failed ? null : { order_id: "committed-id", order_number: "MDF-PUBLIC" },
      error: failed ? { message: "rejected" } : null };
  } }; },
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { public_ref: "MDF-PUBLIC" } }) }) }) }),
};
mock.module("@/lib/auth/session", { namedExports: { NO_TENANT: "none", getDataContext: async () => ({ client, tenantId: "verified-tenant" }) } });
mock.module("@/lib/supabase/server-auth", { namedExports: { createServerAuthClient: async () => client } });
mock.module("@/lib/supabase/server", { namedExports: { createSupabaseServerClient: () => client } });
mock.module("@/lib/push/after-order", { namedExports: { scheduleNewOrderPush: (order: unknown) => {
  assert.equal(calls.at(-1), "commit-result"); scheduled.push(order);
} } });
const { sbCreateOrderRequest } = await import("@/lib/data/supabase-writes");
const { submitTokenOrder } = await import("@/lib/data/token");
const { submitShowcaseGuestOrder } = await import("@/lib/data/catalog-showcase");
const items = [{ productId: "synthetic-product", quantity: 1 }];
beforeEach(() => { calls.length = 0; scheduled.length = 0; failed = false; });
test("authenticated order schedules only after successful RPC; failure schedules nothing", async () => {
  const input = { customerId: null, items, source: "sales_visit" as const, submissionKey: "synthetic-key" };
  const result = await sbCreateOrderRequest(input); assert.equal(result.publicRef, "MDF-PUBLIC");
  assert.deepEqual(scheduled, [{ orderId: "committed-id" }]);
  failed = true; scheduled.length = 0; await assert.rejects(sbCreateOrderRequest(input)); assert.equal(scheduled.length, 0);
});
test("private shop order schedules by returned public ref only after commit", async () => {
  assert.equal(await submitTokenOrder("synthetic-link", items, "synthetic-key"), "MDF-PUBLIC");
  assert.deepEqual(scheduled, [{ publicRef: "MDF-PUBLIC" }]);
  failed = true; scheduled.length = 0; assert.equal(await submitTokenOrder("synthetic-link", items, "synthetic-key"), null);
  assert.equal(scheduled.length, 0);
});
test("showcase guest order schedules by committed public ref only", async () => {
  const store = { name: "Synthetic", contactName: "Test", phone: "+972500000001" };
  assert.equal(await submitShowcaseGuestOrder("synthetic-link", items, store, "synthetic-key"), "MDF-PUBLIC");
  assert.deepEqual(scheduled, [{ publicRef: "MDF-PUBLIC" }]);
  failed = true; scheduled.length = 0; assert.equal(await submitShowcaseGuestOrder("synthetic-link", items, store, "synthetic-key"), null);
  assert.equal(scheduled.length, 0);
});
