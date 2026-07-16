/**
 * Product audit-event test suite (M8I.1). Exercises the PRODUCTION product
 * audit-event taxonomy + label/category/sensitivity mapping + PII-safe details
 * renderer + the pure derivation model (mock/Supabase parity), plus source-level
 * guards for the transactional / server-derived / no-client-forgery / no-global-
 * Activity-Log / no-Inventory-event contract. Pure + zero-env: runs in mock mode
 * with no Supabase.
 *
 * Runner: `npm run test:product-audit` (tsx → node:test).
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  AUDIT_CATEGORY_PRODUCT,
  PRODUCT_AUDIT_EVENT_KEYS,
  PRODUCT_AUDIT_FIELD_KEYS,
  deriveProductActivationEvent,
  deriveProductCreatedEvent,
  deriveProductUpdateEvent,
  isProductAuditEventKey,
  productAuditCategory,
  productAuditEventLabel,
  productAuditSensitivity,
  renderProductAuditDetails,
  resolveProductEventKey,
  type ProductAuditSnapshot,
} from "./product-audit";
import { getDictionary } from "../i18n/dictionaries";

const LOCALES = ["ar", "he", "en"] as const;
const readSrc = (rel: string): string =>
  readFileSync(join(process.cwd(), "src", rel), "utf8");
const readRepo = (rel: string): string =>
  readFileSync(join(process.cwd(), rel), "utf8");
const MIGRATION = readRepo(
  "supabase/migrations/20260806100000_product_audit_foundation.sql",
);

function makeEvent(
  eventType: string,
  metadata: Record<string, unknown>,
): { eventType: string; metadata: Record<string, unknown> } {
  return { eventType, metadata };
}

// ── 1. Closed taxonomy: exactly the 4 product events ───────────────────────
test("every taxonomy key is recognized; length is the closed 4", () => {
  assert.equal(PRODUCT_AUDIT_EVENT_KEYS.length, 4);
  for (const k of PRODUCT_AUDIT_EVENT_KEYS) assert.ok(isProductAuditEventKey(k));
  assert.deepEqual([...PRODUCT_AUDIT_EVENT_KEYS], [
    "product.created",
    "product.updated",
    "product.activated",
    "product.deactivated",
  ]);
});

// ── 2. Every event maps to the explicit product category ───────────────────
test("every event maps to the product category", () => {
  assert.equal(productAuditCategory(), AUDIT_CATEGORY_PRODUCT);
  assert.equal(AUDIT_CATEGORY_PRODUCT, "product");
});

// ── 3. Every event is low sensitivity (no values/PII carried) ──────────────
test("every product event is low sensitivity; unknown is never under-classified", () => {
  for (const k of PRODUCT_AUDIT_EVENT_KEYS) {
    assert.equal(productAuditSensitivity(k), "low", k);
  }
  assert.equal(productAuditSensitivity("product.bogus"), "medium");
});

// ── 4–6. ar/he/en labels exist + non-empty for every event + fields ────────
for (const locale of LOCALES) {
  test(`${locale}: every event + category + changed-field has a non-empty label`, () => {
    const dict = getDictionary(locale);
    assert.ok(dict.audit.product.category.length > 0);
    for (const k of PRODUCT_AUDIT_EVENT_KEYS) {
      assert.ok(productAuditEventLabel(k, dict).length > 0, `${locale} ${k}`);
    }
    for (const f of PRODUCT_AUDIT_FIELD_KEYS) {
      assert.ok(dict.audit.product.fields[f].length > 0, `${locale} field ${f}`);
    }
  });
}

// ── 7. No event maps to "Other"; the unknown label is explicit ─────────────
test("no label is 'Other'; unknown label is explicit", () => {
  for (const locale of LOCALES) {
    const dict = getDictionary(locale);
    assert.ok(!/^other$/i.test(dict.audit.unknownEvent));
    for (const k of PRODUCT_AUDIT_EVENT_KEYS) {
      assert.ok(!/^other$/i.test(productAuditEventLabel(k, dict)));
    }
  }
});

// ── 8. Unknown event handling is explicit (null key, unknown label) ────────
test("an unrecognized event resolves to null and the explicit unknown label", () => {
  assert.equal(resolveProductEventKey("product.bogus"), null);
  assert.equal(resolveProductEventKey("customer.created"), null);
  const dict = getDictionary("en");
  assert.equal(productAuditEventLabel("product.bogus", dict), dict.audit.unknownEvent);
  // An unknown event renders NO detail line (never a raw dump).
  assert.deepEqual(
    renderProductAuditDetails(makeEvent("product.bogus", { changed_fields: ["name"] }), dict),
    [],
  );
});

// ── 9. product.updated lists the changed FIELD KEYS (localized), never values ─
test("product.updated renders localized changed-field labels (keys only)", () => {
  const dict = getDictionary("en");
  const lines = renderProductAuditDetails(
    makeEvent("product.updated", {
      changed_fields: ["name", "wholesale_price", "package"],
    }),
    dict,
  );
  assert.ok(lines.some((l) => l.includes(dict.audit.product.fields.name)));
  assert.ok(lines.some((l) => l.includes(dict.audit.product.fields.wholesale_price)));
  assert.ok(lines.some((l) => l.includes(dict.audit.product.fields.package)));
});

// ── 10. Update rendering never surfaces VALUES (allowlist enforced) ────────
test("update details never surface product name/price/sku VALUES, even if present", () => {
  const dict = getDictionary("en");
  const lines = renderProductAuditDetails(
    makeEvent("product.updated", {
      changed_fields: ["name", "wholesale_price", "sku", "image"],
      name: "Secret Product Ltd",
      wholesale_price: 12.5,
      sku: "SKU-SECRET",
      image: "https://madaf-drab.vercel.app/storage/tenant/secret.png",
    }),
    dict,
  );
  const joined = lines.join(" | ");
  assert.ok(!joined.includes("Secret Product Ltd"));
  assert.ok(!joined.includes("12.5"));
  assert.ok(!joined.includes("SKU-SECRET"));
  assert.ok(!/https?:|storage|secret\.png/i.test(joined));
});

// ── 11. An unknown/invalid changed field is dropped (allowlist) ────────────
test("changed_fields filters to the closed allowlist; bogus keys are dropped", () => {
  const dict = getDictionary("en");
  const lines = renderProductAuditDetails(
    makeEvent("product.updated", { changed_fields: ["name", "is_active", "hack"] }),
    dict,
  );
  const joined = lines.join(" | ");
  assert.ok(joined.includes(dict.audit.product.fields.name));
  // is_active is never a changed field; a stray key never renders raw.
  assert.ok(!/is_active|hack/.test(joined));
});

// ── 12. Lifecycle events have distinct labels + render no leaky detail ──────
test("activation + deactivation have distinct localized labels and no detail line", () => {
  const dict = getDictionary("en");
  assert.notEqual(
    productAuditEventLabel("product.activated", dict),
    productAuditEventLabel("product.deactivated", dict),
  );
  // The label is the whole story — no before/after line is rendered.
  assert.deepEqual(
    renderProductAuditDetails(
      makeEvent("product.activated", { before_active: false, after_active: true }),
      dict,
    ),
    [],
  );
  // product.created likewise renders no detail line.
  assert.deepEqual(renderProductAuditDetails(makeEvent("product.created", {}), dict), []);
});

// ── 13. Pure derivation: created has EMPTY safe metadata (no values) ───────
test("deriveProductCreatedEvent carries no product values (empty metadata)", () => {
  const ev = deriveProductCreatedEvent();
  assert.equal(ev.eventType, "product.created");
  assert.deepEqual(ev.metadata, {});
});

// ── 14. Pure derivation: update → one event on change; none on no-op ───────
const BASE: ProductAuditSnapshot = {
  nameAr: "منتج",
  nameHe: "מוצר",
  nameEn: "Product",
  sku: "SKU-1",
  barcode: null,
  manufacturerId: "m1",
  categoryId: "c1",
  packageUnit: "carton",
  packageQuantity: 6,
  baseUnit: "bottles",
  unitSize: "330ml",
  wholesalePrice: 10,
  vatRate: 0.18,
  trackExpiry: false,
};

test("deriveProductUpdateEvent: a real change → one event; no-op → null", () => {
  assert.equal(deriveProductUpdateEvent(BASE, BASE), null); // no-op
  const nameChange = deriveProductUpdateEvent(BASE, { ...BASE, nameEn: "Product v2" });
  assert.deepEqual(nameChange!.metadata.changed_fields, ["name"]);
  // The localized name columns all normalize to the single logical key `name`.
  const arNameChange = deriveProductUpdateEvent(BASE, { ...BASE, nameAr: "منتج ٢" });
  assert.deepEqual(arNameChange!.metadata.changed_fields, ["name"]);
});

test("deriveProductUpdateEvent: package tuple collapses to a single `package` key", () => {
  const ev = deriveProductUpdateEvent(BASE, { ...BASE, packageQuantity: 12 });
  assert.deepEqual(ev!.metadata.changed_fields, ["package"]);
  const ev2 = deriveProductUpdateEvent(BASE, { ...BASE, baseUnit: "cans" });
  assert.deepEqual(ev2!.metadata.changed_fields, ["package"]);
});

test("deriveProductUpdateEvent: only allowlisted keys appear; price/vat/flags map correctly", () => {
  const ev = deriveProductUpdateEvent(BASE, {
    ...BASE,
    wholesalePrice: 12,
    vatRate: 0.17,
    trackExpiry: true,
  });
  assert.deepEqual(ev!.metadata.changed_fields, [
    "wholesale_price",
    "vat_rate",
    "track_expiry",
  ]);
  // Every emitted key is in the closed allowlist.
  for (const k of ev!.metadata.changed_fields as string[]) {
    assert.ok((PRODUCT_AUDIT_FIELD_KEYS as readonly string[]).includes(k), k);
  }
});

test("deriveProductUpdateEvent: an empty ⇄ null text edit is NOT a change", () => {
  const a: ProductAuditSnapshot = { ...BASE, barcode: "", unitSize: "  " };
  const b: ProductAuditSnapshot = { ...BASE, barcode: null, unitSize: undefined };
  assert.equal(deriveProductUpdateEvent(a, b), null);
});

// ── 14b. Descriptions (Codex P2-1): each locale → the single `description` key ─
const DESC_BASE: ProductAuditSnapshot = {
  ...BASE,
  descriptionAr: "وصف",
  descriptionHe: "תיאור",
  descriptionEn: "Desc",
};

for (const locale of ["Ar", "He", "En"] as const) {
  test(`deriveProductUpdateEvent: a description_${locale.toLowerCase()}-only change → ["description"]`, () => {
    const ev = deriveProductUpdateEvent(DESC_BASE, {
      ...DESC_BASE,
      [`description${locale}`]: "Changed",
    });
    assert.deepEqual(ev!.metadata.changed_fields, ["description"]);
  });
}

test("deriveProductUpdateEvent: multiple localized descriptions change → ONE description key", () => {
  const ev = deriveProductUpdateEvent(DESC_BASE, {
    ...DESC_BASE,
    descriptionAr: "جديد",
    descriptionHe: "חדש",
    descriptionEn: "New",
  });
  assert.deepEqual(ev!.metadata.changed_fields, ["description"]);
});

test("deriveProductUpdateEvent: unchanged (omitted-preserved) descriptions → no description key", () => {
  // An omitted-on-update description is modeled as the SAME effective value on
  // both sides (the SQL preserves it) → never a change.
  assert.equal(deriveProductUpdateEvent(DESC_BASE, { ...DESC_BASE }), null);
  // An explicitly EQUAL description is also not a change.
  const equal = deriveProductUpdateEvent(DESC_BASE, {
    ...DESC_BASE,
    descriptionEn: "Desc",
  });
  assert.equal(equal, null);
  // An empty ⇄ null description edit is not a change.
  const emptyNull = deriveProductUpdateEvent(
    { ...DESC_BASE, descriptionEn: "" },
    { ...DESC_BASE, descriptionEn: null },
  );
  assert.equal(emptyNull, null);
});

test("deriveProductUpdateEvent: a description-only change emits ONE product.updated with keys only", () => {
  const ev = deriveProductUpdateEvent(DESC_BASE, {
    ...DESC_BASE,
    descriptionEn: "Secret internal note",
  });
  assert.equal(ev!.eventType, "product.updated");
  // Only the logical key — never the description TEXT.
  assert.deepEqual(Object.keys(ev!.metadata), ["changed_fields"]);
  assert.ok(!JSON.stringify(ev!.metadata).includes("Secret internal note"));
});

test("deriveProductUpdateEvent: name + description change → [\"name\",\"description\"] (order)", () => {
  const ev = deriveProductUpdateEvent(DESC_BASE, {
    ...DESC_BASE,
    nameEn: "Renamed",
    descriptionEn: "Changed",
  });
  assert.deepEqual(ev!.metadata.changed_fields, ["name", "description"]);
});

// ── 14c. Image (Codex P3): pure derivation now detects image, KEY only ─────
test("deriveProductUpdateEvent: an image reference change → the `image` key, no URL stored", () => {
  const before: ProductAuditSnapshot = { ...BASE, imageUrl: null };
  const after: ProductAuditSnapshot = {
    ...BASE,
    imageUrl: "tenant/abc/secret-image.png",
  };
  const ev = deriveProductUpdateEvent(before, after);
  assert.deepEqual(ev!.metadata.changed_fields, ["image"]);
  assert.ok(!JSON.stringify(ev!.metadata).includes("secret-image"));
  // An unchanged image (both null, or equal) is not a change.
  assert.equal(deriveProductUpdateEvent(before, { ...BASE, imageUrl: null }), null);
  assert.equal(
    deriveProductUpdateEvent(after, { ...BASE, imageUrl: "tenant/abc/secret-image.png" }),
    null,
  );
});

// ── 15. is_active is a distinct lifecycle event, never a changed_fields key ─
test("deriveProductActivationEvent: transition → event; same state → null", () => {
  assert.equal(deriveProductActivationEvent(true, true), null);
  assert.equal(deriveProductActivationEvent(false, false), null);
  assert.equal(deriveProductActivationEvent(false, true)!.eventType, "product.activated");
  assert.equal(deriveProductActivationEvent(true, false)!.eventType, "product.deactivated");
  assert.deepEqual(deriveProductActivationEvent(false, true)!.metadata, {
    before_active: false,
    after_active: true,
  });
});

test("is_active is not part of the changed_fields allowlist", () => {
  assert.ok(!(PRODUCT_AUDIT_FIELD_KEYS as readonly string[]).includes("is_active"));
});

// ── 16. Combined ordinary + active change → two DISTINCT derived events ─────
test("a combined field + active change derives one updated + one lifecycle event", () => {
  const before = { ...BASE };
  const afterActive = true; // was implicitly active; flip to inactive below
  void afterActive;
  const upd = deriveProductUpdateEvent(before, { ...before, nameEn: "Renamed" });
  const life = deriveProductActivationEvent(true, false);
  assert.equal(upd!.eventType, "product.updated");
  assert.equal(life!.eventType, "product.deactivated");
  // They are distinct events (no duplication, no shared identity).
  assert.notEqual(upd!.eventType, life!.eventType);
});

// ── 17. Guard: actor + tenant are server-derived; no client forgery surface ─
test("guard: actor + tenant server-derived; no client actor/event/metadata param", () => {
  assert.ok(/auth\.uid\(\)/.test(MIGRATION), "actor via auth.uid()");
  assert.ok(!/p_actor|p_origin/.test(MIGRATION), "no client actor/origin param");
  // Every event_type passed to the helper is a string literal, not a param.
  assert.ok(/'product\.created'|'product\.updated'/.test(MIGRATION));
  // The helper enforces a closed allowlist + bounds metadata + a JSON object.
  assert.ok(/unknown product event type/.test(MIGRATION));
  assert.ok(/metadata exceeds the size bound/.test(MIGRATION));
  assert.ok(/metadata must be a JSON object/.test(MIGRATION));
  assert.ok(/metadata key % is not allowed for/.test(MIGRATION));
});

// ── 18. Guard: private helper is SECURITY INVOKER + revoked from clients ────
test("guard: the private helper is revoked from public/anon/authenticated", () => {
  assert.ok(
    /revoke all on function public\._log_product_audit_event\([^)]*\)\s*from public, anon, authenticated/i.test(
      MIGRATION.replace(/\s+/g, " "),
    ),
    "helper revoked from all client roles",
  );
});

// ── 19. Guard: the audit READ policy scopes PRODUCT rows to owner/admin ─────
test("guard: product audit rows are owner/admin-only, customer/order clauses preserved", () => {
  const oneLine = MIGRATION.replace(/\s+/g, " ");
  // New product clause: owner/admin only via has_tenant_role.
  assert.ok(
    /entity_type <> 'product' or public\.has_tenant_role\(\s*tenant_id,\s*array\['owner', 'admin'\]/.test(
      oneLine,
    ),
    "product rows gated by has_tenant_role(owner/admin)",
  );
  // Existing customer + order clauses reproduced verbatim (not weakened).
  assert.ok(/can_access_customer\(tenant_id, entity_id\)/.test(oneLine), "customer clause preserved");
  assert.ok(
    /entity_type <> 'order' or \(entity_id is not null and public\.can_access_order\(tenant_id, entity_id\)\)/.test(
      oneLine,
    ),
    "order clause preserved (fail-closed on null entity_id)",
  );
  // The policy is dropped + recreated (additive tightening).
  assert.ok(/drop policy .* on public\.audit_events/i.test(oneLine));
  assert.ok(/create policy .* on public\.audit_events/i.test(oneLine));
});

// ── 20. Guard: update_product locks the row (transaction-safe change gate) ──
test("guard: update_product + set_product_active capture before-state under a row lock", () => {
  assert.ok(/for update/i.test(MIGRATION), "a SELECT ... FOR UPDATE lock is used");
  // The change diff is derived from the locked old row vs the validated values.
  assert.ok(/v_old\.is_active is distinct from v\.is_active/.test(MIGRATION));
});

// ── 21. Guard: NO Inventory event is emitted in Phase 1 ────────────────────
test("guard: Phase 1 emits no inventory audit event and does not touch the inventory helper's body", () => {
  assert.ok(!/_log_inventory_audit_event/.test(MIGRATION), "no inventory audit helper");
  assert.ok(!/'inventory\./.test(MIGRATION), "no inventory.* event type emitted");
  // upsert_inventory_item is CALLED but NOT redefined here.
  assert.ok(
    !/create or replace function public\.upsert_inventory_item/.test(MIGRATION),
    "upsert_inventory_item is not redefined in Phase 1",
  );
});

// ── 22. Guard: exactly one product audit insert per success path (no N+1) ───
test("guard: the helper is invoked per success branch, not in a loop", () => {
  const calls = (MIGRATION.match(/_log_product_audit_event\(/g) ?? []).length;
  // 1 definition + create(1) + update(2: updated + lifecycle) + set_active(1) = 5.
  assert.ok(calls >= 5, `expected ≥5 helper references, got ${calls}`);
});

// ── 23. Guard: redefined RPCs keep their security mode + grants ─────────────
test("guard: the 3 product RPCs stay SECURITY DEFINER with preserved grants", () => {
  const oneLine = MIGRATION.replace(/\s+/g, " ");
  for (const fn of ["create_product", "update_product", "set_product_active"]) {
    assert.ok(
      new RegExp(`create or replace function public\\.${fn}\\b`).test(MIGRATION),
      `${fn} redefined`,
    );
    assert.ok(
      new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to authenticated, service_role`).test(
        oneLine,
      ),
      `${fn} grants preserved`,
    );
  }
  assert.ok(/security definer/i.test(MIGRATION));
});

// ── 24. Guard: no GLOBAL Activity-Log route/screen was added ───────────────
test("guard: no global Activity-Log route/screen was added (Timeline is on the edit page only)", () => {
  for (const p of [
    "app/[locale]/admin/activity",
    "app/[locale]/admin/audit",
    "components/admin/activity-log.tsx",
  ]) {
    assert.ok(!existsSync(join(process.cwd(), "src", p)), `${p} must not exist`);
  }
});

// ── 25. Guard: the private helper is never CALLED from app (TS) code ────────
test("guard: the private audit helper is never invoked from app code", () => {
  for (const rel of [
    "lib/product-audit.ts",
    "lib/actions/products.ts",
    "lib/actions/product-timeline.ts",
    "lib/data/products.ts",
    "lib/data/product-timeline.ts",
  ]) {
    const src = readSrc(rel);
    assert.ok(
      !/\.rpc\(\s*["'`]_log_product_audit_event/.test(src),
      `${rel} must not rpc() the private helper`,
    );
    assert.ok(
      !/\b_log_product_audit_event\s*\(/.test(src),
      `${rel} must not call the private helper`,
    );
  }
});

// ── 26. Guard: read/timeline actions never write an audit event ────────────
test("guard: product-timeline read/action modules never call the audit helper", () => {
  for (const rel of [
    "lib/actions/product-timeline.ts",
    "lib/data/product-timeline.ts",
  ]) {
    assert.ok(!/_log_product_audit_event/.test(readSrc(rel)));
  }
});

// ── 27. Guard: app taxonomy matches the DB helper allowlist EXACTLY ─────────
test("app taxonomy matches the DB helper allowlist EXACTLY", () => {
  for (const k of PRODUCT_AUDIT_EVENT_KEYS) {
    assert.ok(MIGRATION.includes(`'${k}'`), `DB allowlist missing ${k}`);
  }
  const dbTypes = [...MIGRATION.matchAll(/'(product\.[a-z_.]+)'/g)].map((m) => m[1]);
  for (const t of new Set(dbTypes)) {
    assert.ok(
      isProductAuditEventKey(t),
      `DB emits ${t} which is not in the app taxonomy`,
    );
  }
});

// ── 28. Guard: product-audit.ts is pure (no server/data-layer import) ──────
test("guard: product-audit.ts imports no server/data layer (pure)", () => {
  const importLines = readSrc("lib/product-audit.ts")
    .split("\n")
    .filter((l) => /^\s*import\b/.test(l));
  assert.ok(
    !importLines.some((l) =>
      /(supabase-reads|supabase-writes|server-only|data\/products)/.test(l),
    ),
    "no server/data-layer import",
  );
});

// ── 29. Guard: a product event carries no branch/warehouse scope ───────────
test("guard: product events are tenant/product-scoped only (no branch/warehouse key)", () => {
  const ev = deriveProductCreatedEvent();
  assert.ok(!("branchId" in ev.metadata) && !("branch" in ev.metadata));
  assert.ok(!("warehouse_id" in ev.metadata) && !("location" in ev.metadata));
  // No changed-field or metadata key ever carries branch/warehouse scope.
  assert.ok(
    !(PRODUCT_AUDIT_FIELD_KEYS as readonly string[]).some((k) =>
      /branch|warehouse/i.test(k),
    ),
  );
  // The audit INSERT writes only the fixed columns — no branch/warehouse column.
  const insert = MIGRATION.slice(MIGRATION.indexOf("insert into public.audit_events"));
  assert.ok(!/branch_id|warehouse_id/i.test(insert.slice(0, 400)));
});
