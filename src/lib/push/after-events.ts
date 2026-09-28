import "server-only";
import { after } from "next/server";
import { deliverEventPush, type CommittedPushEvent } from "@/lib/data/push-events";

/** Business RPCs have already committed. Both scheduling and delivery fail closed
 * for notifications and never escape into the successful business response. */
export function scheduleEventPush(event: CommittedPushEvent): void {
  if (process.env.MADAF_NATIVE_PUSH_ENABLED !== "true") return;
  try {
    after(async () => {
      try { await deliverEventPush(event); }
      catch { console.warn("[madaf/push] event delivery unavailable"); }
    });
  } catch { console.warn("[madaf/push] event scheduling unavailable"); }
}
