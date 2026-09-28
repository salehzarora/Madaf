import assert from "node:assert/strict";
import { test, mock, beforeEach } from "node:test";
import type { CommittedPushEvent } from "@/lib/data/push-events";
const builders = await import("./firebase-sender");
let claim = true, sendFails = false, scheduleFails = false, preferenceOn = true;
const calls: { name: string; args: Record<string, unknown> }[] = [];
const sent: unknown[] = [];
let scheduled: (() => Promise<void>) | undefined;
const orderId = "95000000-0000-4000-8000-000000000001";
mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
  const name = String(input).split("/").at(-1)!;
  const args = JSON.parse(String(init?.body)); calls.push({ name, args });
  const rows = name === "claim_signup_request_push" ? [{ tenant_id: "db-tenant", store_name: "Shop" }]
    : name === "claim_order_status_push" ? [{ tenant_id: "db-tenant", actor_id: "db-actor", order_number: "MDF-1036", new_status: "preparing" }]
    : name === "claim_low_stock_push" ? [{ generation: 1, quantity: 4, name_ar: "أ", name_he: "א", name_en: "Product" }]
    : name === "push_inventory_products_for_order" ? [{ tenant_id: "db-tenant", product_id: "removed-ledger-product" }]
    : name === "push_event_recipients" ? (preferenceOn ? [{ device_id: "db-device", fcm_token: "synthetic-v12-token", locale: "en" }] : []) : null;
  return Response.json(name.startsWith("claim_") && !claim ? [] : rows);
});
mock.module("@/lib/data/mode", { namedExports: { getDataMode: () => "supabase" } });
mock.module("./firebase-sender", { namedExports: { ...builders, firebaseConfigured: () => true,
  sendPushBatch: async (recipients: { locale: string }[], message: (locale: string) => unknown) => {
    if (sendFails) throw new Error("private provider failure"); sent.push(message(recipients[0].locale)); return ["invalid"];
  },
} });
mock.module("next/server", { namedExports: { after: (fn: () => Promise<void>) => { if (scheduleFails) throw new Error("scope unavailable"); scheduled = fn; } } });
mock.method(console, "warn", () => {}); mock.method(console, "info", () => {});
const { deliverEventPush } = await import("@/lib/data/push-events");
const { scheduleEventPush } = await import("./after-events");
const events: CommittedPushEvent[] = [
  { type: "signup_request", requestId: "committed-request" },
  { type: "order_status", orderId, oldStatus: "confirmed", newStatus: "preparing" },
  { type: "inventory", tenantId: "server-tenant", productId: "product" },
  { type: "order_inventory", orderId },
];
beforeEach(() => {
  claim = true; sendFails = false; scheduleFails = false; preferenceOn = true; calls.length = 0; sent.length = 0; scheduled = undefined;
  process.env.MADAF_NATIVE_PUSH_ENABLED = "true"; process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:58621";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "synthetic-only";
});
for (const event of events) {
  test(`${event.type}: claim before recipients, compare-and-disable exact invalid token`, async () => {
    await deliverEventPush(event);
    assert.equal(sent.length, 1);
    const recipients = calls.find(c => c.name === "push_event_recipients")!;
    assert.equal(recipients.args.p_tenant_id, event.type === "inventory" ? "server-tenant" : "db-tenant");
    if (event.type === "order_status") assert.equal(recipients.args.p_exclude_user_id, "db-actor");
    if (event.type === "order_inventory") assert.equal(calls.find(c => c.name === "claim_low_stock_push")!.args.p_product_id, "removed-ledger-product");
    assert.deepEqual(calls.at(-1), { name: "disable_invalid_push_token", args: { p_device_id: "db-device", p_expected_token: "synthetic-v12-token" } });
  });
  test(`${event.type}: replay has no visible send`, async () => { claim = false; await deliverEventPush(event); assert.equal(sent.length, 0); });
  test(`${event.type}: send-time preference OFF excludes device`, async () => { preferenceOn = false; await deliverEventPush(event); assert.equal(sent.length, 0); });
  test(`${event.type}: schedule and provider failure cannot fail successful business response`, async () => {
    scheduleFails = true; assert.doesNotThrow(() => scheduleEventPush(event));
    scheduleFails = false; sendFails = true; scheduleEventPush(event); assert.ok(scheduled);
    await assert.doesNotReject(scheduled!());
    assert.equal(calls.some(c => c.name === "disable_invalid_push_token"), false);
  });
}
test("disabled feature schedules no work", () => { process.env.MADAF_NATIVE_PUSH_ENABLED = "false"; scheduleEventPush(events[0]); assert.equal(scheduled, undefined); });
