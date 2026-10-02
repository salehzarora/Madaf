import assert from "node:assert/strict";
import { beforeEach, mock, test } from "node:test";

mock.module("server-only", { namedExports: {} });

const tenant = "20000000-0000-4000-8000-000000000001";
const product = "20000000-0000-4000-8000-000000000002";
const customer = "20000000-0000-4000-8000-000000000003";
const key = "20000000-0000-4000-8000-000000000004";
const publicRef = "MDF-SYNTH001";
const token = "synthetic-token-order-unit-fixture";
const items = [{ productId: product, quantity: 2 }];
const quote = { version: 1 as const, digest: "a".repeat(64) };
const calls: { client: "anonymous" | "authenticated"; rpc: string; args: unknown }[] = [];
const pushes: unknown[] = [];
let anonymousFactories = 0;
let cookieFactories = 0;
let reply: { data: { order_number: string } | null; error: { code: string; message: string } | null };

const anonymous = {
  rpc(rpc: string, args: unknown) {
    calls.push({ client: "anonymous", rpc, args });
    return { single: async () => reply };
  },
};
const authenticated = {
  rpc(rpc: string, args: unknown) {
    calls.push({ client: "authenticated", rpc, args });
    return { single: async () => rpc === "create_order_request"
      ? { data: { order_id: "synthetic-order", order_number: "MDF-1" }, error: null }
      : { data: null, error: { code: "22023", message: "Token audit cannot carry an authenticated actor" } } };
  },
  from() {
    const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: { public_ref: publicRef } }) };
    return query;
  },
};
mock.module("@/lib/supabase/server", { namedExports: {
  createSupabaseServerClient: () => { anonymousFactories++; return anonymous; },
  createSupabaseServiceRoleClient: () => { throw new Error("Order submission must not use service role"); },
} });
mock.module("@/lib/supabase/server-auth", { namedExports: {
  createServerAuthClient: async () => { cookieFactories++; return authenticated; },
} });
mock.module("@/lib/auth/session", { namedExports: {
  NO_TENANT: "none",
  getDataContext: async () => ({ client: authenticated, tenantId: tenant }),
  getSessionContext: async () => ({}),
  getTenantTimeZone: async () => "UTC",
} });
mock.module("@/lib/push/after-order", { namedExports: { scheduleNewOrderPush: (value: unknown) => pushes.push(value) } });
mock.module("@/lib/push/after-events", { namedExports: { scheduleEventPush: () => {} } });

const { submitTokenOrder } = await import("./token");
const { submitShowcaseGuestOrder } = await import("./catalog-showcase");
const { sbCreateOrderRequest } = await import("./supabase-writes");
const { PricingError } = await import("../pricing");

beforeEach(() => {
  calls.length = pushes.length = 0;
  anonymousFactories = cookieFactories = 0;
  reply = { data: { order_number: publicRef }, error: null };
});

test("private token write ignores the ambient supplier session and forwards the exact quote/key", async () => {
  assert.equal(await submitTokenOrder(token, items, key, "Synthetic notes", quote), publicRef);
  assert.deepEqual(calls, [{ client: "anonymous", rpc: "create_order_request_from_token", args: {
    p_token: token, p_items: [{ product_id: product, quantity: 2 }], p_submission_key: key,
    p_notes: "Synthetic notes", p_quote: quote,
  } }]);
  assert.equal(cookieFactories, 0);
  assert.equal(anonymousFactories, 1);
  assert.deepEqual(pushes, [{ publicRef }]);
});

test("Showcase guest write ignores the ambient supplier session and preserves guest fields", async () => {
  const store = { name: "Synthetic store", contactName: "Synthetic contact", phone: "0500000001",
    email: "synthetic@example.invalid", cityAr: "اختبار", cityHe: "בדיקה", cityEn: "Test", address: "Synthetic street" };
  assert.equal(await submitShowcaseGuestOrder(token, items, store, key, "Synthetic notes", quote), publicRef);
  assert.deepEqual(calls, [{ client: "anonymous", rpc: "create_order_from_showcase_token", args: {
    p_token: token, p_items: [{ product_id: product, quantity: 2 }], p_submission_key: key,
    p_store_name: store.name, p_contact_name: store.contactName, p_phone: store.phone, p_email: store.email,
    p_city_ar: store.cityAr, p_city_he: store.cityHe, p_city_en: store.cityEn, p_address: store.address,
    p_notes: "Synthetic notes", p_quote: quote,
  } }]);
  assert.equal(cookieFactories, 0);
  assert.equal(anonymousFactories, 1);
  assert.deepEqual(pushes, [{ publicRef }]);
});

for (const channel of ["private", "Showcase"] as const) {
  const submit = (envelope?: typeof quote | { mode: "replay_only" }) => channel === "private"
    ? submitTokenOrder(token, items, key, undefined, envelope)
    : submitShowcaseGuestOrder(token, items, { name: "Synthetic store" }, key, undefined, envelope);

  test(`${channel} keeps replay-only and original submission key without cookies`, async () => {
    assert.equal(await submit({ mode: "replay_only" }), publicRef);
    const args = calls[0].args as Record<string, unknown>;
    assert.deepEqual(args.p_quote, { mode: "replay_only" });
    assert.equal(args.p_submission_key, key);
    assert.equal("p_notes" in args, false);
    assert.equal(cookieFactories, 0);
  });

  test(`${channel} retains disabled-mode quote-less compatibility`, async () => {
    assert.equal(await submit(), publicRef);
    assert.equal("p_quote" in (calls[0].args as object), false);
    assert.equal(cookieFactories, 0);
  });

  test(`${channel} preserves MDF40 conflict and does not schedule push`, async () => {
    reply = { data: null, error: { code: "MDF40", message: "Synthetic conflict" } };
    await assert.rejects(submit(quote), /submission key reused with a different request/);
    assert.deepEqual(pushes, []);
  });

  test(`${channel} preserves pricing errors and does not schedule push`, async () => {
    reply = { data: null, error: { code: "MDF55", message: "Synthetic changed quote" } };
    await assert.rejects(submit(quote), PricingError);
    assert.deepEqual(pushes, []);
  });

  test(`${channel} keeps ordinary denial/missing data as failure without push`, async () => {
    reply = { data: null, error: { code: "22023", message: "Synthetic denial" } };
    assert.equal(await submit(quote), null);
    reply = { data: null, error: null };
    assert.equal(await submit(quote), null);
    assert.deepEqual(pushes, []);
    assert.equal(cookieFactories, 0);
  });
}

test("authenticated supplier creation retains its tenant-bound authenticated client", async () => {
  assert.deepEqual(await sbCreateOrderRequest({ customerId: customer, items, source: "sales_visit", submissionKey: key, quote }),
    { orderId: "synthetic-order", orderNumber: "MDF-1", publicRef });
  assert.deepEqual(calls, [{ client: "authenticated", rpc: "create_order_request", args: {
    p_tenant_id: tenant, p_customer_id: customer, p_items: [{ product_id: product, quantity: 2 }],
    p_source: "sales_visit", p_submission_key: key, p_quote: quote,
  } }]);
  assert.equal(anonymousFactories, 0);
  assert.deepEqual(pushes, [{ orderId: "synthetic-order" }]);
});
