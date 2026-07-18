/**
 * Sales-Rep-Assignment audit test suite (M8I.5). Exercises the PRODUCTION
 * assignment audit taxonomy + label/category/sensitivity + source renderer + the
 * client-safe metadata projection, plus source-level guards for the transactional
 * / server-derived-actor / stale-access-closure / lifecycle-cleanup / owner-admin-RLS
 * / no-bulk-migration-mutation contract. Pure + zero-env: runs in mock mode.
 *
 * Runner: `npm run test:assignment-audit` (tsx → node:test).
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  AUDIT_CATEGORY_SALES_REP_ASSIGNMENT,
  SALES_REP_ASSIGNMENT_AUDIT_EVENT_KEYS,
  SALES_REP_ASSIGNMENT_SOURCES,
  isSalesRepAssignmentAuditEventKey,
  isSalesRepAssignmentSource,
  renderSalesRepAssignmentSource,
  resolveSalesRepAssignmentEventKey,
  safeAssignmentCustomerName,
  safeAssignmentRepEmail,
  safeAssignmentSource,
  salesRepAssignmentAuditCategory,
  salesRepAssignmentAuditEventLabel,
  salesRepAssignmentAuditSensitivity,
} from "./sales-rep-assignment-audit";
import {
  buildSalesRepAssignmentTimelineEvent,
  clientSafeSalesRepAssignmentMetadata,
} from "./sales-rep-assignment-timeline";
import { getDictionary } from "../i18n/dictionaries";

const LOCALES = ["ar", "he", "en"] as const;
const readSrc = (rel: string): string =>
  readFileSync(join(process.cwd(), "src", rel), "utf8");
const readRepo = (rel: string): string =>
  readFileSync(join(process.cwd(), rel), "utf8");
const MIGRATION = readRepo(
  "supabase/migrations/20260810100000_sales_rep_assignment_audit.sql",
);
const ONE = MIGRATION.replace(/\s+/g, " ");

const ev = (eventType: string, metadata: Record<string, unknown>) => ({
  eventType,
  metadata,
});

// ── 1. Closed taxonomy: exactly the 2 assignment events ────────────────────
test("every taxonomy key is recognized; length is the closed 2", () => {
  assert.equal(SALES_REP_ASSIGNMENT_AUDIT_EVENT_KEYS.length, 2);
  for (const k of SALES_REP_ASSIGNMENT_AUDIT_EVENT_KEYS)
    assert.ok(isSalesRepAssignmentAuditEventKey(k));
  assert.deepEqual([...SALES_REP_ASSIGNMENT_AUDIT_EVENT_KEYS], [
    "sales_rep_assignment.created",
    "sales_rep_assignment.removed",
  ]);
  // The Control-Room-excluded events do NOT exist.
  for (const gone of [
    "sales_rep_assignment.changed",
    "sales_rep_assignment.reassigned",
    "sales_rep_assignment.updated",
    "sales_rep_assignment.reactivated",
    "sales_rep_assignment.cleaned",
  ]) {
    assert.equal(resolveSalesRepAssignmentEventKey(gone), null, gone);
  }
});

// ── 2. Category + sensitivity (both medium) ────────────────────────────────
test("category is sales_rep_assignment; both events are medium", () => {
  assert.equal(salesRepAssignmentAuditCategory(), AUDIT_CATEGORY_SALES_REP_ASSIGNMENT);
  assert.equal(AUDIT_CATEGORY_SALES_REP_ASSIGNMENT, "sales_rep_assignment");
  assert.equal(salesRepAssignmentAuditSensitivity("sales_rep_assignment.created"), "medium");
  assert.equal(salesRepAssignmentAuditSensitivity("sales_rep_assignment.removed"), "medium");
  assert.equal(salesRepAssignmentAuditSensitivity("sales_rep_assignment.bogus"), "medium");
});

// ── 3. Source enum: exactly the 4 sources ──────────────────────────────────
test("source enum is the closed 4; created uses manual only (by contract)", () => {
  assert.deepEqual([...SALES_REP_ASSIGNMENT_SOURCES], [
    "manual",
    "member_removed",
    "role_changed",
    "member_joined",
  ]);
  for (const s of SALES_REP_ASSIGNMENT_SOURCES) assert.ok(isSalesRepAssignmentSource(s));
  for (const bad of ["customer_deleted", "cascade", "system", "migration", "reactivated"]) {
    assert.equal(isSalesRepAssignmentSource(bad), false, bad);
  }
});

// ── 4–6. ar/he/en labels + sources exist + non-empty ───────────────────────
for (const locale of LOCALES) {
  test(`${locale}: every event + source + chrome label is non-empty`, () => {
    const dict = getDictionary(locale);
    const a = dict.audit.assignment;
    assert.ok(a.category.length > 0);
    assert.ok(a.timelineHeading.length > 0);
    assert.ok(a.customer.length > 0);
    assert.ok(a.representative.length > 0);
    for (const k of SALES_REP_ASSIGNMENT_AUDIT_EVENT_KEYS) {
      assert.ok(salesRepAssignmentAuditEventLabel(k, dict).length > 0, `${locale} ${k}`);
    }
    for (const s of [
      "createdManual",
      "removedManual",
      "member_removed",
      "role_changed",
      "member_joined",
    ] as const) {
      assert.ok(a.sources[s].length > 0, `${locale} source ${s}`);
    }
  });
}

// ── 7. No "Other"; explicit unknown fallback ───────────────────────────────
test("no label is 'Other'; unknown resolves to the explicit unknown label", () => {
  for (const locale of LOCALES) {
    const dict = getDictionary(locale);
    for (const k of SALES_REP_ASSIGNMENT_AUDIT_EVENT_KEYS) {
      assert.ok(!/^other$/i.test(salesRepAssignmentAuditEventLabel(k, dict)));
    }
  }
  const dict = getDictionary("en");
  assert.equal(
    salesRepAssignmentAuditEventLabel("sales_rep_assignment.bogus", dict),
    dict.audit.unknownEvent,
  );
  assert.equal(renderSalesRepAssignmentSource(ev("sales_rep_assignment.bogus", { source: "manual" }), dict), null);
});

// ── 8. Source renderer: created→manual label; each removed source ──────────
test("renderSalesRepAssignmentSource maps event+source to the right line", () => {
  const dict = getDictionary("en");
  const s = dict.audit.assignment.sources;
  assert.equal(
    renderSalesRepAssignmentSource(ev("sales_rep_assignment.created", { source: "manual" }), dict),
    s.createdManual,
  );
  assert.equal(
    renderSalesRepAssignmentSource(ev("sales_rep_assignment.removed", { source: "manual" }), dict),
    s.removedManual,
  );
  assert.equal(
    renderSalesRepAssignmentSource(ev("sales_rep_assignment.removed", { source: "member_removed" }), dict),
    s.member_removed,
  );
  assert.equal(
    renderSalesRepAssignmentSource(ev("sales_rep_assignment.removed", { source: "role_changed" }), dict),
    s.role_changed,
  );
  assert.equal(
    renderSalesRepAssignmentSource(ev("sales_rep_assignment.removed", { source: "member_joined" }), dict),
    s.member_joined,
  );
  // A malformed / missing source produces NO line.
  assert.equal(renderSalesRepAssignmentSource(ev("sales_rep_assignment.removed", { source: "bogus" }), dict), null);
  assert.equal(renderSalesRepAssignmentSource(ev("sales_rep_assignment.removed", {}), dict), null);
});

// ── 9. member_joined wording does NOT imply a fresh assignment was removed ──
test("member_joined copy reads as a PREVIOUS/old assignment cleanup, per locale", () => {
  const expected = {
    en: /previous/i,
    ar: /قديم/,
    he: /ישן/,
  } as const;
  for (const locale of LOCALES) {
    const dict = getDictionary(locale);
    assert.ok(expected[locale].test(dict.audit.assignment.sources.member_joined), locale);
  }
});

// ── 10. Safe extractors ────────────────────────────────────────────────────
test("safe extractors accept valid values and reject the rest", () => {
  assert.equal(safeAssignmentRepEmail({ rep_email: "a@b.local" }), "a@b.local");
  assert.equal(safeAssignmentRepEmail({ rep_email: "" }), null);
  assert.equal(safeAssignmentRepEmail({ rep_email: "x".repeat(255) }), null);
  assert.equal(safeAssignmentRepEmail({ rep_email: 42 }), null);
  assert.equal(safeAssignmentCustomerName({ customer_name: "Shop" }), "Shop");
  assert.equal(safeAssignmentCustomerName({ customer_name: "" }), null);
  assert.equal(safeAssignmentCustomerName({ customer_name: "x".repeat(201) }), null);
  for (const s of SALES_REP_ASSIGNMENT_SOURCES) assert.equal(safeAssignmentSource(s), s);
  assert.equal(safeAssignmentSource("cascade"), undefined);
  assert.equal(safeAssignmentSource(null), undefined);
});

// ── 11. Client-safe projection: rep_user_id + secrets NEVER cross ──────────
test("clientSafeSalesRepAssignmentMetadata projects ONLY the safe render keys", () => {
  const out = clientSafeSalesRepAssignmentMetadata("sales_rep_assignment.created", {
    rep_user_id: "11111111-1111-4111-8111-111111111111",
    rep_email: "rep@t.local",
    customer_name: "Shop A",
    source: "manual",
    token: "raw-secret",
    jwt: "eyJ...",
    phone: "+972-...",
  });
  // rep_user_id is intentionally dropped (never rendered) — no raw UUID crosses.
  assert.deepEqual(out, {
    rep_email: "rep@t.local",
    customer_name: "Shop A",
    source: "manual",
  });
  assert.ok(!("rep_user_id" in out));
  assert.ok(!("token" in out));
  assert.ok(!("phone" in out));
  // A malformed value under a known key is omitted; an invalid source is dropped.
  assert.deepEqual(
    clientSafeSalesRepAssignmentMetadata("sales_rep_assignment.removed", {
      rep_email: "",
      customer_name: "Shop B",
      source: "cascade",
    }),
    { customer_name: "Shop B" },
  );
  // Unknown event type → {}.
  assert.deepEqual(
    clientSafeSalesRepAssignmentMetadata("sales_rep_assignment.bogus", { rep_email: "x@t.local" }),
    {},
  );
});

// ── 12. buildSalesRepAssignmentTimelineEvent: safe row + category + sensitivity ─
test("buildSalesRepAssignmentTimelineEvent yields a safe row (no uuid/secret keys)", () => {
  const built = buildSalesRepAssignmentTimelineEvent({
    id: "9",
    eventType: "sales_rep_assignment.removed",
    createdAt: "2026-07-12T10:00:00Z",
    actor: { kind: "unknown" },
    metadata: {
      rep_user_id: "11111111-1111-4111-8111-111111111111",
      rep_email: "gone@t.local",
      customer_name: "Shop C",
      source: "member_removed",
      token: "x",
    },
  });
  assert.equal(built.category, "sales_rep_assignment");
  assert.equal(built.sensitivity, "medium");
  assert.deepEqual(built.metadata, {
    rep_email: "gone@t.local",
    customer_name: "Shop C",
    source: "member_removed",
  });
  assert.ok(!("rep_user_id" in built.metadata));
  assert.ok(!("token" in built.metadata));
});

// ── 13. Guard: closed helper; server-derived actor; entity hardcoded; revoked ─
test("guard: closed helper; server actor; per-event key allowlist; assignment entity", () => {
  assert.ok(/auth\.uid\(\)/.test(MIGRATION), "actor via auth.uid()");
  assert.ok(!/p_actor/.test(MIGRATION), "no client actor param");
  // The four keys are validated + the two event types allowlisted.
  for (const k of SALES_REP_ASSIGNMENT_AUDIT_EVENT_KEYS) {
    assert.ok(MIGRATION.includes(`'${k}'`), `DB allowlist missing ${k}`);
  }
  assert.ok(/rep_user_id, rep_email, customer_name, source/.test(MIGRATION), "exact 4-key rule");
  assert.ok(/created source must be manual/.test(MIGRATION));
  assert.ok(/removed source is not allowed/.test(MIGRATION));
  assert.ok(/metadata exceeds the size bound/.test(MIGRATION));
  assert.ok(/metadata must be a JSON object/.test(MIGRATION));
  // entity_type is hardcoded to 'sales_rep_assignment' in the insert.
  assert.ok(/p_event_type, 'sales_rep_assignment', p_entity_id, v_meta/.test(ONE));
  // Both private helpers are revoked from every client role.
  assert.ok(
    /revoke all on function public\._log_sales_rep_assignment_audit_event\([^)]*\) from public, anon, authenticated/i.test(ONE),
    "log helper revoked from all client roles",
  );
  assert.ok(
    /revoke all on function public\._purge_rep_assignments\([^)]*\) from public, anon, authenticated/i.test(ONE),
    "purge helper revoked from all client roles",
  );
});

// ── 14. Guard: app taxonomy + sources match the DB EXACTLY ─────────────────
test("app taxonomy + source allowlist match the DB EXACTLY", () => {
  const dbTypes = [...MIGRATION.matchAll(/'(sales_rep_assignment\.[a-z_]+)'/g)].map((m) => m[1]);
  for (const t of new Set(dbTypes)) {
    assert.ok(isSalesRepAssignmentAuditEventKey(t), `DB emits ${t} not in the app taxonomy`);
  }
  // The DB source strings used by the producers are all app-recognized.
  for (const s of ["manual", "member_removed", "role_changed", "member_joined"]) {
    assert.ok(ONE.includes(`'${s}'`), `DB missing source ${s}`);
    assert.ok(isSalesRepAssignmentSource(s));
  }
});

// ── 15. Guard: access-predicate hardening (current sales_rep membership) ────
test("guard: can_access_customer/order require a current sales_rep membership", () => {
  assert.ok(
    /create or replace function public\.can_access_customer/.test(MIGRATION),
    "can_access_customer redefined",
  );
  assert.ok(
    /create or replace function public\.can_access_order/.test(MIGRATION),
    "can_access_order redefined",
  );
  // Both bodies join tenant_users and require the current sales_rep role.
  const joinCount = [...ONE.matchAll(/join public\.tenant_users tu on tu\.tenant_id = a\.tenant_id and tu\.user_id = a\.user_id/g)].length;
  assert.ok(joinCount >= 2, `expected ≥2 current-membership joins, got ${joinCount}`);
  const roleCount = [...ONE.matchAll(/tu\.role = 'sales_rep'/g)].length;
  assert.ok(roleCount >= 2, `expected ≥2 current-sales_rep role checks, got ${roleCount}`);
});

// ── 16. Guard: lifecycle cleanup wired into the FIVE RPCs with the right source ─
test("guard: role/removal/join RPCs purge assignments transactionally", () => {
  // The five lifecycle RPCs are redefined (incl. demote — owner→sales_rep entry).
  for (const fn of [
    "update_tenant_member_role",
    "remove_tenant_member",
    "promote_tenant_owner",
    "demote_tenant_owner",
    "accept_tenant_invite",
  ]) {
    assert.ok(
      new RegExp(`create or replace function public\\.${fn}\\b`).test(MIGRATION),
      `${fn} redefined`,
    );
  }
  // Each cleanup path passes the correct source into the purge helper.
  assert.ok(/_purge_rep_assignments\(v_tenant, p_user_id, v_email, 'role_changed'\)/.test(ONE));
  assert.ok(/_purge_rep_assignments\(v_tenant, p_user_id, v_email, 'member_removed'\)/.test(ONE));
  assert.ok(/_purge_rep_assignments\(v_inv\.tenant_id, v_uid, lower\(btrim\(v_inv\.email\)\), 'member_joined'\)/.test(ONE));
  // role_changed cleanup fires when sales_rep is on EITHER side of the change.
  assert.ok(/if v_current = 'sales_rep' or p_new_role = 'sales_rep' then/.test(ONE), "entry+exit gate");
});

// ── 17. Guard: no MIGRATION-LEVEL bulk mutation of business rows ────────────
test("guard: assignment/audit DML lives ONLY inside the RPC bodies (no backfill)", () => {
  // Exactly one INSERT into sales_rep_customers (assign) and two DELETEs
  // (unassign + purge) — all inside function bodies; NO stray migration-level DML.
  assert.equal([...ONE.matchAll(/insert into public\.sales_rep_customers/g)].length, 1);
  assert.equal([...ONE.matchAll(/delete from public\.sales_rep_customers/g)].length, 2);
  // The only audit_events INSERT is inside the log helper (no historical backfill).
  assert.equal([...ONE.matchAll(/insert into public\.audit_events/g)].length, 1);
  // create_tenant_with_owner is NOT redefined (stale rows structurally impossible).
  assert.ok(
    !/create or replace function public\.create_tenant_with_owner\b/.test(MIGRATION),
    "onboarding RPC not redefined",
  );
  // No table/column drop, no bulk UPDATE of the assignment table.
  assert.ok(!/drop table/i.test(MIGRATION));
  assert.ok(!/update public\.sales_rep_customers/i.test(MIGRATION));
});

// ── 18. Guard: additive owner/admin RLS; prior clauses preserved; one policy ─
test("guard: assignment rows owner/admin-only; prior clauses preserved", () => {
  assert.ok(
    /entity_type <> 'sales_rep_assignment' or public\.has_tenant_role\(tenant_id, array\['owner', 'admin'\]/.test(ONE),
    "assignment clause owner/admin only",
  );
  for (const clause of [
    /can_access_customer\(tenant_id, entity_id\)/,
    /can_access_order\(tenant_id, entity_id\)/,
    /entity_type <> 'product' or public\.has_tenant_role/,
    /entity_type <> 'inventory' or public\.has_tenant_role/,
    /entity_type <> 'team' or public\.has_tenant_role/,
    /entity_type <> 'settings' or public\.has_tenant_role/,
  ]) {
    assert.ok(clause.test(ONE), `preserved clause ${clause}`);
  }
  assert.ok(/drop policy if exists .* on public\.audit_events/i.test(ONE));
  assert.ok(/create policy "audit_events: members read; entity rows scoped"/.test(MIGRATION));
});

// ── 19. Guard: partial tenant-wide assignment index ────────────────────────
test("guard: the tenant-wide Assignment index is partial on entity_type=sales_rep_assignment", () => {
  assert.ok(
    /create index audit_events_tenant_assignment_time_idx on public\.audit_events \(tenant_id, created_at desc, id desc\) where entity_type = 'sales_rep_assignment'/.test(ONE),
    "partial assignment index present",
  );
});

// ── 20. Guard: private helpers never CALLED from app (TS) code ─────────────
test("guard: the private helpers are never invoked from app code", () => {
  for (const rel of [
    "lib/sales-rep-assignment-audit.ts",
    "lib/sales-rep-assignment-timeline.ts",
    "lib/actions/assignment-timeline.ts",
    "lib/data/assignment-timeline.ts",
  ]) {
    const src = readSrc(rel);
    for (const helper of ["_log_sales_rep_assignment_audit_event", "_purge_rep_assignments"]) {
      assert.ok(!new RegExp(`\\.rpc\\(\\s*["'\`]${helper}`).test(src), `${rel} must not rpc() ${helper}`);
      assert.ok(!new RegExp(`\\b${helper}\\s*\\(`).test(src), `${rel} must not call ${helper}`);
    }
  }
});

// ── 21. Guard: no global Activity page; pure module; no branch/warehouse ────
test("guard: no global activity page; module is pure; no branch scope", () => {
  for (const p of [
    "app/[locale]/admin/activity",
    "app/[locale]/admin/audit",
    "components/admin/activity-log.tsx",
  ]) {
    assert.ok(!existsSync(join(process.cwd(), "src", p)), `${p} must not exist`);
  }
  const importLines = readSrc("lib/sales-rep-assignment-audit.ts")
    .split("\n")
    .filter((l) => /^\s*import\b/.test(l));
  assert.ok(
    !importLines.some((l) => /(supabase-reads|supabase-writes|server-only|data\/)/.test(l)),
    "no server/data-layer import",
  );
  assert.ok(
    !/array\['[^\]]*(branch|warehouse|territory|commission|quota)[^\]]*'\]/i.test(ONE),
    "no branch/CRM metadata key",
  );
});

// ── 22. Guard: assignment RPC signatures + DEFINER preserved ────────────────
test("guard: the assignment RPCs are redefined with unchanged signatures", () => {
  for (const s of [
    "create or replace function public.assign_customer_to_rep( p_tenant_id uuid, p_user_id uuid, p_customer_id uuid )",
    "create or replace function public.unassign_customer_from_rep( p_tenant_id uuid, p_user_id uuid, p_customer_id uuid )",
  ]) {
    assert.ok(ONE.includes(s), `signature preserved: ${s.slice(0, 48)}…`);
  }
  // assign locks membership then customer (FOR UPDATE appears in the body).
  assert.ok(/for update/.test(ONE), "assignment RPCs carry FOR UPDATE locks");
});
