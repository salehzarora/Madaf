-- ═══════════════════════════════════════════════════════════════════════
-- pgTAP — M8I.3 TEAM & ACCESS AUDIT (PILOT-OPS-AUDIT-003)
--
-- Verifies the transactional Team/Access producers on public.audit_events:
--   • the private helper is SECURITY INVOKER, search_path='', executable by NO
--     client role; closed 5-event allowlist; entity_type fixed to 'team';
--     metadata a bounded JSON object with per-event allowlisted keys, an
--     enum-checked role, and a NORMALIZED target_email;
--   • each SUCCESSFUL mutation writes exactly the right event(s) with a unified
--     target_email resolved from an authoritative source, and NO event for a
--     no-op / re-revoke / blocked / unauthorized / cross-tenant / last-owner call;
--   • the member_removed / member_joined snapshots stay legible after the member
--     is deleted from tenant_users;
--   • the audit_events RLS policy scopes TEAM rows to owner/admin (a sales_rep
--     reads none; another tenant reads none), leaving the customer/order/product/
--     inventory clauses intact;
--   • every redefined RPC keeps its signature / DEFINER / search_path / grants,
--     and carries the deterministic FOR UPDATE lock.
--
-- Run with the local stack up:  supabase test db
-- Disposable tenants T + T2 in THIS transaction; everything rolls back.
-- No real secrets — controlled local fixtures only (tokens are throwaway).
-- ═══════════════════════════════════════════════════════════════════════
begin;
select plan(90);

set local request.jwt.claims = '{"role":"service_role"}';

-- ── Fixtures (auth users carry emails — the authoritative target source) ────
insert into auth.users (id, email) values
  ('10000000-0000-4000-8000-000000000001', 'owner@t.local'),
  ('10000000-0000-4000-8000-000000000002', 'owner2@t.local'),
  ('10000000-0000-4000-8000-000000000003', 'owner3@t.local'),
  ('10000000-0000-4000-8000-000000000004', 'admin@t.local'),
  ('10000000-0000-4000-8000-000000000005', 'rep@t.local'),
  ('10000000-0000-4000-8000-000000000006', 'member@t.local'),
  ('10000000-0000-4000-8000-000000000007', 'joiner@t.local'),
  ('10000000-0000-4000-8000-000000000008', 'mismatch@t.local'),
  ('10000000-0000-4000-8000-000000000009', 'revme@t.local'),
  ('10000000-0000-4000-8000-00000000000a', 'expme@t.local'),
  ('20000000-0000-4000-8000-000000000001', 'owner@t2.local');
insert into public.tenants (id, name_ar, name_he, name_en) values
  ('33333333-3333-4333-8333-333333333333', 'ت', 'ט', 'T'),
  ('44444444-4444-4444-8444-444444444444', 'ت٢', 'ט٢', 'T2');
insert into public.tenant_users (tenant_id, user_id, role) values
  ('33333333-3333-4333-8333-333333333333', '10000000-0000-4000-8000-000000000001', 'owner'),
  ('33333333-3333-4333-8333-333333333333', '10000000-0000-4000-8000-000000000002', 'owner'),
  ('33333333-3333-4333-8333-333333333333', '10000000-0000-4000-8000-000000000003', 'owner'),
  ('33333333-3333-4333-8333-333333333333', '10000000-0000-4000-8000-000000000004', 'admin'),
  ('33333333-3333-4333-8333-333333333333', '10000000-0000-4000-8000-000000000005', 'sales_rep'),
  ('33333333-3333-4333-8333-333333333333', '10000000-0000-4000-8000-000000000006', 'admin'),
  ('44444444-4444-4444-8444-444444444444', '20000000-0000-4000-8000-000000000001', 'owner');

-- A scratch table to carry captured invitation ids across statements.
create temporary table _t (k text primary key, v uuid) on commit drop;

-- ══ 1–8. Helper: exists, INVOKER, empty search_path, returns void, no client
-- role may execute it ══════════════════════════════════════════════════════
select has_function('public', '_log_team_audit_event',
  array['uuid', 'text', 'uuid', 'jsonb'], 'the private Team audit helper exists');
select is((select prosecdef from pg_proc where oid='public._log_team_audit_event(uuid,text,uuid,jsonb)'::regprocedure),
  false, 'helper is SECURITY INVOKER (holds no privileges of its own)');
select is((select array_to_string(proconfig, ',') from pg_proc where oid='public._log_team_audit_event(uuid,text,uuid,jsonb)'::regprocedure),
  'search_path=""', 'helper pins an EMPTY search_path');
select is(pg_get_function_result('public._log_team_audit_event(uuid,text,uuid,jsonb)'::regprocedure),
  'void', 'helper returns void');
select ok(not has_function_privilege('public', 'public._log_team_audit_event(uuid,text,uuid,jsonb)', 'EXECUTE'),
  'PUBLIC cannot invoke the helper');
select ok(not has_function_privilege('anon', 'public._log_team_audit_event(uuid,text,uuid,jsonb)', 'EXECUTE'),
  'anon cannot invoke the helper');
select ok(not has_function_privilege('authenticated', 'public._log_team_audit_event(uuid,text,uuid,jsonb)', 'EXECUTE'),
  'authenticated cannot invoke the helper');
select ok(not has_function_privilege('service_role', 'public._log_team_audit_event(uuid,text,uuid,jsonb)', 'EXECUTE'),
  'service_role has NO explicit helper grant');

-- ══ 9–17. Helper validation (as superuser; raises before any insert) ═══════
select throws_ok(
  $$ select public._log_team_audit_event('33333333-3333-4333-8333-333333333333', 'team.bogus',
       '10000000-0000-4000-8000-000000000006', jsonb_build_object('target_email','x@t.local','role','admin')) $$,
  '22023', NULL, 'helper rejects an unknown event type (no "Other")');
select throws_ok(
  $$ select public._log_team_audit_event('33333333-3333-4333-8333-333333333333', 'team.member_invited',
       '10000000-0000-4000-8000-000000000006', '[1,2]'::jsonb) $$,
  '22023', NULL, 'helper rejects non-object metadata');
select throws_ok(
  $$ select public._log_team_audit_event('33333333-3333-4333-8333-333333333333', 'team.member_invited',
       '10000000-0000-4000-8000-000000000006', jsonb_build_object('target_email','x@t.local','role', repeat('a',5000))) $$,
  '22023', NULL, 'helper rejects oversized metadata');
select throws_ok(
  $$ select public._log_team_audit_event('33333333-3333-4333-8333-333333333333', 'team.member_invited',
       '10000000-0000-4000-8000-000000000006', jsonb_build_object('target_email','x@t.local','role','admin','token','secret')) $$,
  '22023', NULL, 'helper rejects a non-allowlisted metadata key (token)');
select throws_ok(
  $$ select public._log_team_audit_event('33333333-3333-4333-8333-333333333333', 'team.member_invited',
       '10000000-0000-4000-8000-000000000006', jsonb_build_object('role','admin')) $$,
  '22023', NULL, 'helper rejects a missing target_email');
select throws_ok(
  $$ select public._log_team_audit_event('33333333-3333-4333-8333-333333333333', 'team.member_invited',
       '10000000-0000-4000-8000-000000000006', jsonb_build_object('target_email','MiXeD@T.local','role','admin')) $$,
  '22023', NULL, 'helper rejects a non-normalized target_email');
select throws_ok(
  $$ select public._log_team_audit_event('33333333-3333-4333-8333-333333333333', 'team.role_changed',
       '10000000-0000-4000-8000-000000000006', jsonb_build_object('target_email','x@t.local','from_role','admin','to_role','root')) $$,
  '22023', NULL, 'helper rejects an invalid role value');
select throws_ok(
  $$ select public._log_team_audit_event('33333333-3333-4333-8333-333333333333', 'team.member_invited',
       null, jsonb_build_object('target_email','x@t.local','role','admin')) $$,
  '22023', NULL, 'helper rejects a null entity id');
select throws_ok(
  $$ select public._log_team_audit_event(null, 'team.member_invited',
       '10000000-0000-4000-8000-000000000006', jsonb_build_object('target_email','x@t.local','role','admin')) $$,
  '22023', NULL, 'helper rejects a null tenant');

-- ══ Producer phase — call the REAL RPCs as the appropriate members ══════════

-- ── ownerT context ─────────────────────────────────────────────────────────
-- Stay as the (superuser) test role so the scratch table _t is writable; the
-- RPCs derive the actor from the JWT claims GUC (not the DB role), and RLS is
-- exercised separately below under an explicit `set local role authenticated`.
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}';

-- invA → revoke → re-revoke (idempotent)
insert into _t(k, v) values ('invA', public.create_tenant_invite(
  '33333333-3333-4333-8333-333333333333', 'inva@t.local', 'sales_rep',
  encode(sha256(convert_to('rawtoken-invA-000001', 'UTF8')), 'hex')));
select is(public.revoke_tenant_invite('33333333-3333-4333-8333-333333333333',
  (select v from _t where k='invA')), (select v from _t where k='invA'),
  'owner revokes a pending invite');
select is(public.revoke_tenant_invite('33333333-3333-4333-8333-333333333333',
  (select v from _t where k='invA')), (select v from _t where k='invA'),
  're-revoke is an idempotent no-op (returns the id)');

-- Duplicate pending invitations to the same email are both allowed.
insert into _t(k, v) values ('invB', public.create_tenant_invite(
  '33333333-3333-4333-8333-333333333333', 'dup@t.local', 'sales_rep',
  encode(sha256(convert_to('rawtoken-invB-000001', 'UTF8')), 'hex')));
insert into _t(k, v) values ('invB2', public.create_tenant_invite(
  '33333333-3333-4333-8333-333333333333', 'dup@t.local', 'admin',
  encode(sha256(convert_to('rawtoken-invB2-00001', 'UTF8')), 'hex')));

-- Invites for the accept-phase scenarios.
insert into _t(k, v) values ('invJ', public.create_tenant_invite(
  '33333333-3333-4333-8333-333333333333', 'joiner@t.local', 'sales_rep',
  encode(sha256(convert_to('rawtoken-joiner-00001', 'UTF8')), 'hex')));
insert into _t(k, v) values ('invMis', public.create_tenant_invite(
  '33333333-3333-4333-8333-333333333333', 'someoneelse@t.local', 'admin',
  encode(sha256(convert_to('rawtoken-mis-0000001', 'UTF8')), 'hex')));
insert into _t(k, v) values ('invRev', public.create_tenant_invite(
  '33333333-3333-4333-8333-333333333333', 'revme@t.local', 'admin',
  encode(sha256(convert_to('rawtoken-rev-0000001', 'UTF8')), 'hex')));
select is(public.revoke_tenant_invite('33333333-3333-4333-8333-333333333333',
  (select v from _t where k='invRev')), (select v from _t where k='invRev'),
  'owner revokes the revoke-accept-test invite');
insert into _t(k, v) values ('invExp', public.create_tenant_invite(
  '33333333-3333-4333-8333-333333333333', 'expme@t.local', 'admin',
  encode(sha256(convert_to('rawtoken-exp-0000001', 'UTF8')), 'hex'),
  null, now() - interval '1 day'));

-- Role changes on memberT: admin → sales_rep, then a same-role no-op.
select lives_ok(
  $$ select public.update_tenant_member_role('33333333-3333-4333-8333-333333333333',
       '10000000-0000-4000-8000-000000000006', 'sales_rep') $$,
  'owner changes a member role (admin → sales_rep)');
select lives_ok(
  $$ select public.update_tenant_member_role('33333333-3333-4333-8333-333333333333',
       '10000000-0000-4000-8000-000000000006', 'sales_rep') $$,
  'a same-role request is an accepted no-op');
-- Promote then demote memberT (owner transfer path).
select lives_ok(
  $$ select public.promote_tenant_owner('33333333-3333-4333-8333-333333333333',
       '10000000-0000-4000-8000-000000000006') $$,
  'owner promotes a member to owner');
select lives_ok(
  $$ select public.demote_tenant_owner('33333333-3333-4333-8333-333333333333',
       '10000000-0000-4000-8000-000000000006', 'admin') $$,
  'owner demotes an owner back to admin');
-- Remove memberT (now admin again).
select lives_ok(
  $$ select public.remove_tenant_member('33333333-3333-4333-8333-333333333333',
       '10000000-0000-4000-8000-000000000006') $$,
  'owner removes a member');

-- Blocked (owner context): self-role-change + cross-tenant.
select throws_ok(
  $$ select public.update_tenant_member_role('33333333-3333-4333-8333-333333333333',
       '10000000-0000-4000-8000-000000000001', 'admin') $$,
  '42501', NULL, 'owner cannot change their OWN role via update_tenant_member_role');
select throws_ok(
  $$ select public.create_tenant_invite('44444444-4444-4444-8444-444444444444',
       'x@t2.local', 'admin', encode(sha256(convert_to('rawtoken-xt2-000001','UTF8')),'hex')) $$,
  '42501', NULL, 'owner of T cannot invite into T2 (cross-tenant)');

-- Self-removal ALLOWED while another owner remains (owner3T removes self).
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated"}';
select lives_ok(
  $$ select public.remove_tenant_member('33333333-3333-4333-8333-333333333333',
       '10000000-0000-4000-8000-000000000003') $$,
  'a non-last owner may remove themselves (owner3 self-removes)');

-- Self-demotion ALLOWED while another owner remains (owner2T demotes self).
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}';
select lives_ok(
  $$ select public.demote_tenant_owner('33333333-3333-4333-8333-333333333333',
       '10000000-0000-4000-8000-000000000002', 'admin') $$,
  'a non-last owner may demote themselves (owner2 self-demotes)');

-- Now ownerT is the SOLE owner → self-demote / self-remove are blocked.
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok(
  $$ select public.demote_tenant_owner('33333333-3333-4333-8333-333333333333',
       '10000000-0000-4000-8000-000000000001', 'admin') $$,
  '42501', NULL, 'the last owner cannot be demoted');
select throws_ok(
  $$ select public.remove_tenant_member('33333333-3333-4333-8333-333333333333',
       '10000000-0000-4000-8000-000000000001') $$,
  '42501', NULL, 'the last owner cannot be removed');

-- Cross-tenant TARGET (a user who belongs only to T2) fails closed — the caller
-- is authorized for THEIR tenant, but the tenant-scoped target lookup finds no
-- membership, so no role change / removal / event crosses the boundary.
select throws_ok(
  $$ select public.update_tenant_member_role('33333333-3333-4333-8333-333333333333',
       '20000000-0000-4000-8000-000000000001', 'admin') $$,
  '22023', NULL, 'a role change targeting another tenant''s user fails closed');
select throws_ok(
  $$ select public.remove_tenant_member('33333333-3333-4333-8333-333333333333',
       '20000000-0000-4000-8000-000000000001') $$,
  '22023', NULL, 'removal targeting another tenant''s user fails closed');

-- ── adminT context: may invite; may NOT change roles/remove ────────────────
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000004","role":"authenticated"}';
insert into _t(k, v) values ('invAdmin', public.create_tenant_invite(
  '33333333-3333-4333-8333-333333333333', 'byadmin@t.local', 'sales_rep',
  encode(sha256(convert_to('rawtoken-admin-00001', 'UTF8')), 'hex')));
select throws_ok(
  $$ select public.update_tenant_member_role('33333333-3333-4333-8333-333333333333',
       '10000000-0000-4000-8000-000000000005', 'admin') $$,
  '42501', NULL, 'an admin cannot change a member role (owner-only)');

-- ── repT context: no team management ───────────────────────────────────────
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000005","role":"authenticated"}';
select throws_ok(
  $$ select public.create_tenant_invite('33333333-3333-4333-8333-333333333333',
       'byrep@t.local', 'sales_rep', encode(sha256(convert_to('rawtoken-rep-0000001','UTF8')),'hex')) $$,
  '42501', NULL, 'a sales_rep cannot create invitations');

-- ── Accept phase ───────────────────────────────────────────────────────────
-- joiner accepts a valid invite.
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000007","role":"authenticated"}';
select is(public.accept_tenant_invite('rawtoken-joiner-00001'),
  '33333333-3333-4333-8333-333333333333', 'the invited user accepts and joins the tenant');
select throws_ok(
  $$ select public.accept_tenant_invite('rawtoken-joiner-00001') $$,
  'MDF05', NULL, 'a second acceptance of the same invite is refused');
-- wrong email.
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000008","role":"authenticated"}';
select throws_ok(
  $$ select public.accept_tenant_invite('rawtoken-mis-0000001') $$,
  'MDF06', NULL, 'acceptance by a different email is refused');
-- revoked invite.
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000009","role":"authenticated"}';
select throws_ok(
  $$ select public.accept_tenant_invite('rawtoken-rev-0000001') $$,
  'MDF03', NULL, 'a revoked invite cannot be accepted');
-- expired invite.
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-00000000000a","role":"authenticated"}';
select throws_ok(
  $$ select public.accept_tenant_invite('rawtoken-exp-0000001') $$,
  'MDF04', NULL, 'an expired invite cannot be accepted');

-- ══ Cardinality + metadata assertions (as superuser — bypass RLS) ══════════
reset role;

-- member_invited: one per successful invite; duplicate email → two events.
select is((select count(*)::int from public.audit_events
           where entity_type='team' and event_type='team.member_invited'
             and entity_id = (select v from _t where k='invB')),
  1, 'exactly ONE member_invited for invite B');
select is((select count(*)::int from public.audit_events
           where entity_type='team' and event_type='team.member_invited'
             and metadata->>'target_email' = 'dup@t.local'),
  2, 'duplicate pending invites to the same email each emit their own event');
select is((select metadata->>'role' from public.audit_events
           where entity_type='team' and event_type='team.member_invited'
             and entity_id = (select v from _t where k='invB')),
  'sales_rep', 'member_invited carries the invited role');
select is((select metadata->>'target_email' from public.audit_events
           where entity_type='team' and event_type='team.member_invited'
             and entity_id = (select v from _t where k='invB')),
  'dup@t.local', 'member_invited carries the normalized target_email');

-- invitation_revoked: one for invA despite the re-revoke.
select is((select count(*)::int from public.audit_events
           where entity_type='team' and event_type='team.invitation_revoked'
             and entity_id = (select v from _t where k='invA')),
  1, 'exactly ONE invitation_revoked for invite A (re-revoke emits nothing)');
select is((select metadata->>'target_email' from public.audit_events
           where entity_type='team' and event_type='team.invitation_revoked'
             and entity_id = (select v from _t where k='invA')),
  'inva@t.local', 'invitation_revoked carries the locked-row target_email');

-- member_joined: one for the joiner, legible via target_email.
select is((select count(*)::int from public.audit_events
           where entity_type='team' and event_type='team.member_joined'
             and entity_id = '10000000-0000-4000-8000-000000000007'),
  1, 'exactly ONE member_joined for the joiner (no duplicate)');
select is((select metadata->>'target_email' from public.audit_events
           where entity_type='team' and event_type='team.member_joined'
             and entity_id = '10000000-0000-4000-8000-000000000007'),
  'joiner@t.local', 'member_joined carries the verified target_email');
select is((select count(*)::int from public.tenant_users
           where tenant_id='33333333-3333-4333-8333-333333333333'
             and user_id='10000000-0000-4000-8000-000000000007'),
  1, 'the joiner is now a member of the tenant');

-- role_changed: exactly THREE for memberT (admin→sales_rep, →owner, owner→admin);
-- the same-role request added NONE.
select is((select count(*)::int from public.audit_events
           where entity_type='team' and event_type='team.role_changed'
             and entity_id = '10000000-0000-4000-8000-000000000006'),
  3, 'exactly THREE role_changed for the member (the no-op added none)');
select is((select count(*)::int from public.audit_events
           where entity_type='team' and event_type='team.role_changed'
             and entity_id='10000000-0000-4000-8000-000000000006'
             and metadata->>'from_role'='admin' and metadata->>'to_role'='sales_rep'),
  1, 'the admin→sales_rep transition is recorded honestly');
select is((select count(*)::int from public.audit_events
           where entity_type='team' and event_type='team.role_changed'
             and entity_id='10000000-0000-4000-8000-000000000006'
             and metadata->>'to_role'='owner'),
  1, 'the promotion to owner is recorded (privileged grant)');
select is((select count(*)::int from public.audit_events
           where entity_type='team' and event_type='team.role_changed'
             and entity_id='10000000-0000-4000-8000-000000000006'
             and metadata->>'from_role'='owner' and metadata->>'to_role'='admin'),
  1, 'the demotion from owner is recorded');

-- member_removed: one for memberT, with the pre-delete role + email snapshot,
-- STILL legible after the tenant_users row is gone.
select is((select count(*)::int from public.audit_events
           where entity_type='team' and event_type='team.member_removed'
             and entity_id='10000000-0000-4000-8000-000000000006'),
  1, 'exactly ONE member_removed for the member');
select is((select metadata->>'role' from public.audit_events
           where entity_type='team' and event_type='team.member_removed'
             and entity_id='10000000-0000-4000-8000-000000000006'),
  'admin', 'member_removed captured the role BEFORE deletion');
select is((select metadata->>'target_email' from public.audit_events
           where entity_type='team' and event_type='team.member_removed'
             and entity_id='10000000-0000-4000-8000-000000000006'),
  'member@t.local', 'member_removed target_email stays legible after deletion');
select is((select count(*)::int from public.tenant_users
           where tenant_id='33333333-3333-4333-8333-333333333333'
             and user_id='10000000-0000-4000-8000-000000000006'),
  0, 'the removed member no longer has a membership row');

-- Self-service allowed self-actions produced honest events; sole-owner blocks
-- produced NONE for ownerT.
select is((select count(*)::int from public.audit_events
           where entity_type='team' and event_type='team.member_removed'
             and entity_id='10000000-0000-4000-8000-000000000003'),
  1, 'owner3 self-removal emitted one member_removed');
select is((select count(*)::int from public.audit_events
           where entity_type='team' and event_type='team.role_changed'
             and entity_id='10000000-0000-4000-8000-000000000002'
             and metadata->>'from_role'='owner'),
  1, 'owner2 self-demotion emitted one role_changed');
select is((select count(*)::int from public.audit_events
           where entity_type='team'
             and entity_id='10000000-0000-4000-8000-000000000001'),
  0, 'the blocked last-owner self-actions emitted NO event for owner1');

-- adminT invite succeeded; rep/admin blocked calls emitted nothing.
select is((select count(*)::int from public.audit_events
           where entity_type='team' and event_type='team.member_invited'
             and entity_id = (select v from _t where k='invAdmin')),
  1, 'an admin CAN invite (one member_invited)');
select is((select count(*)::int from public.audit_events
           where entity_type='team' and event_type='team.role_changed'
             and entity_id='10000000-0000-4000-8000-000000000005'),
  0, 'the admin/rep blocked role change emitted no event');

-- The failed accepts (wrong email / revoked / expired / dup) added no joined
-- rows beyond the single legitimate join.
select is((select count(*)::int from public.audit_events
           where entity_type='team' and event_type='team.member_joined'),
  1, 'only the single valid acceptance produced a member_joined');

-- ══ Secret / PII safety over EVERY team row ════════════════════════════════
select is((select count(*)::int from public.audit_events
           where entity_type='team'
             and (metadata ?| array['token','token_hash','token_preview','acceptance_url',
                                     'jwt','session','password','raw_auth','email_body'])),
  0, 'NO team audit row carries a token/secret/raw-auth key');
select is((select count(*)::int from public.audit_events
           where entity_type='team' and metadata->>'target_email' is null),
  0, 'EVERY team audit row carries a target_email');
select is((select count(*)::int from public.audit_events
           where entity_type='team' and entity_id is null),
  0, 'EVERY team audit row has a non-null entity id');
select is((select count(distinct k)::int from (
             select jsonb_object_keys(metadata) as k from public.audit_events
             where entity_type='team'
           ) s
           where k not in ('target_email','role','from_role','to_role')),
  0, 'team metadata uses ONLY the allowlisted keys');

-- ══ RLS visibility (owner/admin read team rows; sales_rep + other tenant none) ══
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}';
select ok((select count(*) from public.audit_events
           where tenant_id='33333333-3333-4333-8333-333333333333' and entity_type='team') > 0,
  'an owner reads the tenant Team activity');
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000004","role":"authenticated"}';
select ok((select count(*) from public.audit_events
           where tenant_id='33333333-3333-4333-8333-333333333333' and entity_type='team') > 0,
  'an admin reads the tenant Team activity');
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000005","role":"authenticated"}';
select is((select count(*)::int from public.audit_events
           where tenant_id='33333333-3333-4333-8333-333333333333' and entity_type='team'),
  0, 'a sales_rep reads NO Team activity');
set local request.jwt.claims = '{"sub":"20000000-0000-4000-8000-000000000001","role":"authenticated"}';
select is((select count(*)::int from public.audit_events
           where tenant_id='33333333-3333-4333-8333-333333333333' and entity_type='team'),
  0, 'another tenant reads NONE of this tenant''s Team activity');
reset role;

-- ══ RLS policy shape preserved (renamed, still owner/admin for scoped rows) ══
select is((select count(*)::int from pg_policies
           where schemaname='public' and tablename='audit_events'
             and policyname='audit_events: members read; entity rows scoped'),
  1, 'the audit_events SELECT policy exists under the concise name');
select is((select count(*)::int from pg_policies
           where schemaname='public' and tablename='audit_events' and cmd='SELECT'),
  1, 'there is exactly ONE audit_events SELECT policy (no competing permissive one)');
-- The customer/order/product/inventory clauses survive verbatim in the new policy.
select ok((select qual from pg_policies
           where schemaname='public' and tablename='audit_events'
             and policyname='audit_events: members read; entity rows scoped')
          like '%can_access_customer%', 'the customer clause is preserved');
select ok((select qual from pg_policies
           where schemaname='public' and tablename='audit_events'
             and policyname='audit_events: members read; entity rows scoped')
          like '%can_access_order%', 'the order clause is preserved');

-- ══ RPC preservation: signatures + SECURITY DEFINER + deterministic lock ════
select ok(to_regprocedure('public.create_tenant_invite(uuid,text,public.tenant_role,text,text,timestamptz)') is not null,
  'create_tenant_invite signature preserved');
select ok(to_regprocedure('public.revoke_tenant_invite(uuid,uuid)') is not null,
  'revoke_tenant_invite signature preserved');
select ok(to_regprocedure('public.accept_tenant_invite(text)') is not null,
  'accept_tenant_invite signature preserved');
select ok(to_regprocedure('public.update_tenant_member_role(uuid,uuid,public.tenant_role)') is not null,
  'update_tenant_member_role signature preserved');
select ok(to_regprocedure('public.remove_tenant_member(uuid,uuid)') is not null,
  'remove_tenant_member signature preserved');
select ok(to_regprocedure('public.promote_tenant_owner(uuid,uuid)') is not null,
  'promote_tenant_owner signature preserved');
select ok(to_regprocedure('public.demote_tenant_owner(uuid,uuid,public.tenant_role)') is not null,
  'demote_tenant_owner signature preserved');
select is((select bool_and(prosecdef) from pg_proc
           where proname in ('create_tenant_invite','revoke_tenant_invite','accept_tenant_invite',
                             'update_tenant_member_role','remove_tenant_member',
                             'promote_tenant_owner','demote_tenant_owner')
             and pronamespace='public'::regnamespace),
  true, 'every redefined Team RPC is SECURITY DEFINER');

-- Deterministic owner-lock present in the four owner-sensitive RPCs.
select ok((select pg_get_functiondef('public.update_tenant_member_role(uuid,uuid,public.tenant_role)'::regprocedure))
          ~ 'order by user_id\s+for update', 'update_tenant_member_role locks owners+target in user_id order');
select ok((select pg_get_functiondef('public.remove_tenant_member(uuid,uuid)'::regprocedure))
          ~ 'order by user_id\s+for update', 'remove_tenant_member locks owners+target in user_id order');
select ok((select pg_get_functiondef('public.promote_tenant_owner(uuid,uuid)'::regprocedure))
          ~ 'order by user_id\s+for update', 'promote_tenant_owner locks owners+target in user_id order');
select ok((select pg_get_functiondef('public.demote_tenant_owner(uuid,uuid,public.tenant_role)'::regprocedure))
          ~ 'order by user_id\s+for update', 'demote_tenant_owner locks owners+target in user_id order');
-- Invitation-row lock present in accept + revoke.
select ok((select pg_get_functiondef('public.accept_tenant_invite(text)'::regprocedure)) ~ 'for update',
  'accept_tenant_invite locks the invitation row');
select ok((select pg_get_functiondef('public.revoke_tenant_invite(uuid,uuid)'::regprocedure)) ~ 'for update',
  'revoke_tenant_invite locks the invitation row');

-- ══ The tenant-wide Team Timeline index exists ═════════════════════════════
select has_index('public', 'audit_events', 'audit_events_tenant_type_time_idx',
  'the tenant-wide Team Timeline index exists');

select * from finish();
rollback;
