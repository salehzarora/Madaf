/**
 * Inventory Timeline — pure, shared contract (M8I.2).
 *
 * The bounded page type and the CLIENT-SAFE metadata projection for the
 * read-only Inventory Timeline, which consumes the M8I.2 `audit_events` rows
 * (entity_type = 'inventory'). No server-only imports, no `window` — runs on the
 * server (data layer) and the client (component) and is unit tested.
 *
 * REUSE, NOT RE-DESIGN. The keyset cursor, DESC comparator, page-size clamp and
 * viewer-aware actor resolver are ENTITY-NEUTRAL and imported verbatim from the
 * M8G.3 Customer Timeline contract (also used by Order/Product timelines).
 *
 * SECURITY: nothing here authorizes anything — RLS on audit_events is the
 * authorization boundary (its inventory clause requires owner/admin). The cursor
 * carries only (created_at, id): never a tenant, a product id, a secret or PII.
 *
 * The projection is the LAST line of defence: it re-applies the DB helper's
 * per-event key allowlist AND validates every value shape on READ, so no raw /
 * oversized / quantity value can reach the client through an inventory audit row.
 */
import type { AuditSensitivity } from "@/lib/audit-events";
import type { TimelineActor } from "@/lib/customer-timeline";
import {
  inventoryAuditSensitivity,
  isInventoryAuditFieldKey,
  resolveInventoryEventKey,
  type InventoryAuditFieldKey,
} from "@/lib/inventory-audit";

/** One safe, client-bound Inventory Timeline row. Carries only allowlisted metadata. */
export interface InventoryTimelineEvent {
  /** audit_events.id (bigint) as a string. */
  id: string;
  eventType: string;
  createdAt: string;
  actor: TimelineActor;
  sensitivity: AuditSensitivity;
  /** Always "inventory" for this phase. */
  category: "inventory";
  /** ONLY the allowlisted, validated keys the renderer uses. */
  metadata: Record<string, unknown>;
}

/** A bounded Inventory Timeline page + an opaque cursor for the next (older) page. */
export interface InventoryTimelinePage {
  events: InventoryTimelineEvent[];
  nextCursor: string | null;
  hasMore: boolean;
}

/**
 * The OPTIONAL initial Timeline read, as it reaches the client. A success carries
 * the first page; a failure is explicit ({ ok: false }) so the section can render
 * a localized, retryable error WITHOUT the Product edit page crashing and WITHOUT
 * faking "no activity". A failure carries no backend error text.
 */
export type InventoryTimelineInitial =
  | { ok: true; page: InventoryTimelinePage }
  | { ok: false };

// ── Client-safe metadata projection (KEY-safe AND VALUE-safe) ───────────────

const INVENTORY_INT_MAX = 100_000_000;

function safeCount(v: unknown): number | undefined {
  return typeof v === "number" &&
    Number.isInteger(v) &&
    v >= 0 &&
    v <= INVENTORY_INT_MAX
    ? v
    : undefined;
}

function safeLocation(v: unknown): string | null | undefined {
  if (v === null) return null;
  if (typeof v === "string" && v.length > 0 && v.length <= 40) return v;
  return undefined;
}

function safeDate(v: unknown): string | null | undefined {
  if (v === null) return null;
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  return undefined;
}

/** Validate a {from,to} pair, keeping only resolvable sides; drop if both fail. */
function safePair<T>(
  v: unknown,
  pick: (x: unknown) => T | null | undefined,
): { from: T | null; to: T | null } | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as { from?: unknown; to?: unknown };
  const from = pick(o.from);
  const to = pick(o.to);
  if (from === undefined && to === undefined) return undefined;
  return { from: (from ?? null) as T | null, to: (to ?? null) as T | null };
}

function safeChangedFields(v: unknown): InventoryAuditFieldKey[] {
  if (!Array.isArray(v)) return [];
  const out: InventoryAuditFieldKey[] = [];
  for (const x of v) {
    if (isInventoryAuditFieldKey(x) && !out.includes(x)) out.push(x);
  }
  return out;
}

/**
 * Project stored metadata down to the client-safe, VALUE-VALIDATED allowlist for
 * its event type. An unrecognized event type → {}. A malformed value under a known
 * key is omitted (the row is kept; only the bad value is dropped). quantity is only
 * ever projected for inventory.created; it is never present on inventory.updated.
 */
export function clientSafeInventoryMetadata(
  eventType: string,
  metadata: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const key = resolveInventoryEventKey(eventType);
  if (!key) return {};
  const src = metadata ?? {};
  const out: Record<string, unknown> = {};

  if (key === "inventory.created") {
    const quantity = safeCount(src.quantity);
    if (quantity !== undefined) out.quantity = quantity;
    const threshold = safeCount(src.threshold);
    if (threshold !== undefined) out.threshold = threshold;
    return out;
  }

  // inventory.updated
  if (Array.isArray(src.changed_fields)) {
    out.changed_fields = safeChangedFields(src.changed_fields);
  }
  const thr = safePair(src.threshold, safeCount);
  if (thr) out.threshold = thr;
  const loc = safePair(src.location, safeLocation);
  if (loc) out.location = loc;
  const exp = safePair(src.expiry, safeDate);
  if (exp) out.expiry = exp;
  return out;
}

/** Build one client-safe InventoryTimelineEvent from a resolved actor + raw fields. */
export function buildInventoryTimelineEvent(input: {
  id: string;
  eventType: string;
  createdAt: string;
  actor: TimelineActor;
  metadata: Record<string, unknown> | null | undefined;
}): InventoryTimelineEvent {
  return {
    id: input.id,
    eventType: input.eventType,
    createdAt: input.createdAt,
    actor: input.actor,
    sensitivity: inventoryAuditSensitivity(input.eventType),
    category: "inventory",
    metadata: clientSafeInventoryMetadata(input.eventType, input.metadata),
  };
}
