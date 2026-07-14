/**
 * Order Timeline data access (M8H.3). Mock by default; the Supabase branch is
 * server-only (see ./supabase-reads → sbGetOrderTimelinePage). Reads the M8H.1
 * audit_events rows for ONE order (entity_type = 'order'), bounded +
 * cursor-paginated, under RLS — whose order clause requires can_access_order, so
 * a sales_rep only ever sees the history of an order they can already open.
 *
 * READ-ONLY: no mutation, and NO new audit event is produced by viewing, paging
 * or resolving actors (audit_events has no INSERT policy for `authenticated` at
 * all — only the SECURITY DEFINER producer RPCs write, and none run here).
 */
import { auditActors, orderAuditEvents } from "@/lib/mock";
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
  buildOrderTimelineEvent,
  type OrderTimelineInitial,
  type OrderTimelinePage,
} from "@/lib/order-timeline";

import { getDataMode } from "./mode";

export interface OrderTimelineQuery {
  orderId: string;
  /** Opaque cursor from a previous page; malformed → first page. */
  cursor?: string | null;
  pageSize?: number;
}

/**
 * Isolate the OPTIONAL initial Order Timeline read from the REQUIRED Order
 * Details reads. The Timeline is a non-critical widget: if its first read fails,
 * the Order Details page must still render, so this NEVER throws — it maps a
 * failure to `{ ok: false }` (and a success to `{ ok: true, page }`).
 *
 * It takes the fetch as a thunk rather than fetching inline for two reasons:
 *   • it reuses the SAME `getOrderTimelinePage` data path the client action and
 *     the Load-More flow use, so there is no second fetch implementation to
 *     drift, and the safe VALUE projection in buildOrderTimelineEvent still runs;
 *   • it is directly testable — a test can pass a throwing thunk to prove the
 *     server-read failure is contained and no backend error text escapes.
 *
 * The caught error is deliberately swallowed (not returned): the client is told
 * only that the read failed, never WHY, so a raw PostgREST / DB message can never
 * reach the browser. Required reads are NOT routed through this wrapper, so their
 * failures still propagate and fail the page as before.
 */
export async function safeInitialOrderTimeline(
  fetchPage: () => Promise<OrderTimelinePage>,
): Promise<OrderTimelineInitial> {
  try {
    return { ok: true, page: await fetchPage() };
  } catch {
    return { ok: false };
  }
}

/**
 * One bounded Order Timeline page (newest first). Tenant is server-derived; the
 * order is access-checked by RLS (Supabase) or by simple existence (mock). Never
 * fetches the full history and never issues an actor N+1 — the actors for the
 * page are resolved in ONE bounded lookup.
 */
export async function getOrderTimelinePage(
  input: OrderTimelineQuery,
): Promise<OrderTimelinePage> {
  const pageSize = clampTimelinePageSize(input.pageSize);
  if (getDataMode() === "supabase") {
    return (await import("./supabase-reads")).sbGetOrderTimelinePage({
      orderId: input.orderId,
      cursor: input.cursor ?? null,
      pageSize,
    });
  }
  return mockOrderTimelinePage(input.orderId, input.cursor ?? null, pageSize);
}

/**
 * Mock model of the exact Supabase contract (bounded, deterministic order,
 * keyset cursor, page-scoped actor resolution). Mock is the open demo → treated
 * as an owner/admin viewer; actor labels are resolved for ONLY this page's
 * distinct actors (never the full demo roster).
 */
function mockOrderTimelinePage(
  orderId: string,
  cursor: string | null,
  pageSize: number,
): OrderTimelinePage {
  const decoded = decodeTimelineCursor(cursor);
  const ordered = orderAuditEvents
    .filter((e) => e.orderId === orderId)
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
    buildOrderTimelineEvent({
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
