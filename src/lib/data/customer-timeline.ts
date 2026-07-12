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
  distinctActorIds,
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
 * Resolve display labels for ONLY the distinct actors on the CURRENT Timeline
 * page — never the whole tenant roster. The input is deduped + hard-capped at
 * the page maximum ({@link distinctActorIds}); an empty page performs NO lookup.
 * Owner/admin get email labels through the authorized, tenant-scoped roster;
 * every other viewer (a sales_rep) gets an empty map — no identity is exposed.
 * Returns only `{ actorId → email }` for the requested ids; raw member/auth
 * rows never reach the caller or the client.
 */
export async function getTimelineActorLabelsForIds(
  actorIds: ReadonlyArray<string | null | undefined>,
): Promise<Map<string, string>> {
  const ids = distinctActorIds(actorIds);
  if (ids.length === 0) return new Map();
  if (getDataMode() === "supabase") {
    return (await import("./supabase-reads")).sbGetTimelineActorLabels(ids);
  }
  return mockActorLabels(ids);
}

/** Mock label source (the open demo → an owner/admin viewer): projects the demo
 * roster to ONLY the requested ids — one bounded lookup, never the full roster. */
function mockActorLabels(ids: string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const id of ids) {
    const email = auditActors.get(id);
    if (email) out.set(id, email);
  }
  return out;
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
 * as an owner/admin viewer; actor labels are resolved for ONLY this page's
 * distinct actors via the bounded contract (never the full demo roster). */
async function mockTimelinePage(
  customerId: string,
  cursor: string | null,
  pageSize: number,
): Promise<TimelinePage> {
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

  // Resolve labels for ONLY the distinct actors on THIS page (bounded, no N+1).
  const emails = await getTimelineActorLabelsForIds(
    page.map((e) => e.actorUserId),
  );
  const events = page.map((e) =>
    buildTimelineEvent({
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
