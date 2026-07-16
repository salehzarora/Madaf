/**
 * Inventory audit-event test suite (M8I.2). Exercises the PRODUCTION inventory
 * audit taxonomy + label/category/sensitivity mapping + safe details renderer +
 * the pure derivation model, plus source-level guards for the quantity-integrity /
 * transactional / server-derived / no-quantity-in-updated / owner-admin-RLS /
 * no-duplication contract. Pure + zero-env: runs in mock mode with no Supabase.
 *
 * Runner: `npm run test:inventory-audit` (tsx → node:test).
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  AUDIT_CATEGORY_INVENTORY,
  INVENTORY_AUDIT_EVENT_KEYS,
  INVENTORY_AUDIT_FIELD_KEYS,
  deriveInventoryCreatedEvent,
  deriveInventoryUpdateEvent,
  inventoryAuditCategory,
  inventoryAuditEventLabel,
  inventoryAuditSensitivity,
  isInventoryAuditEventKey,
  renderInventoryAuditDetails,
  resolveInventoryEventKey,
  type InventoryConfigSnapshot,
} from "./inventory-audit";
import { getDictionary } from "../i18n/dictionaries";

const LOCALES = ["ar", "he", "en"] as const;
const readSrc = (rel: string): string =>
  readFileSync(join(process.cwd(), "src", rel), "utf8");
const readRepo = (rel: string): string =>
  readFileSync(join(process.cwd(), rel), "utf8");
const MIGRATION = readRepo(
  "supabase/migrations/20260807100000_inventory_integrity_audit.sql",
);

function makeEvent(
  eventType: string,
  metadata: Record<string, unknown>,
): { eventType: string; metadata: Record<string, unknown> } {
  return { eventType, metadata };
}

// ── 1. Closed taxonomy: exactly the 2 inventory events ─────────────────────
test("every taxonomy key is recognized; length is the closed 2", () => {
  assert.equal(INVENTORY_AUDIT_EVENT_KEYS.length, 2);
  for (const k of INVENTORY_AUDIT_EVENT_KEYS) assert.ok(isInventoryAuditEventKey(k));
  assert.deepEqual([...INVENTORY_AUDIT_EVENT_KEYS], [
    "inventory.created",
    "inventory.updated",
  ]);
  // The removed-by-decision events do NOT exist.
  assert.equal(resolveInventoryEventKey("inventory.quantity_set"), null);
  assert.equal(resolveInventoryEventKey("inventory.adjusted"), null);
});

// ── 2. Category + sensitivity ──────────────────────────────────────────────
test("every event maps to the inventory category, low sensitivity", () => {
  assert.equal(inventoryAuditCategory(), AUDIT_CATEGORY_INVENTORY);
  assert.equal(AUDIT_CATEGORY_INVENTORY, "inventory");
  for (const k of INVENTORY_AUDIT_EVENT_KEYS) {
    assert.equal(inventoryAuditSensitivity(k), "low", k);
  }
  assert.equal(inventoryAuditSensitivity("inventory.bogus"), "medium");
});

// ── 3–5. ar/he/en labels exist + non-empty ─────────────────────────────────
for (const locale of LOCALES) {
  test(`${locale}: every event + category + field has a non-empty label`, () => {
    const dict = getDictionary(locale);
    assert.ok(dict.audit.inventory.category.length > 0);
    assert.ok(dict.audit.inventory.timelineHeading.length > 0);
    for (const k of INVENTORY_AUDIT_EVENT_KEYS) {
      assert.ok(inventoryAuditEventLabel(k, dict).length > 0, `${locale} ${k}`);
    }
    for (const f of INVENTORY_AUDIT_FIELD_KEYS) {
      assert.ok(dict.audit.inventory.fields[f].length > 0, `${locale} ${f}`);
    }
  });
}

// ── 6. No "Other"; explicit unknown fallback ───────────────────────────────
test("no label is 'Other'; unknown resolves to the explicit unknown label", () => {
  for (const locale of LOCALES) {
    const dict = getDictionary(locale);
    assert.ok(!/^other$/i.test(dict.audit.unknownEvent));
    for (const k of INVENTORY_AUDIT_EVENT_KEYS) {
      assert.ok(!/^other$/i.test(inventoryAuditEventLabel(k, dict)));
    }
  }
  const dict = getDictionary("en");
  assert.equal(inventoryAuditEventLabel("inventory.bogus", dict), dict.audit.unknownEvent);
  assert.deepEqual(renderInventoryAuditDetails(makeEvent("inventory.bogus", {}), dict), []);
});

// ── 7. inventory.created renders safe initial quantity/threshold ───────────
test("inventory.created renders the safe initial quantity + threshold", () => {
  const dict = getDictionary("en");
  const lines = renderInventoryAuditDetails(
    makeEvent("inventory.created", { quantity: 120, threshold: 10 }),
    dict,
  );
  assert.equal(lines.length, 1);
  assert.ok(lines[0].includes("120"));
  assert.ok(lines[0].includes("10"));
});

// ── 8. inventory.updated renders per-field before → after (config only) ────
test("inventory.updated renders localized per-field before → after", () => {
  const dict = getDictionary("en");
  const lines = renderInventoryAuditDetails(
    makeEvent("inventory.updated", {
      changed_fields: ["threshold", "location", "expiry"],
      threshold: { from: 10, to: 24 },
      location: { from: "A-03", to: "B-11" },
      expiry: { from: "2026-12-31", to: "2027-03-15" },
    }),
    dict,
  );
  const joined = lines.join(" | ");
  assert.ok(joined.includes(dict.audit.inventory.fields.threshold));
  assert.ok(joined.includes("10") && joined.includes("24"));
  assert.ok(joined.includes(dict.audit.inventory.fields.location));
  assert.ok(joined.includes("A-03") && joined.includes("B-11"));
  assert.ok(joined.includes(dict.audit.inventory.fields.expiry));
  assert.ok(joined.includes("2027-03-15"));
});

// ── 9. quantity is NEVER rendered for inventory.updated (even if smuggled) ─
test("inventory.updated never surfaces a quantity value, even if smuggled in", () => {
  const dict = getDictionary("en");
  const lines = renderInventoryAuditDetails(
    makeEvent("inventory.updated", {
      changed_fields: ["threshold"],
      threshold: { from: 10, to: 24 },
      // A hostile quantity key must be ignored by the renderer's allowlist.
      quantity: { from: 999, to: 7 },
      quantity_available: 7,
    }),
    dict,
  );
  const joined = lines.join(" | ");
  assert.ok(!joined.includes("999"));
  assert.ok(!joined.includes(dict.audit.inventory.fields.threshold + ": 999"));
});

// ── 10. Location rendering is bounded + treated as text (no HTML) ──────────
test("an oversized/hostile location value is dropped (not rendered)", () => {
  const dict = getDictionary("en");
  const hostile = "<script>alert(1)</script>".padEnd(60, "x"); // > 40 chars
  const lines = renderInventoryAuditDetails(
    makeEvent("inventory.updated", {
      changed_fields: ["location"],
      location: { from: "A-1", to: hostile },
    }),
    dict,
  );
  const joined = lines.join(" | ");
  // The oversized 'to' side is dropped → the pair is still shown with a safe
  // fallback for the invalid side, but the raw script string never appears.
  assert.ok(!joined.includes("<script>"));
});

// ── 11. Pure derivation: created carries safe {quantity, threshold} ────────
test("deriveInventoryCreatedEvent carries only safe ints", () => {
  const ev = deriveInventoryCreatedEvent({ quantity: 50, threshold: 5 });
  assert.equal(ev.eventType, "inventory.created");
  assert.deepEqual(ev.metadata, { quantity: 50, threshold: 5 });
});

// ── 12. Pure derivation: update is config-only, quantity excluded ──────────
const CFG: InventoryConfigSnapshot = {
  threshold: 10,
  location: "A-03",
  expiry: "2026-12-31",
};

test("deriveInventoryUpdateEvent: a real config change → one event; no-op → null", () => {
  assert.equal(deriveInventoryUpdateEvent(CFG, CFG), null);
  const ev = deriveInventoryUpdateEvent(CFG, { ...CFG, threshold: 24 });
  assert.deepEqual(ev!.metadata.changed_fields, ["threshold"]);
  assert.deepEqual(ev!.metadata.threshold, { from: 10, to: 24 });
  // never a quantity key.
  assert.ok(!("quantity" in ev!.metadata) && !("quantity_available" in ev!.metadata));
});

test("deriveInventoryUpdateEvent: multi-field change → one event, ordered keys", () => {
  const ev = deriveInventoryUpdateEvent(CFG, {
    threshold: 24,
    location: "B-11",
    expiry: "2027-01-01",
  });
  assert.deepEqual(ev!.metadata.changed_fields, ["threshold", "location", "expiry"]);
});

test("deriveInventoryUpdateEvent: an empty ⇄ null location edit is NOT a change", () => {
  const a: InventoryConfigSnapshot = { threshold: 10, location: "", expiry: null };
  const b: InventoryConfigSnapshot = { threshold: 10, location: null, expiry: null };
  assert.equal(deriveInventoryUpdateEvent(a, b), null);
});

// ── 13. Guard: actor/tenant server-derived; helper closed + revoked ────────
test("guard: server-derived actor/tenant; closed helper; per-event key allowlist", () => {
  assert.ok(/auth\.uid\(\)/.test(MIGRATION), "actor via auth.uid()");
  assert.ok(!/p_actor/.test(MIGRATION), "no client actor param");
  assert.ok(/'inventory\.created'|'inventory\.updated'/.test(MIGRATION));
  assert.ok(/unknown inventory event type/.test(MIGRATION));
  assert.ok(/metadata exceeds the size bound/.test(MIGRATION));
  assert.ok(/metadata must be a JSON object/.test(MIGRATION));
  assert.ok(/metadata key % is not allowed for/.test(MIGRATION));
  assert.ok(
    /revoke all on function public\._log_inventory_audit_event\([^)]*\)\s*from public, anon, authenticated/i.test(
      MIGRATION.replace(/\s+/g, " "),
    ),
    "helper revoked from all client roles",
  );
});

// ── 14. Guard: quantity_available is never an allowed inventory.updated key ─
test("guard: quantity_available is not an allowed key + is preserved (never overwritten)", () => {
  const oneLine = MIGRATION.replace(/\s+/g, " ");
  // The helper's inventory.updated allowlist excludes quantity.
  assert.ok(
    /'inventory.updated' then array\['changed_fields', 'threshold', 'location', 'expiry'\]/.test(
      oneLine,
    ),
    "inventory.updated allowlist is config-only",
  );
  // The existing-row UPDATE sets ONLY the config columns — quantity_available is
  // never in the SET list (it is preserved).
  assert.ok(
    /update public\.inventory_items i set low_stock_threshold = v_threshold, warehouse_location = v_location, expiry_date = v_expiry/.test(
      oneLine,
    ),
    "existing-row UPDATE preserves quantity_available (config-only SET)",
  );
  assert.ok(!(INVENTORY_AUDIT_FIELD_KEYS as readonly string[]).includes("quantity"));
});

// ── 15. Guard: locked before-capture + first-row race handling ─────────────
test("guard: FOR UPDATE lock + ON CONFLICT DO NOTHING first-row race", () => {
  const oneLine = MIGRATION.replace(/\s+/g, " ");
  assert.ok(/for update/i.test(MIGRATION), "before-capture is locked");
  assert.ok(/on conflict \(tenant_id, product_id\) do nothing/.test(oneLine), "first-row race is safe");
  // inventory.created is emitted ONLY when this tx actually inserted.
  assert.ok(/if v_id is not null then/.test(oneLine));
});

// ── 16. Guard: additive owner/admin inventory RLS; others preserved ────────
test("guard: inventory audit rows are owner/admin-only; customer/order/product preserved", () => {
  const oneLine = MIGRATION.replace(/\s+/g, " ");
  assert.ok(
    /entity_type <> 'inventory' or public\.has_tenant_role\(tenant_id, array\['owner', 'admin'\]/.test(oneLine),
    "inventory clause owner/admin only",
  );
  assert.ok(/can_access_customer\(tenant_id, entity_id\)/.test(oneLine), "customer clause preserved");
  assert.ok(/can_access_order\(tenant_id, entity_id\)/.test(oneLine), "order clause preserved");
  assert.ok(/entity_type <> 'product' or public\.has_tenant_role/.test(oneLine), "product clause preserved");
  assert.ok(/drop policy .* on public\.audit_events/i.test(oneLine));
});

// ── 17. Guard: only upsert_inventory_item is redefined ─────────────────────
test("guard: create_product/update_product/adjust_inventory_stock/order RPCs NOT redefined", () => {
  assert.ok(/create or replace function public\.upsert_inventory_item/.test(MIGRATION));
  for (const fn of [
    "create_product",
    "update_product",
    "adjust_inventory_stock",
    "update_order_status",
    "update_order_items",
  ]) {
    assert.ok(
      !new RegExp(`create or replace function public\\.${fn}\\b`).test(MIGRATION),
      `${fn} must not be redefined`,
    );
  }
});

// ── 18. Guard: the private helper is never CALLED from app (TS) code ───────
test("guard: the private audit helper is never invoked from app code", () => {
  for (const rel of [
    "lib/inventory-audit.ts",
    "lib/actions/inventory.ts",
    "lib/actions/inventory-timeline.ts",
    "lib/data/inventory.ts",
    "lib/data/inventory-timeline.ts",
  ]) {
    const src = readSrc(rel);
    assert.ok(!/\.rpc\(\s*["'`]_log_inventory_audit_event/.test(src), `${rel} must not rpc() the helper`);
    assert.ok(!/\b_log_inventory_audit_event\s*\(/.test(src), `${rel} must not call the helper`);
  }
});

// ── 19. Guard: app taxonomy matches the DB allowlist EXACTLY ───────────────
test("app taxonomy matches the DB helper allowlist EXACTLY", () => {
  for (const k of INVENTORY_AUDIT_EVENT_KEYS) {
    assert.ok(MIGRATION.includes(`'${k}'`), `DB allowlist missing ${k}`);
  }
  const dbTypes = [...MIGRATION.matchAll(/'(inventory\.[a-z_.]+)'/g)].map((m) => m[1]);
  for (const t of new Set(dbTypes)) {
    assert.ok(isInventoryAuditEventKey(t), `DB emits ${t} which is not in the app taxonomy`);
  }
});

// ── 20. Guard: no global Activity-Log route; pure module; no branch scope ──
test("guard: no global activity page; inventory-audit.ts is pure; no branch/warehouse scope", () => {
  for (const p of [
    "app/[locale]/admin/activity",
    "app/[locale]/admin/audit",
    "components/admin/activity-log.tsx",
  ]) {
    assert.ok(!existsSync(join(process.cwd(), "src", p)), `${p} must not exist`);
  }
  const importLines = readSrc("lib/inventory-audit.ts")
    .split("\n")
    .filter((l) => /^\s*import\b/.test(l));
  assert.ok(
    !importLines.some((l) => /(supabase-reads|supabase-writes|server-only|data\/)/.test(l)),
    "no server/data-layer import",
  );
  // No branch/warehouse-id scope key is ever produced.
  assert.ok(!(INVENTORY_AUDIT_FIELD_KEYS as readonly string[]).some((k) => /branch|warehouse_id/i.test(k)));
});

// ── 21. Guard: manual/order stock changes are NOT audited here ─────────────
test("guard: no audit emission from adjust_inventory_stock / order movements", () => {
  // The migration touches ONLY upsert_inventory_item — it writes NO movement
  // ledger row and adds NO producer to the manual/order paths.
  assert.ok(
    !/insert into public\.order_inventory_movements/i.test(MIGRATION),
    "no ledger writes in this migration",
  );
  assert.ok(!/order_reserved|order_reservation_released/.test(MIGRATION));
});
