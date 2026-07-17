"use server";

/**
 * Team Timeline "load more" Server Action (M8I.3) — the ONLY client bridge to the
 * bounded, tenant-wide Team audit read.
 *
 * READ-ONLY. It fetches one page and writes NOTHING: no mutation, and no new
 * audit event for viewing, paging, or resolving actors (`authenticated` holds no
 * INSERT privilege on audit_events; only the SECURITY DEFINER producers write,
 * and none run on this path).
 *
 * tenant + entity_type are server-derived in the data layer; RLS (the M8I.3 team
 * clause, which requires owner/admin) is the authorization boundary. The cursor
 * is opaque and never authorizes access; a malformed cursor normalizes to the
 * first page. No client-supplied tenant, entity type, page size, or actor id is
 * trusted. A backend failure is logged server-side and surfaces only as
 * `{ ok: false }` — the raw error text never crosses the wire.
 */
import { getTeamTimelinePage } from "@/lib/data";
import type { TeamTimelinePage } from "@/lib/team-timeline";

const MAX_CURSOR_LENGTH = 256;

export interface TeamTimelineActionResult {
  ok: boolean;
  page?: TeamTimelinePage;
}

export async function loadTeamTimelineAction(
  input: { cursor?: string | null } = {},
): Promise<TeamTimelineActionResult> {
  try {
    const cursor =
      typeof input.cursor === "string" && input.cursor.length <= MAX_CURSOR_LENGTH
        ? input.cursor
        : null;
    const page = await getTeamTimelinePage({ cursor });
    return { ok: true, page };
  } catch (error) {
    console.error("[madaf/actions] loadTeamTimelineAction failed:", error);
    return { ok: false };
  }
}
