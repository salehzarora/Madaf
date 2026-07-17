import "server-only";

/**
 * Settings Timeline data access (M8I.4). Mock by default; the Supabase branch is
 * server-only (see ./supabase-reads → sbGetSettingsTimelinePage). Reads the M8I.4
 * audit_events rows for the WHOLE tenant (entity_type = 'settings'), bounded +
 * cursor-paginated, under RLS — whose settings clause requires owner/admin, so a
 * sales_rep never sees Settings activity (and the settings route already 404s a
 * sales_rep before this runs).
 *
 * READ-ONLY: no mutation, and NO new audit event is produced by viewing, paging or
 * resolving actors (audit_events has no INSERT policy for `authenticated` — only
 * the SECURITY DEFINER producers write, and none run here).
 */
import { auditActors, settingsAuditEvents } from "@/lib/mock";
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
  buildSettingsTimelineEvent,
  type SettingsTimelineInitial,
  type SettingsTimelinePage,
} from "@/lib/settings-timeline";

import { getDataMode } from "./mode";

export interface SettingsTimelineQuery {
  /** Opaque cursor from a previous page; malformed → first page. */
  cursor?: string | null;
  pageSize?: number;
}

/**
 * Isolate the OPTIONAL initial Settings Timeline read from the REQUIRED settings
 * reads (twin of safeInitialTeamTimeline). The Timeline is a non-critical section:
 * if its first read fails, the Settings page must still render, so this NEVER throws
 * — it maps a failure to `{ ok: false }` (no backend error text) and a success to
 * `{ ok: true, page }`. It reuses the SAME `getSettingsTimelinePage` data path the
 * client action and Load-More use.
 */
export async function safeInitialSettingsTimeline(
  fetchPage: () => Promise<SettingsTimelinePage>,
): Promise<SettingsTimelineInitial> {
  try {
    return { ok: true, page: await fetchPage() };
  } catch {
    return { ok: false };
  }
}

/**
 * One bounded Settings Timeline page (newest first). Tenant is server-derived; the
 * owner/admin boundary is enforced by RLS (Supabase). Never fetches the full history
 * and never issues an actor N+1.
 */
export async function getSettingsTimelinePage(
  input: SettingsTimelineQuery = {},
): Promise<SettingsTimelinePage> {
  const pageSize = clampTimelinePageSize(input.pageSize);
  if (getDataMode() === "supabase") {
    return (await import("./supabase-reads")).sbGetSettingsTimelinePage({
      cursor: input.cursor ?? null,
      pageSize,
    });
  }
  return mockSettingsTimelinePage(input.cursor ?? null, pageSize);
}

/**
 * Mock model of the exact Supabase contract (bounded, deterministic order, keyset
 * cursor, page-scoped actor resolution). Mock is the open demo → treated as an
 * owner/admin viewer; actor labels are resolved for ONLY this page's distinct actors.
 */
function mockSettingsTimelinePage(
  cursor: string | null,
  pageSize: number,
): SettingsTimelinePage {
  const decoded = decodeTimelineCursor(cursor);
  const ordered = [...settingsAuditEvents].sort(compareTimelineDesc);
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
    buildSettingsTimelineEvent({
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
