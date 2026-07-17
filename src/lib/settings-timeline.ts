/**
 * Settings Timeline — pure, shared contract (M8I.4).
 *
 * The bounded page type and the CLIENT-SAFE metadata projection for the read-only
 * tenant-wide Settings Activity stream (audit_events, entity_type='settings'). No
 * server-only imports, no `window` — runs on the server (data layer) and the client
 * (component) and is unit tested.
 *
 * REUSE, NOT RE-DESIGN. The keyset cursor, DESC comparator, page-size clamp and
 * viewer-aware actor resolver are imported verbatim from the Customer Timeline
 * contract (also used by Order/Product/Inventory/Team).
 *
 * SECURITY: nothing here authorizes anything — RLS on audit_events is the boundary
 * (its settings clause requires owner/admin). The cursor carries only (created_at,
 * id): never a tenant, a secret, or PII.
 *
 * The projection is the LAST line of defence: it re-applies the DB helper's per-event
 * changed-field allowlist AND validates every safe {from,to} on READ, so no sensitive
 * value and no unknown key can reach the client through a settings audit row.
 */
import type { AuditSensitivity } from "@/lib/audit-events";
import type { TimelineActor } from "@/lib/customer-timeline";
import {
  isSettingsSafeField,
  resolveSettingsEventKey,
  settingsAuditSensitivity,
  SETTINGS_FIELD_KEYS,
} from "@/lib/settings-audit";

/** One safe, client-bound Settings Timeline row. Carries only allowlisted metadata. */
export interface SettingsTimelineEvent {
  /** audit_events.id (bigint) as a string. */
  id: string;
  eventType: string;
  createdAt: string;
  actor: TimelineActor;
  sensitivity: AuditSensitivity;
  /** Always "settings" for this phase. */
  category: "settings";
  /** ONLY changed_fields + validated safe {from,to} transitions. */
  metadata: Record<string, unknown>;
}

/** A bounded Settings Timeline page + an opaque cursor for the next (older) page. */
export interface SettingsTimelinePage {
  events: SettingsTimelineEvent[];
  nextCursor: string | null;
  hasMore: boolean;
}

/**
 * The OPTIONAL initial Settings Timeline read, as it reaches the client. A success
 * carries the first page; a failure is explicit ({ ok: false }) so the section can
 * render a localized, retryable error WITHOUT the Settings page crashing and WITHOUT
 * faking "no activity". A failure carries no backend error text.
 */
export type SettingsTimelineInitial =
  | { ok: true; page: SettingsTimelinePage }
  | { ok: false };

// ── Client-safe metadata projection (KEY-safe AND VALUE-safe) ───────────────

/** A validated {from,to} for a safe field, keeping only correctly-typed sides. */
function safeTransition(
  field: string,
  v: unknown,
): { from: unknown; to: unknown } | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as { from?: unknown; to?: unknown };
  if (!("from" in o) || !("to" in o)) return undefined;
  const ok = (x: unknown): boolean => {
    if (x === null) return true;
    if (field === "display_vat_rate" || field === "default_vat_rate") {
      return typeof x === "number" && Number.isFinite(x);
    }
    if (field === "legal_invoicing_ready") return typeof x === "boolean";
    // country_code / invoice_language / timezone
    return typeof x === "string" && x.length <= 64;
  };
  if (!ok(o.from) || !ok(o.to)) return undefined;
  return { from: o.from ?? null, to: o.to ?? null };
}

/**
 * Project stored metadata down to the client-safe allowlist for its event type.
 * An unrecognized event type → {}. changed_fields is filtered to the event's
 * allowlisted field keys (deduped); a safe transition is kept only for a safe
 * field that is itself in changed_fields and validates. Everything else is dropped.
 */
export function clientSafeSettingsMetadata(
  eventType: string,
  metadata: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const key = resolveSettingsEventKey(eventType);
  if (!key) return {};
  const allow = SETTINGS_FIELD_KEYS[key];
  const src = metadata ?? {};
  const out: Record<string, unknown> = {};

  const changed = Array.isArray(src.changed_fields)
    ? (src.changed_fields as unknown[]).filter(
        (f, i, arr): f is string =>
          typeof f === "string" && allow.includes(f) && arr.indexOf(f) === i,
      )
    : [];
  if (changed.length === 0) return {};
  out.changed_fields = changed;

  for (const field of changed) {
    if (isSettingsSafeField(field) && field in src) {
      const pair = safeTransition(field, src[field]);
      if (pair) out[field] = pair;
    }
  }
  return out;
}

/** Build one client-safe SettingsTimelineEvent from a resolved actor + raw fields. */
export function buildSettingsTimelineEvent(input: {
  id: string;
  eventType: string;
  createdAt: string;
  actor: TimelineActor;
  metadata: Record<string, unknown> | null | undefined;
}): SettingsTimelineEvent {
  return {
    id: input.id,
    eventType: input.eventType,
    createdAt: input.createdAt,
    actor: input.actor,
    sensitivity: settingsAuditSensitivity(input.eventType),
    category: "settings",
    metadata: clientSafeSettingsMetadata(input.eventType, input.metadata),
  };
}
