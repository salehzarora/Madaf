import assert from "node:assert/strict";
import { test } from "node:test";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";
import { formatCurrency } from "@/lib/format";
import { sendNewOrderBatch } from "./firebase-sender";

const batches: { token: string; data: { title: string; body: string; path: string } }[][] = [];
test("next delivery uses each registered device locale for title, subtotal and deep link", async t => {
  // In-memory SDK instance only; the transport is stubbed and credentials cannot resolve.
  const app = initializeApp({ projectId: "madafdev-35599", credential: {
    getAccessToken: async () => { throw new Error("Test must never authenticate"); },
  } }, "madaf-native-push");
  t.mock.method(getMessaging(app), "sendEach", async (messages: (typeof batches)[number]) => {
    batches.push(messages); return { responses: messages.map(() => ({ success: true })) };
  });
  t.after(() => deleteApp(app));
  process.env.MADAF_NATIVE_PUSH_ENABLED = "true";
  process.env.FIREBASE_PROJECT_ID = "madafdev-35599";
  process.env.FIREBASE_CLIENT_EMAIL = "synthetic@test.local";
  process.env.FIREBASE_PRIVATE_KEY = "synthetic-not-a-key";
  const orderId = "95000000-0000-4000-8000-000000000001";
  for (const [locale, title] of [["he", "הזמנה חדשה"], ["ar", "طلب جديد"], ["en", "New order"]] as const) {
    await sendNewOrderBatch(orderId, "MDF-1036", [{ device_id: "same-device", fcm_token: "same-synthetic-token", locale }],
      { customerName: "Shop", subtotal: 54.25 });
    const message = batches.at(-1)![0];
    assert.equal(message.token, "same-synthetic-token");
    assert.equal(message.data.title, title);
    assert.equal(message.data.path, `/${locale}/admin/orders/${orderId}`);
    assert.ok(message.data.body.includes(formatCurrency(54.25, locale)));
    assert.deepEqual(Object.keys(message.data).sort(), ["body", "path", "title"]);
    assert.equal("notification" in message, false);
  }
});
