/**
 * Product Timeline data access (M8I.1). Mock by default; the Supabase branch is
 * server-only (see ./supabase-reads → sbGetProductTimelinePage). Reads the M8I.1
 * audit_events rows for ONE product (entity_type = 'product'), bounded +
 * cursor-paginated, under RLS — whose product clause requires owner/admin, so a
 * sales_rep never sees product audit history (and the Product edit route already
 * 404s a sales_rep before this runs).
 *
 * READ-ONLY: no mutation, and NO new audit event is produced by viewing, paging
 * or resolving actors (audit_events has no INSERT policy for `authenticated` at
 * all — only the SECURITY DEFINER producer RPCs write, and none run here).
 */
import { auditActors, productAuditEvents } from "@/lib/mock";
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
  buildProductTimelineEvent,
  type ProductTimelineInitial,
  type ProductTimelinePage,
} from "@/lib/product-timeline";

import { getDataMode } from "./mode";

export interface ProductTimelineQuery {
  productId: string;
  /** Opaque cursor from a previous page; malformed → first page. */
  cursor?: string | null;
  pageSize?: number;
}

/**
 * Isolate the OPTIONAL initial Product Timeline read from the REQUIRED Product
 * edit reads (twin of safeInitialOrderTimeline / safeInitialCustomerTimeline).
 * The Timeline is a non-critical section: if its first read fails, the Product
 * edit page must still render, so this NEVER throws — it maps a failure to
 * `{ ok: false }` (no backend error text) and a success to `{ ok: true, page }`.
 * It reuses the SAME `getProductTimelinePage` data path the client action and
 * Load-More use, and is directly testable — a test passes a throwing thunk to
 * prove containment. The required product reads are NOT routed through this
 * wrapper, so their failures still propagate and fail the page as before.
 */
export async function safeInitialProductTimeline(
  fetchPage: () => Promise<ProductTimelinePage>,
): Promise<ProductTimelineInitial> {
  try {
    return { ok: true, page: await fetchPage() };
  } catch {
    return { ok: false };
  }
}

/**
 * One bounded Product Timeline page (newest first). Tenant is server-derived; the
 * product is access-checked by RLS (Supabase) or by simple existence (mock).
 * Never fetches the full history and never issues an actor N+1 — the actors for
 * the page are resolved in ONE bounded lookup.
 */
export async function getProductTimelinePage(
  input: ProductTimelineQuery,
): Promise<ProductTimelinePage> {
  const pageSize = clampTimelinePageSize(input.pageSize);
  if (getDataMode() === "supabase") {
    return (await import("./supabase-reads")).sbGetProductTimelinePage({
      productId: input.productId,
      cursor: input.cursor ?? null,
      pageSize,
    });
  }
  return mockProductTimelinePage(input.productId, input.cursor ?? null, pageSize);
}

/**
 * Mock model of the exact Supabase contract (bounded, deterministic order,
 * keyset cursor, page-scoped actor resolution). Mock is the open demo → treated
 * as an owner/admin viewer; actor labels are resolved for ONLY this page's
 * distinct actors (never the full demo roster).
 */
function mockProductTimelinePage(
  productId: string,
  cursor: string | null,
  pageSize: number,
): ProductTimelinePage {
  const decoded = decodeTimelineCursor(cursor);
  const ordered = productAuditEvents
    .filter((e) => e.productId === productId)
    .sort(compareTimelineDesc);
  const after = decoded
    ? ordered.filter((e) => timelineRowBeforeCursor(e, decoded))
    : ordered;

  const slice = after.slice(0, pageSize + 1);
  const hasMore = slice.length > pageSize;
  const page = slice.slice(0, pageSize);

  // Labels for ONLY the distinct actors on THIS page (bounded, no N+1).
  const emails = new Map<string, string>();
  for (const id of distinctActorIds(page.map((e) => e.actorUserId))) {
    const email = auditActors.get(id);
    if (email) emails.set(id, email);
  }

  const events = page.map((e) =>
    buildProductTimelineEvent({
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
