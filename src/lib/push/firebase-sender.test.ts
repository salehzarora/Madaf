import assert from "node:assert/strict";
import { test } from "node:test";
import { newOrderMessage, isPermanentTokenError, firebaseConfigured } from "./firebase-sender";
test("localized new-order data contains only safe relative path and minimal order ref", () => {
  const id = "95000000-0000-4000-8000-000000000001";
  for (const [locale, title] of [["ar", "طلب جديد"], ["he", "הזמנה חדשה"], ["en", "New order"]]) {
    assert.deepEqual(newOrderMessage(id, "MDF-42", locale), { title, body: `${title} · \u2068MDF-42\u2069`, path: `/${locale}/admin/orders/${id}` });
  }
  assert.equal(newOrderMessage(id, "unsafe\ncustomer phone", "xx").body, "הזמנה חדשה");
  assert.throws(() => newOrderMessage("//evil.test", "MDF-42", "he"));
});
test("only definitive token errors revoke registrations", () => {
  for (const code of ["messaging/registration-token-not-registered", "messaging/invalid-registration-token"]) assert.equal(isPermanentTokenError(code), true);
  for (const code of ["messaging/invalid-argument", "messaging/server-unavailable", "messaging/internal-error", "messaging/third-party-auth-error", "messaging/mismatched-credential", "messaging/quota-exceeded", undefined]) assert.equal(isPermanentTokenError(code), false);
});
test("Firebase sender is disabled without explicit server configuration", () => { assert.equal(firebaseConfigured(), false); });
