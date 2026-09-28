import assert from "node:assert/strict";
import { test, mock, beforeEach } from "node:test";
let failed = false, noOp = false, signupValid = true;
const events: unknown[] = [];
const client = { rpc: (name: string) => {
  const data = name === "submit_customer_signup_request_v2" ? (signupValid ? "inserted-request" : null)
    : ["create_product", "update_product"].includes(name) ? "db-product"
    : name === "adjust_inventory_stock" ? 4
    : { order_id: "db-order", old_status: "new", new_status: noOp ? "new" : "confirmed" };
  const result = { data, error: failed ? { message: "failed mutation" } : null };
  return { ...result, single: async () => result };
} };
mock.module("@/lib/auth/session", { namedExports: { getDataContext: async () => ({ client, tenantId: "server-tenant" }), NO_TENANT: "none" } });
mock.module("@/lib/supabase/server-auth", { namedExports: { createServerAuthClient: async () => client } });
mock.module("./after-events", { namedExports: { scheduleEventPush: (event: unknown) => events.push(event) } });
mock.module("@/lib/data/token", { namedExports: { hashToken: () => "synthetic-hash" } });
const writes = await import("@/lib/data/supabase-writes");
const { submitSignupRequest } = await import("@/lib/data/customer-signup");
beforeEach(() => { events.length = 0; failed = false; noOp = false; signupValid = true; });
test("signup success schedules exact inserted identity and visitor only gets boolean", async () => {
  assert.equal(await submitSignupRequest("synthetic", { name: "Shop" }), true);
  assert.deepEqual(events, [{ type: "signup_request", requestId: "inserted-request" }]);
});
test("invalid or failed signup never schedules", async () => {
  signupValid = false; assert.equal(await submitSignupRequest("synthetic", { name: "Shop" }), false);
  failed = true; assert.equal(await submitSignupRequest("synthetic", { name: "Shop" }), false);
  assert.equal(events.length, 0);
});
test("real status transition schedules status + authoritative order inventory lookup", async () => {
  await writes.sbUpdateOrderStatus("caller-order", "confirmed");
  assert.deepEqual(events, [{ type: "order_status", orderId: "db-order", oldStatus: "new", newStatus: "confirmed" }, { type: "order_inventory", orderId: "db-order" }]);
});
test("no-op and failed status (including stock failure) schedule none", async () => {
  noOp = true; await writes.sbUpdateOrderStatus("caller-order", "new");
  failed = true; await assert.rejects(writes.sbUpdateOrderStatus("caller-order", "confirmed")); assert.equal(events.length, 0);
});
test("reserved item edit, stock adjustment, inventory upsert schedule only after success", async () => {
  await writes.sbUpdateOrderItems("caller-order", [{ productId: "untrusted-line", quantity: 1 }]);
  await writes.sbAdjustInventoryStock("product", -1, "correction");
  await writes.sbUpsertInventory("product", { quantityAvailable: 4, lowStockThreshold: 5 });
  assert.deepEqual(events, [{ type: "order_inventory", orderId: "db-order" },
    { type: "inventory", tenantId: "server-tenant", productId: "product" }, { type: "inventory", tenantId: "server-tenant", productId: "product" }]);
  failed = true; events.length = 0;
  await assert.rejects(writes.sbUpdateOrderItems("order", []));
  await assert.rejects(writes.sbAdjustInventoryStock("product", -1, "correction"));
  await assert.rejects(writes.sbUpsertInventory("product", { quantityAvailable: 4, lowStockThreshold: 5 }));
  assert.equal(events.length, 0);
});

test("product create/update with inventory hook exact DB identity; no inventory means no event", async () => {
  const input = { nameAr: "Product", nameHe: "Product", nameEn: "Product", categoryId: "category",
    packageUnit: "carton" as const, packageQuantity: 1, baseUnit: "units" as const, wholesalePrice: 1 };
  await writes.sbCreateProduct(input);
  await writes.sbUpdateProduct("caller-product", input);
  assert.equal(events.length, 0);
  await writes.sbCreateProduct(input, { quantityAvailable: 20 });
  await writes.sbUpdateProduct("caller-product", input, { quantityAvailable: 20 });
  assert.deepEqual(events, [
    { type: "inventory", tenantId: "server-tenant", productId: "db-product" },
    { type: "inventory", tenantId: "server-tenant", productId: "db-product" },
  ]);
  events.length = 0; failed = true;
  await assert.rejects(writes.sbCreateProduct(input, { quantityAvailable: 20 }));
  await assert.rejects(writes.sbUpdateProduct("product", input, { quantityAvailable: 20 }));
  assert.equal(events.length, 0);
});
