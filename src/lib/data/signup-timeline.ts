import "server-only";

/**
 * Customer Signup Activity Timeline data access (M8I.6). Mock by default; the
 * Supabase branch is server-only (see ./supabase-reads → sbGetSignupTimelinePage).
 * Reads the M8I.6 audit_events rows for the WHOLE tenant (entity_type =
 * 'customer_signup_request'), bounded + cursor-paginated, under RLS — whose
 * customer_signup_request clause requires owner/admin, so a sales_rep never sees
 * signup activity (and the /admin/customers/signup route already gates it).
 *
 * READ-ONLY: no mutation, and NO new audit event is produced by viewing, paging or
 * resolving actors (audit_events has no INSERT policy for `authenticated` — only
 * the SECURITY DEFINER review producers write, and none run here).
 */
import { auditActors, signupRequestAuditEvents } from "@/lib/mock";
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
  buildSignupRequestTimelineEvent,
  type SignupRequestTimelineInitial,
  type SignupRequestTimelinePage,
} from "@/lib/signup-request-timeline";

import { getDataMode } from "./mode";

export interface SignupTimelineQuery {
  /** Opaque cursor from a previous page; malformed → first page. */
  cursor?: string | null;
  pageSize?: number;
}

/**
 * Isolate the OPTIONAL initial Signup Activity read from the REQUIRED signup
 * management reads (twin of safeInitialTeamTimeline). The Timeline is a
 * non-critical section: if its first read fails, the signup management page must
 * still render, so this NEVER throws — it maps a failure to `{ ok: false }` (no
 * backend error text) and a success to `{ ok: true, page }`. It reuses the SAME
 * `getSignupTimelinePage` data path the client action and Load-More use.
 */
export async function safeInitialSignupTimeline(
  fetchPage: () => Promise<SignupRequestTimelinePage>,
): Promise<SignupRequestTimelineInitial> {
  try {
    return { ok: true, page: await fetchPage() };
  } catch {
    return { ok: false };
  }
}

/**
 * One bounded Signup Activity page (newest first). Tenant is server-derived; the
 * owner/admin boundary is enforced by RLS (Supabase). Never fetches the full
 * history and never issues an actor N+1; the business name is carried inline as a
 * bounded snapshot, so there is NO second lookup.
 */
export async function getSignupTimelinePage(
  input: SignupTimelineQuery = {},
): Promise<SignupRequestTimelinePage> {
  const pageSize = clampTimelinePageSize(input.pageSize);
  if (getDataMode() === "supabase") {
    return (await import("./supabase-reads")).sbGetSignupTimelinePage({
      cursor: input.cursor ?? null,
      pageSize,
    });
  }
  return mockSignupTimelinePage(input.cursor ?? null, pageSize);
}

/**
 * Mock model of the exact Supabase contract (bounded, deterministic order, keyset
 * cursor, page-scoped actor resolution). Mock is the open demo → treated as an
 * owner/admin viewer; actor labels are resolved for ONLY this page's distinct
 * actors (never the full demo roster).
 */
function mockSignupTimelinePage(
  cursor: string | null,
  pageSize: number,
): SignupRequestTimelinePage {
  const decoded = decodeTimelineCursor(cursor);
  const ordered = [...signupRequestAuditEvents].sort(compareTimelineDesc);
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
    buildSignupRequestTimelineEvent({
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
