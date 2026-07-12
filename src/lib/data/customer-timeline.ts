/**
 * Customer Timeline data access (M8G.3). Mock by default; the Supabase branch
 * is server-only (see ./supabase-reads → sbGetCustomerTimelinePage). Reads the
 * M8G.2 audit_events rows for ONE customer, bounded + cursor-paginated, under
 * RLS (which is the authorization boundary). No mutation, no new audit event.
 */
import { auditActors, auditEvents } from "@/lib/mock";
import {
  buildTimelineEvent,
  clampTimelinePageSize,
  compareTimelineDesc,
  decodeTimelineCursor,
  encodeTimelineCursor,
  resolveTimelineActor,
  timelineRowBeforeCursor,
  type TimelinePage,
} from "@/lib/customer-timeline";

import { getDataMode } from "./mode";

export interface TimelineQuery {
  customerId: string;
  /** Opaque cursor from a previous page; malformed → first page. */
  cursor?: string | null;
  pageSize?: number;
}

/**
 * One bounded Customer Timeline page (newest first). Tenant is server-derived;
 * the customer is validated + access-checked by RLS (Supabase) or by simple
 * existence (mock). Never fetches the full history and never issues an actor
 * N+1 — actors for the page are resolved in one roster lookup.
 */
export async function getCustomerTimelinePage(
  input: TimelineQuery,
): Promise<TimelinePage> {
  const pageSize = clampTimelinePageSize(input.pageSize);
  if (getDataMode() === "supabase") {
    return (await import("./supabase-reads")).sbGetCustomerTimelinePage({
      customerId: input.customerId,
      cursor: input.cursor ?? null,
      pageSize,
    });
  }
  return mockTimelinePage(input.customerId, input.cursor ?? null, pageSize);
}

/** Mock model of the exact Supabase contract (bounded, deterministic order,
 * keyset cursor, page-scoped actor resolution). Mock is the open demo → treated
 * as an owner/admin viewer (named actors resolved from the demo roster). */
function mockTimelinePage(
  customerId: string,
  cursor: string | null,
  pageSize: number,
): TimelinePage {
  const decoded = decodeTimelineCursor(cursor);
  const ordered = auditEvents
    .filter((e) => e.customerId === customerId)
    .sort(compareTimelineDesc);
  const after = decoded
    ? ordered.filter((e) => timelineRowBeforeCursor(e, decoded))
    : ordered;

  const slice = after.slice(0, pageSize + 1);
  const hasMore = slice.length > pageSize;
  const page = slice.slice(0, pageSize);

  const events = page.map((e) =>
    buildTimelineEvent({
      id: e.id,
      eventType: e.eventType,
      createdAt: e.createdAt,
      actor: resolveTimelineActor(e.actorUserId, {
        isAdmin: true,
        emails: auditActors,
      }),
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
