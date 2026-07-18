/**
 * Customer-signup-request decision audit test suite (M8I.6). Exercises the
 * PRODUCTION taxonomy + label/category/sensitivity + safe extractors + the
 * client-safe metadata projection, plus source-level guards for the reframe (no
 * platform/Tenant provisioning), the C2 preservation, the customer.created
 * preservation, the change-gated events, privacy, and owner/admin-only RLS.
 * Pure + zero-env: runs in mock mode.
 *
 * Runner: `npm run test:signup-audit` (tsx → node:test).
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  AUDIT_CATEGORY_SIGNUP_REQUEST,
  SIGNUP_REQUEST_AUDIT_EVENT_KEYS,
  isSignupRequestAuditEventKey,
  resolveSignupRequestEventKey,
  safeSignupBusinessName,
  safeSignupResultingCustomerId,
  signupRequestAuditCategory,
  signupRequestAuditEventLabel,
  signupRequestAuditSensitivity,
} from "./signup-request-audit";
import {
  buildSignupRequestTimelineEvent,
  clientSafeSignupRequestMetadata,
} from "./signup-request-timeline";
import { getDictionary } from "../i18n/dictionaries";

const LOCALES = ["ar", "he", "en"] as const;
const UUID = "44444444-4444-4444-8444-444444444444";
const readSrc = (rel: string): string =>
  readFileSync(join(process.cwd(), "src", rel), "utf8");
const readRepo = (rel: string): string =>
  readFileSync(join(process.cwd(), rel), "utf8");
const MIGRATION = readRepo(
  "supabase/migrations/20260811100000_customer_signup_request_audit.sql",
);
const ONE = MIGRATION.replace(/\s+/g, " ");

// ── 1. Closed taxonomy: exactly the 2 events ───────────────────────────────
test("every taxonomy key is recognized; length is the closed 2", () => {
  assert.equal(SIGNUP_REQUEST_AUDIT_EVENT_KEYS.length, 2);
  for (const k of SIGNUP_REQUEST_AUDIT_EVENT_KEYS)
    assert.ok(isSignupRequestAuditEventKey(k));
  assert.deepEqual([...SIGNUP_REQUEST_AUDIT_EVENT_KEYS], [
    "customer_signup_request.approved",
    "customer_signup_request.rejected",
  ]);
  for (const gone of [
    "customer_signup_request.submitted",
    "customer_signup_request.created",
    "customer_signup_request.updated",
    "customer_signup_request.reviewed",
    "signup_request.approved",
    "platform_signup.approved",
  ]) {
    assert.equal(resolveSignupRequestEventKey(gone), null, gone);
  }
});

// ── 2. Category + sensitivity (both medium) ────────────────────────────────
test("category is customer_signup_request; both events are medium", () => {
  assert.equal(signupRequestAuditCategory(), AUDIT_CATEGORY_SIGNUP_REQUEST);
  assert.equal(AUDIT_CATEGORY_SIGNUP_REQUEST, "customer_signup_request");
  assert.equal(signupRequestAuditSensitivity("customer_signup_request.approved"), "medium");
  assert.equal(signupRequestAuditSensitivity("customer_signup_request.rejected"), "medium");
  assert.equal(signupRequestAuditSensitivity("customer_signup_request.bogus"), "medium");
});

// ── 3–5. ar/he/en labels exist + non-empty ─────────────────────────────────
for (const locale of LOCALES) {
  test(`${locale}: every event + chrome label is non-empty`, () => {
    const dict = getDictionary(locale);
    const s = dict.audit.signup;
    assert.ok(s.category.length > 0);
    assert.ok(s.timelineHeading.length > 0);
    assert.ok(s.business.length > 0);
    assert.ok(s.resultingCustomer.length > 0);
    for (const k of SIGNUP_REQUEST_AUDIT_EVENT_KEYS) {
      assert.ok(signupRequestAuditEventLabel(k, dict).length > 0, `${locale} ${k}`);
    }
  });
}

// ── 6. No "Other"; explicit unknown fallback ───────────────────────────────
test("no label is 'Other'; unknown resolves to the explicit unknown label", () => {
  for (const locale of LOCALES) {
    const dict = getDictionary(locale);
    for (const k of SIGNUP_REQUEST_AUDIT_EVENT_KEYS) {
      assert.ok(!/^other$/i.test(signupRequestAuditEventLabel(k, dict)));
    }
  }
  const dict = getDictionary("en");
  assert.equal(
    signupRequestAuditEventLabel("customer_signup_request.bogus", dict),
    dict.audit.unknownEvent,
  );
});

// ── 7. Safe extractors ─────────────────────────────────────────────────────
test("safe extractors accept valid values and reject the rest", () => {
  assert.equal(safeSignupBusinessName({ business_name: "Shop" }), "Shop");
  assert.equal(safeSignupBusinessName({ business_name: "" }), null);
  assert.equal(safeSignupBusinessName({ business_name: "x".repeat(201) }), null);
  assert.equal(safeSignupBusinessName({ business_name: 42 }), null);
  assert.equal(safeSignupResultingCustomerId({ resulting_customer_id: UUID }), UUID);
  assert.equal(safeSignupResultingCustomerId({ resulting_customer_id: "not-a-uuid" }), null);
  assert.equal(safeSignupResultingCustomerId({ resulting_customer_id: "../etc/passwd" }), null);
  assert.equal(safeSignupResultingCustomerId({}), null);
});

// ── 8. Client-safe projection: PII/secrets NEVER cross; rejected drops id ───
test("clientSafeSignupRequestMetadata projects ONLY the safe render keys", () => {
  // Approved: business_name + a validated resulting_customer_id; everything else dropped.
  const approved = clientSafeSignupRequestMetadata("customer_signup_request.approved", {
    business_name: "Shop A",
    resulting_customer_id: UUID,
    email: "applicant@x.local",
    phone: "+972-5",
    address: "1 St",
    notes: "internal",
    token: "raw",
  });
  assert.deepEqual(approved, { business_name: "Shop A", resulting_customer_id: UUID });
  for (const k of ["email", "phone", "address", "notes", "token"]) {
    assert.ok(!(k in approved), `${k} must not cross`);
  }
  // Rejected: business_name only — resulting_customer_id is NOT projected.
  const rejected = clientSafeSignupRequestMetadata("customer_signup_request.rejected", {
    business_name: "Shop B",
    resulting_customer_id: UUID,
  });
  assert.deepEqual(rejected, { business_name: "Shop B" });
  assert.ok(!("resulting_customer_id" in rejected));
  // A malformed customer id under approved is dropped (row kept).
  assert.deepEqual(
    clientSafeSignupRequestMetadata("customer_signup_request.approved", {
      business_name: "Shop C",
      resulting_customer_id: "nope",
    }),
    { business_name: "Shop C" },
  );
  // Unknown event type → {}.
  assert.deepEqual(
    clientSafeSignupRequestMetadata("customer_signup_request.bogus", { business_name: "x" }),
    {},
  );
});

// ── 9. buildSignupRequestTimelineEvent: safe row + category + sensitivity ───
test("buildSignupRequestTimelineEvent yields a safe row (no PII/secret keys)", () => {
  const built = buildSignupRequestTimelineEvent({
    id: "9",
    eventType: "customer_signup_request.approved",
    createdAt: "2026-07-12T10:00:00Z",
    actor: { kind: "unknown" },
    metadata: { business_name: "Shop D", resulting_customer_id: UUID, email: "x@y" },
  });
  assert.equal(built.category, "customer_signup_request");
  assert.equal(built.sensitivity, "medium");
  assert.deepEqual(built.metadata, { business_name: "Shop D", resulting_customer_id: UUID });
  assert.ok(!("email" in built.metadata));
});

// ── 10. Guard: closed helper; server actor; entity hardcoded; revoked ──────
test("guard: closed helper; server actor; exact key sets; signup entity; revoked", () => {
  assert.ok(/auth\.uid\(\)/.test(MIGRATION), "actor via auth.uid()");
  assert.ok(!/p_actor/.test(MIGRATION), "no client actor param");
  for (const k of SIGNUP_REQUEST_AUDIT_EVENT_KEYS) {
    assert.ok(MIGRATION.includes(`'${k}'`), `DB allowlist missing ${k}`);
  }
  assert.ok(/approved metadata must contain exactly business_name and resulting_customer_id/.test(MIGRATION));
  assert.ok(/rejected metadata must contain exactly business_name/.test(MIGRATION));
  assert.ok(/business_name must be trimmed and 1\.\.200 chars/.test(MIGRATION));
  assert.ok(/resulting_customer_id must be a UUID/.test(MIGRATION));
  assert.ok(/metadata must be a JSON object/.test(MIGRATION));
  assert.ok(/metadata exceeds the size bound/.test(MIGRATION));
  // entity_type hardcoded in the insert.
  assert.ok(/p_event_type, 'customer_signup_request', p_entity_id, v_meta/.test(ONE));
  assert.ok(
    /revoke all on function public\._log_customer_signup_request_audit_event\([^)]*\) from public, anon, authenticated/i.test(ONE),
    "helper revoked from all client roles",
  );
});

// ── 11. Guard: NO source field; exact metadata shapes ──────────────────────
test("guard: no source field anywhere in the signup migration", () => {
  assert.ok(!ONE.includes("'source'"), "no 'source' key in the signup taxonomy");
  // Approved builds exactly business_name + resulting_customer_id.
  assert.ok(
    /jsonb_build_object\( 'business_name', left\(btrim\(v_req\.name\), 200\), 'resulting_customer_id', v_customer_id\)/.test(ONE),
    "approved metadata is exactly {business_name, resulting_customer_id}",
  );
  assert.ok(
    /jsonb_build_object\('business_name', left\(btrim\(v_name\), 200\)\)/.test(ONE),
    "rejected metadata is exactly {business_name}",
  );
});

// ── 12. Guard: C2 + customer.created preserved; reject RETURNING change-gate ─
test("guard: approve keeps FOR UPDATE + customer.created; reject uses RETURNING", () => {
  assert.ok(/create or replace function public\.approve_customer_signup_request/.test(MIGRATION));
  assert.ok(/create or replace function public\.reject_customer_signup_request/.test(MIGRATION));
  // C2 lock + conditional claim preserved.
  assert.ok(/for update/.test(ONE), "approve keeps the request-row FOR UPDATE lock");
  assert.ok(/get diagnostics v_claimed = row_count/.test(ONE), "approve keeps the C2 conditional claim");
  // The existing customer.created(origin=signup) is preserved.
  assert.ok(/_log_customer_audit_event\( v_tenant, 'customer\.created'/.test(ONE));
  assert.ok(/'origin', 'signup', 'signup_request_id', p_request_id/.test(ONE));
  // The approved event is added AFTER the claim.
  assert.ok(/_log_customer_signup_request_audit_event\( v_tenant, 'customer_signup_request\.approved'/.test(ONE));
  // reject change-gates the event via RETURNING.
  assert.ok(/returning r\.name into v_name/.test(ONE), "reject captures the name via RETURNING");
  assert.ok(/_log_customer_signup_request_audit_event\( v_tenant, 'customer_signup_request\.rejected'/.test(ONE));
});

// ── 13. Guard: reframe — no platform/Tenant provisioning; submit untouched ──
test("guard: no platform/Tenant provisioning; submit + onboarding untouched", () => {
  assert.ok(
    !/create or replace function public\.submit_customer_signup_request\b/.test(MIGRATION),
    "submit RPC is NOT redefined",
  );
  assert.ok(
    !/create or replace function public\.create_tenant_with_owner\b/.test(MIGRATION),
    "create_tenant_with_owner is NOT redefined",
  );
  // No new table/column, no alter, no historical backfill, no rejection reason.
  assert.ok(!/create table/i.test(MIGRATION), "no table creation");
  assert.ok(!/alter table/i.test(MIGRATION), "no alter table");
  assert.ok(!ONE.includes("rejection_reason"), "no rejection_reason column/metadata");
  // No platform-admin TABLE / platform-signup QUEUE is introduced (code, not prose).
  assert.ok(!/create table[^;]*platform/i.test(MIGRATION), "no platform table created");
  // Exactly one audit_events insert (in the helper) — no historical backfill.
  assert.equal([...ONE.matchAll(/insert into public\.audit_events/g)].length, 1);
  // No migration-level mutation of signup requests / customers.
  assert.ok(!/^insert into public\.customer_signup_requests/im.test(MIGRATION));
  assert.ok(!/^update public\.customer_signup_requests/im.test(MIGRATION));
});

// ── 14. Guard: additive owner/admin RLS; prior clauses preserved ───────────
test("guard: signup rows owner/admin-only; prior clauses preserved; one policy", () => {
  assert.ok(
    /entity_type <> 'customer_signup_request' or public\.has_tenant_role\(tenant_id, array\['owner', 'admin'\]/.test(ONE),
    "signup clause owner/admin only",
  );
  for (const clause of [
    /can_access_customer\(tenant_id, entity_id\)/,
    /can_access_order\(tenant_id, entity_id\)/,
    /entity_type <> 'product' or public\.has_tenant_role/,
    /entity_type <> 'inventory' or public\.has_tenant_role/,
    /entity_type <> 'team' or public\.has_tenant_role/,
    /entity_type <> 'settings' or public\.has_tenant_role/,
    /entity_type <> 'sales_rep_assignment' or public\.has_tenant_role/,
  ]) {
    assert.ok(clause.test(ONE), `preserved clause ${clause}`);
  }
  assert.ok(/create policy "audit_events: members read; entity rows scoped"/.test(MIGRATION));
});

// ── 15. Guard: partial signup index ────────────────────────────────────────
test("guard: the tenant-wide Signup index is partial on entity_type=customer_signup_request", () => {
  assert.ok(
    /create index audit_events_tenant_customer_signup_time_idx on public\.audit_events \(tenant_id, created_at desc, id desc\) where entity_type = 'customer_signup_request'/.test(ONE),
    "partial signup index present",
  );
});

// ── 16. Guard: helper never CALLED from app (TS) code ──────────────────────
test("guard: the private helper is never invoked from app code", () => {
  for (const rel of [
    "lib/signup-request-audit.ts",
    "lib/signup-request-timeline.ts",
    "lib/actions/signup-timeline.ts",
    "lib/data/signup-timeline.ts",
  ]) {
    const src = readSrc(rel);
    assert.ok(!/\.rpc\(\s*["'`]_log_customer_signup_request_audit_event/.test(src), `${rel} must not rpc() the helper`);
    assert.ok(!/\b_log_customer_signup_request_audit_event\s*\(/.test(src), `${rel} must not call the helper`);
  }
});

// ── 17. Guard: no global Activity page; pure module ────────────────────────
test("guard: no global activity page; module is pure", () => {
  for (const p of [
    "app/[locale]/admin/activity",
    "app/[locale]/admin/audit",
    "components/admin/activity-log.tsx",
  ]) {
    assert.ok(!existsSync(join(process.cwd(), "src", p)), `${p} must not exist`);
  }
  const importLines = readSrc("lib/signup-request-audit.ts")
    .split("\n")
    .filter((l) => /^\s*import\b/.test(l));
  assert.ok(
    !importLines.some((l) => /(supabase-reads|supabase-writes|server-only|data\/)/.test(l)),
    "no server/data-layer import",
  );
});
