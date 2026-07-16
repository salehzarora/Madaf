"use server";

/**
 * Inventory Timeline "load more" Server Action (M8I.2) — the ONLY client bridge to
 * the bounded Inventory audit read.
 *
 * READ-ONLY. It fetches one page and writes NOTHING: no mutation, and no new audit
 * event for viewing, paging, or resolving actors (`authenticated` holds no INSERT
 * privilege on audit_events; only the SECURITY DEFINER producers write, and none
 * run on this path).
 *
 * tenant + entity_type are server-derived in the data layer; RLS (the M8I.2
 * inventory clause, which requires owner/admin) is the authorization boundary. The
 * cursor is opaque and never authorizes access; a malformed cursor normalizes to
 * the first page. No client-supplied tenant, entity type, page size, or actor id is
 * trusted. A backend failure is logged server-side and surfaces only as
 * `{ ok: false }` — the raw error text never crosses the wire.
 */
import { getInventoryTimelinePage } from "@/lib/data";
import type { InventoryTimelinePage } from "@/lib/inventory-timeline";

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

export interface InventoryTimelineActionResult {
  ok: boolean;
  page?: InventoryTimelinePage;
}

export async function loadInventoryTimelineAction(input: {
  productId: string;
  cursor?: string | null;
}): Promise<InventoryTimelineActionResult> {
  try {
    if (!isPlausibleId(input.productId)) return { ok: false };
    const cursor =
      typeof input.cursor === "string" && input.cursor.length <= MAX_CURSOR_LENGTH
        ? input.cursor
        : null;
    const page = await getInventoryTimelinePage({
      productId: input.productId,
      cursor,
    });
    return { ok: true, page };
  } catch (error) {
    console.error("[madaf/actions] loadInventoryTimelineAction failed:", error);
    return { ok: false };
  }
}
