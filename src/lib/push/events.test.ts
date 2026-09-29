import assert from "node:assert/strict";
import { test } from "node:test";
import { signupRequestMessage, orderStatusMessage, lowStockMessage } from "./firebase-sender";
import { defaultPushPreferences, parsePushPreferences } from "./preferences";
import { getDictionary } from "@/i18n/dictionaries";

test("preference payload accepts exact booleans only, rejects spoofed IDs and malformed input", () => {
  assert.deepEqual(parsePushPreferences(defaultPushPreferences), { new_order: true, signup_request: true, low_stock: true, order_status: false });
  for (const input of [null, [], {}, { ...defaultPushPreferences, tenant_id: "other" }, { ...defaultPushPreferences, user_id: "other" },
    { ...defaultPushPreferences, new_order: "false" }, { ...defaultPushPreferences, low_stock: null }]) assert.equal(parsePushPreferences(input), null);
});
for (const locale of ["ar", "he", "en"] as const) {
  test(`${locale}: localized safe event bodies and fixed relative paths`, () => {
    const dict = getDictionary(locale);
    const signup = signupRequestMessage(" Shop\n\u202eName ", locale);
    assert.equal(signup.title, dict.push.signupRequest);
    assert.equal(signup.body, "\u2068Shop Name\u2069");
    assert.equal(signup.path, `/${locale}/admin/customers/signup`);
    const id = "95000000-0000-4000-8000-000000000001";
    const status = orderStatusMessage(id, "MDF-1036", "preparing", locale);
    assert.equal(status.title, dict.push.orderStatus);
    assert.equal(status.body, `\u2068MDF-1036\u2069 · ${dict.status.preparing}`);
    assert.equal(status.path, `/${locale}/admin/orders/${id}`);
    const low = lowStockMessage({ name_ar: "عربي", name_he: "עברית", name_en: "English", quantity: 4 }, locale);
    assert.equal(low.title, dict.push.lowStock);
    assert.ok(low.body.includes({ ar: "عربي", he: "עברית", en: "English" }[locale]));
    assert.ok(low.body.includes(`${dict.push.remaining} \u20684\u2069`));
    assert.equal(low.path, `/${locale}/admin/inventory`);
    for (const message of [signup, status, low]) assert.deepEqual(Object.keys(message).sort(), ["body", "path", "title"]);
  });
}
test("invalid content degrades safely; invalid deep-link IDs rejected; locale cannot inject a path", () => {
  assert.equal(signupRequestMessage(null, "https://evil").path, "/he/admin/customers/signup");
  assert.equal(signupRequestMessage("\u202e\n", "en").body, "New store signup request");
  assert.ok(signupRequestMessage("a".repeat(500), "en").body.length < 85);
  assert.throws(() => orderStatusMessage("../../evil", "MDF-1", "new", "en"));
  assert.equal(orderStatusMessage("95000000-0000-4000-8000-000000000001", "PII\n123", "new", "en").body, "Order status updated");
  assert.equal(lowStockMessage({ name_ar: null, name_he: null, name_en: null, quantity: NaN }, "en").body, "Low stock");
});
