"use server";

/**
 * Order Timeline "load more" Server Action (M8H.3) — the ONLY client bridge to
 * the bounded Order audit read.
 *
 * READ-ONLY. It fetches one page and writes NOTHING: no mutation, and no new
 * audit event for viewing, paging, or resolving actors. (`authenticated` holds
 * no INSERT privilege on audit_events at all — only the SECURITY DEFINER order
 * producer RPCs write, and none of them run on this path. A "timeline viewed"
 * event would be pure audit noise and is deliberately not produced.)
 *
 * tenant + entity_type are server-derived in the data layer; RLS (the M8H.1
 * order clause, which requires can_access_order) is the authorization boundary.
 * The cursor is opaque and never authorizes access; a malformed cursor
 * normalizes to the first page. No client-supplied tenant, entity type, page
 * size, event filter, or actor id is trusted. A backend failure is logged
 * server-side and surfaces to the client only as `{ ok: false }` — the raw error
 * text never crosses the wire.
 */
import { getOrderTimelinePage } from "@/lib/data";
import type { OrderTimelinePage } from "@/lib/order-timeline";

const MAX_ID_LENGTH = 64;
const MAX_CURSOR_LENGTH = 256;

function isPlausibleId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_ID_LENGTH &&
    /^[A-Za-z0-9-]+$/.test(value)
  );
}

export interface OrderTimelineActionResult {
  ok: boolean;
  page?: OrderTimelinePage;
}

export async function loadOrderTimelineAction(input: {
  orderId: string;
  cursor?: string | null;
}): Promise<OrderTimelineActionResult> {
  try {
    if (!isPlausibleId(input.orderId)) return { ok: false };
    const cursor =
      typeof input.cursor === "string" && input.cursor.length <= MAX_CURSOR_LENGTH
        ? input.cursor
        : null;
    const page = await getOrderTimelinePage({ orderId: input.orderId, cursor });
    return { ok: true, page };
  } catch (error) {
    console.error("[madaf/actions] loadOrderTimelineAction failed:", error);
    return { ok: false };
  }
}
