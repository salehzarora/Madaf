/**
 * Settings/Timezone audit-event taxonomy + safe render/label contract (M8I.4).
 *
 * The app-layer companion to the transactional producers in migration
 * 20260809100000 (`_log_settings_audit_event`, emitted only from the three
 * settings RPCs): a CLOSED three-event vocabulary, its category + sensitivity,
 * localized labels, and a PII-safe details renderer that shows FULL before/after
 * only for approved safe scalars/enums + the timezone, and renders every sensitive
 * field (business/legal names, identifiers, contact/address, free-text, logo) as a
 * changed-field label ONLY — never its value.
 *
 * SCOPE. Tenant-shared settings only:
 *   settings.business_updated — update_tenant_profile changed a field.
 *   settings.timezone_changed — update_tenant_timezone changed the IANA zone.
 *   settings.tax_updated      — upsert_tenant_tax_settings created/changed the row.
 *
 * SAFETY. No event carries a sensitive value; the DB helper's allowlist + this
 * module's projection both keep only changed_fields + the approved safe {from,to}.
 * Timezone renders the stored IANA identifiers verbatim (bidi-safe), never offsets.
 *
 * Pure + serializable: no server-only imports, no `window`. Unit-tested directly.
 */
import type { Dictionary } from "@/i18n/types";
import { interpolate } from "@/i18n/dictionaries";
import type { AuditSensitivity } from "@/lib/audit-events";

/** The closed set of Settings audit event types (mirrors the DB allowlist). */
export const SETTINGS_AUDIT_EVENT_KEYS = [
  "settings.business_updated",
  "settings.timezone_changed",
  "settings.tax_updated",
] as const;
export type SettingsAuditEventKey = (typeof SETTINGS_AUDIT_EVENT_KEYS)[number];

export function isSettingsAuditEventKey(v: unknown): v is SettingsAuditEventKey {
  return (
    typeof v === "string" &&
    (SETTINGS_AUDIT_EVENT_KEYS as readonly string[]).includes(v)
  );
}

export function resolveSettingsEventKey(raw: string): SettingsAuditEventKey | null {
  return isSettingsAuditEventKey(raw) ? raw : null;
}

/** Entity-aligned audit category for this phase. */
export const AUDIT_CATEGORY_SETTINGS = "settings" as const;
export type SettingsAuditCategory = typeof AUDIT_CATEGORY_SETTINGS;

export function settingsAuditCategory(): SettingsAuditCategory {
  return AUDIT_CATEGORY_SETTINGS;
}

/** Per-event changed-field allowlist (mirrors the DB helper EXACTLY). */
export const SETTINGS_FIELD_KEYS: Record<SettingsAuditEventKey, readonly string[]> = {
  "settings.business_updated": [
    "name_ar", "name_he", "name_en", "phone", "email", "address_ar", "address_he",
    "address_en", "legal_name", "company_id", "display_vat_rate", "logo_url",
  ],
  "settings.timezone_changed": ["timezone"],
  "settings.tax_updated": [
    "legal_name", "business_registration_number", "vat_registration_number",
    "vat_registration_type", "country_code", "default_vat_rate", "invoice_language",
    "street", "city", "postal_code", "country", "contact_email", "contact_phone",
    "legal_invoicing_ready", "readiness_notes",
  ],
};

/** The fields whose FULL before/after value is safe to display (mirrors the DB). */
export const SETTINGS_SAFE_FIELDS = [
  "display_vat_rate",
  "country_code",
  "default_vat_rate",
  "invoice_language",
  "legal_invoicing_ready",
  "timezone",
] as const;
export type SettingsSafeField = (typeof SETTINGS_SAFE_FIELDS)[number];

export function isSettingsSafeField(v: unknown): v is SettingsSafeField {
  return (
    typeof v === "string" && (SETTINGS_SAFE_FIELDS as readonly string[]).includes(v)
  );
}

export function isSettingsFieldKey(event: string, field: unknown): boolean {
  const key = resolveSettingsEventKey(event);
  return (
    key != null &&
    typeof field === "string" &&
    SETTINGS_FIELD_KEYS[key].includes(field)
  );
}

/** Sensitivity per event (owner/admin-only viewers): timezone low; business
 * medium; tax high (legal/tax identity). Unknown → medium (never under-classified). */
const SENSITIVITY: Record<SettingsAuditEventKey, AuditSensitivity> = {
  "settings.business_updated": "medium",
  "settings.timezone_changed": "low",
  "settings.tax_updated": "high",
};

export function settingsAuditSensitivity(raw: string): AuditSensitivity {
  const key = resolveSettingsEventKey(raw);
  return key ? SENSITIVITY[key] : "medium";
}

export function settingsAuditEventLabel(raw: string, dict: Dictionary): string {
  const key = resolveSettingsEventKey(raw);
  return key ? dict.audit.settings.events[key] : dict.audit.unknownEvent;
}

export function settingsAuditCategoryLabel(dict: Dictionary): string {
  return dict.audit.settings.category;
}

// ── Safe value helpers ──────────────────────────────────────────────────────

/** Localized label for a settings field key, or the raw key if unmapped (never a
 * DB column name reaches the UI when the dictionary is complete). */
export function settingsFieldLabel(field: string, dict: Dictionary): string {
  const labels = dict.audit.settings.fields as Record<string, string>;
  return labels[field] ?? field;
}

/** Render one safe value for display (localized). null → "not set"; a rate →
 * percentage; invoice_language → localized language; legal_invoicing_ready →
 * localized ready/not-ready; timezone/country_code → the stored string. */
function renderSafeValue(
  field: SettingsSafeField,
  value: unknown,
  dict: Dictionary,
): string {
  const d = dict.audit.settings.details;
  if (value === null || value === undefined) return d.notSet;
  if (field === "display_vat_rate" || field === "default_vat_rate") {
    if (typeof value !== "number" || !Number.isFinite(value)) return d.notSet;
    return `${Math.round(value * 10000) / 100}%`;
  }
  if (field === "legal_invoicing_ready") {
    return value === true ? d.ready : d.notReady;
  }
  if (field === "invoice_language") {
    const langs = dict.audit.settings.langValues as Record<string, string>;
    return typeof value === "string" ? langs[value] ?? value : d.notSet;
  }
  // timezone + country_code: the stored string verbatim.
  return typeof value === "string" && value.length > 0 ? value : d.notSet;
}

// ── Safe details renderer ───────────────────────────────────────────────────
// Safe fields render "label: from → to"; sensitive changed fields are collapsed
// into one "Changed: a, b" line (label ONLY, never a value). An unknown event or a
// malformed value produces no line rather than leaking anything raw.

export function renderSettingsAuditDetails(
  event: { eventType: string; metadata: Record<string, unknown> },
  dict: Dictionary,
): string[] {
  const key = resolveSettingsEventKey(event.eventType);
  if (!key) return [];
  const m = event.metadata ?? {};
  const t = dict.audit.settings.details;
  const changed = Array.isArray(m.changed_fields)
    ? (m.changed_fields as unknown[]).filter(
        (f, i, arr): f is string =>
          typeof f === "string" &&
          SETTINGS_FIELD_KEYS[key].includes(f) &&
          arr.indexOf(f) === i,
      )
    : [];
  if (changed.length === 0) return [];

  const out: string[] = [];
  const sensitiveLabels: string[] = [];

  for (const field of changed) {
    if (isSettingsSafeField(field) && m[field] && typeof m[field] === "object") {
      const pair = m[field] as { from?: unknown; to?: unknown };
      out.push(
        interpolate(t.change, {
          field: settingsFieldLabel(field, dict),
          from: renderSafeValue(field, pair.from, dict),
          to: renderSafeValue(field, pair.to, dict),
        }),
      );
    } else {
      sensitiveLabels.push(settingsFieldLabel(field, dict));
    }
  }

  if (sensitiveLabels.length > 0) {
    out.push(interpolate(t.changed, { fields: sensitiveLabels.join("، ") }));
  }
  return out;
}
