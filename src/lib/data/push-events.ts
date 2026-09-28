import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { OrderStatus } from "@/lib/types";
import { getDataMode } from "./mode";
import { firebaseConfigured, sendPushBatch, signupRequestMessage, orderStatusMessage, lowStockMessage,
  type PushMessage } from "@/lib/push/firebase-sender";

export type CommittedPushEvent =
  | { type: "signup_request"; requestId: string }
  | { type: "order_status"; orderId: string; oldStatus: OrderStatus; newStatus: OrderStatus }
  | { type: "inventory"; tenantId: string; productId: string }
  | { type: "order_inventory"; orderId: string };

async function sendEvent(client: SupabaseClient<Database>, tenantId: string,
  event: "signup_request" | "order_status" | "low_stock", message: (locale: string) => PushMessage,
  deadline: number, actorId?: string | null) {
  let afterId: string | undefined;
  do {
    if (Date.now() >= deadline) return;
    const { data: recipients, error } = await client.rpc("push_event_recipients", {
      p_tenant_id: tenantId, p_event: event,
      ...(actorId ? { p_exclude_user_id: actorId } : {}), ...(afterId ? { p_after_id: afterId } : {}),
    });
    if (error) throw new Error("push_recipients_failed");
    if (!recipients?.length) return;
    const outcomes = await sendPushBatch(recipients, message);
    for (let i = 0; i < outcomes.length; i++) {
      if (outcomes[i] === "invalid") {
        const { error } = await client.rpc("disable_invalid_push_token", {
          p_device_id: recipients[i].device_id, p_expected_token: recipients[i].fcm_token,
        });
        if (error) console.warn("[madaf/push] invalid-token cleanup unavailable");
      }
    }
    console.info("[madaf/push] event batch", { event, sent: outcomes.filter(v => v === "sent").length,
      invalid: outcomes.filter(v => v === "invalid").length, failed: outcomes.filter(v => v === "failed").length });
    if (recipients.length < 100) return;
    afterId = recipients.at(-1)!.device_id;
  } while (Date.now() < deadline);
}

export async function deliverEventPush(event: CommittedPushEvent): Promise<void> {
  if (getDataMode() !== "supabase" || !firebaseConfigured()) return;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return;
  const client = createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(8000) }) } });
  const deadline = Date.now() + 25_000;
  if (event.type === "signup_request") {
    const { data, error } = await client.rpc("claim_signup_request_push", { p_request_id: event.requestId }).maybeSingle();
    if (error) throw new Error("push_claim_failed");
    if (data) await sendEvent(client, data.tenant_id, event.type, locale => signupRequestMessage(data.store_name, locale), deadline);
  } else if (event.type === "order_status") {
    const { data, error } = await client.rpc("claim_order_status_push", {
      p_order_id: event.orderId, p_old_status: event.oldStatus, p_new_status: event.newStatus,
    }).maybeSingle();
    if (error) throw new Error("push_claim_failed");
    if (data) await sendEvent(client, data.tenant_id, event.type,
      locale => orderStatusMessage(event.orderId, data.order_number, data.new_status, locale), deadline, data.actor_id);
  } else {
    let products: { tenant_id: string; product_id: string }[];
    if (event.type === "order_inventory") {
      // Actual committed lines + movement history, never caller-supplied line IDs.
      const { data, error } = await client.rpc("push_inventory_products_for_order", { p_order_id: event.orderId });
      if (error) throw new Error("push_inventory_lookup_failed");
      products = data ?? [];
    } else products = [{ tenant_id: event.tenantId, product_id: event.productId }];
    for (const product of products) {
      if (Date.now() >= deadline) break;
      try {
        const { data, error } = await client.rpc("claim_low_stock_push", {
          p_tenant_id: product.tenant_id, p_product_id: product.product_id,
        });
        if (error) throw new Error("push_claim_failed");
        for (const crossing of data ?? []) {
          if (Date.now() >= deadline) break;
          await sendEvent(client, product.tenant_id, "low_stock", locale => lowStockMessage(crossing, locale), deadline);
        }
      } catch { console.warn("[madaf/push] inventory notification unavailable"); }
    }
  }
}
