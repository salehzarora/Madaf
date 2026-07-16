/**
 * Inventory Timeline data access (M8I.2). Mock by default; the Supabase branch is
 * server-only (see ./supabase-reads → sbGetInventoryTimelinePage). Reads the M8I.2
 * audit_events rows for ONE product (entity_type = 'inventory', entity_id =
 * product_id), bounded + cursor-paginated, under RLS — whose inventory clause
 * requires owner/admin, so a sales_rep never sees inventory audit history (and the
 * Product edit route already 404s a sales_rep before this runs).
 *
 * READ-ONLY: no mutation, and NO new audit event is produced by viewing, paging or
 * resolving actors (audit_events has no INSERT policy for `authenticated` — only
 * the SECURITY DEFINER producers write, and none run here).
 */
import { auditActors, inventoryAuditEvents } from "@/lib/mock";
import {
  clampTimelinePageSize,
  compareTimelineDesc,
  decodeTimelineCursor,
  distinctActorIds,
  encodeTimelineCursor,
  resolveTimelineActor,
  timelineRowBeforeCursor,
} from "@/lib/customer-timeline";
import {
  buildInventoryTimelineEvent,
  type InventoryTimelineInitial,
  type InventoryTimelinePage,
} from "@/lib/inventory-timeline";

import { getDataMode } from "./mode";

export interface InventoryTimelineQuery {
  productId: string;
  /** Opaque cursor from a previous page; malformed → first page. */
  cursor?: string | null;
  pageSize?: number;
}

/**
 * Isolate the OPTIONAL initial Inventory Timeline read from the REQUIRED Product
 * edit reads (twin of safeInitialProductTimeline). The Timeline is a non-critical
 * section: if its first read fails, the Product edit page must still render, so
 * this NEVER throws — it maps a failure to `{ ok: false }` (no backend error text)
 * and a success to `{ ok: true, page }`. It reuses the SAME `getInventoryTimelinePage`
 * data path the client action and Load-More use, and is directly testable.
 */
export async function safeInitialInventoryTimeline(
  fetchPage: () => Promise<InventoryTimelinePage>,
): Promise<InventoryTimelineInitial> {
  try {
    return { ok: true, page: await fetchPage() };
  } catch {
    return { ok: false };
  }
}

/**
 * One bounded Inventory Timeline page (newest first). Tenant is server-derived; the
 * product is access-checked by RLS (Supabase) or by simple existence (mock). Never
 * fetches the full history and never issues an actor N+1.
 */
export async function getInventoryTimelinePage(
  input: InventoryTimelineQuery,
): Promise<InventoryTimelinePage> {
  const pageSize = clampTimelinePageSize(input.pageSize);
  if (getDataMode() === "supabase") {
    return (await import("./supabase-reads")).sbGetInventoryTimelinePage({
      productId: input.productId,
      cursor: input.cursor ?? null,
      pageSize,
    });
  }
  return mockInventoryTimelinePage(input.productId, input.cursor ?? null, pageSize);
}

/**
 * Mock model of the exact Supabase contract (bounded, deterministic order, keyset
 * cursor, page-scoped actor resolution). Mock is the open demo → treated as an
 * owner/admin viewer; actor labels are resolved for ONLY this page's distinct
 * actors (never the full demo roster).
 */
function mockInventoryTimelinePage(
  productId: string,
  cursor: string | null,
  pageSize: number,
): InventoryTimelinePage {
  const decoded = decodeTimelineCursor(cursor);
  const ordered = inventoryAuditEvents
    .filter((e) => e.productId === productId)
    .sort(compareTimelineDesc);
  const after = decoded
    ? ordered.filter((e) => timelineRowBeforeCursor(e, decoded))
    : ordered;

  const slice = after.slice(0, pageSize + 1);
  const hasMore = slice.length > pageSize;
  const page = slice.slice(0, pageSize);

  const emails = new Map<string, string>();
  for (const id of distinctActorIds(page.map((e) => e.actorUserId))) {
    const email = auditActors.get(id);
    if (email) emails.set(id, email);
  }

  const events = page.map((e) =>
    buildInventoryTimelineEvent({
      id: e.id,
      eventType: e.eventType,
      createdAt: e.createdAt,
      actor: resolveTimelineActor(e.actorUserId, { isAdmin: true, emails }),
      metadata: e.metadata,
    }),
  );

  const last = page[page.length - 1];
  const nextCursor =
    hasMore && last
      ? encodeTimelineCursor({ createdAt: last.createdAt, id: last.id })
      : null;
  return { events, nextCursor, hasMore };
}
