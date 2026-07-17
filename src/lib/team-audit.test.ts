/**
 * Team/Access audit test suite (M8I.3). Exercises the PRODUCTION team audit
 * taxonomy + label/category/sensitivity mapping + safe details renderer + the
 * client-safe metadata projection, plus source-level guards for the
 * transactional / server-derived-actor / unified-target_email / owner-admin-RLS /
 * deterministic-lock / no-op / capture-before-delete / signup-excluded contract.
 * Pure + zero-env: runs in mock mode with no Supabase.
 *
 * Runner: `npm run test:team-audit` (tsx → node:test).
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  AUDIT_CATEGORY_TEAM,
  TEAM_AUDIT_EVENT_KEYS,
  TEAM_AUDIT_ROLES,
  isTeamAuditEventKey,
  renderTeamAuditDetails,
  resolveTeamEventKey,
  safeTeamRole,
  safeTeamTargetEmail,
  teamAuditCategory,
  teamAuditEventLabel,
  teamAuditSensitivity,
} from "./team-audit";
import {
  buildTeamTimelineEvent,
  clientSafeTeamMetadata,
} from "./team-timeline";
import { getDictionary } from "../i18n/dictionaries";

const LOCALES = ["ar", "he", "en"] as const;
const readSrc = (rel: string): string =>
  readFileSync(join(process.cwd(), "src", rel), "utf8");
const readRepo = (rel: string): string =>
  readFileSync(join(process.cwd(), rel), "utf8");
const MIGRATION = readRepo(
  "supabase/migrations/20260808100000_team_access_audit.sql",
);
const ONE = MIGRATION.replace(/\s+/g, " ");

const ev = (eventType: string, metadata: Record<string, unknown>) => ({
  eventType,
  metadata,
});

// ── 1. Closed taxonomy: exactly the 5 team events ──────────────────────────
test("every taxonomy key is recognized; length is the closed 5", () => {
  assert.equal(TEAM_AUDIT_EVENT_KEYS.length, 5);
  for (const k of TEAM_AUDIT_EVENT_KEYS) assert.ok(isTeamAuditEventKey(k));
  assert.deepEqual([...TEAM_AUDIT_EVENT_KEYS], [
    "team.member_invited",
    "team.invitation_revoked",
    "team.member_joined",
    "team.role_changed",
    "team.member_removed",
  ]);
  // The Control-Room-excluded events do NOT exist.
  for (const gone of [
    "team.member_added",
    "team.member_disabled",
    "team.member_enabled",
    "team.invitation_resent",
    "team.updated",
  ]) {
    assert.equal(resolveTeamEventKey(gone), null, gone);
  }
});

// ── 2. Category + sensitivity (owner-touching → high) ──────────────────────
test("category is team; sensitivity is high only when owner is involved", () => {
  assert.equal(teamAuditCategory(), AUDIT_CATEGORY_TEAM);
  assert.equal(AUDIT_CATEGORY_TEAM, "team");
  // Plain lifecycle → medium.
  assert.equal(teamAuditSensitivity("team.member_invited", { role: "admin" }), "medium");
  assert.equal(teamAuditSensitivity("team.member_joined", { role: "sales_rep" }), "medium");
  assert.equal(teamAuditSensitivity("team.invitation_revoked", { role: "admin" }), "medium");
  // Role change touching owner → high; otherwise medium.
  assert.equal(
    teamAuditSensitivity("team.role_changed", { from_role: "sales_rep", to_role: "owner" }),
    "high",
  );
  assert.equal(
    teamAuditSensitivity("team.role_changed", { from_role: "owner", to_role: "admin" }),
    "high",
  );
  assert.equal(
    teamAuditSensitivity("team.role_changed", { from_role: "admin", to_role: "sales_rep" }),
    "medium",
  );
  // Removal of an owner → high; otherwise medium.
  assert.equal(teamAuditSensitivity("team.member_removed", { role: "owner" }), "high");
  assert.equal(teamAuditSensitivity("team.member_removed", { role: "sales_rep" }), "medium");
  // Unknown → medium (never under-classified).
  assert.equal(teamAuditSensitivity("team.bogus"), "medium");
});

// ── 3–5. ar/he/en labels exist + non-empty ─────────────────────────────────
for (const locale of LOCALES) {
  test(`${locale}: every event + category + chrome label is non-empty`, () => {
    const dict = getDictionary(locale);
    assert.ok(dict.audit.team.category.length > 0);
    assert.ok(dict.audit.team.timelineHeading.length > 0);
    assert.ok(dict.audit.team.targetMember.length > 0);
    assert.ok(dict.audit.team.details.role.includes("{role}"));
    assert.ok(dict.audit.team.details.roleChange.includes("{from}"));
    assert.ok(dict.audit.team.details.roleChange.includes("{to}"));
    for (const k of TEAM_AUDIT_EVENT_KEYS) {
      assert.ok(teamAuditEventLabel(k, dict).length > 0, `${locale} ${k}`);
    }
    // Roles reuse the shared session role labels.
    for (const r of TEAM_AUDIT_ROLES) {
      assert.ok(dict.access.session.roles[r].length > 0, `${locale} ${r}`);
    }
  });
}

// ── 6. No "Other"; explicit unknown fallback ───────────────────────────────
test("no label is 'Other'; unknown resolves to the explicit unknown label", () => {
  for (const locale of LOCALES) {
    const dict = getDictionary(locale);
    assert.ok(!/^other$/i.test(dict.audit.unknownEvent));
    for (const k of TEAM_AUDIT_EVENT_KEYS) {
      assert.ok(!/^other$/i.test(teamAuditEventLabel(k, dict)));
    }
  }
  const dict = getDictionary("en");
  assert.equal(teamAuditEventLabel("team.bogus", dict), dict.audit.unknownEvent);
  assert.deepEqual(renderTeamAuditDetails(ev("team.bogus", {}), dict), []);
});

// ── 7. Details: role line + role transition ────────────────────────────────
test("renderTeamAuditDetails renders localized role / from→to lines", () => {
  const dict = getDictionary("en");
  assert.deepEqual(
    renderTeamAuditDetails(ev("team.member_invited", { target_email: "x@t.local", role: "sales_rep" }), dict),
    [`Role: ${dict.access.session.roles.sales_rep}`],
  );
  const rc = renderTeamAuditDetails(
    ev("team.role_changed", { target_email: "x@t.local", from_role: "admin", to_role: "owner" }),
    dict,
  );
  assert.equal(rc.length, 1);
  assert.ok(rc[0].includes(dict.access.session.roles.admin));
  assert.ok(rc[0].includes(dict.access.session.roles.owner));
  // A malformed role produces NO line rather than leaking anything.
  assert.deepEqual(
    renderTeamAuditDetails(ev("team.role_changed", { from_role: "root", to_role: "x" }), dict),
    [],
  );
});

// ── 8. safeTeamTargetEmail + safeTeamRole ──────────────────────────────────
test("safe extractors accept valid values and reject the rest", () => {
  assert.equal(safeTeamTargetEmail({ target_email: "a@b.local" }), "a@b.local");
  assert.equal(safeTeamTargetEmail({ target_email: "" }), null);
  assert.equal(safeTeamTargetEmail({ target_email: "x".repeat(255) }), null);
  assert.equal(safeTeamTargetEmail({}), null);
  assert.equal(safeTeamTargetEmail({ target_email: 42 }), null);
  for (const r of TEAM_AUDIT_ROLES) assert.equal(safeTeamRole(r), r);
  assert.equal(safeTeamRole("root"), undefined);
  assert.equal(safeTeamRole(null), undefined);
});

// ── 9. Client-safe projection: only target_email + safe role enums cross ───
test("clientSafeTeamMetadata projects ONLY allowlisted, validated keys", () => {
  // A hostile payload with token/hash/url/unknown-role must be stripped.
  const out = clientSafeTeamMetadata("team.member_invited", {
    target_email: "rep@t.local",
    role: "sales_rep",
    token: "raw-secret",
    token_hash: "deadbeef",
    acceptance_url: "https://x/y",
    jwt: "eyJ...",
  });
  assert.deepEqual(out, { target_email: "rep@t.local", role: "sales_rep" });
  // role_changed keeps from/to; drops an invalid role value.
  assert.deepEqual(
    clientSafeTeamMetadata("team.role_changed", {
      target_email: "x@t.local",
      from_role: "admin",
      to_role: "owner",
      role: "sales_rep", // wrong key for this event → dropped
    }),
    { target_email: "x@t.local", from_role: "admin", to_role: "owner" },
  );
  assert.deepEqual(
    clientSafeTeamMetadata("team.role_changed", { from_role: "root", to_role: "owner" }),
    { to_role: "owner" },
  );
  // Unknown event type → {}.
  assert.deepEqual(clientSafeTeamMetadata("team.bogus", { target_email: "x@t.local" }), {});
});

// ── 10. buildTeamTimelineEvent: safe row with derived sensitivity ──────────
test("buildTeamTimelineEvent yields a safe row (no secret keys) + sensitivity", () => {
  const built = buildTeamTimelineEvent({
    id: "9",
    eventType: "team.member_removed",
    createdAt: "2026-07-12T10:00:00Z",
    actor: { kind: "unknown" },
    metadata: { target_email: "gone@t.local", role: "owner", token: "x" },
  });
  assert.equal(built.category, "team");
  assert.equal(built.sensitivity, "high"); // removed owner
  assert.deepEqual(built.metadata, { target_email: "gone@t.local", role: "owner" });
  assert.ok(!("token" in built.metadata));
});

// ── 11. Guard: helper is server-derived, closed, revoked, entity_type=team ─
test("guard: closed helper; server-derived actor; per-event key allowlist; team entity", () => {
  assert.ok(/auth\.uid\(\)/.test(MIGRATION), "actor via auth.uid()");
  assert.ok(!/p_actor/.test(MIGRATION), "no client actor param");
  // target_email is resolved inside the producer — NEVER a public RPC parameter.
  assert.ok(!/p_target_email/.test(MIGRATION), "target_email is not an RPC parameter");
  for (const k of TEAM_AUDIT_EVENT_KEYS) {
    assert.ok(MIGRATION.includes(`'${k}'`), `DB allowlist missing ${k}`);
  }
  assert.ok(/unknown team event type/.test(MIGRATION));
  assert.ok(/metadata exceeds the size bound/.test(MIGRATION));
  assert.ok(/metadata must be a JSON object/.test(MIGRATION));
  assert.ok(/metadata key % is not allowed for/.test(MIGRATION));
  assert.ok(/target_email is missing or not normalized/.test(MIGRATION));
  assert.ok(/role values must be owner\/admin\/sales_rep/.test(MIGRATION));
  // entity_type is hardcoded to 'team' in the insert.
  assert.ok(/p_event_type, 'team', p_entity_id, v_meta/.test(ONE));
  assert.ok(
    /revoke all on function public\._log_team_audit_event\([^)]*\)\s*from public, anon, authenticated/i.test(ONE),
    "helper revoked from all client roles",
  );
});

// ── 12. Guard: app taxonomy matches the DB allowlist EXACTLY ───────────────
test("app taxonomy matches the DB helper allowlist EXACTLY", () => {
  const dbTypes = [...MIGRATION.matchAll(/'(team\.[a-z_]+)'/g)].map((m) => m[1]);
  for (const t of new Set(dbTypes)) {
    assert.ok(isTeamAuditEventKey(t), `DB emits ${t} which is not in the app taxonomy`);
  }
});

// ── 13. Guard: deterministic owner lock + invitation lock ──────────────────
test("guard: owner-sensitive RPCs lock owners+target in user_id order; invites locked", () => {
  const ownerRpcs = [
    "update_tenant_member_role",
    "remove_tenant_member",
    "promote_tenant_owner",
    "demote_tenant_owner",
  ];
  // Each owner-sensitive RPC carries the identical ordered lock predicate.
  const lockCount = [...ONE.matchAll(/\(role = 'owner' or user_id = p_user_id\) order by user_id for update/g)].length;
  assert.ok(lockCount >= ownerRpcs.length, `expected ≥${ownerRpcs.length} ordered owner locks, got ${lockCount}`);
  // accept + revoke lock the invitation row.
  assert.ok(/select \* into v_inv from public\.tenant_invitations where token_hash = v_hash for update/.test(ONE));
  assert.ok(/from public\.tenant_invitations i where i\.id = p_invite_id and i\.tenant_id = v_tenant for update/.test(ONE));
});

// ── 14. Guard: no-op role gate + change-gated revoke + capture-before-delete ─
test("guard: no-op guard, revoke change-gate, and pre-delete capture", () => {
  assert.ok(/if v_current = p_new_role then return; end if/.test(ONE), "same-role is a no-op");
  assert.ok(/if v_inv\.revoked_at is null then/.test(ONE), "revoke is change-gated");
  // The removed-member email is captured BEFORE the delete.
  assert.ok(
    /into v_email from auth\.users u where u\.id = p_user_id; delete from public\.tenant_users/.test(ONE),
    "target email captured immediately before the hard delete",
  );
});

// ── 15. Guard: additive owner/admin team RLS; others preserved; concise name ─
test("guard: team audit rows owner/admin-only; customer/order/product/inventory preserved", () => {
  assert.ok(
    /entity_type <> 'team' or public\.has_tenant_role\(tenant_id, array\['owner', 'admin'\]/.test(ONE),
    "team clause owner/admin only",
  );
  assert.ok(/can_access_customer\(tenant_id, entity_id\)/.test(ONE), "customer clause preserved");
  assert.ok(/can_access_order\(tenant_id, entity_id\)/.test(ONE), "order clause preserved");
  assert.ok(/entity_type <> 'product' or public\.has_tenant_role/.test(ONE), "product clause preserved");
  assert.ok(/entity_type <> 'inventory' or public\.has_tenant_role/.test(ONE), "inventory clause preserved");
  assert.ok(/drop policy if exists .* on public\.audit_events/i.test(ONE));
  // Concise policy name (well under the 63-byte identifier limit).
  assert.ok(/create policy "audit_events: members read; entity rows scoped"/.test(MIGRATION));
});

// ── 16. Guard: partial tenant-wide team index ──────────────────────────────
test("guard: the tenant-wide Team index is partial on entity_type=team", () => {
  assert.ok(
    /create index audit_events_tenant_type_time_idx on public\.audit_events \(tenant_id, created_at desc, id desc\) where entity_type = 'team'/.test(ONE),
    "partial team index present",
  );
});

// ── 17. Guard: the private helper is never CALLED from app (TS) code ────────
test("guard: the private audit helper is never invoked from app code", () => {
  for (const rel of [
    "lib/team-audit.ts",
    "lib/team-timeline.ts",
    "lib/actions/team.ts",
    "lib/actions/team-timeline.ts",
    "lib/data/team.ts",
    "lib/data/team-timeline.ts",
  ]) {
    const src = readSrc(rel);
    assert.ok(!/\.rpc\(\s*["'`]_log_team_audit_event/.test(src), `${rel} must not rpc() the helper`);
    assert.ok(!/\b_log_team_audit_event\s*\(/.test(src), `${rel} must not call the helper`);
  }
});

// ── 18. Guard: signup / platform onboarding are NOT audited here ────────────
test("guard: create_tenant_with_owner + signup RPCs are NOT redefined", () => {
  for (const fn of [
    "create_tenant_with_owner",
    "approve_signup_request",
    "reject_signup_request",
    "submit_signup_request",
  ]) {
    assert.ok(
      !new RegExp(`create or replace function public\\.${fn}\\b`).test(MIGRATION),
      `${fn} must not be redefined`,
    );
  }
});

// ── 19. Guard: no global Activity page; pure module; no branch/warehouse scope ─
test("guard: no global activity page; team-audit.ts is pure; no branch scope", () => {
  for (const p of [
    "app/[locale]/admin/activity",
    "app/[locale]/admin/audit",
    "components/admin/activity-log.tsx",
  ]) {
    assert.ok(!existsSync(join(process.cwd(), "src", p)), `${p} must not exist`);
  }
  const importLines = readSrc("lib/team-audit.ts")
    .split("\n")
    .filter((l) => /^\s*import\b/.test(l));
  assert.ok(
    !importLines.some((l) => /(supabase-reads|supabase-writes|server-only|data\/)/.test(l)),
    "no server/data-layer import",
  );
  // No branch/warehouse SCOPE key is ever introduced into the audit metadata
  // allowlist (the prose comments correctly DISCLAIM branches, so scope the check
  // to the allowlist arrays, not the whole file).
  assert.ok(
    !/array\['[^\]]*(branch|warehouse)[^\]]*'\]/i.test(ONE),
    "no branch/warehouse metadata key",
  );
});

// ── 20. Guard: the seven redefined RPCs keep their public signatures ────────
test("guard: the seven Team RPCs are redefined with unchanged signatures", () => {
  const sigs = [
    "create or replace function public.create_tenant_invite( p_tenant_id uuid, p_email text, p_role public.tenant_role, p_token_hash text, p_token_preview text default null, p_expires_at timestamptz default null )",
    "create or replace function public.revoke_tenant_invite(p_tenant_id uuid, p_invite_id uuid)",
    "create or replace function public.accept_tenant_invite(p_token text)",
    "create or replace function public.update_tenant_member_role( p_tenant_id uuid, p_user_id uuid, p_new_role public.tenant_role )",
    "create or replace function public.remove_tenant_member(p_tenant_id uuid, p_user_id uuid)",
    "create or replace function public.promote_tenant_owner( p_tenant_id uuid, p_user_id uuid )",
    "create or replace function public.demote_tenant_owner( p_tenant_id uuid, p_user_id uuid, p_new_role public.tenant_role )",
  ];
  for (const s of sigs) {
    assert.ok(ONE.includes(s), `signature preserved: ${s.slice(0, 48)}…`);
  }
});
