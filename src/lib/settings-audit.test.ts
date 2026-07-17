/**
 * Settings/Timezone audit test suite (M8I.4). Exercises the PRODUCTION settings
 * audit taxonomy + label/category/sensitivity + safe details renderer + the
 * client-safe projection, plus source-level guards for the transactional /
 * server-derived / safe-value / keys-only-PII / shared-lock / no-op /
 * direct-write-lockdown / owner-admin-RLS contract. Pure + zero-env.
 *
 * Runner: `npm run test:settings-audit` (tsx → node:test).
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  AUDIT_CATEGORY_SETTINGS,
  SETTINGS_AUDIT_EVENT_KEYS,
  SETTINGS_FIELD_KEYS,
  SETTINGS_SAFE_FIELDS,
  isSettingsAuditEventKey,
  renderSettingsAuditDetails,
  resolveSettingsEventKey,
  settingsAuditCategory,
  settingsAuditEventLabel,
  settingsAuditSensitivity,
  settingsFieldLabel,
} from "./settings-audit";
import {
  buildSettingsTimelineEvent,
  clientSafeSettingsMetadata,
} from "./settings-timeline";
import { getDictionary } from "../i18n/dictionaries";

const LOCALES = ["ar", "he", "en"] as const;
const readSrc = (rel: string): string =>
  readFileSync(join(process.cwd(), "src", rel), "utf8");
const readRepo = (rel: string): string =>
  readFileSync(join(process.cwd(), rel), "utf8");
const MIGRATION = readRepo(
  "supabase/migrations/20260809100000_tenant_settings_audit.sql",
);
const ONE = MIGRATION.replace(/\s+/g, " ");

const ev = (eventType: string, metadata: Record<string, unknown>) => ({
  eventType,
  metadata,
});

// ── 1. Closed taxonomy: exactly the 3 settings events ──────────────────────
test("taxonomy is the closed 3; excluded event names do not resolve", () => {
  assert.equal(SETTINGS_AUDIT_EVENT_KEYS.length, 3);
  for (const k of SETTINGS_AUDIT_EVENT_KEYS) assert.ok(isSettingsAuditEventKey(k));
  assert.deepEqual([...SETTINGS_AUDIT_EVENT_KEYS], [
    "settings.business_updated",
    "settings.timezone_changed",
    "settings.tax_updated",
  ]);
  for (const gone of [
    "settings.created",
    "settings.changed",
    "settings.profile_updated",
    "settings.tax_created",
  ]) {
    assert.equal(resolveSettingsEventKey(gone), null, gone);
  }
});

// ── 2. Category + sensitivity ──────────────────────────────────────────────
test("category is settings; sensitivity business=medium, timezone=low, tax=high", () => {
  assert.equal(settingsAuditCategory(), AUDIT_CATEGORY_SETTINGS);
  assert.equal(AUDIT_CATEGORY_SETTINGS, "settings");
  assert.equal(settingsAuditSensitivity("settings.business_updated"), "medium");
  assert.equal(settingsAuditSensitivity("settings.timezone_changed"), "low");
  assert.equal(settingsAuditSensitivity("settings.tax_updated"), "high");
  assert.equal(settingsAuditSensitivity("settings.bogus"), "medium");
});

// ── 3–5. ar/he/en labels non-empty ─────────────────────────────────────────
for (const locale of LOCALES) {
  test(`${locale}: every event + category + field + detail label is non-empty`, () => {
    const dict = getDictionary(locale);
    assert.ok(dict.audit.settings.category.length > 0);
    assert.ok(dict.audit.settings.timelineHeading.length > 0);
    assert.ok(dict.audit.settings.details.change.includes("{field}"));
    assert.ok(dict.audit.settings.details.changed.includes("{fields}"));
    assert.ok(dict.audit.settings.details.notSet.length > 0);
    for (const k of SETTINGS_AUDIT_EVENT_KEYS) {
      assert.ok(settingsAuditEventLabel(k, dict).length > 0, `${locale} ${k}`);
    }
    // Every changed-field key across all events has a localized label.
    const allFields = new Set(Object.values(SETTINGS_FIELD_KEYS).flat());
    for (const f of allFields) {
      assert.ok(settingsFieldLabel(f, dict).length > 0, `${locale} ${f}`);
      assert.notEqual(settingsFieldLabel(f, dict), f, `${locale} ${f} unmapped`);
    }
  });
}

// ── 6. No "Other"; unknown fallback ────────────────────────────────────────
test("no label is 'Other'; unknown resolves to the explicit unknown label", () => {
  for (const locale of LOCALES) {
    const dict = getDictionary(locale);
    assert.ok(!/^other$/i.test(dict.audit.unknownEvent));
    for (const k of SETTINGS_AUDIT_EVENT_KEYS) {
      assert.ok(!/^other$/i.test(settingsAuditEventLabel(k, dict)));
    }
  }
  const dict = getDictionary("en");
  assert.equal(settingsAuditEventLabel("settings.bogus", dict), dict.audit.unknownEvent);
  assert.deepEqual(renderSettingsAuditDetails(ev("settings.bogus", {}), dict), []);
});

// ── 7. Details: safe transitions rendered; sensitive collapsed to labels ────
test("renderSettingsAuditDetails renders safe values + sensitive labels only", () => {
  const dict = getDictionary("en");
  // Business: display_vat_rate safe (null → 18%); name_en sensitive (label only).
  const biz = renderSettingsAuditDetails(
    ev("settings.business_updated", {
      changed_fields: ["name_en", "display_vat_rate"],
      display_vat_rate: { from: null, to: 0.18 },
    }),
    dict,
  ).join(" | ");
  assert.ok(biz.includes("18%"));
  assert.ok(biz.includes(dict.audit.settings.details.notSet));
  assert.ok(biz.includes(dict.audit.settings.fields.name_en));
  assert.ok(!/EN2|acme|@/i.test(biz)); // never a sensitive VALUE

  // Timezone: exact IANA from/to.
  const tz = renderSettingsAuditDetails(
    ev("settings.timezone_changed", {
      changed_fields: ["timezone"],
      timezone: { from: "Asia/Jerusalem", to: "Europe/London" },
    }),
    dict,
  ).join(" | ");
  assert.ok(tz.includes("Asia/Jerusalem") && tz.includes("Europe/London"));

  // Tax: invoice_language localized; legal_invoicing_ready localized; legal_name label-only.
  const tax = renderSettingsAuditDetails(
    ev("settings.tax_updated", {
      changed_fields: ["legal_name", "invoice_language", "legal_invoicing_ready"],
      invoice_language: { from: null, to: "he" },
      legal_invoicing_ready: { from: null, to: true },
    }),
    dict,
  ).join(" | ");
  assert.ok(tax.includes(dict.audit.settings.langValues.he));
  assert.ok(tax.includes(dict.audit.settings.details.ready));
  assert.ok(tax.includes(dict.audit.settings.fields.legal_name));
});

// ── 8. Client-safe projection: keys + validated safe transitions only ──────
test("clientSafeSettingsMetadata keeps only allowlisted keys + valid safe transitions", () => {
  // A hostile payload: sensitive value object + token + unknown field.
  const out = clientSafeSettingsMetadata("settings.business_updated", {
    changed_fields: ["name_en", "email", "display_vat_rate", "bogus_field"],
    display_vat_rate: { from: null, to: 0.18 },
    email: { from: "a@x.local", to: "b@x.local" }, // sensitive → dropped
    token: "secret", // unknown → dropped
  });
  assert.deepEqual(out.changed_fields, ["name_en", "email", "display_vat_rate"]);
  assert.deepEqual(out.display_vat_rate, { from: null, to: 0.18 });
  assert.ok(!("email" in out) && !("token" in out) && !("bogus_field" in out));
  assert.ok(!JSON.stringify(out).includes("@x.local"));

  // A malformed safe value is dropped but the key stays in changed_fields.
  const bad = clientSafeSettingsMetadata("settings.business_updated", {
    changed_fields: ["display_vat_rate"],
    display_vat_rate: { from: 0, to: "eighteen" },
  });
  assert.deepEqual(bad.changed_fields, ["display_vat_rate"]);
  assert.ok(!("display_vat_rate" in bad));

  // Unknown event type → {}.
  assert.deepEqual(clientSafeSettingsMetadata("settings.bogus", { changed_fields: ["x"] }), {});
});

// ── 9. buildSettingsTimelineEvent: safe row + derived sensitivity ──────────
test("buildSettingsTimelineEvent yields a safe row (no sensitive values)", () => {
  const built = buildSettingsTimelineEvent({
    id: "9",
    eventType: "settings.tax_updated",
    createdAt: "2026-07-11T12:00:00Z",
    actor: { kind: "unknown" },
    metadata: {
      changed_fields: ["legal_name", "default_vat_rate"],
      default_vat_rate: { from: 0.17, to: 0.18 },
      legal_name: { from: "Secret Ltd", to: "Other Ltd" },
    },
  });
  assert.equal(built.category, "settings");
  assert.equal(built.sensitivity, "high");
  assert.deepEqual(built.metadata.changed_fields, ["legal_name", "default_vat_rate"]);
  assert.ok(!("legal_name" in built.metadata));
  assert.ok(!JSON.stringify(built).includes("Secret Ltd"));
});

// ── 10. Guard: closed helper; server-derived; strict metadata; team entity ─
test("guard: closed helper; entity_type=settings; entity_id=tenant; strict validation", () => {
  assert.ok(/auth\.uid\(\)/.test(MIGRATION), "actor via auth.uid()");
  assert.ok(!/p_actor/.test(MIGRATION), "no client actor param");
  for (const k of SETTINGS_AUDIT_EVENT_KEYS) {
    assert.ok(MIGRATION.includes(`'${k}'`), `DB allowlist missing ${k}`);
  }
  assert.ok(/p_event_type, 'settings', p_entity_id, v_meta/.test(ONE), "entity_type hardcoded to settings");
  assert.ok(/entity id must equal the tenant id/.test(MIGRATION), "entity_id must equal tenant_id");
  assert.ok(/changed_fields must be in canonical allowlist order/.test(MIGRATION));
  assert.ok(/timezone changed_fields must be exactly \[timezone\]/.test(MIGRATION));
  assert.ok(/metadata must be a JSON object/.test(MIGRATION));
  assert.ok(/metadata exceeds the size bound/.test(MIGRATION));
  assert.ok(/is not an allowed safe transition for/.test(MIGRATION));
  assert.ok(/from and to must differ/.test(MIGRATION));
  assert.ok(
    /revoke all on function public\._log_settings_audit_event\([^)]*\)\s*from public, anon, authenticated/i.test(ONE),
    "helper revoked from all client roles",
  );
});

// ── 11. Guard: app taxonomy matches the DB allowlist EXACTLY ───────────────
test("app taxonomy matches the DB helper allowlist EXACTLY", () => {
  const dbTypes = [...MIGRATION.matchAll(/'(settings\.[a-z_]+)'/g)].map((m) => m[1]);
  for (const t of new Set(dbTypes)) {
    assert.ok(isSettingsAuditEventKey(t), `DB emits ${t} which is not in the app taxonomy`);
  }
  // The safe-field list mirrors the DB helper's v_safe.
  assert.deepEqual([...SETTINGS_SAFE_FIELDS].sort(), [
    "country_code", "default_vat_rate", "display_vat_rate",
    "invoice_language", "legal_invoicing_ready", "timezone",
  ]);
});

// ── 12. Guard: shared tenants-row lock + no-op gate + canonical diff ───────
test("guard: all three RPCs lock the tenant row; no-op gates return the row", () => {
  const locks = [...ONE.matchAll(/public\.tenants where id = v_tenant for update/g)].length;
  assert.ok(locks >= 3, `expected >=3 shared tenant-row locks, got ${locks}`);
  assert.ok(/if array_length\(v_changed, 1\) is null then return next v_old/.test(ONE), "business/tax no-op returns the row");
  assert.ok(/if v_old is not distinct from v_tz then return v_old/.test(ONE), "timezone no-op returns the value");
  assert.ok(/is distinct from/.test(MIGRATION), "canonical null-safe diff");
});

// ── 13. Guard: direct tenants UPDATE lockdown ──────────────────────────────
test("guard: direct authenticated tenants UPDATE is locked down", () => {
  assert.ok(/revoke update on public\.tenants from authenticated/.test(ONE), "UPDATE grant revoked");
  assert.ok(
    /drop policy if exists "tenants: owners\/admins can update their tenant" on public\.tenants/.test(ONE),
    "the UPDATE policy is dropped",
  );
});

// ── 14. Guard: additive settings RLS + partial index; others preserved ─────
test("guard: settings RLS clause owner/admin; customer/order/product/inventory/team preserved", () => {
  assert.ok(/entity_type <> 'settings' or public\.has_tenant_role\(tenant_id, array\['owner', 'admin'\]/.test(ONE));
  for (const e of ["customer", "order", "product", "inventory", "team"]) {
    assert.ok(new RegExp(`entity_type <> '${e}'`).test(ONE), `${e} clause preserved`);
  }
  assert.ok(/create policy "audit_events: members read; entity rows scoped"/.test(MIGRATION));
  assert.ok(
    /create index audit_events_tenant_settings_time_idx on public\.audit_events \(tenant_id, created_at desc, id desc\) where entity_type = 'settings'/.test(ONE),
    "partial settings index present",
  );
});

// ── 15. Guard: the three RPCs are redefined with unchanged signatures ──────
test("guard: the three settings RPCs are redefined (signatures preserved)", () => {
  assert.ok(/create or replace function public\.update_tenant_profile\( p_tenant_id uuid, p_name_ar text, p_name_he text, p_name_en text, p_phone text default null, p_email text default null, p_address_ar text default null, p_address_he text default null, p_address_en text default null, p_legal_name text default null, p_company_id text default null, p_display_vat_rate numeric default null, p_logo_url text default null \)/.test(ONE));
  assert.ok(/create or replace function public\.update_tenant_timezone\( p_tenant_id uuid, p_timezone text \)/.test(ONE));
  assert.ok(/create or replace function public\.upsert_tenant_tax_settings\(/.test(ONE));
});

// ── 16. Guard: the helper is never CALLED from app (TS) code ───────────────
test("guard: the private audit helper is never invoked from app code", () => {
  for (const rel of [
    "lib/settings-audit.ts",
    "lib/settings-timeline.ts",
    "lib/actions/settings-timeline.ts",
    "lib/data/settings-timeline.ts",
  ]) {
    const src = readSrc(rel);
    assert.ok(!/\.rpc\(\s*["'`]_log_settings_audit_event/.test(src), `${rel} must not rpc() the helper`);
    assert.ok(!/\b_log_settings_audit_event\s*\(/.test(src), `${rel} must not call the helper`);
  }
});

// ── 17. Guard: no global Activity page; pure module ────────────────────────
test("guard: no global activity page; settings-audit.ts is pure", () => {
  for (const p of [
    "app/[locale]/admin/activity",
    "app/[locale]/admin/audit",
    "components/admin/activity-log.tsx",
  ]) {
    assert.ok(!existsSync(join(process.cwd(), "src", p)), `${p} must not exist`);
  }
  const importLines = readSrc("lib/settings-audit.ts")
    .split("\n")
    .filter((l) => /^\s*import\b/.test(l));
  assert.ok(
    !importLines.some((l) => /(supabase-reads|supabase-writes|server-only|data\/)/.test(l)),
    "no server/data-layer import",
  );
});
