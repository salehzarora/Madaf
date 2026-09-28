import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { getDataMode } from "./mode";
import { firebaseConfigured, safeOrderPushSummary, sendNewOrderBatch, type OrderPushSummary } from "@/lib/push/firebase-sender";

export type CommittedOrder = { orderId: string; publicRef?: never } | { publicRef: string; orderId?: never };
export async function deliverNewOrderPush(order: CommittedOrder): Promise<void> {
  if (getDataMode() !== "supabase" || !firebaseConfigured()) return;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return;
  // Dedicated server-only RPC client. Registration uses the cookie client, never this key.
  const client = createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(8000) }) } });
  const { data: claim, error } = await client.rpc("claim_new_order_push", {
    ...(order.orderId ? { p_order_id: order.orderId } : { p_public_ref: order.publicRef }),
  }).maybeSingle();
  if (error) throw new Error("push_claim_failed");
  if (!claim) return;
  let summary: OrderPushSummary | undefined;
  try {
    // Only the successfully claimed DB order ID is authoritative here. Project
    // the business name from its snapshot, never fetch the full private snapshot.
    // This also covers guest orders without a linked customer row.
    const { data, error } = await client.from("orders")
      .select("subtotal, customer_name:customer_snapshot->>name")
      .eq("id", claim.order_id).maybeSingle();
    if (!error && data) summary = safeOrderPushSummary(data.customer_name, data.subtotal);
  } catch { /* Lookup failure must still allow the order-number-only alert. */ }
  let afterId: string | undefined;
  const deadline = Date.now() + 25_000;
  do {
    const { data: recipients, error } = await client.rpc("new_order_push_recipients", {
      p_order_id: claim.order_id, ...(afterId ? { p_after_id: afterId } : {}),
    });
    if (error) throw new Error("push_recipients_failed");
    if (!recipients?.length) return;
    const outcomes = await sendNewOrderBatch(claim.order_id, claim.order_number, recipients, summary);
    for (let index = 0; index < outcomes.length; index++) {
      if (outcomes[index] === "invalid") {
        const { error } = await client.rpc("disable_invalid_push_token", {
          p_device_id: recipients[index].device_id, p_expected_token: recipients[index].fcm_token,
        });
        if (error) console.warn("[madaf/push] invalid-token cleanup unavailable");
      }
    }
    console.info("[madaf/push] new-order batch", {
      sent: outcomes.filter(v => v === "sent").length,
      invalid: outcomes.filter(v => v === "invalid").length,
      failed: outcomes.filter(v => v === "failed").length,
    });
    if (recipients.length < 100) return;
    afterId = recipients[recipients.length - 1].device_id;
  } while (Date.now() < deadline);
  console.warn("[madaf/push] dispatch time budget exhausted");
}
