"use server";

/**
 * Customer Timeline "load more" Server Action (M8G.3) — the ONLY client bridge
 * to the bounded audit read. READ-ONLY: it fetches a page and logs nothing (no
 * new audit event). tenant + entity_type are server-derived in the data layer;
 * RLS (audit_events customer-scoped policy) is the authorization boundary. The
 * cursor is opaque and never authorizes access; a malformed cursor normalizes
 * to the first page. No client-supplied tenant, entity type, page size, or
 * event filter is trusted.
 */
import { getCustomerTimelinePage } from "@/lib/data";
import type { TimelinePage } from "@/lib/customer-timeline";

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

export interface TimelineActionResult {
  ok: boolean;
  page?: TimelinePage;
}

export async function loadCustomerTimelineAction(input: {
  customerId: string;
  cursor?: string | null;
}): Promise<TimelineActionResult> {
  try {
    if (!isPlausibleId(input.customerId)) return { ok: false };
    const cursor =
      typeof input.cursor === "string" && input.cursor.length <= MAX_CURSOR_LENGTH
        ? input.cursor
        : null;
    const page = await getCustomerTimelinePage({
      customerId: input.customerId,
      cursor,
    });
    return { ok: true, page };
  } catch (error) {
    console.error("[madaf/actions] loadCustomerTimelineAction failed:", error);
    return { ok: false };
  }
}
