import "server-only";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";
import { UUID } from "./device-input";
import { getDictionary } from "@/i18n/dictionaries";

export function firebaseConfigured() {
  return process.env.MADAF_NATIVE_PUSH_ENABLED === "true"
    && process.env.FIREBASE_PROJECT_ID === "madafdev-35599"
    && Boolean(process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY);
}
export type Recipient = { device_id: string; fcm_token: string; locale: string };
export function newOrderMessage(orderId: string, orderNumber: string, locale: string) {
  if (!UUID.test(orderId)) throw new Error("invalid_order_id");
  const lang = locale === "ar" || locale === "en" ? locale : "he";
  const title = getDictionary(lang).push.newOrder;
  const safeNumber = /^MDF-[A-Za-z0-9-]{1,40}$/.test(orderNumber) ? orderNumber : "";
  // Data-only is required by the existing Android validated-path handler.
  // No customer name/phone, notes, prices, credentials or full URL.
  return { title, body: safeNumber ? `${title} · \u2068${safeNumber}\u2069` : title,
    path: `/${lang}/admin/orders/${orderId}` };
}
export function isPermanentTokenError(code: unknown) {
  return code === "messaging/registration-token-not-registered"
    || code === "messaging/invalid-registration-token";
}
export async function sendNewOrderBatch(orderId: string, number: string, recipients: Recipient[]) {
  if (!firebaseConfigured()) throw new Error("push_not_configured");
  const app = getApps().find(app => app.name === "madaf-native-push") ?? initializeApp({
    credential: cert({ projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY!.replace(/\\n/g, "\n") }),
    projectId: process.env.FIREBASE_PROJECT_ID,
  }, "madaf-native-push");
  const result = await getMessaging(app).sendEach(recipients.map(device => ({
    token: device.fcm_token,
    data: newOrderMessage(orderId, number, device.locale),
    android: { priority: "high" as const, ttl: 15 * 60 * 1000 },
  })));
  // Reduce SDK responses to safe classifications immediately. Never log raw errors.
  return result.responses.map(response => response.success ? "sent"
    : isPermanentTokenError(response.error?.code) ? "invalid" : "failed");
}
