/**
 * Team Timeline — pure, shared contract (M8I.3).
 *
 * The bounded page type and the CLIENT-SAFE metadata projection for the
 * read-only Team Activity stream, which consumes the M8I.3 `audit_events` rows
 * (entity_type = 'team', tenant-wide). No server-only imports, no `window` — runs
 * on the server (data layer) and the client (component) and is unit tested.
 *
 * REUSE, NOT RE-DESIGN. The keyset cursor, DESC comparator, page-size clamp and
 * viewer-aware actor resolver are ENTITY-NEUTRAL and imported verbatim from the
 * M8G.3 Customer Timeline contract (also used by Order/Product/Inventory).
 *
 * SECURITY: nothing here authorizes anything — RLS on audit_events is the
 * authorization boundary (its team clause requires owner/admin). The cursor
 * carries only (created_at, id): never a tenant, a user id, a secret, or PII.
 *
 * The projection is the LAST line of defence: it re-applies the DB helper's
 * per-event key allowlist AND validates every value on READ, so no raw / oversized
 * / secret-shaped value can reach the client through a Team audit row. The
 * affected member is projected as `target_email` (a bounded snapshot) so the row
 * stays legible after the member is removed — with NO second identity lookup.
 */
import type { AuditSensitivity } from "@/lib/audit-events";
import type { TimelineActor } from "@/lib/customer-timeline";
import {
  resolveTeamEventKey,
  safeTeamRole,
  teamAuditSensitivity,
} from "@/lib/team-audit";

/** One safe, client-bound Team Timeline row. Carries only allowlisted metadata. */
export interface TeamTimelineEvent {
  /** audit_events.id (bigint) as a string. */
  id: string;
  eventType: string;
  createdAt: string;
  actor: TimelineActor;
  sensitivity: AuditSensitivity;
  /** Always "team" for this phase. */
  category: "team";
  /** ONLY the allowlisted, validated keys the renderer uses (target_email + safe
   * role enums). */
  metadata: Record<string, unknown>;
}

/** A bounded Team Timeline page + an opaque cursor for the next (older) page. */
export interface TeamTimelinePage {
  events: TeamTimelineEvent[];
  nextCursor: string | null;
  hasMore: boolean;
}

/**
 * The OPTIONAL initial Team Timeline read, as it reaches the client. A success
 * carries the first page; a failure is explicit ({ ok: false }) so the section
 * can render a localized, retryable error WITHOUT the Team management page
 * crashing and WITHOUT faking "no activity". A failure carries no backend error text.
 */
export type TeamTimelineInitial =
  | { ok: true; page: TeamTimelinePage }
  | { ok: false };

// ── Client-safe metadata projection (KEY-safe AND VALUE-safe) ───────────────

/** A safe normalized email (non-empty, ≤254) or undefined. */
function safeEmail(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 && v.length <= 254 ? v : undefined;
}

/**
 * Project stored metadata down to the client-safe, VALUE-VALIDATED allowlist for
 * its event type. An unrecognized event type → {}. A malformed value under a known
 * key is omitted (the row is kept; only the bad value is dropped). Only
 * target_email + the safe role enums ever cross the wire — never a token, hash,
 * preview, URL, or any other key.
 */
export function clientSafeTeamMetadata(
  eventType: string,
  metadata: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const key = resolveTeamEventKey(eventType);
  if (!key) return {};
  const src = metadata ?? {};
  const out: Record<string, unknown> = {};

  const email = safeEmail(src.target_email);
  if (email !== undefined) out.target_email = email;

  if (key === "team.role_changed") {
    const from = safeTeamRole(src.from_role);
    if (from !== undefined) out.from_role = from;
    const to = safeTeamRole(src.to_role);
    if (to !== undefined) out.to_role = to;
    return out;
  }

  const role = safeTeamRole(src.role);
  if (role !== undefined) out.role = role;
  return out;
}

/** Build one client-safe TeamTimelineEvent from a resolved actor + raw fields. */
export function buildTeamTimelineEvent(input: {
  id: string;
  eventType: string;
  createdAt: string;
  actor: TimelineActor;
  metadata: Record<string, unknown> | null | undefined;
}): TeamTimelineEvent {
  const metadata = clientSafeTeamMetadata(input.eventType, input.metadata);
  return {
    id: input.id,
    eventType: input.eventType,
    createdAt: input.createdAt,
    actor: input.actor,
    sensitivity: teamAuditSensitivity(input.eventType, metadata),
    category: "team",
    metadata,
  };
}
