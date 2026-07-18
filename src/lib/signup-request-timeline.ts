/**
 * Customer-signup-request Timeline — pure, shared contract (M8I.6).
 *
 * The bounded page type and the CLIENT-SAFE metadata projection for the read-only
 * Customer Signup Activity stream, which consumes the M8I.6 `audit_events` rows
 * (entity_type = 'customer_signup_request', tenant-wide). No server-only imports,
 * no `window` — runs on the server (data layer) and the client (component) and is
 * unit tested.
 *
 * REUSE, NOT RE-DESIGN. The keyset cursor, DESC comparator, page-size clamp and
 * viewer-aware actor resolver are ENTITY-NEUTRAL and imported verbatim from the
 * M8G.3 Customer Timeline contract.
 *
 * SECURITY: nothing here authorizes anything — RLS on audit_events is the
 * authorization boundary (its customer_signup_request clause requires owner/admin).
 * The cursor carries only (created_at, id): never a tenant, a request id, a secret,
 * or PII.
 *
 * The projection is the LAST line of defence: only business_name (bounded) and a
 * validated resulting_customer_id (approved only, used solely to build a safe link
 * — never rendered raw) ever cross the wire. No applicant email/phone/address/
 * notes/contact, and no other key, exists to begin with.
 */
import type { AuditSensitivity } from "@/lib/audit-events";
import type { TimelineActor } from "@/lib/customer-timeline";
import {
  resolveSignupRequestEventKey,
  safeSignupBusinessName,
  safeSignupResultingCustomerId,
  signupRequestAuditSensitivity,
} from "@/lib/signup-request-audit";

/** One safe, client-bound Signup Activity row. Carries only allowlisted metadata. */
export interface SignupRequestTimelineEvent {
  /** audit_events.id (bigint) as a string. */
  id: string;
  eventType: string;
  createdAt: string;
  actor: TimelineActor;
  sensitivity: AuditSensitivity;
  /** Always "customer_signup_request" for this phase. */
  category: "customer_signup_request";
  /** ONLY the allowlisted, validated keys the renderer uses. */
  metadata: Record<string, unknown>;
}

/** A bounded Signup Activity page + an opaque cursor for the next (older) page. */
export interface SignupRequestTimelinePage {
  events: SignupRequestTimelineEvent[];
  nextCursor: string | null;
  hasMore: boolean;
}

/**
 * The OPTIONAL initial Signup Activity read, as it reaches the client. A success
 * carries the first page; a failure is explicit ({ ok: false }) so the section can
 * render a localized, retryable error WITHOUT the signup management page crashing
 * and WITHOUT faking "no activity". A failure carries no backend error text.
 */
export type SignupRequestTimelineInitial =
  | { ok: true; page: SignupRequestTimelinePage }
  | { ok: false };

// ── Client-safe metadata projection (KEY-safe AND VALUE-safe) ───────────────

/**
 * Project stored metadata down to the client-safe, VALUE-VALIDATED allowlist:
 * business_name (≤200) and — for approved only — a validated resulting_customer_id
 * (UUID shape, used to build a safe link, never rendered as raw text). An
 * unrecognized event type → {}. A malformed value under a known key is omitted
 * (the row is kept). No applicant contact field exists to project.
 */
export function clientSafeSignupRequestMetadata(
  eventType: string,
  metadata: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const key = resolveSignupRequestEventKey(eventType);
  if (!key) return {};
  const out: Record<string, unknown> = {};

  const name = safeSignupBusinessName(metadata);
  if (name !== null) out.business_name = name;

  if (key === "customer_signup_request.approved") {
    const customerId = safeSignupResultingCustomerId(metadata);
    if (customerId !== null) out.resulting_customer_id = customerId;
  }

  return out;
}

/** Build one client-safe SignupRequestTimelineEvent from a resolved actor + raw
 * fields. */
export function buildSignupRequestTimelineEvent(input: {
  id: string;
  eventType: string;
  createdAt: string;
  actor: TimelineActor;
  metadata: Record<string, unknown> | null | undefined;
}): SignupRequestTimelineEvent {
  const metadata = clientSafeSignupRequestMetadata(input.eventType, input.metadata);
  return {
    id: input.id,
    eventType: input.eventType,
    createdAt: input.createdAt,
    actor: input.actor,
    sensitivity: signupRequestAuditSensitivity(input.eventType),
    category: "customer_signup_request",
    metadata,
  };
}
