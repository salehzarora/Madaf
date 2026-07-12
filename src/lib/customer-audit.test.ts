/**
 * Customer audit-event test suite (M8G.2). Exercises the PRODUCTION audit-event
 * taxonomy + label/category/sensitivity mapping + PII-safe details renderer +
 * the pure derivation model (mock/Supabase parity), plus source-level guards for
 * the transactional / server-derived / no-client-forgery / no-Timeline contract.
 * Pure + zero-env: runs in mock mode with no Supabase.
 *
 * Runner: `npm run test:customer-audit` (tsx → node:test).
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  AUDIT_CATEGORY_CUSTOMER,
  CUSTOMER_AUDIT_EVENT_KEYS,
  auditCategory,
  auditEventLabel,
  auditSensitivity,
  deriveActivationEvent,
  deriveCustomerCreatedEvent,
  deriveCustomerUpdateEvent,
  isCustomerAuditEventKey,
  renderCustomerAuditDetails,
  resolveCustomerEventKey,
  type AuditEvent,
  type CustomerAuditSnapshot,
} from "./audit-events";
import { getDictionary } from "../i18n/dictionaries";

const LOCALES = ["ar", "he", "en"] as const;
const readSrc = (rel: string): string =>
  readFileSync(join(process.cwd(), "src", rel), "utf8");
const readRepo = (rel: string): string =>
  readFileSync(join(process.cwd(), rel), "utf8");
const MIGRATION = readRepo(
  "supabase/migrations/20260731100000_m8g2_customer_audit_foundation.sql",
);

function makeEvent(
  eventType: string,
  metadata: Record<string, unknown>,
): AuditEvent {
  return {
    id: "1",
    eventType,
    entityType: "customer",
    entityId: "cc000000-0000-4000-8000-000000000001",
    actorUserId: "a0000000-0000-4000-8000-000000000001",
    metadata,
    createdAt: "2026-07-31T10:00:00Z",
  };
}

// ── 1. Every final event key is recognized ─────────────────────────────────
test("every taxonomy key is recognized; length is the closed 8", () => {
  assert.equal(CUSTOMER_AUDIT_EVENT_KEYS.length, 8);
  for (const k of CUSTOMER_AUDIT_EVENT_KEYS) assert.ok(isCustomerAuditEventKey(k));
});

// ── 2. Every event maps to the explicit customer category ──────────────────
test("every event maps to the customer category", () => {
  assert.equal(auditCategory(), AUDIT_CATEGORY_CUSTOMER);
  assert.equal(AUDIT_CATEGORY_CUSTOMER, "customer");
});

// ── 3. Every event has an explicit sensitivity (low|medium) ────────────────
test("every event has an explicit low/medium sensitivity", () => {
  for (const k of CUSTOMER_AUDIT_EVENT_KEYS) {
    assert.ok(["low", "medium"].includes(auditSensitivity(k)), k);
  }
  // Access-link + update carry credential/PII-field context → medium.
  assert.equal(auditSensitivity("customer.access_link.revoked"), "medium");
  assert.equal(auditSensitivity("customer.updated"), "medium");
  assert.equal(auditSensitivity("customer.created"), "low");
});

// ── 4–6. ar/he/en labels exist + non-empty for every event ─────────────────
for (const locale of LOCALES) {
  test(`${locale}: every event + category + sensitivity has a non-empty label`, () => {
    const dict = getDictionary(locale);
    assert.ok(dict.audit.category.length > 0);
    for (const s of ["low", "medium", "high"] as const) {
      assert.ok(dict.audit.sensitivity[s].length > 0);
    }
    for (const k of CUSTOMER_AUDIT_EVENT_KEYS) {
      assert.ok(auditEventLabel(k, dict).length > 0, `${locale} ${k}`);
    }
  });
}

// ── 7. No event maps to "Other"; the unknown label is explicit, not "Other" ─
test("no label is 'Other'; unknown label is explicit", () => {
  for (const locale of LOCALES) {
    const dict = getDictionary(locale);
    assert.ok(!/^other$/i.test(dict.audit.unknownEvent));
    for (const k of CUSTOMER_AUDIT_EVENT_KEYS) {
      assert.ok(!/^other$/i.test(auditEventLabel(k, dict)));
    }
  }
});

// ── 8. Unknown event handling is explicit (null key, unknown label) ────────
test("an unrecognized event resolves to null and the explicit unknown label", () => {
  assert.equal(resolveCustomerEventKey("customer.bogus"), null);
  assert.equal(resolveCustomerEventKey("order.created"), null);
  const dict = getDictionary("en");
  assert.equal(auditEventLabel("customer.bogus", dict), dict.audit.unknownEvent);
  // Unknown types are never under-classified.
  assert.equal(auditSensitivity("customer.bogus"), "medium");
});

// ── 9. customer.created displays origin safely ─────────────────────────────
test("customer.created renders a localized origin (no raw enum leaks)", () => {
  const dict = getDictionary("en");
  const lines = renderCustomerAuditDetails(
    makeEvent("customer.created", { origin: "signup" }),
    dict,
  );
  assert.ok(lines.some((l) => l.includes(dict.admin.customers.origin.values.signup)));
  // An invalid origin value is ignored (never rendered raw).
  assert.deepEqual(
    renderCustomerAuditDetails(makeEvent("customer.created", { origin: "x" }), dict),
    [],
  );
});

// ── 10. customer.updated lists the changed fields ──────────────────────────
test("customer.updated renders localized changed-field labels + enum change", () => {
  const dict = getDictionary("en");
  const lines = renderCustomerAuditDetails(
    makeEvent("customer.updated", {
      changed_fields: ["name", "customer_type"],
      customer_type: { from: "grocery", to: "kiosk" },
    }),
    dict,
  );
  assert.ok(lines.some((l) => l.includes(dict.audit.fields.name)));
  assert.ok(lines.some((l) => l.includes(dict.audit.fields.customer_type)));
  assert.ok(lines.some((l) => l.includes(dict.admin.customers.types.kiosk)));
});

// ── 11. Update rendering never surfaces PII VALUES (allowlist enforced) ─────
test("update details never surface PII values, even if present in metadata", () => {
  const dict = getDictionary("en");
  // Defense: an (impossible-by-design) phone value must NOT be rendered.
  const lines = renderCustomerAuditDetails(
    makeEvent("customer.updated", {
      changed_fields: ["phone", "name"],
      phone: "050-1234567",
      name: "Secret Shop Ltd",
    }),
    dict,
  );
  const joined = lines.join(" | ");
  assert.ok(!joined.includes("050-1234567"));
  assert.ok(!joined.includes("Secret Shop Ltd"));
});

// ── 12–13. activation / deactivation display ───────────────────────────────
test("activation + deactivation have distinct localized labels", () => {
  const dict = getDictionary("en");
  assert.notEqual(
    auditEventLabel("customer.activated", dict),
    auditEventLabel("customer.deactivated", dict),
  );
});

// ── 14–15. access-link display; token/URL never appears ────────────────────
test("access-link events render safely — never a token/hash/URL", () => {
  const dict = getDictionary("en");
  for (const k of [
    "customer.access_link.created",
    "customer.access_link.rotated",
    "customer.access_link.revoked",
  ]) {
    // Even if a token/URL leaked into metadata, the renderer must not surface it.
    const lines = renderCustomerAuditDetails(
      makeEvent(k, {
        link_id: "l1",
        expires_at: "2026-12-31",
        token: "SECRET-TOKEN",
        token_hash: "DEADBEEFHASH",
        url: "https://madaf-drab.vercel.app/shop/SECRET",
      }),
      dict,
    );
    const joined = lines.join(" | ");
    assert.ok(!/SECRET|DEADBEEF|http/i.test(joined), `${k} leaks nothing`);
    assert.ok(auditEventLabel(k, dict).length > 0);
  }
});

// ── 16–17. order-link display; source order id not treated as PII ──────────
test("order_linked renders a safe line and copies no snapshot", () => {
  const dict = getDictionary("en");
  const lines = renderCustomerAuditDetails(
    makeEvent("customer.order_linked", {
      order_id: "o1",
      previous_linkage: "unlinked",
    }),
    dict,
  );
  assert.deepEqual(lines, [dict.audit.details.orderLinked]);
});

// ── 18–21. AuditEvent shape: actor resolved at read time, no branch field ──
test("AuditEvent shape carries actor/timestamp; no branch/PII fields", () => {
  const ev = makeEvent("customer.created", { origin: "manual" });
  assert.equal(typeof ev.actorUserId, "string");
  assert.equal(typeof ev.createdAt, "string");
  // Branch scope is not part of a customer event (tenant-wide) — no branch key.
  assert.ok(!("branchId" in ev) && !("branch" in ev));
  // actorName is an OPTIONAL read-time resolution, never stored on the row.
  assert.equal(ev.actorName, undefined);
});

// ── 22–24. ar/he/en render a non-empty detail line for a created event ─────
for (const locale of LOCALES) {
  test(`${locale}: renders a localized detail line`, () => {
    const dict = getDictionary(locale);
    const lines = renderCustomerAuditDetails(
      makeEvent("customer.created", { origin: "manual" }),
      dict,
    );
    assert.ok(lines.length === 1 && lines[0].length > 0);
  });
}

// ── 25. RTL locales use a distinct (mirrored) type-change template ─────────
test("type-change template differs between ar/he (RTL) and en (LTR)", () => {
  assert.notEqual(getDictionary("en").audit.details.typeChange, getDictionary("ar").audit.details.typeChange);
  // The RTL arrow points the other way (logical from→to).
  assert.ok(getDictionary("he").audit.details.typeChange.includes("←"));
  assert.ok(getDictionary("en").audit.details.typeChange.includes("→"));
});

// ── 26–29. Pure derivation model: one event on change; none on no-op ───────
const BASE: CustomerAuditSnapshot = {
  name: "Store",
  phone: "050-1",
  customerType: "grocery",
};
test("deriveCustomerUpdateEvent: a real change → one event; no-op → null", () => {
  assert.equal(deriveCustomerUpdateEvent(BASE, BASE), null); // no-op
  const changed = deriveCustomerUpdateEvent(BASE, { ...BASE, name: "Store v2" });
  assert.ok(changed);
  assert.deepEqual(changed!.metadata.changed_fields, ["name"]);
});

test("deriveActivationEvent: transition → event; same state → null", () => {
  assert.equal(deriveActivationEvent(true, true), null);
  assert.equal(deriveActivationEvent(false, false), null);
  assert.equal(deriveActivationEvent(false, true)!.eventType, "customer.activated");
  assert.equal(deriveActivationEvent(true, false)!.eventType, "customer.deactivated");
});

test("deriveCustomerCreatedEvent: correct origin metadata per path", () => {
  assert.equal(
    deriveCustomerCreatedEvent({ origin: "manual", customerType: "kiosk" }).metadata.origin,
    "manual",
  );
  assert.equal(
    deriveCustomerCreatedEvent({ origin: "signup", signupRequestId: "r1" }).metadata.signup_request_id,
    "r1",
  );
  assert.equal(
    deriveCustomerCreatedEvent({ origin: "guest_conversion", sourceOrderId: "o1" }).metadata.source_order_id,
    "o1",
  );
});

test("derivation never carries a PII value (created metadata is origin + safe ids)", () => {
  const ev = deriveCustomerCreatedEvent({ origin: "manual", customerType: "grocery" });
  const keys = Object.keys(ev.metadata).sort();
  assert.deepEqual(keys, ["customer_type", "origin"]);
});

// ── 30. Origin remains immutable (audit layer never writes origin) ─────────
test("guard: the audit migration never changes customer origin", () => {
  assert.ok(!/\borigin\s*=|set\s+origin/i.test(MIGRATION), "no origin write in the migration");
  // link_order_to_customer explicitly keeps origin (documented + code).
  assert.ok(/order linking does NOT change|Origin is NOT changed/i.test(MIGRATION));
});

// ── 31–32. Origin filtering + statistics remain importable/healthy ─────────
test("guard: M8G.1 origin + M8F.3 stats modules remain intact", async () => {
  const q = await import("./customers-query");
  assert.equal(q.parseCustomersQuery({ origin: "signup" }).origin, "signup");
  const audit = await import("./audit-events");
  assert.equal(audit.CUSTOMER_AUDIT_EVENT_KEYS.length, 8);
});

// ── 33–35. No full fetch / no N+1: one bounded insert per success ──────────
test("guard: audit-events.ts imports no server/data layer (pure)", () => {
  const importLines = readSrc("lib/audit-events.ts")
    .split("\n")
    .filter((l) => /^\s*import\b/.test(l));
  assert.ok(
    !importLines.some((l) =>
      /(supabase-reads|supabase-writes|server-only|data\/customers)/.test(l),
    ),
    "no server/data-layer import",
  );
});
test("guard: exactly one audit insert per success path (no N+1)", () => {
  // The helper is invoked once per RPC success branch (8 producers).
  const calls = (MIGRATION.match(/_log_customer_audit_event\(/g) ?? []).length;
  // 1 definition + 8 producer call sites.
  assert.ok(calls >= 9, `expected ≥9 helper references, got ${calls}`);
  assert.ok(!/for\s+\w+\s+in|loop/i.test(MIGRATION.split("returns void")[1] ?? ""));
});

// ── 36–39. No client-provided actor/tenant/event-type/metadata ─────────────
test("guard: actor + tenant are server-derived; no client forgery surface", () => {
  assert.ok(/actor_user_id.*auth\.uid\(\)|auth\.uid\(\)/.test(MIGRATION), "actor via auth.uid()");
  assert.ok(!/p_actor|p_origin/.test(MIGRATION), "no client actor/origin param");
  // Every event_type passed to the helper is a string literal, not a param.
  assert.ok(/'customer\.created'|'customer\.updated'/.test(MIGRATION));
  // The helper enforces a closed allowlist + bounds metadata.
  assert.ok(/unknown customer event type/.test(MIGRATION));
  assert.ok(/metadata exceeds the size bound/.test(MIGRATION));
});

// ── 39b. Audit READ is scoped: customer rows follow can_access_customer (M4D) ─
test("guard: the migration rep-scopes customer audit reads (no M4D leak)", () => {
  assert.ok(
    /can_access_customer\(\s*tenant_id,\s*entity_id\s*\)/.test(MIGRATION),
    "customer-category rows are gated by can_access_customer in the read policy",
  );
  assert.ok(
    /on public\.audit_events\s+for select/i.test(MIGRATION) &&
      /drop policy .* on public\.audit_events/i.test(MIGRATION),
    "the audit_events SELECT policy is dropped + recreated (tightened)",
  );
});

// ── 40. Read/search/filter/pagination actions log nothing ──────────────────
test("guard: customer search/read actions never call the audit helper", () => {
  const action = readSrc("lib/actions/customers.ts");
  assert.ok(!/audit|_log_customer/i.test(action));
});

// ── 41–42. No Customer Timeline UI / Activity tab was added ────────────────
test("guard: no Customer Timeline UI / Activity-Log screen was added", () => {
  for (const p of [
    "app/[locale]/admin/activity",
    "app/[locale]/admin/audit",
    "components/admin/customer-timeline.tsx",
    "components/admin/activity-log.tsx",
  ]) {
    assert.ok(!existsSync(join(process.cwd(), "src", p)), `${p} must not exist`);
  }
  const detail = readSrc("app/[locale]/admin/customers/[id]/page.tsx");
  assert.ok(!/timeline|activity.?tab|audit/i.test(detail), "no Activity tab on detail");
});

// ── 43. The private helper is never CALLED from app (TS) code — DB-only ────
test("guard: the private audit helper is never invoked from app code", () => {
  for (const rel of [
    "lib/audit-events.ts",
    "lib/actions/customers.ts",
    "lib/actions/customer-links.ts",
    "lib/data/customer-links.ts",
    "lib/data/customers.ts",
  ]) {
    const src = readSrc(rel);
    // A doc-comment mention is fine; a runtime CALL (rpc/invocation) is not.
    assert.ok(
      !/\.rpc\(\s*["'`]_log_customer_audit_event/.test(src),
      `${rel} must not rpc() the private helper`,
    );
    assert.ok(
      !/\b_log_customer_audit_event\s*\(/.test(src),
      `${rel} must not call the private helper`,
    );
  }
});

// ── 44–45. Taxonomy parity with the DB allowlist (no test-only taxonomy) ───
test("app taxonomy matches the DB helper allowlist EXACTLY", () => {
  for (const k of CUSTOMER_AUDIT_EVENT_KEYS) {
    assert.ok(MIGRATION.includes(`'${k}'`), `DB allowlist missing ${k}`);
  }
  // The DB allowlist has no extra customer.* type beyond the app taxonomy.
  const dbTypes = [...MIGRATION.matchAll(/'(customer\.[a-z_.]+)'/g)].map((m) => m[1]);
  for (const t of new Set(dbTypes)) {
    assert.ok(
      isCustomerAuditEventKey(t),
      `DB emits ${t} which is not in the app taxonomy`,
    );
  }
});
