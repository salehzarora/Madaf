import "server-only";

/**
 * Team Timeline data access (M8I.3). Mock by default; the Supabase branch is
 * server-only (see ./supabase-reads → sbGetTeamTimelinePage). Reads the M8I.3
 * audit_events rows for the WHOLE tenant (entity_type = 'team'), bounded +
 * cursor-paginated, under RLS — whose team clause requires owner/admin, so a
 * sales_rep never sees Team activity (and the /admin/team route already 404s a
 * sales_rep before this runs).
 *
 * READ-ONLY: no mutation, and NO new audit event is produced by viewing, paging
 * or resolving actors (audit_events has no INSERT policy for `authenticated` —
 * only the SECURITY DEFINER producers write, and none run here).
 */
import { auditActors, teamAuditEvents } from "@/lib/mock";
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
  buildTeamTimelineEvent,
  type TeamTimelineInitial,
  type TeamTimelinePage,
} from "@/lib/team-timeline";

import { getDataMode } from "./mode";

export interface TeamTimelineQuery {
  /** Opaque cursor from a previous page; malformed → first page. */
  cursor?: string | null;
  pageSize?: number;
}

/**
 * Isolate the OPTIONAL initial Team Timeline read from the REQUIRED Team
 * management reads (twin of safeInitialInventoryTimeline). The Timeline is a
 * non-critical section: if its first read fails, the Team page must still render,
 * so this NEVER throws — it maps a failure to `{ ok: false }` (no backend error
 * text) and a success to `{ ok: true, page }`. It reuses the SAME
 * `getTeamTimelinePage` data path the client action and Load-More use.
 */
export async function safeInitialTeamTimeline(
  fetchPage: () => Promise<TeamTimelinePage>,
): Promise<TeamTimelineInitial> {
  try {
    return { ok: true, page: await fetchPage() };
  } catch {
    return { ok: false };
  }
}

/**
 * One bounded Team Timeline page (newest first). Tenant is server-derived; the
 * owner/admin boundary is enforced by RLS (Supabase). Never fetches the full
 * history and never issues an actor N+1; the affected member is carried inline as
 * `target_email`, so there is NO second identity lookup.
 */
export async function getTeamTimelinePage(
  input: TeamTimelineQuery = {},
): Promise<TeamTimelinePage> {
  const pageSize = clampTimelinePageSize(input.pageSize);
  if (getDataMode() === "supabase") {
    return (await import("./supabase-reads")).sbGetTeamTimelinePage({
      cursor: input.cursor ?? null,
      pageSize,
    });
  }
  return mockTeamTimelinePage(input.cursor ?? null, pageSize);
}

/**
 * Mock model of the exact Supabase contract (bounded, deterministic order, keyset
 * cursor, page-scoped actor resolution). Mock is the open demo → treated as an
 * owner/admin viewer; actor labels are resolved for ONLY this page's distinct
 * actors (never the full demo roster).
 */
function mockTeamTimelinePage(
  cursor: string | null,
  pageSize: number,
): TeamTimelinePage {
  const decoded = decodeTimelineCursor(cursor);
  const ordered = [...teamAuditEvents].sort(compareTimelineDesc);
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
    buildTeamTimelineEvent({
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
