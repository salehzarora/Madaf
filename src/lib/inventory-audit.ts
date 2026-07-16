/**
 * Inventory audit-event taxonomy + safe render/label contract (M8I.2).
 *
 * The app-layer companion to the transactional producer in migration
 * 20260807100000 (`_log_inventory_audit_event`, emitted only from
 * `upsert_inventory_item`): a CLOSED two-event inventory vocabulary, its category
 * + sensitivity, localized labels, a safe details renderer, and the PURE
 * derivation model that mock and Supabase BOTH obey.
 *
 * SCOPE. Only the Product inventory-SETUP path is audited:
 *   inventory.created — the first inventory_items row (tracking started);
 *                       safe metadata {quantity, threshold} only.
 *   inventory.updated — an effective change to a CONFIGURATION field
 *                       (threshold / location / expiry) on an existing row;
 *                       changed_fields + safe before/after. NEVER quantity.
 * Manual `adjust_inventory_stock` and order-driven stock stay in the movement
 * ledger + order audit — they are NOT represented here (no duplication).
 *
 * SAFETY. No event carries quantity_available on inventory.updated, a raw row,
 * a raw payload, a product name, an image url, a token, or Customer/Order data.
 * `warehouse_location` is a bounded (≤40) internal shelf label rendered ONLY as
 * escaped text — never HTML, never a branch/another warehouse.
 *
 * Pure + serializable: no server-only imports, no `window`. Unit-tested directly.
 */
import type { Dictionary } from "@/i18n/types";
import { interpolate } from "@/i18n/dictionaries";
import type { AuditSensitivity } from "@/lib/audit-events";

/** The closed set of Inventory audit event types (mirrors the DB
 * `_log_inventory_audit_event` allowlist EXACTLY). */
export const INVENTORY_AUDIT_EVENT_KEYS = [
  "inventory.created",
  "inventory.updated",
] as const;
export type InventoryAuditEventKey = (typeof INVENTORY_AUDIT_EVENT_KEYS)[number];

export function isInventoryAuditEventKey(v: unknown): v is InventoryAuditEventKey {
  return (
    typeof v === "string" &&
    (INVENTORY_AUDIT_EVENT_KEYS as readonly string[]).includes(v)
  );
}

/** Resolve a raw event_type to a known key, or null (explicit unknown — NEVER
 * silently "Other"). */
export function resolveInventoryEventKey(
  raw: string,
): InventoryAuditEventKey | null {
  return isInventoryAuditEventKey(raw) ? raw : null;
}

/** Entity-aligned audit category for this phase. */
export const AUDIT_CATEGORY_INVENTORY = "inventory" as const;
export type InventoryAuditCategory = typeof AUDIT_CATEGORY_INVENTORY;

export function inventoryAuditCategory(): InventoryAuditCategory {
  return AUDIT_CATEGORY_INVENTORY;
}

/** Every inventory event is `low` (no PII/tokens/quantity-value leaves, only safe
 * bounded scalars). Unknown → `medium` (never under-classified). */
const INVENTORY_SENSITIVITY: Record<InventoryAuditEventKey, AuditSensitivity> = {
  "inventory.created": "low",
  "inventory.updated": "low",
};

export function inventoryAuditSensitivity(raw: string): AuditSensitivity {
  const key = resolveInventoryEventKey(raw);
  return key ? INVENTORY_SENSITIVITY[key] : "medium";
}

/** Localized event label. An unrecognized type gets the explicit shared
 * unknown-event label, NOT "Other". */
export function inventoryAuditEventLabel(raw: string, dict: Dictionary): string {
  const key = resolveInventoryEventKey(raw);
  return key ? dict.audit.inventory.events[key] : dict.audit.unknownEvent;
}

export function inventoryAuditCategoryLabel(dict: Dictionary): string {
  return dict.audit.inventory.category;
}

/** The closed changed-field keys for inventory.updated (config only — never
 * quantity). `location` is a shelf/aisle inside the one warehouse. */
export const INVENTORY_AUDIT_FIELD_KEYS = [
  "threshold",
  "location",
  "expiry",
] as const;
export type InventoryAuditFieldKey = (typeof INVENTORY_AUDIT_FIELD_KEYS)[number];

export function isInventoryAuditFieldKey(v: unknown): v is InventoryAuditFieldKey {
  return (
    typeof v === "string" &&
    (INVENTORY_AUDIT_FIELD_KEYS as readonly string[]).includes(v)
  );
}

// ── Safe value validators (mirror the DB bounds; last line of defence) ─────

const INVENTORY_INT_MAX = 100_000_000;

/** A safe, bounded non-negative integer, or undefined. */
function safeCount(v: unknown): number | undefined {
  return typeof v === "number" &&
    Number.isInteger(v) &&
    v >= 0 &&
    v <= INVENTORY_INT_MAX
    ? v
    : undefined;
}

/** A safe bounded location label (≤40) or null. Never HTML — the renderer treats
 * it as plain text (React escapes it), and this rejects anything oversized. */
function safeLocation(v: unknown): string | null {
  if (v === null) return null;
  return typeof v === "string" && v.length > 0 && v.length <= 40 ? v : null;
}

/** A safe normalized date (YYYY-MM-DD) or null. */
function safeDate(v: unknown): string | null {
  if (v === null) return null;
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

/** A validated {from,to} pair of a given shape, or null. */
function safePair<T>(
  v: unknown,
  pick: (x: unknown) => T | null | undefined,
): { from: T | null; to: T | null } | null {
  if (!v || typeof v !== "object") return null;
  const o = v as { from?: unknown; to?: unknown };
  if (!("from" in o) || !("to" in o)) return null;
  const from = pick(o.from);
  const to = pick(o.to);
  // A pair where BOTH sides are unresolved is dropped (nothing safe to show).
  if (from === undefined && to === undefined) return null;
  return { from: (from ?? null) as T | null, to: (to ?? null) as T | null };
}

// ── Safe details renderer ──────────────────────────────────────────────────
// Renders ONLY allowlisted, validated values. An unknown event, an unexpected
// key, or a malformed value produces NO line rather than leaking anything raw.

function displayText(v: string | number | null, dict: Dictionary): string {
  return v === null || v === "" ? dict.audit.inventory.details.none : String(v);
}

/**
 * Localized, safe detail lines for one inventory audit event.
 * inventory.created → the initial quantity + threshold (safe ints).
 * inventory.updated → one line per changed configuration field, "label: from → to"
 * (the arrow direction is locale-correct via the dict template). Location is
 * rendered as plain text (never HTML).
 */
export function renderInventoryAuditDetails(
  event: { eventType: string; metadata: Record<string, unknown> },
  dict: Dictionary,
): string[] {
  const key = resolveInventoryEventKey(event.eventType);
  if (!key) return [];
  const m = event.metadata ?? {};
  const t = dict.audit.inventory.details;
  const f = dict.audit.inventory.fields;
  const out: string[] = [];

  if (key === "inventory.created") {
    const quantity = safeCount(m.quantity);
    const threshold = safeCount(m.threshold);
    if (quantity !== undefined || threshold !== undefined) {
      out.push(
        interpolate(t.created, {
          quantity: quantity === undefined ? "—" : String(quantity),
          threshold: threshold === undefined ? "—" : String(threshold),
        }),
      );
    }
    return out;
  }

  // inventory.updated — one line per changed, validated configuration field.
  const changed = Array.isArray(m.changed_fields)
    ? (m.changed_fields as unknown[]).filter(
        (x, i, arr): x is InventoryAuditFieldKey =>
          isInventoryAuditFieldKey(x) && arr.indexOf(x) === i,
      )
    : [];

  for (const field of changed) {
    let pair: { from: string | number | null; to: string | number | null } | null =
      null;
    if (field === "threshold") pair = safePair(m.threshold, safeCount);
    else if (field === "location") pair = safePair(m.location, safeLocation);
    else if (field === "expiry") pair = safePair(m.expiry, safeDate);
    if (!pair) continue;
    out.push(
      interpolate(t.change, {
        field: f[field],
        from: displayText(pair.from, dict),
        to: displayText(pair.to, dict),
      }),
    );
  }
  return out;
}

// ══ PURE DERIVATION MODEL (mock ⇄ Supabase parity) ════════════════════════
// The single source of truth for WHEN an inventory event fires and WHAT safe
// metadata it carries. The DB producer implements exactly this contract, so a
// no-op can never fabricate an event and quantity is never in inventory.updated.

export interface DerivedInventoryEvent {
  eventType: InventoryAuditEventKey;
  metadata: Record<string, unknown>;
}

/** ONE inventory.created for the first row — safe {quantity, threshold} ints. */
export function deriveInventoryCreatedEvent(input: {
  quantity: number;
  threshold: number;
}): DerivedInventoryEvent {
  return {
    eventType: "inventory.created",
    metadata: { quantity: input.quantity, threshold: input.threshold },
  };
}

/** The effective CONFIGURATION state an inventory update is judged against
 * (quantity is intentionally absent — it is never compared or recorded). */
export interface InventoryConfigSnapshot {
  threshold: number;
  location?: string | null;
  expiry?: string | null;
}

function normLoc(v: string | null | undefined): string | null {
  const t = (v ?? "").trim();
  return t === "" ? null : t;
}

/**
 * Compute the change-gated inventory.updated metadata (mirrors the SQL diff): the
 * changed CONFIGURATION field keys + safe before/after per changed field. Returns
 * null when nothing effectively changed → the producer emits NO event. quantity is
 * never considered.
 */
export function deriveInventoryUpdateEvent(
  before: InventoryConfigSnapshot,
  after: InventoryConfigSnapshot,
): DerivedInventoryEvent | null {
  const changed: InventoryAuditFieldKey[] = [];
  const meta: Record<string, unknown> = {};

  if (before.threshold !== after.threshold) {
    changed.push("threshold");
    meta.threshold = { from: before.threshold, to: after.threshold };
  }
  if (normLoc(before.location) !== normLoc(after.location)) {
    changed.push("location");
    meta.location = { from: normLoc(before.location), to: normLoc(after.location) };
  }
  if ((before.expiry ?? null) !== (after.expiry ?? null)) {
    changed.push("expiry");
    meta.expiry = { from: before.expiry ?? null, to: after.expiry ?? null };
  }

  if (changed.length === 0) return null;
  return {
    eventType: "inventory.updated",
    metadata: { changed_fields: changed, ...meta },
  };
}
