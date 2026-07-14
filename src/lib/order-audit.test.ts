/**
 * Order audit-event test suite (M8H.1). Exercises the PRODUCTION Order taxonomy +
 * category/sensitivity mapping + honest initiator model + PII-safe details
 * renderer + the pure derivation model (mock ⇄ Supabase parity), the MOCK write
 * paths (one event per effective mutation, none for a no-op/rejected one), and
 * source-level guards for the transactional / server-derived / no-client-forgery /
 * no-Order-Timeline contract. Pure + zero-env: runs in mock mode, no Supabase.
 *
 * Runner: `npm run test:order-audit` (tsx → node:test).
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  AUDIT_CATEGORY_ORDER,
  ORDER_AUDIT_EVENT_KEYS,
  ORDER_AUDIT_FIELD_KEYS,
  ORDER_INITIATOR_KINDS,
  ORDER_INVENTORY_EFFECTS,
  deriveOrderCreatedEvent,
  deriveOrderCustomerLinkedEvent,
  deriveOrderStatusEvent,
  deriveOrderUpdateEvent,
  isOrderAuditEventKey,
  orderAuditCategory,
  orderAuditCategoryLabel,
  orderAuditEventLabel,
  orderAuditSensitivity,
  orderInitiatorLabel,
  renderOrderAuditDetails,
  resolveOrderEventKey,
  trackedInventoryEffect,
  type OrderAuditSnapshot,
} from "./order-audit";
import {
  createOrderRequest,
  readMockOrderAuditLog,
  resetMockOrderAuditLog,
  updateOrderStatus,
} from "./data/orders";
import { getDictionary } from "../i18n/dictionaries";

const LOCALES = ["ar", "he", "en"] as const;
const readSrc = (rel: string): string =>
  readFileSync(join(process.cwd(), "src", rel), "utf8");
const readRepo = (rel: string): string =>
  readFileSync(join(process.cwd(), rel), "utf8");
/** Strip comments so a guard scans CODE, not the doc-comments that describe the
 * very invariants we forbid in code. */
const stripComments = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const MIGRATION = readRepo(
  "supabase/migrations/20260802100000_m8h1_order_audit_foundation.sql",
);

function makeEvent(eventType: string, metadata: Record<string, unknown>) {
  return { eventType, metadata };
}

// ── 1–2. Closed taxonomy + explicit category ──────────────────────────────
test("every Order event key is recognized; the taxonomy is the closed 4", () => {
  assert.equal(ORDER_AUDIT_EVENT_KEYS.length, 4);
  for (const k of ORDER_AUDIT_EVENT_KEYS) assert.ok(isOrderAuditEventKey(k));
  assert.deepEqual([...ORDER_AUDIT_EVENT_KEYS], [
    "order.created",
    "order.updated",
    "order.status_changed",
    "order.customer_linked",
  ]);
});
test("the Order category is explicit (never 'Other')", () => {
  assert.equal(orderAuditCategory(), AUDIT_CATEGORY_ORDER);
  assert.equal(AUDIT_CATEGORY_ORDER, "order");
  for (const locale of LOCALES) {
    const label = orderAuditCategoryLabel(getDictionary(locale));
    assert.ok(label.length > 0);
    assert.ok(!/^other$/i.test(label));
  }
});

// ── 3. Explicit sensitivity per event ─────────────────────────────────────
test("every Order event has an explicit low/medium sensitivity", () => {
  for (const k of ORDER_AUDIT_EVENT_KEYS) {
    assert.ok(["low", "medium"].includes(orderAuditSensitivity(k)), k);
  }
  // An edit reveals WHICH parts moved; linking binds a buyer → medium.
  assert.equal(orderAuditSensitivity("order.updated"), "medium");
  assert.equal(orderAuditSensitivity("order.customer_linked"), "medium");
  assert.equal(orderAuditSensitivity("order.created"), "low");
  assert.equal(orderAuditSensitivity("order.status_changed"), "low");
  // Unknown types are never UNDER-classified.
  assert.equal(orderAuditSensitivity("order.bogus"), "medium");
});

// ── 4–6. ar / he / en labels for every event ──────────────────────────────
for (const locale of LOCALES) {
  test(`${locale}: every Order event + category + initiator has a non-empty label`, () => {
    const dict = getDictionary(locale);
    assert.ok(dict.audit.order.category.length > 0);
    for (const k of ORDER_AUDIT_EVENT_KEYS) {
      assert.ok(orderAuditEventLabel(k, dict).length > 0, `${locale} ${k}`);
    }
    for (const i of ORDER_INITIATOR_KINDS) {
      assert.ok(dict.audit.order.initiator[i].length > 0, `${locale} ${i}`);
    }
    for (const e of ORDER_INVENTORY_EFFECTS) {
      assert.ok(dict.audit.order.inventoryEffect[e].length > 0, `${locale} ${e}`);
    }
    for (const f of ORDER_AUDIT_FIELD_KEYS) {
      assert.ok(dict.audit.order.fields[f].length > 0, `${locale} ${f}`);
    }
  });
}

// ── 7–8. No "Other"; an unrecognized event stays explicit ─────────────────
test("no Order event maps to 'Other'; unknown stays explicitly unrecognized", () => {
  for (const locale of LOCALES) {
    const dict = getDictionary(locale);
    for (const k of ORDER_AUDIT_EVENT_KEYS) {
      assert.ok(!/^other$/i.test(orderAuditEventLabel(k, dict)));
    }
    // The legacy `order.delivered` demo row in the local seed is NOT taxonomy.
    assert.equal(resolveOrderEventKey("order.delivered"), null);
    assert.equal(
      orderAuditEventLabel("order.delivered", dict),
      dict.audit.unknownEvent,
    );
    assert.ok(!/^other$/i.test(dict.audit.unknownEvent));
  }
  assert.equal(resolveOrderEventKey("customer.created"), null);
});

// ── 9–13. Creation renders safely; initiator is honest (null ≠ System) ─────
test("order.created renders the localized channel + a bounded line count", () => {
  const dict = getDictionary("en");
  const lines = renderOrderAuditDetails(
    makeEvent("order.created", {
      source: "sales_visit",
      initiator_kind: "authenticated_user",
      initial_status: "new",
      customer_kind: "existing",
      item_count: 3,
    }),
    dict,
  );
  assert.ok(lines.some((l) => l.includes(dict.audit.order.initiator.authenticated_user)));
  assert.ok(lines.some((l) => l.includes("3")));
});
test("each initiator kind has its own honest localized label", () => {
  for (const locale of LOCALES) {
    const dict = getDictionary(locale);
    const labels = ORDER_INITIATOR_KINDS.map((k) => orderInitiatorLabel(k, dict));
    assert.equal(new Set(labels).size, ORDER_INITIATOR_KINDS.length, `${locale} distinct`);
    for (const l of labels) assert.ok(l && l.length > 0);
  }
});
test("customer_link + showcase_guest render as their own channels", () => {
  const dict = getDictionary("en");
  const link = renderOrderAuditDetails(
    makeEvent("order.created", { initiator_kind: "customer_link", item_count: 1 }),
    dict,
  ).join(" | ");
  const guest = renderOrderAuditDetails(
    makeEvent("order.created", { initiator_kind: "showcase_guest", item_count: 1 }),
    dict,
  ).join(" | ");
  assert.ok(link.includes(dict.audit.order.initiator.customer_link));
  assert.ok(guest.includes(dict.audit.order.initiator.showcase_guest));
  assert.notEqual(link, guest);
});
test("a NULL actor is NEVER auto-labelled 'System' — the channel is authoritative", () => {
  const dict = getDictionary("en");
  // No initiator_kind at all → the renderer emits NO channel line (it does not
  // guess "System"); an unrecognized kind likewise renders nothing.
  assert.equal(orderInitiatorLabel(undefined, dict), null);
  assert.equal(orderInitiatorLabel(null, dict), null);
  assert.equal(orderInitiatorLabel("system", dict), null);
  const lines = renderOrderAuditDetails(makeEvent("order.created", {}), dict);
  assert.deepEqual(lines, []);
  // "system" is deliberately NOT in the taxonomy — no order path is system-made.
  assert.ok(!(ORDER_INITIATOR_KINDS as readonly string[]).includes("system"));
});
test("the initiator allowlist is exactly the three real channels", () => {
  assert.deepEqual([...ORDER_INITIATOR_KINDS], [
    "authenticated_user",
    "customer_link",
    "showcase_guest",
  ]);
});

// ── 14. Update renders changed-field LABELS (never the values) ─────────────
test("order.updated renders localized changed-field labels + a line-count change", () => {
  const dict = getDictionary("en");
  const lines = renderOrderAuditDetails(
    makeEvent("order.updated", {
      changed_fields: ["items", "notes"],
      item_count_before: 1,
      item_count_after: 3,
    }),
    dict,
  );
  const joined = lines.join(" | ");
  assert.ok(joined.includes(dict.audit.order.fields.items));
  assert.ok(joined.includes(dict.audit.order.fields.notes));
  assert.ok(joined.includes("1") && joined.includes("3"));
});

// ── 15–18, 21. The renderer NEVER surfaces PII / snapshot / items / money ──
test("no PII, guest snapshot, line items, prices, totals or tokens are ever rendered", () => {
  const dict = getDictionary("en");
  // Even if impossible values were somehow present, the renderer reads ONLY the
  // allowlisted keys — nothing raw can escape.
  const hostile = {
    // PII / guest snapshot
    name: "Guest Shop Ltd",
    contact_name: "Guest Contact",
    phone: "050-1234567",
    email: "guest@example.com",
    address: "1 Secret Street",
    customer_snapshot: { name: "Guest Shop Ltd", phone: "050-1234567" },
    notes_value: "private delivery instructions",
    // line items / catalog
    items: [{ product_id: "p-1", quantity: 9, unit_price: 12.5 }],
    product_id: "p-1",
    product_name: "Cola 1.5L",
    // money
    total: 999.99,
    subtotal: 850,
    vat_total: 149.99,
    discount: 10,
    // credentials
    token: "SHOPTOKEN-SECRET",
    token_hash: "DEADBEEFHASH",
    url: "https://madaf-drab.vercel.app/shop/SECRET",
    // stock
    quantity_available: 42,
  };
  for (const k of ORDER_AUDIT_EVENT_KEYS) {
    const joined = renderOrderAuditDetails(makeEvent(k, hostile), dict).join(" | ");
    assert.ok(
      !/Guest Shop|Guest Contact|050-1234567|guest@example|Secret Street|delivery instructions|Cola|p-1|999\.99|850|149\.99|SHOPTOKEN|DEADBEEF|http|42/i.test(
        joined,
      ),
      `${k} leaked: ${joined}`,
    );
  }
});

// ── 19–20. Status transition + safe inventory effect ──────────────────────
test("order.status_changed renders localized from → to using the existing status labels", () => {
  const dict = getDictionary("en");
  const lines = renderOrderAuditDetails(
    makeEvent("order.status_changed", {
      from_status: "new",
      to_status: "confirmed",
      inventory_effect: "reserved",
    }),
    dict,
  );
  const joined = lines.join(" | ");
  assert.ok(joined.includes(dict.status.new));
  assert.ok(joined.includes(dict.status.confirmed));
  assert.ok(joined.includes(dict.audit.order.inventoryEffect.reserved));
});
test("inventory effect renders ONLY as a safe enum; 'none' adds no line; junk is dropped", () => {
  const dict = getDictionary("en");
  const none = renderOrderAuditDetails(
    makeEvent("order.status_changed", {
      from_status: "confirmed",
      to_status: "preparing",
      inventory_effect: "none",
    }),
    dict,
  );
  assert.equal(none.length, 1, "only the status line — 'none' adds nothing");
  const junk = renderOrderAuditDetails(
    makeEvent("order.status_changed", {
      from_status: "new",
      to_status: "confirmed",
      inventory_effect: "deducted 42 units of Cola",
    }),
    dict,
  ).join(" | ");
  assert.ok(!/42|Cola|deducted/i.test(junk), "a non-enum effect is never rendered");
});
test("a malformed status pair renders nothing rather than raw values", () => {
  const dict = getDictionary("en");
  const lines = renderOrderAuditDetails(
    makeEvent("order.status_changed", { from_status: "shipped", to_status: "refunded" }),
    dict,
  );
  assert.deepEqual(lines, []);
});

// ── Customer-link rendering (both kinds, distinct) ────────────────────────
test("order.customer_linked renders a distinct line per link kind, with no ids", () => {
  const dict = getDictionary("en");
  const existing = renderOrderAuditDetails(
    makeEvent("order.customer_linked", { link_kind: "existing_customer" }),
    dict,
  );
  const guest = renderOrderAuditDetails(
    makeEvent("order.customer_linked", { link_kind: "guest_conversion" }),
    dict,
  );
  assert.deepEqual(existing, [dict.audit.order.details.linkedExisting]);
  assert.deepEqual(guest, [dict.audit.order.details.linkedGuestConversion]);
  assert.notDeepEqual(existing, guest);
});

// ── Pure derivation model (the shared mock ⇄ Supabase contract) ────────────
test("deriveOrderStatusEvent: a real transition → one event; same state → null", () => {
  assert.equal(deriveOrderStatusEvent("confirmed", "confirmed", "none"), null);
  const ev = deriveOrderStatusEvent("new", "confirmed", "reserved");
  assert.ok(ev);
  assert.equal(ev!.eventType, "order.status_changed");
  assert.deepEqual(ev!.metadata, {
    from_status: "new",
    to_status: "confirmed",
    inventory_effect: "reserved",
  });
});
test("deriveOrderUpdateEvent: an effective change → one event; a no-op → null", () => {
  const base: OrderAuditSnapshot = { items: { p1: 2 }, notes: "n" };
  assert.equal(deriveOrderUpdateEvent(base, { items: { p1: 2 }, notes: "n" }), null);
  const qty = deriveOrderUpdateEvent(base, { items: { p1: 3 }, notes: "n" });
  assert.deepEqual(qty!.metadata.changed_fields, ["items"]);
  const notes = deriveOrderUpdateEvent(base, { items: { p1: 2 }, notes: "n2" });
  assert.deepEqual(notes!.metadata.changed_fields, ["notes"]);
  const both = deriveOrderUpdateEvent(base, { items: { p1: 2, p2: 1 }, notes: "n2" });
  assert.deepEqual(both!.metadata.changed_fields, ["items", "notes"]);
  assert.equal(both!.metadata.item_count_before, 1);
  assert.equal(both!.metadata.item_count_after, 2);
});
test("deriveOrderUpdateEvent: metadata carries counts only — no ids, quantities or notes", () => {
  const ev = deriveOrderUpdateEvent(
    { items: { "prod-1": 2 }, notes: "secret note" },
    { items: { "prod-2": 9 }, notes: "another secret" },
  );
  const json = JSON.stringify(ev!.metadata);
  assert.ok(!/prod-1|prod-2|secret|another|9/.test(json), json);
});
test("deriveOrderCreatedEvent / deriveOrderCustomerLinkedEvent carry only safe facts", () => {
  const created = deriveOrderCreatedEvent({
    source: "remote_customer",
    initiatorKind: "showcase_guest",
    customerKind: "guest",
    itemCount: 2,
  });
  assert.deepEqual(Object.keys(created.metadata).sort(), [
    "customer_kind",
    "initial_status",
    "initiator_kind",
    "item_count",
    "source",
  ]);
  const linked = deriveOrderCustomerLinkedEvent("guest_conversion");
  assert.deepEqual(linked.metadata, { link_kind: "guest_conversion" });
});
test("trackedInventoryEffect models reserve-once / no-double-deduct / restore-once", () => {
  assert.equal(trackedInventoryEffect("new", "confirmed"), "reserved");
  assert.equal(trackedInventoryEffect("confirmed", "preparing"), "none"); // no double deduct
  assert.equal(trackedInventoryEffect("preparing", "delivered"), "none"); // delivered never deducts
  assert.equal(trackedInventoryEffect("confirmed", "cancelled"), "restored");
  assert.equal(trackedInventoryEffect("preparing", "cancelled"), "restored");
  assert.equal(trackedInventoryEffect("new", "cancelled"), "none"); // never reserved
});

// ── 22–29. MOCK write paths obey the SAME contract ────────────────────────
test("mock: a successful create records exactly ONE order.created", async () => {
  resetMockOrderAuditLog();
  await createOrderRequest({
    customerId: "c01",
    items: [{ productId: "p1", quantity: 2 }, { productId: "p2", quantity: 1 }],
    source: "sales_visit",
  });
  const log = readMockOrderAuditLog();
  assert.equal(log.length, 1);
  assert.equal(log[0].eventType, "order.created");
  assert.equal(log[0].metadata.initiator_kind, "authenticated_user");
  assert.equal(log[0].metadata.customer_kind, "existing");
  assert.equal(log[0].metadata.item_count, 2);
});
test("mock: a guest-less create records customer_kind none", async () => {
  resetMockOrderAuditLog();
  await createOrderRequest({
    customerId: null,
    items: [{ productId: "p1", quantity: 1 }],
    source: "admin",
  });
  assert.equal(readMockOrderAuditLog()[0].metadata.customer_kind, "none");
});
test("mock: a valid status transition records ONE order.status_changed", async () => {
  resetMockOrderAuditLog();
  const { orders } = await import("./mock");
  const target = orders.find((o) => o.status === "new");
  assert.ok(target, "a demo order in status new exists");
  await updateOrderStatus(target!.id, "confirmed");
  const log = readMockOrderAuditLog();
  assert.equal(log.length, 1);
  assert.equal(log[0].eventType, "order.status_changed");
  assert.equal(log[0].metadata.from_status, "new");
  assert.equal(log[0].metadata.to_status, "confirmed");
  assert.equal(log[0].metadata.inventory_effect, "reserved");
});
test("mock: requesting the CURRENT status records NO event (no-op)", async () => {
  resetMockOrderAuditLog();
  const { orders } = await import("./mock");
  const target = orders.find((o) => o.status === "new");
  await updateOrderStatus(target!.id, "new");
  assert.equal(readMockOrderAuditLog().length, 0);
});
test("mock: an INVALID transition throws and records NO event", async () => {
  resetMockOrderAuditLog();
  const { orders } = await import("./mock");
  const target = orders.find((o) => o.status === "new");
  await assert.rejects(() => updateOrderStatus(target!.id, "delivered"));
  assert.equal(readMockOrderAuditLog().length, 0);
});
test("mock: a failed create (unknown order for status) records NO event", async () => {
  resetMockOrderAuditLog();
  await assert.rejects(() => updateOrderStatus("no-such-order", "confirmed"));
  assert.equal(readMockOrderAuditLog().length, 0);
});
test("mock: the Supabase-only write paths throw and record NO event", async () => {
  resetMockOrderAuditLog();
  const orders = await import("./data/orders");
  await assert.rejects(() => orders.updateOrderItems("demo-order", [{ productId: "p1", quantity: 1 }]));
  await assert.rejects(() => orders.createCustomerFromOrder("demo-order"));
  await assert.rejects(() => orders.linkOrderToCustomer("demo-order", "c01"));
  assert.equal(readMockOrderAuditLog().length, 0);
});
test("mock: recorded metadata never contains PII, items, prices or tokens", async () => {
  resetMockOrderAuditLog();
  await createOrderRequest({
    customerId: "c01",
    items: [{ productId: "p1", quantity: 2 }],
    notes: "secret delivery instructions",
    source: "sales_visit",
  });
  const json = JSON.stringify(readMockOrderAuditLog());
  assert.ok(!/secret|delivery instructions|p1|price|total/i.test(json), json);
});

// ── 30. The Customer-link decision matches the Supabase contract ───────────
test("guard: linking writes ONE order-entity row AND keeps M8G.2's customer row", () => {
  // Both producers emit the order-side event; neither drops the customer-side one.
  assert.ok(/link_order_to_customer/.test(MIGRATION));
  assert.ok(/create_customer_from_order/.test(MIGRATION));
  // Declared in the event allowlist + its metadata-key allowlist, then emitted
  // by BOTH link paths (link_order_to_customer + create_customer_from_order).
  const linked = (MIGRATION.match(/'order\.customer_linked'/g) ?? []).length;
  assert.equal(linked, 4, "declared twice (allowlists) + emitted by BOTH link paths");
  assert.ok(/'customer\.order_linked'/.test(MIGRATION), "M8G.2's customer event is preserved");
  assert.ok(/'customer\.created'/.test(MIGRATION), "M8G.2's guest-conversion event is preserved");
  assert.ok(/'existing_customer'/.test(MIGRATION) && /'guest_conversion'/.test(MIGRATION));
});

// ── 31–33. Customer audit / Timeline remain intact ────────────────────────
test("guard: the M8G.2 customer taxonomy + M8G.3 timeline modules stay healthy", async () => {
  const audit = await import("./audit-events");
  assert.equal(audit.CUSTOMER_AUDIT_EVENT_KEYS.length, 8);
  const timeline = await import("./customer-timeline");
  assert.equal(timeline.TIMELINE_PAGE_SIZE_MAX, 50);
  // The Customer helper is NOT weakened or replaced by this migration.
  assert.ok(!/create (or replace )?function public\._log_customer_audit_event/i.test(MIGRATION));
});
test("guard: the RLS policy preserves the customer clause and adds an order clause", () => {
  assert.ok(
    /entity_type <> 'customer'\s*\n?\s*or public\.can_access_customer\(tenant_id, entity_id\)/.test(MIGRATION),
    "the M8G.2 customer rule is reproduced verbatim",
  );
  assert.ok(
    /entity_type <> 'order'\s*\n?\s*or \(entity_id is not null and public\.can_access_order\(tenant_id, entity_id\)\)/.test(MIGRATION),
    "the order rule is additive and fails closed on a null entity_id",
  );
  // The ONLY policy dropped is the audit_events SELECT policy (recreated with the
  // clause above). No policy on any other table is touched.
  const sql = MIGRATION.replace(/--.*$/gm, "");
  // NB: the policy NAME itself contains a ';', so scan across it, not up to it.
  const drops = [...sql.matchAll(/drop policy[\s\S]*?on (public\.[a-z_]+)/gi)].map((m) => m[1]);
  assert.deepEqual(drops, ["public.audit_events"], "only the audit_events policy is replaced");
  const creates = [...sql.matchAll(/create policy[\s\S]*?on (public\.[a-z_]+)/gi)].map((m) => m[1]);
  assert.deepEqual(creates, ["public.audit_events"], "only the audit_events policy is created");
});

// ── 34–35. The Order Timeline is M8H.3; a GLOBAL Activity Log is still not ──
// M8H.1 asserted that neither existed yet. M8H.3 delivered the per-order
// Timeline (that half of the fence has been crossed, deliberately and under
// review), so the guard now pins the CURRENT boundary: the read-only Order
// Timeline exists, and the cross-entity Activity Log browser still does NOT.
test("guard: the Order Timeline is per-order (M8H.3) — no global Activity Log route", () => {
  // M8H.3 delivered exactly these, and nothing wider.
  for (const p of [
    "components/admin/order-timeline.tsx",
    "lib/data/order-timeline.ts",
    "lib/actions/order-timeline.ts",
  ]) {
    assert.ok(existsSync(join(process.cwd(), "src", p)), `${p} exists (M8H.3)`);
  }
  // A tenant-wide audit browser is NOT in scope and must not have appeared.
  for (const p of [
    "components/admin/activity-log.tsx",
    "app/[locale]/admin/activity",
    "app/[locale]/admin/audit",
  ]) {
    assert.ok(
      !existsSync(join(process.cwd(), "src", p)),
      `${p} must not exist (a global Activity Log is future scope)`,
    );
  }
  // The Timeline is mounted on the ORDER detail page, scoped to that one order.
  const detail = readSrc("app/[locale]/admin/orders/[id]/page.tsx");
  assert.ok(/OrderTimeline/.test(detail));
  assert.ok(/getOrderTimelinePage\(\{ orderId: order\.id \}\)/.test(detail));
});

// ── 36–39. No client-provided actor / tenant / event type / metadata ───────
test("guard: actor, tenant, entity and event type are all server-derived", () => {
  assert.ok(/auth\.uid\(\)/.test(MIGRATION), "actor via auth.uid()");
  assert.ok(!/p_actor|p_initiator|p_event_type text default|p_audit/.test(
    MIGRATION.replace(/_log_order_audit_event\(\s*\n?\s*p_tenant_id uuid,\s*\n?\s*p_event_type text/g, ""),
  ), "no client actor/initiator/audit parameter on any PUBLIC rpc");
  assert.ok(/authorize_tenant\(/.test(MIGRATION), "tenant validated server-side");
  assert.ok(/'order'/.test(MIGRATION), "entity_type hardcoded");
  // Every event_type passed to the helper is a string LITERAL, never a param.
  assert.ok(/'order\.created'|'order\.status_changed'/.test(MIGRATION));
  assert.ok(/unknown order event type/.test(MIGRATION), "closed allowlist");
  assert.ok(/metadata must be a JSON object/.test(MIGRATION), "metadata shape enforced");
  assert.ok(/metadata key % is not allowed/.test(MIGRATION), "per-event key allowlist");
  assert.ok(/metadata exceeds the size bound/.test(MIGRATION), "metadata bounded");
});
test("guard: the token channels can never carry an authenticated actor", () => {
  assert.ok(
    /cannot carry an authenticated actor/.test(MIGRATION),
    "an operator can never be recorded as a guest/customer-link",
  );
});

// ── 40. Read / search / export / detail paths create NO events ────────────
test("guard: order read/search/export actions never audit", () => {
  const actions = stripComments(readSrc("lib/actions/orders.ts"));
  assert.ok(!/_log_order_audit_event|audit_events/i.test(actions));
  const query = stripComments(readSrc("lib/orders-query.ts"));
  assert.ok(!/_log_order_audit_event|audit_events/i.test(query));
});

// ── 41–42. One bounded INSERT per action — no N+1, no history read ────────
test("guard: exactly one audit insert per producer success path (no N+1)", () => {
  // 1 definition + 7 producer call sites (create ×3, status, update, link ×2).
  const calls = (MIGRATION.match(/_log_order_audit_event\(/g) ?? []).length;
  assert.ok(calls >= 8, `expected ≥8 helper references, got ${calls}`);
  // The helper is never invoked inside a LOOP (that would be an N+1 per line).
  const body = MIGRATION.slice(MIGRATION.indexOf("create function public._log_order_audit_event"));
  assert.ok(!/loop[\s\S]{0,400}_log_order_audit_event\(/i.test(body), "no per-line audit insert");
  // Exactly ONE insert into audit_events, inside the helper.
  const inserts = (MIGRATION.match(/insert into public\.audit_events/g) ?? []).length;
  assert.equal(inserts, 1, "a single, bounded audit INSERT lives in the helper");
});
test("guard: the migration reads no audit history and adds no index", () => {
  assert.ok(!/select[\s\S]{0,80}from public\.audit_events/i.test(MIGRATION), "no audit-history read");
  assert.ok(!/create index/i.test(MIGRATION), "no new (duplicate) audit index — M8G.3's is reused");
  assert.ok(!/count\(\*\)[\s\S]{0,40}audit_events/i.test(MIGRATION), "no exact audit count");
});

// ── 43–44. Bundle/secret boundary + no destructive SQL ────────────────────
test("guard: the private Order helper is never called from app (TS) code", () => {
  for (const rel of [
    "lib/order-audit.ts",
    "lib/data/orders.ts",
    "lib/data/supabase-writes.ts",
    "lib/actions/orders.ts",
  ]) {
    const src = stripComments(readSrc(rel));
    assert.ok(!/_log_order_audit_event/.test(src), `${rel} must not reference the private helper`);
  }
});
test("guard: the migration is additive — no destructive or out-of-scope SQL", () => {
  const sql = MIGRATION.replace(/--.*$/gm, ""); // strip comments
  // Nothing destructive, no status-enum change, no rewriting of audit history.
  assert.ok(
    !/drop table|drop function|drop type|truncate|alter type public\.order_status|create type/i.test(sql),
    "no destructive / status-enum change",
  );
  assert.ok(
    !/update public\.audit_events|delete from public\.audit_events/i.test(sql),
    "existing audit rows are never modified or deleted",
  );
  // No FAKE HISTORY: audit rows are only ever written by the helper, one row,
  // in-transaction with a real mutation — never backfilled/reconstructed.
  const auditInserts = (sql.match(/insert into public\.audit_events/gi) ?? []).length;
  assert.equal(auditInserts, 1, "the ONLY audit insert is the helper's single row");
  assert.ok(!/generate_series|from public\.orders o\s+where[\s\S]{0,80}insert into public\.audit_events/i.test(sql),
    "no historical backfill loop");
  // Least privilege: the helper is granted to NOBODY (and never to service_role).
  assert.ok(!/service_role/i.test(sql), "no service_role grant");
  assert.ok(!/grant [\s\S]*? on function public\._log_order_audit_event/i.test(sql), "helper granted to nobody");
  assert.ok(/revoke all on function public\._log_order_audit_event/i.test(sql));
  // Inventory math and the specialized ledgers are untouched (the only non-audit
  // writes are the PRESERVED order/inventory/customer statements of the RPCs).
  assert.ok(!/alter table public\.order_inventory_movements|alter table public\.order_status_history/i.test(sql));
});

// ── Public-token contract: rate limiting + token validation are PRESERVED ──
test("guard: both token RPCs keep their rate limiter + token validation intact", () => {
  // The two anon channels must still resolve the token and record/deny failures
  // exactly as before — audit is the ONLY behavioral addition.
  assert.ok(/_token_rate_exceeded\('shop_order', v_fp\)/.test(MIGRATION));
  assert.ok(/_token_rate_exceeded\('showcase_order', v_fp\)/.test(MIGRATION));
  assert.ok(/_record_token_failure\('shop_order', v_fp\)/.test(MIGRATION));
  assert.ok(/_record_token_failure\('showcase_order', v_fp\)/.test(MIGRATION));
  assert.ok(/_resolve_token\(p_token\)/.test(MIGRATION), "shop token still resolved");
  assert.ok(/_resolve_showcase_token\(p_token\)/.test(MIGRATION), "showcase token still resolved");
  // The fingerprint is still a hash of the token — the RAW token is never stored.
  assert.ok(/encode\(sha256\(convert_to\(coalesce\(p_token, ''\), 'UTF8'\)\), 'hex'\)/.test(MIGRATION));
  // The deactivated-store (P0005) deny-without-recording path is preserved.
  assert.ok(/sqlstate 'P0005'/.test(MIGRATION));
});

// ── 45. The pure module stays isomorphic + free of server imports ─────────
test("guard: order-audit.ts is pure (no server-only / data-layer / next import)", () => {
  const src = readSrc("lib/order-audit.ts");
  const imports = [...src.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
  assert.ok(
    !imports.some((p) => /(supabase-|server-only|^next\/|\/data\/|\/mock)/.test(p)),
    `no server/data import: ${imports.join(", ")}`,
  );
});
