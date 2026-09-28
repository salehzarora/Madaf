import "server-only";
import { after } from "next/server";
import { deliverNewOrderPush, type CommittedOrder } from "@/lib/data/push-delivery";

/** Call ONLY after the order RPC resolves successfully. Neither scheduling nor
 * delivery exceptions may escape into the order result/idempotency path. */
export function scheduleNewOrderPush(order: CommittedOrder): void {
  if (process.env.MADAF_NATIVE_PUSH_ENABLED !== "true") return;
  try {
    after(async () => {
      try { await deliverNewOrderPush(order); }
      catch { console.warn("[madaf/push] new-order delivery unavailable"); }
    });
  } catch { console.warn("[madaf/push] new-order scheduling unavailable"); }
}
