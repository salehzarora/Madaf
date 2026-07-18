import "server-only";

/**
 * Assignment Activity Timeline data access (M8I.5). Mock by default; the Supabase
 * branch is server-only (see ./supabase-reads → sbGetAssignmentTimelinePage).
 * Reads the M8I.5 audit_events rows for the WHOLE tenant (entity_type =
 * 'sales_rep_assignment'), bounded + cursor-paginated, under RLS — whose
 * sales_rep_assignment clause requires owner/admin, so a sales_rep never sees
 * assignment activity (and the /admin/team route already 404s a sales_rep before
 * this runs).
 *
 * READ-ONLY: no mutation, and NO new audit event is produced by viewing, paging or
 * resolving actors (audit_events has no INSERT policy for `authenticated` — only
 * the SECURITY DEFINER producers write, and none run here).
 */
import { auditActors, salesRepAssignmentAuditEvents } from "@/lib/mock";
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
  buildSalesRepAssignmentTimelineEvent,
  type SalesRepAssignmentTimelineInitial,
  type SalesRepAssignmentTimelinePage,
} from "@/lib/sales-rep-assignment-timeline";

import { getDataMode } from "./mode";

export interface AssignmentTimelineQuery {
  /** Opaque cursor from a previous page; malformed → first page. */
  cursor?: string | null;
  pageSize?: number;
}

/**
 * Isolate the OPTIONAL initial Assignment Timeline read from the REQUIRED Team
 * management reads (twin of safeInitialTeamTimeline). The Timeline is a
 * non-critical section: if its first read fails, the Team page must still render,
 * so this NEVER throws — it maps a failure to `{ ok: false }` (no backend error
 * text) and a success to `{ ok: true, page }`. It reuses the SAME
 * `getAssignmentTimelinePage` data path the client action and Load-More use.
 */
export async function safeInitialAssignmentTimeline(
  fetchPage: () => Promise<SalesRepAssignmentTimelinePage>,
): Promise<SalesRepAssignmentTimelineInitial> {
  try {
    return { ok: true, page: await fetchPage() };
  } catch {
    return { ok: false };
  }
}

/**
 * One bounded Assignment Timeline page (newest first). Tenant is server-derived;
 * the owner/admin boundary is enforced by RLS (Supabase). Never fetches the full
 * history and never issues an actor N+1; the affected customer + representative
 * are carried inline as bounded snapshots, so there is NO second identity lookup.
 */
export async function getAssignmentTimelinePage(
  input: AssignmentTimelineQuery = {},
): Promise<SalesRepAssignmentTimelinePage> {
  const pageSize = clampTimelinePageSize(input.pageSize);
  if (getDataMode() === "supabase") {
    return (await import("./supabase-reads")).sbGetAssignmentTimelinePage({
      cursor: input.cursor ?? null,
      pageSize,
    });
  }
  return mockAssignmentTimelinePage(input.cursor ?? null, pageSize);
}

/**
 * Mock model of the exact Supabase contract (bounded, deterministic order, keyset
 * cursor, page-scoped actor resolution). Mock is the open demo → treated as an
 * owner/admin viewer; actor labels are resolved for ONLY this page's distinct
 * actors (never the full demo roster).
 */
function mockAssignmentTimelinePage(
  cursor: string | null,
  pageSize: number,
): SalesRepAssignmentTimelinePage {
  const decoded = decodeTimelineCursor(cursor);
  const ordered = [...salesRepAssignmentAuditEvents].sort(compareTimelineDesc);
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
    buildSalesRepAssignmentTimelineEvent({
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
