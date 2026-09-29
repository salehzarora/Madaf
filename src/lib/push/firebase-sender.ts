import "server-only";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";
import { UUID } from "./device-input";
import { getDictionary } from "@/i18n/dictionaries";
import { formatCurrency } from "@/lib/format";
import type { OrderStatus } from "@/lib/types";

export function firebaseConfigured() {
  return process.env.MADAF_NATIVE_PUSH_ENABLED === "true"
    && process.env.FIREBASE_PROJECT_ID === "madafdev-35599"
    && Boolean(process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY);
}
export type Recipient = { device_id: string; fcm_token: string; locale: string };
export type OrderPushSummary = { customerName: string; subtotal: number };
export type PushMessage = { title: string; body: string; path: string };
const pushLocale = (locale: string) => locale === "ar" || locale === "en" ? locale : "he";
export function safePushText(value: unknown): string {
  return typeof value === "string" ? Array.from(value.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, " ")
    .replace(/\s+/gu, " ").trim()).slice(0, 80).join("").trim() : "";
}
export function signupRequestMessage(name: unknown, locale: string): PushMessage {
  const lang = pushLocale(locale), title = getDictionary(lang).push.signupRequest;
  const safe = safePushText(name);
  return { title, body: safe ? `\u2068${safe}\u2069` : title, path: `/${lang}/admin/customers/signup` };
}
export function orderStatusMessage(orderId: string, number: string, status: OrderStatus, locale: string): PushMessage {
  if (!UUID.test(orderId)) throw new Error("invalid_order_id");
  const lang = pushLocale(locale), dict = getDictionary(lang), title = dict.push.orderStatus;
  const valid = ["new", "confirmed", "preparing", "delivered", "cancelled"].includes(status);
  const body = /^MDF-[A-Za-z0-9-]{1,40}$/.test(number) && valid ? `\u2068${number}\u2069 · ${dict.status[status]}` : title;
  return { title, body, path: `/${lang}/admin/orders/${orderId}` };
}
export function lowStockMessage(product: { name_ar: unknown; name_he: unknown; name_en: unknown; quantity: number }, locale: string): PushMessage {
  const lang = pushLocale(locale), t = getDictionary(lang).push;
  const name = safePushText(product[`name_${lang}`]) || safePushText(product.name_he) || t.product;
  const quantity = Number.isSafeInteger(product.quantity) && product.quantity >= 0 ? String(product.quantity) : "";
  return { title: t.lowStock, body: quantity ? `\u2068${name}\u2069 · ${t.remaining} \u2068${quantity}\u2069` : t.lowStock,
    path: `/${lang}/admin/inventory` };
}

export function safeOrderPushSummary(name: unknown, subtotal: unknown): OrderPushSummary | undefined {
  if (typeof name !== "string" || typeof subtotal !== "number" || !Number.isFinite(subtotal) || subtotal < 0) return;
  // Remove control/bidi overrides and line separators; cap by Unicode code point.
  const customerName = Array.from(name.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, " ")
    .replace(/\s+/gu, " ").trim()).slice(0, 80).join("").trim();
  return customerName ? { customerName, subtotal } : undefined;
}

export function newOrderMessage(orderId: string, orderNumber: string, locale: string, summary?: OrderPushSummary) {
  if (!UUID.test(orderId)) throw new Error("invalid_order_id");
  const lang = locale === "ar" || locale === "en" ? locale : "he";
  const title = getDictionary(lang).push.newOrder;
  const safeNumber = /^MDF-[A-Za-z0-9-]{1,40}$/.test(orderNumber) ? orderNumber : "";
  let body = safeNumber ? `${title} · \u2068${safeNumber}\u2069` : title;
  try {
    const safe = safeOrderPushSummary(summary?.customerName, summary?.subtotal);
    if (safe && safeNumber) {
      body = `\u2068${safe.customerName}\u2069 · \u2068${safeNumber}\u2069 · \u2068${formatCurrency(safe.subtotal, lang)}\u2069`;
    }
  } catch { /* Enrichment/rendering is optional; retain the original minimal body. */ }
  // Data-only for Android's validated-path handler. Never include contact details,
  // notes, credentials or additional order/customer fields in the payload.
  return { title, body, path: `/${lang}/admin/orders/${orderId}` };
}
export function isPermanentTokenError(code: unknown) {
  return code === "messaging/registration-token-not-registered"
    || code === "messaging/invalid-registration-token";
}
export async function sendNewOrderBatch(orderId: string, number: string, recipients: Recipient[], summary?: OrderPushSummary) {
  return sendPushBatch(recipients, locale => newOrderMessage(orderId, number, locale, summary));
}
export async function sendPushBatch(recipients: Recipient[], message: (locale: string) => PushMessage) {
  if (!firebaseConfigured()) throw new Error("push_not_configured");
  const app = getApps().find(app => app.name === "madaf-native-push") ?? initializeApp({
    credential: cert({ projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY!.replace(/\\n/g, "\n") }),
    projectId: process.env.FIREBASE_PROJECT_ID,
  }, "madaf-native-push");
  const result = await getMessaging(app).sendEach(recipients.map(device => ({
    token: device.fcm_token,
    data: message(device.locale),
    android: { priority: "high" as const, ttl: 15 * 60 * 1000 },
  })));
  // Reduce SDK responses to safe classifications immediately. Never log raw errors.
  return result.responses.map(response => response.success ? "sent"
    : isPermanentTokenError(response.error?.code) ? "invalid" : "failed");
}
