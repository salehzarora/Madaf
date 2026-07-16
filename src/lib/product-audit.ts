/**
 * Product audit-event taxonomy + safe render/label contract (M8I.1).
 *
 * The app-layer companion to the transactional producers in migration
 * 20260806100000: a CLOSED product event vocabulary, its derived category +
 * sensitivity, localized labels, a PII-safe details renderer, and the PURE
 * derivation model that mock and Supabase BOTH obey (so a no-op can never
 * fabricate an event in either mode, and the changed-field derivation stays in
 * lock-step with the SQL).
 *
 * The read-only Product Timeline (same phase) consumes THIS module. An
 * unrecognized event type maps to the explicit shared "unknown event" label,
 * NEVER a silent "Other".
 *
 * SAFETY: no event ever carries a product name, localized name/description,
 * price, VAT, SKU, barcode, image url, storage path, token, raw row or raw JSON.
 * `product.updated` carries only the changed-field KEY array; the lifecycle
 * events carry only the safe {before_active, after_active} booleans. The DB
 * helper enforces the same per-event key allowlist on WRITE; this module renders
 * only what that allowlist permits.
 *
 * Category and sensitivity are DERIVED from the event type here (the DB stores
 * only event_type) — there is no per-row category/sensitivity column.
 *
 * Pure + serializable: no server-only imports, no `window`. Unit-tested directly.
 */
import type { Dictionary } from "@/i18n/types";
import { interpolate } from "@/i18n/dictionaries";
import type { AuditSensitivity } from "@/lib/audit-events";

/** The closed set of Product-lifecycle audit event types (mirrors the DB
 * `_log_product_audit_event` allowlist EXACTLY). */
export const PRODUCT_AUDIT_EVENT_KEYS = [
  "product.created",
  "product.updated",
  "product.activated",
  "product.deactivated",
] as const;
export type ProductAuditEventKey = (typeof PRODUCT_AUDIT_EVENT_KEYS)[number];

export function isProductAuditEventKey(v: unknown): v is ProductAuditEventKey {
  return (
    typeof v === "string" &&
    (PRODUCT_AUDIT_EVENT_KEYS as readonly string[]).includes(v)
  );
}

/** Resolve a raw event_type to a known key, or null (explicit unknown — NEVER
 * silently "Other"). */
export function resolveProductEventKey(raw: string): ProductAuditEventKey | null {
  return isProductAuditEventKey(raw) ? raw : null;
}

/** Entity-aligned audit category for this phase. */
export const AUDIT_CATEGORY_PRODUCT = "product" as const;
export type ProductAuditCategory = typeof AUDIT_CATEGORY_PRODUCT;

export function productAuditCategory(): ProductAuditCategory {
  return AUDIT_CATEGORY_PRODUCT;
}

/**
 * Sensitivity per event — every product event is `low`: none carries PII, a
 * price, or a value of any kind (only field KEYS + safe booleans). Never `high`.
 * An unknown type is treated as `medium` (never under-classified) rather than
 * dropped, matching the customer/order contracts.
 */
const PRODUCT_SENSITIVITY: Record<ProductAuditEventKey, AuditSensitivity> = {
  "product.created": "low",
  "product.updated": "low",
  "product.activated": "low",
  "product.deactivated": "low",
};

export function productAuditSensitivity(raw: string): AuditSensitivity {
  const key = resolveProductEventKey(raw);
  return key ? PRODUCT_SENSITIVITY[key] : "medium";
}

/** Localized event label. An unrecognized type gets the explicit shared
 * unknown-event label, NOT "Other". */
export function productAuditEventLabel(raw: string, dict: Dictionary): string {
  const key = resolveProductEventKey(raw);
  return key ? dict.audit.product.events[key] : dict.audit.unknownEvent;
}

export function productAuditCategoryLabel(dict: Dictionary): string {
  return dict.audit.product.category;
}

// ── Safe value allowlist (mirrors the DB helper + the change diff exactly) ──

/** The `changed_fields` allowlist for product.updated (NEVER the values). The
 * localized name columns collapse to `name`; the package tuple to `package`;
 * image_url to `image`. is_active is deliberately ABSENT — it is a distinct
 * lifecycle event, never a changed field. */
export const PRODUCT_AUDIT_FIELD_KEYS = [
  "name",
  "description",
  "sku",
  "barcode",
  "manufacturer",
  "category",
  "package",
  "unit_size",
  "wholesale_price",
  "vat_rate",
  "track_expiry",
  "image",
] as const;
export type ProductAuditFieldKey = (typeof PRODUCT_AUDIT_FIELD_KEYS)[number];

export function isProductAuditFieldKey(v: unknown): v is ProductAuditFieldKey {
  return (
    typeof v === "string" &&
    (PRODUCT_AUDIT_FIELD_KEYS as readonly string[]).includes(v)
  );
}

// ── Safe details renderer ──────────────────────────────────────────────────
// Renders ONLY allowlisted, validated values. An unknown event, an unexpected
// key, or a malformed value produces NO line rather than leaking anything raw.

/**
 * Localized, PII-safe detail lines for one product audit event. The lifecycle
 * events (created / activated / deactivated) carry the whole story in their
 * label, so they add no line; product.updated lists the localized labels of the
 * changed field KEYS (never the values). A malformed changed_fields yields no
 * line rather than a raw dump.
 */
export function renderProductAuditDetails(
  event: { eventType: string; metadata: Record<string, unknown> },
  dict: Dictionary,
): string[] {
  const key = resolveProductEventKey(event.eventType);
  if (!key) return [];
  if (key !== "product.updated") return [];

  const m = event.metadata ?? {};
  const fields = Array.isArray(m.changed_fields)
    ? (m.changed_fields as unknown[]).filter(
        (f, i, arr): f is ProductAuditFieldKey =>
          isProductAuditFieldKey(f) && arr.indexOf(f) === i,
      )
    : [];
  if (fields.length === 0) return [];
  return [
    interpolate(dict.audit.product.details.changed, {
      fields: fields.map((f) => dict.audit.product.fields[f]).join(", "),
    }),
  ];
}

// ══ PURE DERIVATION MODEL (mock ⇄ Supabase parity) ════════════════════════
// The single source of truth for WHEN a product event fires and WHAT safe
// metadata it carries. The DB producers implement exactly this contract, so a
// no-op can never fabricate an event in either mode, and the changed-field
// derivation cannot drift from the SQL.

export interface DerivedProductEvent {
  eventType: ProductAuditEventKey;
  metadata: Record<string, unknown>;
}

/** ONE product.created per successfully created product (safe empty metadata —
 * no name/price/sku/image is ever recorded). */
export function deriveProductCreatedEvent(): DerivedProductEvent {
  return { eventType: "product.created", metadata: {} };
}

/** The authoritative before/after state a product edit is judged against — the
 * ORDINARY (non-active) fields only. is_active lives in {@link deriveProductActivationEvent}. */
export interface ProductAuditSnapshot {
  nameAr: string;
  nameHe: string;
  nameEn: string;
  /** The EFFECTIVE localized descriptions (an omitted-on-update field is modeled
   * by passing the same value on both sides — the SQL preserves it, so it is not a
   * change). The VALUE is never recorded — only the logical `description` key. */
  descriptionAr?: string | null;
  descriptionHe?: string | null;
  descriptionEn?: string | null;
  sku?: string | null;
  barcode?: string | null;
  manufacturerId?: string | null;
  categoryId?: string | null;
  packageUnit: string;
  packageQuantity: number;
  baseUnit: string;
  unitSize?: string | null;
  wholesalePrice: number;
  vatRate: number;
  trackExpiry: boolean;
  /** The effective image reference. Compared for change only — the URL/path VALUE
   * is never recorded (only the logical `image` key). */
  imageUrl?: string | null;
}

/** Normalize an optional text field the way the SQL producers do (trim + empty →
 * null), so a "" ⇄ null edit is correctly seen as no change. */
function norm(v: string | null | undefined): string | null {
  const t = (v ?? "").trim();
  return t === "" ? null : t;
}

/**
 * Compute the change-gated product.updated metadata (mirrors the SQL diff): the
 * list of changed ORDINARY field KEYS. Localized name columns collapse to `name`;
 * the package tuple to `package`; image_url to `image`. Returns null when no
 * ordinary field effectively changed → the producer emits NO product.updated.
 * is_active is NOT considered here (see deriveProductActivationEvent).
 */
export function deriveProductUpdateEvent(
  before: ProductAuditSnapshot,
  after: ProductAuditSnapshot,
): DerivedProductEvent | null {
  const changed: ProductAuditFieldKey[] = [];
  if (
    norm(before.nameAr) !== norm(after.nameAr) ||
    norm(before.nameHe) !== norm(after.nameHe) ||
    norm(before.nameEn) !== norm(after.nameEn)
  )
    changed.push("name");
  // Localized descriptions collapse to the single logical key. An omitted-on-update
  // description is modeled as an unchanged value on both sides (the SQL preserves
  // it), so it never registers as a change; the text itself is never recorded.
  if (
    norm(before.descriptionAr) !== norm(after.descriptionAr) ||
    norm(before.descriptionHe) !== norm(after.descriptionHe) ||
    norm(before.descriptionEn) !== norm(after.descriptionEn)
  )
    changed.push("description");
  if (norm(before.sku) !== norm(after.sku)) changed.push("sku");
  if (norm(before.barcode) !== norm(after.barcode)) changed.push("barcode");
  if (norm(before.manufacturerId) !== norm(after.manufacturerId))
    changed.push("manufacturer");
  if (norm(before.categoryId) !== norm(after.categoryId))
    changed.push("category");
  if (
    before.packageUnit !== after.packageUnit ||
    before.packageQuantity !== after.packageQuantity ||
    before.baseUnit !== after.baseUnit
  )
    changed.push("package");
  if (norm(before.unitSize) !== norm(after.unitSize)) changed.push("unit_size");
  if (before.wholesalePrice !== after.wholesalePrice)
    changed.push("wholesale_price");
  if (before.vatRate !== after.vatRate) changed.push("vat_rate");
  if (before.trackExpiry !== after.trackExpiry) changed.push("track_expiry");
  // A changed image reference → the logical `image` key (mirrors the SQL, which
  // already diffs image_url). The URL/path VALUE is never recorded.
  if (norm(before.imageUrl) !== norm(after.imageUrl)) changed.push("image");

  if (changed.length === 0) return null;
  return {
    eventType: "product.updated",
    metadata: { changed_fields: changed },
  };
}

/**
 * The lifecycle event for an is_active transition (mirrors set_product_active and
 * the is_active branch of update_product): activated / deactivated, or null when
 * the state is unchanged (no event). Recorded as a first-class event — is_active
 * is NEVER a changed_fields key.
 */
export function deriveProductActivationEvent(
  before: boolean,
  after: boolean,
): DerivedProductEvent | null {
  if (before === after) return null;
  return {
    eventType: after ? "product.activated" : "product.deactivated",
    metadata: { before_active: before, after_active: after },
  };
}
