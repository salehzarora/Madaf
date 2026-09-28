import assert from "node:assert/strict";
import { test, mock, beforeEach } from "node:test";
let claim = true;
let outcomes = ["sent", "invalid", "failed"];
let sendFails = false;
let summaryFails = false;
let summaryMissing = false;
let cleanupFails = false;
const summaryRequests: URL[] = [];
let scheduled: (() => Promise<void>) | undefined;
let schedulingFails = false;
const calls: { name: string; args: Record<string, unknown> }[] = [];
const sent: unknown[] = [];
const { safeOrderPushSummary } = await import("@/lib/push/firebase-sender");
const recipients = ["owner", "admin", "other-admin"].map((name, i) => ({ device_id: name, fcm_token: `synthetic_token_${i}`, locale: "he" }));
mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(String(input));
  if (url.pathname.endsWith("/orders")) {
    summaryRequests.push(url);
    if (summaryFails) return Response.json({ message: "private database details" }, { status: 500 });
    return Response.json(summaryMissing ? [] : [{ customer_name: " Test\nShop ", subtotal: 54 }]);
  }
  const name = String(input).split("/").at(-1)!;
  const args = JSON.parse(String(init?.body));
  calls.push({ name, args });
  if (name === "disable_invalid_push_token" && cleanupFails) throw new Error("private cleanup failure");
  const data = name === "claim_new_order_push" ? (claim ? [{ order_id: "order-from-db", order_number: "MDF-1" }] : [])
    : name === "new_order_push_recipients" ? recipients : null;
  return Response.json(data);
});
mock.module("@/lib/data/mode", { namedExports: { getDataMode: () => "supabase" } });
mock.module("@/lib/push/firebase-sender", { namedExports: {
  firebaseConfigured: () => true,
  safeOrderPushSummary,
  sendNewOrderBatch: async (...args: unknown[]) => { sent.push(args); if (sendFails) throw new Error("private provider details"); return outcomes; },
} });
mock.module("next/server", { namedExports: { after: (fn: () => Promise<void>) => { if (schedulingFails) throw new Error("no request scope"); scheduled = fn; } } });
mock.method(console, "warn", () => {}); mock.method(console, "info", () => {});
const { deliverNewOrderPush } = await import("@/lib/data/push-delivery");
const { scheduleNewOrderPush } = await import("@/lib/push/after-order");
beforeEach(() => { claim = true; sendFails = false; summaryFails = false; summaryMissing = false; cleanupFails = false; summaryRequests.length = 0; schedulingFails = false; scheduled = undefined; outcomes = ["sent", "invalid", "failed"]; calls.length = 0; sent.length = 0;
  process.env.MADAF_NATIVE_PUSH_ENABLED = "true"; process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:58621"; process.env.SUPABASE_SERVICE_ROLE_KEY = "synthetic-test-only"; });
test("sender uses DB recipients and disables only exact permanently invalid token", async () => {
  await deliverNewOrderPush({ orderId: "committed-id" });
  assert.equal(sent.length, 1); assert.deepEqual(sent[0], ["order-from-db", "MDF-1", recipients, { customerName: "Test Shop", subtotal: 54 }]);
  assert.equal(summaryRequests.length, 1);
  assert.equal(summaryRequests[0].searchParams.get("id"), "eq.order-from-db");
  assert.equal(summaryRequests[0].searchParams.get("select"), "subtotal,customer_name:customer_snapshot->>name");
  const cleanup = calls.filter(c => c.name === "disable_invalid_push_token");
  assert.deepEqual(cleanup, [{ name: "disable_invalid_push_token", args: { p_device_id: "admin", p_expected_token: "synthetic_token_1" } }]);
});
test("already claimed order causes no send (including public-ref retry)", async () => {
  claim = false; await deliverNewOrderPush({ publicRef: "MDF-PUBLIC" });
  assert.equal(sent.length, 0); assert.equal(calls.length, 1);
  assert.equal(summaryRequests.length, 0);
});
test("missing summary and failed summary lookup still send the original minimal alert", async () => {
  summaryFails = true;
  await assert.doesNotReject(deliverNewOrderPush({ orderId: "committed-id" }));
  assert.deepEqual(sent[0], ["order-from-db", "MDF-1", recipients, undefined]);
  summaryFails = false; summaryMissing = true;
  await deliverNewOrderPush({ publicRef: "MDF-PUBLIC" });
  assert.deepEqual(sent[1], ["order-from-db", "MDF-1", recipients, undefined]);
});
test("summary and cleanup failures cannot escape post-commit scheduling", async () => {
  for (const failure of ["summary", "cleanup"]) {
    summaryFails = failure === "summary"; cleanupFails = failure === "cleanup";
    assert.doesNotThrow(() => scheduleNewOrderPush({ orderId: "committed-id" }));
    assert.ok(scheduled); await assert.doesNotReject(scheduled!());
  }
  assert.equal(sent.length, 2);
});
test("transient batch error never disables any token", async () => {
  sendFails = true; await assert.rejects(deliverNewOrderPush({ orderId: "committed-id" }));
  assert.equal(calls.some(c => c.name === "disable_invalid_push_token"), false);
});
test("both scheduling and asynchronous Firebase failures preserve successful order result", async () => {
  const createCommittedOrder = () => { scheduleNewOrderPush({ orderId: "committed-id" }); return { ok: true, orderId: "committed-id" }; };
  schedulingFails = true; assert.equal(createCommittedOrder().ok, true);
  schedulingFails = false; sendFails = true;
  assert.equal(createCommittedOrder().ok, true); assert.ok(scheduled);
  await assert.doesNotReject(scheduled!());
});
