"use server";

/**
 * Product Timeline "load more" Server Action (M8I.1) — the ONLY client bridge to
 * the bounded Product audit read.
 *
 * READ-ONLY. It fetches one page and writes NOTHING: no mutation, and no new
 * audit event for viewing, paging, or resolving actors. (`authenticated` holds
 * no INSERT privilege on audit_events at all — only the SECURITY DEFINER product
 * producer RPCs write, and none of them run on this path. A "timeline viewed"
 * event would be pure audit noise and is deliberately not produced.)
 *
 * tenant + entity_type are server-derived in the data layer; RLS (the M8I.1
 * product clause, which requires owner/admin) is the authorization boundary. The
 * cursor is opaque and never authorizes access; a malformed cursor normalizes to
 * the first page. No client-supplied tenant, entity type, page size, event
 * filter, or actor id is trusted. A backend failure is logged server-side and
 * surfaces to the client only as `{ ok: false }` — the raw error text never
 * crosses the wire.
 */
import { getProductTimelinePage } from "@/lib/data";
import type { ProductTimelinePage } from "@/lib/product-timeline";

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

export interface ProductTimelineActionResult {
  ok: boolean;
  page?: ProductTimelinePage;
}

export async function loadProductTimelineAction(input: {
  productId: string;
  cursor?: string | null;
}): Promise<ProductTimelineActionResult> {
  try {
    if (!isPlausibleId(input.productId)) return { ok: false };
    const cursor =
      typeof input.cursor === "string" && input.cursor.length <= MAX_CURSOR_LENGTH
        ? input.cursor
        : null;
    const page = await getProductTimelinePage({
      productId: input.productId,
      cursor,
    });
    return { ok: true, page };
  } catch (error) {
    console.error("[madaf/actions] loadProductTimelineAction failed:", error);
    return { ok: false };
  }
}
