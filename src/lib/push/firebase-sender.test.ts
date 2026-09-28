import assert from "node:assert/strict";
import { test } from "node:test";
import { newOrderMessage, safeOrderPushSummary, isPermanentTokenError, firebaseConfigured } from "./firebase-sender";
import { formatCurrency } from "@/lib/format";
const id = "95000000-0000-4000-8000-000000000001";
test("localized new-order data contains only safe relative path and minimal order ref", () => {
  const id = "95000000-0000-4000-8000-000000000001";
  for (const [locale, title] of [["ar", "طلب جديد"], ["he", "הזמנה חדשה"], ["en", "New order"]]) {
    assert.deepEqual(newOrderMessage(id, "MDF-42", locale), { title, body: `${title} · \u2068MDF-42\u2069`, path: `/${locale}/admin/orders/${id}` });
  }
  assert.equal(newOrderMessage(id, "unsafe\ncustomer phone", "xx").body, "הזמנה חדשה");
  assert.throws(() => newOrderMessage("//evil.test", "MDF-42", "he"));
});
test("rich AR/HE/EN messages allow only business name, strict order number and localized ILS subtotal", () => {
  const summary = { customerName: "بقالة الواحة", subtotal: 54.25,
    phone: "0500000000", email: "private@test.local", address: "Secret street", notes: "Do not expose" };
  for (const [locale, title] of [["ar", "طلب جديد"], ["he", "הזמנה חדשה"], ["en", "New order"]] as const) {
    const message = newOrderMessage(id, "MDF-1036", locale, summary);
    assert.deepEqual(message, { title,
      body: `\u2068بقالة الواحة\u2069 · \u2068MDF-1036\u2069 · \u2068${formatCurrency(54.25, locale)}\u2069`,
      path: `/${locale}/admin/orders/${id}` });
    for (const forbidden of [summary.phone, summary.email, summary.address, summary.notes, id]) assert.ok(!message.body.includes(forbidden));
  }
});
test("business name strips controls, newlines, bidi overrides and bounds Unicode length", () => {
  const safe = safeOrderPushSummary("  Shop\u0000\r\n\tA\u202e\u2066\u2028\u2029 B  ", 0)!;
  assert.deepEqual(safe, { customerName: "Shop A B", subtotal: 0 });
  assert.equal(Array.from(safeOrderPushSummary("😀".repeat(100), 1)!.customerName).length, 80);
  assert.ok(newOrderMessage(id, "MDF-2", "en", safe).body.includes(formatCurrency(0, "en")));
});
test("missing/unsafe summaries and invalid order numbers degrade to the existing safe body", () => {
  for (const [customerName, subtotal] of [[null, 54], ["", 54], ["\n\u202e", 54],
    ["Shop", -1], ["Shop", NaN], ["Shop", Infinity], ["Shop", "54"], ["Shop", null]]) {
    assert.equal(safeOrderPushSummary(customerName, subtotal), undefined);
    assert.deepEqual(newOrderMessage(id, "MDF-42", "he", { customerName, subtotal } as never), newOrderMessage(id, "MDF-42", "he"));
  }
  assert.equal(newOrderMessage(id, "MDF-42\nprivate", "en", { customerName: "Shop", subtotal: 54 }).body, "New order");
});
test("currency renderer failure still returns a safe order-number-only message", t => {
  t.mock.method(Intl, "NumberFormat", () => { throw new Error("renderer unavailable"); });
  assert.deepEqual(newOrderMessage(id, "MDF-42", "en", { customerName: "Shop", subtotal: 54 }), newOrderMessage(id, "MDF-42", "en"));
});
test("only definitive token errors revoke registrations", () => {
  for (const code of ["messaging/registration-token-not-registered", "messaging/invalid-registration-token"]) assert.equal(isPermanentTokenError(code), true);
  for (const code of ["messaging/invalid-argument", "messaging/server-unavailable", "messaging/internal-error", "messaging/third-party-auth-error", "messaging/mismatched-credential", "messaging/quota-exceeded", undefined]) assert.equal(isPermanentTokenError(code), false);
});
test("Firebase sender is disabled without explicit server configuration", () => { assert.equal(firebaseConfigured(), false); });
