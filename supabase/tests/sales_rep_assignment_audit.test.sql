-- ═══════════════════════════════════════════════════════════════════════
-- pgTAP — M8I.5 SALES REP CUSTOMER ASSIGNMENT AUDIT (PILOT-OPS-AUDIT-005)
--
-- Verifies the transactional assignment producers + lifecycle cleanup on
-- public.audit_events:
--   • the private helpers are SECURITY INVOKER, search_path='', executable by NO
--     client role; closed 2-event allowlist; entity_type fixed to
--     'sales_rep_assignment'; metadata EXACTLY {rep_user_id, rep_email,
--     customer_name, source} with per-event source allowlists + bounds;
--   • assign/unassign emit exactly one event on a real mutation and none on a
--     no-op; owner/admin manage; a sales_rep is denied; cross-tenant fails closed;
--   • can_access_customer / can_access_order require a CURRENT sales_rep
--     membership (a removed member / role-away member / legacy orphan is inert),
--     owner/admin stay tenant-wide, cross-tenant cannot bridge;
--   • role exit/entry, member removal and membership rejoin each PURGE the target's
--     assignments (one removed event per row, the right source) alongside the
--     single existing Team event — a (re)entering member inherits nothing;
--   • customer deletion cascades the assignment with NO assignment event;
--   • a helper failure rolls the whole operation (assignments + membership) back;
--   • the audit_events RLS policy scopes assignment rows to owner/admin, leaving
--     the customer/order/product/inventory/team/settings clauses intact;
--   • every redefined RPC/predicate keeps its signature / DEFINER / search_path.
--
-- Run with the local stack up:  supabase test db
-- Disposable tenants T + T2 in THIS transaction; everything rolls back.
-- No real secrets — controlled local fixtures only (tokens are throwaway).
-- ═══════════════════════════════════════════════════════════════════════
begin;
select plan(115);

set local request.jwt.claims = '{"role":"service_role"}';

-- ── Fixtures ────────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('10000000-0000-4000-8000-000000000001', 'owner@t.local'),
  ('10000000-0000-4000-8000-000000000002', 'owner2@t.local'),
  ('10000000-0000-4000-8000-000000000004', 'admin@t.local'),
  ('10000000-0000-4000-8000-000000000005', 'rep@t.local'),
  ('10000000-0000-4000-8000-000000000006', 'rep2@t.local'),
  ('10000000-0000-4000-8000-000000000007', 'entry@t.local'),
  ('10000000-0000-4000-8000-000000000008', 'rejoin@t.local'),
  ('10000000-0000-4000-8000-000000000009', 'ghost@t.local'),
  ('10000000-0000-4000-8000-00000000000a', 'removerep@t.local'),
  ('10000000-0000-4000-8000-00000000000b', 'delrep@t.local'),
  ('10000000-0000-4000-8000-00000000000c', 'noemail-placeholder@t.local'),
  ('20000000-0000-4000-8000-000000000001', 'owner@t2.local');
-- A sales_rep whose auth email is NULL → forces the audit helper to fail (used by
-- the rollback test). We insert with an email then null it to dodge any signup
-- constraints on insert.
update auth.users set email = null where id = '10000000-0000-4000-8000-00000000000c';

insert into public.tenants (id, name_ar, name_he, name_en) values
  ('33333333-3333-4333-8333-333333333333', 'ت', 'ט', 'T'),
  ('44444444-4444-4444-8444-444444444444', 'ت٢', 'ט٢', 'T2');

insert into public.tenant_users (tenant_id, user_id, role) values
  ('33333333-3333-4333-8333-333333333333', '10000000-0000-4000-8000-000000000001', 'owner'),
  ('33333333-3333-4333-8333-333333333333', '10000000-0000-4000-8000-000000000002', 'owner'),
  ('33333333-3333-4333-8333-333333333333', '10000000-0000-4000-8000-000000000004', 'admin'),
  ('33333333-3333-4333-8333-333333333333', '10000000-0000-4000-8000-000000000005', 'sales_rep'),
  ('33333333-3333-4333-8333-333333333333', '10000000-0000-4000-8000-000000000006', 'sales_rep'),
  ('33333333-3333-4333-8333-333333333333', '10000000-0000-4000-8000-000000000007', 'admin'),
  ('33333333-3333-4333-8333-333333333333', '10000000-0000-4000-8000-00000000000a', 'sales_rep'),
  ('33333333-3333-4333-8333-333333333333', '10000000-0000-4000-8000-00000000000b', 'sales_rep'),
  ('33333333-3333-4333-8333-333333333333', '10000000-0000-4000-8000-00000000000c', 'sales_rep'),
  ('44444444-4444-4444-8444-444444444444', '20000000-0000-4000-8000-000000000001', 'owner');

insert into public.customers (id, tenant_id, name) values
  ('aaaaaaaa-0000-4000-8000-000000000001', '33333333-3333-4333-8333-333333333333', 'Customer A'),
  ('aaaaaaaa-0000-4000-8000-000000000002', '33333333-3333-4333-8333-333333333333', 'Customer B'),
  ('aaaaaaaa-0000-4000-8000-000000000003', '33333333-3333-4333-8333-333333333333', 'Customer C'),
  ('aaaaaaaa-0000-4000-8000-000000000004', '33333333-3333-4333-8333-333333333333', 'Customer D'),
  ('cccccccc-0000-4000-8000-000000000001', '44444444-4444-4444-8444-444444444444', 'T2 Cust');

-- Two orders (owner/admin walk-in-capable) for the can_access_order tests.
insert into public.orders (tenant_id, customer_id, order_number, public_ref) values
  ('33333333-3333-4333-8333-333333333333', 'aaaaaaaa-0000-4000-8000-000000000001', 'ORD-A', 'REF-A'),
  ('33333333-3333-4333-8333-333333333333', 'aaaaaaaa-0000-4000-8000-000000000002', 'ORD-B', 'REF-B');

-- Legacy orphan / stale assignment rows inserted DIRECTLY (bypassing the RPC), to
-- prove the predicate hardening + entry/join cleanup. ghost is a NON-member.
insert into public.sales_rep_customers (tenant_id, user_id, customer_id, assigned_by) values
  ('33333333-3333-4333-8333-333333333333', '10000000-0000-4000-8000-000000000009', 'aaaaaaaa-0000-4000-8000-000000000001', null), -- ghost orphan (cA)
  ('33333333-3333-4333-8333-333333333333', '10000000-0000-4000-8000-000000000007', 'aaaaaaaa-0000-4000-8000-000000000002', null), -- entry stale (cB)
  ('33333333-3333-4333-8333-333333333333', '10000000-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000003', null), -- owner2 stale (cC)
  ('33333333-3333-4333-8333-333333333333', '10000000-0000-4000-8000-000000000008', 'aaaaaaaa-0000-4000-8000-000000000001', null); -- rejoin stale (cA)

-- An invite for the rejoin scenario (rejoin@t.local as sales_rep).
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}';
create temporary table _t (k text primary key, v uuid) on commit drop;
insert into _t(k, v) values ('invRejoin', public.create_tenant_invite(
  '33333333-3333-4333-8333-333333333333', 'rejoin@t.local', 'sales_rep',
  encode(sha256(convert_to('rawtoken-rejoin-0001', 'UTF8')), 'hex')));
reset role;
set local request.jwt.claims = '{"role":"service_role"}';

-- ══ 1–8. Log helper: exists, INVOKER, empty search_path, void, no client grant ══
select has_function('public', '_log_sales_rep_assignment_audit_event',
  array['uuid', 'text', 'uuid', 'jsonb'], 'the private assignment audit helper exists');
select is((select prosecdef from pg_proc where oid='public._log_sales_rep_assignment_audit_event(uuid,text,uuid,jsonb)'::regprocedure),
  false, 'log helper is SECURITY INVOKER');
select is((select array_to_string(proconfig, ',') from pg_proc where oid='public._log_sales_rep_assignment_audit_event(uuid,text,uuid,jsonb)'::regprocedure),
  'search_path=""', 'log helper pins an EMPTY search_path');
select is(pg_get_function_result('public._log_sales_rep_assignment_audit_event(uuid,text,uuid,jsonb)'::regprocedure),
  'void', 'log helper returns void');
select ok(not has_function_privilege('public', 'public._log_sales_rep_assignment_audit_event(uuid,text,uuid,jsonb)', 'EXECUTE'),
  'PUBLIC cannot invoke the log helper');
select ok(not has_function_privilege('anon', 'public._log_sales_rep_assignment_audit_event(uuid,text,uuid,jsonb)', 'EXECUTE'),
  'anon cannot invoke the log helper');
select ok(not has_function_privilege('authenticated', 'public._log_sales_rep_assignment_audit_event(uuid,text,uuid,jsonb)', 'EXECUTE'),
  'authenticated cannot invoke the log helper');
select ok(not has_function_privilege('service_role', 'public._log_sales_rep_assignment_audit_event(uuid,text,uuid,jsonb)', 'EXECUTE'),
  'service_role has NO explicit log-helper grant');

-- ══ 9–13. Purge helper: exists, INVOKER, void, no client grant ═════════════════
select has_function('public', '_purge_rep_assignments',
  array['uuid', 'uuid', 'text', 'text'], 'the private purge helper exists');
select is((select prosecdef from pg_proc where oid='public._purge_rep_assignments(uuid,uuid,text,text)'::regprocedure),
  false, 'purge helper is SECURITY INVOKER');
select is(pg_get_function_result('public._purge_rep_assignments(uuid,uuid,text,text)'::regprocedure),
  'void', 'purge helper returns void');
select ok(not has_function_privilege('anon', 'public._purge_rep_assignments(uuid,uuid,text,text)', 'EXECUTE'),
  'anon cannot invoke the purge helper');
select ok(not has_function_privilege('authenticated', 'public._purge_rep_assignments(uuid,uuid,text,text)', 'EXECUTE'),
  'authenticated cannot invoke the purge helper');

-- ══ 14–29. Log-helper metadata validation (as superuser; raises before insert) ══
select throws_ok(
  $$ select public._log_sales_rep_assignment_audit_event('33333333-3333-4333-8333-333333333333', 'sales_rep_assignment.bogus',
       'aaaaaaaa-0000-4000-8000-000000000001', jsonb_build_object('rep_user_id','10000000-0000-4000-8000-000000000005','rep_email','rep@t.local','customer_name','Customer A','source','manual')) $$,
  '22023', NULL, 'helper rejects an unknown event type (no "Other")');
select throws_ok(
  $$ select public._log_sales_rep_assignment_audit_event('33333333-3333-4333-8333-333333333333', 'sales_rep_assignment.created',
       'aaaaaaaa-0000-4000-8000-000000000001', '[1,2]'::jsonb) $$,
  '22023', NULL, 'helper rejects non-object metadata');
select throws_ok(
  $$ select public._log_sales_rep_assignment_audit_event('33333333-3333-4333-8333-333333333333', 'sales_rep_assignment.created',
       'aaaaaaaa-0000-4000-8000-000000000001', jsonb_build_object('rep_user_id','10000000-0000-4000-8000-000000000005','rep_email','rep@t.local','customer_name', repeat('a',5000),'source','manual')) $$,
  '22023', NULL, 'helper rejects oversized metadata');
select throws_ok(
  $$ select public._log_sales_rep_assignment_audit_event('33333333-3333-4333-8333-333333333333', 'sales_rep_assignment.created',
       'aaaaaaaa-0000-4000-8000-000000000001', jsonb_build_object('rep_user_id','10000000-0000-4000-8000-000000000005','rep_email','rep@t.local','customer_name','Customer A')) $$,
  '22023', NULL, 'helper rejects a missing required key (source)');
select throws_ok(
  $$ select public._log_sales_rep_assignment_audit_event('33333333-3333-4333-8333-333333333333', 'sales_rep_assignment.created',
       'aaaaaaaa-0000-4000-8000-000000000001', jsonb_build_object('rep_user_id','10000000-0000-4000-8000-000000000005','rep_email','rep@t.local','customer_name','Customer A','source','manual','token','secret')) $$,
  '22023', NULL, 'helper rejects an unknown extra key (token)');
select throws_ok(
  $$ select public._log_sales_rep_assignment_audit_event('33333333-3333-4333-8333-333333333333', 'sales_rep_assignment.created',
       'aaaaaaaa-0000-4000-8000-000000000001', jsonb_build_object('rep_user_id','not-a-uuid','rep_email','rep@t.local','customer_name','Customer A','source','manual')) $$,
  '22023', NULL, 'helper rejects a malformed rep_user_id');
select throws_ok(
  $$ select public._log_sales_rep_assignment_audit_event('33333333-3333-4333-8333-333333333333', 'sales_rep_assignment.created',
       'aaaaaaaa-0000-4000-8000-000000000001', jsonb_build_object('rep_user_id', 123,'rep_email','rep@t.local','customer_name','Customer A','source','manual')) $$,
  '22023', NULL, 'helper rejects a non-string rep_user_id');
select throws_ok(
  $$ select public._log_sales_rep_assignment_audit_event('33333333-3333-4333-8333-333333333333', 'sales_rep_assignment.created',
       'aaaaaaaa-0000-4000-8000-000000000001', jsonb_build_object('rep_user_id','10000000-0000-4000-8000-000000000005','rep_email','','customer_name','Customer A','source','manual')) $$,
  '22023', NULL, 'helper rejects an empty rep_email');
select throws_ok(
  $$ select public._log_sales_rep_assignment_audit_event('33333333-3333-4333-8333-333333333333', 'sales_rep_assignment.created',
       'aaaaaaaa-0000-4000-8000-000000000001', jsonb_build_object('rep_user_id','10000000-0000-4000-8000-000000000005','rep_email','MiXeD@T.local','customer_name','Customer A','source','manual')) $$,
  '22023', NULL, 'helper rejects a non-normalized rep_email');
select throws_ok(
  $$ select public._log_sales_rep_assignment_audit_event('33333333-3333-4333-8333-333333333333', 'sales_rep_assignment.created',
       'aaaaaaaa-0000-4000-8000-000000000001', jsonb_build_object('rep_user_id','10000000-0000-4000-8000-000000000005','rep_email','rep@t.local','customer_name','','source','manual')) $$,
  '22023', NULL, 'helper rejects an empty customer_name');
select throws_ok(
  $$ select public._log_sales_rep_assignment_audit_event('33333333-3333-4333-8333-333333333333', 'sales_rep_assignment.created',
       'aaaaaaaa-0000-4000-8000-000000000001', jsonb_build_object('rep_user_id','10000000-0000-4000-8000-000000000005','rep_email','rep@t.local','customer_name', repeat('a',201),'source','manual')) $$,
  '22023', NULL, 'helper rejects an oversized customer_name');
select throws_ok(
  $$ select public._log_sales_rep_assignment_audit_event('33333333-3333-4333-8333-333333333333', 'sales_rep_assignment.created',
       'aaaaaaaa-0000-4000-8000-000000000001', jsonb_build_object('rep_user_id','10000000-0000-4000-8000-000000000005','rep_email','rep@t.local','customer_name','Customer A','source','role_changed')) $$,
  '22023', NULL, 'helper rejects a created event with source != manual');
select throws_ok(
  $$ select public._log_sales_rep_assignment_audit_event('33333333-3333-4333-8333-333333333333', 'sales_rep_assignment.removed',
       'aaaaaaaa-0000-4000-8000-000000000001', jsonb_build_object('rep_user_id','10000000-0000-4000-8000-000000000005','rep_email','rep@t.local','customer_name','Customer A','source','customer_deleted')) $$,
  '22023', NULL, 'helper rejects a removed event with a disallowed source (customer_deleted)');
select throws_ok(
  $$ select public._log_sales_rep_assignment_audit_event('33333333-3333-4333-8333-333333333333', 'sales_rep_assignment.removed',
       'aaaaaaaa-0000-4000-8000-000000000001', jsonb_build_object('rep_user_id','10000000-0000-4000-8000-000000000005','rep_email','rep@t.local','customer_name','Customer A','source','cascade')) $$,
  '22023', NULL, 'helper rejects a removed event with a disallowed source (cascade)');
select throws_ok(
  $$ select public._log_sales_rep_assignment_audit_event('33333333-3333-4333-8333-333333333333', 'sales_rep_assignment.created',
       null, jsonb_build_object('rep_user_id','10000000-0000-4000-8000-000000000005','rep_email','rep@t.local','customer_name','Customer A','source','manual')) $$,
  '22023', NULL, 'helper rejects a null entity id (customer)');
select throws_ok(
  $$ select public._log_sales_rep_assignment_audit_event(null, 'sales_rep_assignment.created',
       'aaaaaaaa-0000-4000-8000-000000000001', jsonb_build_object('rep_user_id','10000000-0000-4000-8000-000000000005','rep_email','rep@t.local','customer_name','Customer A','source','manual')) $$,
  '22023', NULL, 'helper rejects a null tenant');

-- ══ Producer phase — manual assign / unassign ══════════════════════════════════

-- ── owner context ─────────────────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}';
select lives_ok(
  $$ select public.assign_customer_to_rep('33333333-3333-4333-8333-333333333333',
       '10000000-0000-4000-8000-000000000005', 'aaaaaaaa-0000-4000-8000-000000000001') $$,
  'owner assigns rep→cA');
select lives_ok(
  $$ select public.assign_customer_to_rep('33333333-3333-4333-8333-333333333333',
       '10000000-0000-4000-8000-000000000005', 'aaaaaaaa-0000-4000-8000-000000000001') $$,
  'a duplicate assign is an accepted no-op');
select throws_ok(
  $$ select public.assign_customer_to_rep('33333333-3333-4333-8333-333333333333',
       '10000000-0000-4000-8000-000000000004', 'aaaaaaaa-0000-4000-8000-000000000001') $$,
  '22023', NULL, 'assigning a NON-sales_rep (admin) target is rejected');
select throws_ok(
  $$ select public.assign_customer_to_rep('33333333-3333-4333-8333-333333333333',
       '10000000-0000-4000-8000-000000000005', 'cccccccc-0000-4000-8000-000000000001') $$,
  '22023', NULL, 'assigning a cross-tenant customer is rejected');
-- admin may manage: assign rep→cB.
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000004","role":"authenticated"}';
select lives_ok(
  $$ select public.assign_customer_to_rep('33333333-3333-4333-8333-333333333333',
       '10000000-0000-4000-8000-000000000005', 'aaaaaaaa-0000-4000-8000-000000000002') $$,
  'admin assigns rep→cB');
-- sales_rep may NOT manage.
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000005","role":"authenticated"}';
select throws_ok(
  $$ select public.assign_customer_to_rep('33333333-3333-4333-8333-333333333333',
       '10000000-0000-4000-8000-000000000005', 'aaaaaaaa-0000-4000-8000-000000000003') $$,
  '42501', NULL, 'a sales_rep cannot assign customers');

-- unassign (owner): cA removed; a repeat is a no-op.
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}';
select lives_ok(
  $$ select public.unassign_customer_from_rep('33333333-3333-4333-8333-333333333333',
       '10000000-0000-4000-8000-000000000005', 'aaaaaaaa-0000-4000-8000-000000000001') $$,
  'owner unassigns rep→cA');
select lives_ok(
  $$ select public.unassign_customer_from_rep('33333333-3333-4333-8333-333333333333',
       '10000000-0000-4000-8000-000000000005', 'aaaaaaaa-0000-4000-8000-000000000001') $$,
  'a missing-pair unassign is an accepted no-op');
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000005","role":"authenticated"}';
select throws_ok(
  $$ select public.unassign_customer_from_rep('33333333-3333-4333-8333-333333333333',
       '10000000-0000-4000-8000-000000000005', 'aaaaaaaa-0000-4000-8000-000000000002') $$,
  '42501', NULL, 'a sales_rep cannot unassign customers');

-- ── Cardinality + metadata for the manual assign/unassign ─────────────────────
reset role;
select is((select count(*)::int from public.audit_events
           where entity_type='sales_rep_assignment' and event_type='sales_rep_assignment.created'
             and entity_id='aaaaaaaa-0000-4000-8000-000000000001'
             and metadata->>'rep_user_id'='10000000-0000-4000-8000-000000000005'),
  1, 'exactly ONE created for rep→cA (the duplicate added none)');
select is((select metadata->>'source' from public.audit_events
           where entity_type='sales_rep_assignment' and event_type='sales_rep_assignment.created'
             and entity_id='aaaaaaaa-0000-4000-8000-000000000001'
             and metadata->>'rep_user_id'='10000000-0000-4000-8000-000000000005'),
  'manual', 'created carries source=manual');
select is((select metadata->>'rep_email' from public.audit_events
           where entity_type='sales_rep_assignment' and event_type='sales_rep_assignment.created'
             and entity_id='aaaaaaaa-0000-4000-8000-000000000001'
             and metadata->>'rep_user_id'='10000000-0000-4000-8000-000000000005'),
  'rep@t.local', 'created carries the rep_email snapshot');
select is((select metadata->>'customer_name' from public.audit_events
           where entity_type='sales_rep_assignment' and event_type='sales_rep_assignment.created'
             and entity_id='aaaaaaaa-0000-4000-8000-000000000001'
             and metadata->>'rep_user_id'='10000000-0000-4000-8000-000000000005'),
  'Customer A', 'created carries the customer_name snapshot');
select is((select count(*)::int from public.audit_events
           where entity_type='sales_rep_assignment' and event_type='sales_rep_assignment.removed'
             and entity_id='aaaaaaaa-0000-4000-8000-000000000001'
             and metadata->>'rep_user_id'='10000000-0000-4000-8000-000000000005'),
  1, 'exactly ONE manual removed for rep→cA (the no-op added none)');
select is((select metadata->>'source' from public.audit_events
           where entity_type='sales_rep_assignment' and event_type='sales_rep_assignment.removed'
             and entity_id='aaaaaaaa-0000-4000-8000-000000000001'
             and metadata->>'rep_user_id'='10000000-0000-4000-8000-000000000005'),
  'manual', 'manual unassign removed carries source=manual');

-- ══ Access predicates ══════════════════════════════════════════════════════════
-- rep is currently assigned cB (only). Direct predicate calls read auth.uid() from
-- the JWT GUC (SECURITY DEFINER) — no need for `set role`.
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000005","role":"authenticated"}';
select is(public.can_access_customer('33333333-3333-4333-8333-333333333333', 'aaaaaaaa-0000-4000-8000-000000000002'),
  true, 'assigned current sales_rep CAN access the assigned customer (cB)');
select is(public.can_access_customer('33333333-3333-4333-8333-333333333333', 'aaaaaaaa-0000-4000-8000-000000000001'),
  false, 'sales_rep CANNOT access an unassigned customer (cA)');
select is(public.can_access_customer('44444444-4444-4444-8444-444444444444', 'cccccccc-0000-4000-8000-000000000001'),
  false, 'a cross-tenant assignment cannot bridge access');
select is(public.can_access_order('33333333-3333-4333-8333-333333333333',
            (select id from public.orders where order_number='ORD-B')),
  true, 'assigned current sales_rep CAN access the assigned customer''s order');
select is(public.can_access_order('33333333-3333-4333-8333-333333333333',
            (select id from public.orders where order_number='ORD-A')),
  false, 'sales_rep CANNOT access an unassigned customer''s order');
-- Legacy orphan is INERT: ghost has a direct sales_rep_customers row on cA but is
-- NOT a current member → both predicates fail closed.
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000009","role":"authenticated"}';
select is(public.can_access_customer('33333333-3333-4333-8333-333333333333', 'aaaaaaaa-0000-4000-8000-000000000001'),
  false, 'a legacy orphan assignment (non-member) grants NO customer access');
select is(public.can_access_order('33333333-3333-4333-8333-333333333333',
            (select id from public.orders where order_number='ORD-A')),
  false, 'a legacy orphan assignment (non-member) grants NO order access');
-- owner/admin stay tenant-wide.
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}';
select is(public.can_access_customer('33333333-3333-4333-8333-333333333333', 'aaaaaaaa-0000-4000-8000-000000000001'),
  true, 'owner keeps tenant-wide customer access');
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000004","role":"authenticated"}';
select is(public.can_access_order('33333333-3333-4333-8333-333333333333',
            (select id from public.orders where order_number='ORD-A')),
  true, 'admin keeps tenant-wide order access');

-- ══ Role EXIT (sales_rep → admin) purges assignments (source role_changed) ═════
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}';
select lives_ok(
  $$ select public.update_tenant_member_role('33333333-3333-4333-8333-333333333333',
       '10000000-0000-4000-8000-000000000005', 'admin') $$,
  'owner moves rep (sales_rep→admin) — exit cleanup');
reset role;
select is((select count(*)::int from public.sales_rep_customers
           where tenant_id='33333333-3333-4333-8333-333333333333' and user_id='10000000-0000-4000-8000-000000000005'),
  0, 'rep has ZERO assignments after leaving sales_rep');
select is((select count(*)::int from public.audit_events
           where entity_type='sales_rep_assignment' and event_type='sales_rep_assignment.removed'
             and entity_id='aaaaaaaa-0000-4000-8000-000000000002'
             and metadata->>'rep_user_id'='10000000-0000-4000-8000-000000000005'
             and metadata->>'source'='role_changed'),
  1, 'the exit purged cB with a role_changed removed event');
select is((select count(*)::int from public.audit_events
           where entity_type='team' and event_type='team.role_changed'
             and entity_id='10000000-0000-4000-8000-000000000005'),
  1, 'the role exit still emits exactly ONE team.role_changed');

-- ══ Role ENTRY (admin → sales_rep) purges any stale legacy rows (role_changed) ══
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}';
select lives_ok(
  $$ select public.update_tenant_member_role('33333333-3333-4333-8333-333333333333',
       '10000000-0000-4000-8000-000000000007', 'sales_rep') $$,
  'owner moves entry-user (admin→sales_rep) — entry cleanup');
reset role;
select is((select count(*)::int from public.sales_rep_customers
           where tenant_id='33333333-3333-4333-8333-333333333333' and user_id='10000000-0000-4000-8000-000000000007'),
  0, 'the entering sales_rep inherits ZERO assignments (legacy row purged)');
select is((select count(*)::int from public.audit_events
           where entity_type='sales_rep_assignment' and event_type='sales_rep_assignment.removed'
             and entity_id='aaaaaaaa-0000-4000-8000-000000000002'
             and metadata->>'rep_user_id'='10000000-0000-4000-8000-000000000007'
             and metadata->>'source'='role_changed'),
  1, 'the entry purged the stale cB with a role_changed removed event');
select is((select count(*)::int from public.audit_events
           where entity_type='sales_rep_assignment' and event_type='sales_rep_assignment.created'
             and metadata->>'rep_user_id'='10000000-0000-4000-8000-000000000007'),
  0, 'the role change into sales_rep emits NO created event');
-- The re-entered rep has no access until an explicit assignment.
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000007","role":"authenticated"}';
select is(public.can_access_customer('33333333-3333-4333-8333-333333333333', 'aaaaaaaa-0000-4000-8000-000000000002'),
  false, 'the re-entered sales_rep has NO inherited access until an explicit assign');

-- ══ Owner ENTRY (owner → sales_rep) via demote purges stale rows ═══════════════
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}';
select lives_ok(
  $$ select public.demote_tenant_owner('33333333-3333-4333-8333-333333333333',
       '10000000-0000-4000-8000-000000000002', 'sales_rep') $$,
  'owner demotes owner2 (owner→sales_rep) — entry cleanup, last-owner preserved');
reset role;
select is((select count(*)::int from public.sales_rep_customers
           where tenant_id='33333333-3333-4333-8333-333333333333' and user_id='10000000-0000-4000-8000-000000000002'),
  0, 'owner2 (now sales_rep) inherits ZERO assignments');
select is((select count(*)::int from public.audit_events
           where entity_type='sales_rep_assignment' and event_type='sales_rep_assignment.removed'
             and entity_id='aaaaaaaa-0000-4000-8000-000000000003'
             and metadata->>'rep_user_id'='10000000-0000-4000-8000-000000000002'
             and metadata->>'source'='role_changed'),
  1, 'owner→sales_rep entry purged the stale cC (role_changed)');

-- ══ Owner EXIT (sales_rep → owner) via promote purges assignments ═════════════
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}';
select lives_ok(
  $$ select public.assign_customer_to_rep('33333333-3333-4333-8333-333333333333',
       '10000000-0000-4000-8000-000000000006', 'aaaaaaaa-0000-4000-8000-000000000003') $$,
  'owner assigns rep2→cC (before promotion)');
select lives_ok(
  $$ select public.promote_tenant_owner('33333333-3333-4333-8333-333333333333',
       '10000000-0000-4000-8000-000000000006') $$,
  'owner promotes rep2 (sales_rep→owner) — exit cleanup');
reset role;
select is((select count(*)::int from public.sales_rep_customers
           where tenant_id='33333333-3333-4333-8333-333333333333' and user_id='10000000-0000-4000-8000-000000000006'),
  0, 'rep2 (now owner) has ZERO assignments');
select is((select count(*)::int from public.audit_events
           where entity_type='sales_rep_assignment' and event_type='sales_rep_assignment.removed'
             and entity_id='aaaaaaaa-0000-4000-8000-000000000003'
             and metadata->>'rep_user_id'='10000000-0000-4000-8000-000000000006'
             and metadata->>'source'='role_changed'),
  1, 'sales_rep→owner exit purged cC (role_changed)');

-- ══ Member REMOVAL purges assignments (source member_removed) ══════════════════
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}';
select lives_ok(
  $$ select public.assign_customer_to_rep('33333333-3333-4333-8333-333333333333',
       '10000000-0000-4000-8000-00000000000a', 'aaaaaaaa-0000-4000-8000-000000000001') $$,
  'owner assigns removerep→cA (before removal)');
select lives_ok(
  $$ select public.assign_customer_to_rep('33333333-3333-4333-8333-333333333333',
       '10000000-0000-4000-8000-00000000000a', 'aaaaaaaa-0000-4000-8000-000000000002') $$,
  'owner assigns removerep→cB (before removal)');
select lives_ok(
  $$ select public.remove_tenant_member('33333333-3333-4333-8333-333333333333',
       '10000000-0000-4000-8000-00000000000a') $$,
  'owner removes removerep — member cleanup');
reset role;
select is((select count(*)::int from public.sales_rep_customers
           where tenant_id='33333333-3333-4333-8333-333333333333' and user_id='10000000-0000-4000-8000-00000000000a'),
  0, 'the removed member leaves ZERO assignment rows (no orphan)');
select is((select count(*)::int from public.audit_events
           where entity_type='sales_rep_assignment' and event_type='sales_rep_assignment.removed'
             and metadata->>'rep_user_id'='10000000-0000-4000-8000-00000000000a'
             and metadata->>'source'='member_removed'),
  2, 'member removal purged BOTH assignments with member_removed events');
select is((select count(*)::int from public.audit_events
           where entity_type='team' and event_type='team.member_removed'
             and entity_id='10000000-0000-4000-8000-00000000000a'),
  1, 'member removal still emits exactly ONE team.member_removed');
-- The removed member is denied immediately (no membership, no assignment).
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-00000000000a","role":"authenticated"}';
select is(public.can_access_customer('33333333-3333-4333-8333-333333333333', 'aaaaaaaa-0000-4000-8000-000000000001'),
  false, 'the removed member is denied customer access immediately');

-- ══ Membership REJOIN purges stale legacy rows (source member_joined) ══════════
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000008","role":"authenticated"}';
select is(public.accept_tenant_invite('rawtoken-rejoin-0001'),
  '33333333-3333-4333-8333-333333333333', 'the (re)joining user accepts and joins');
reset role;
select is((select count(*)::int from public.sales_rep_customers
           where tenant_id='33333333-3333-4333-8333-333333333333' and user_id='10000000-0000-4000-8000-000000000008'),
  0, 'the (re)joining member inherits ZERO stale assignments');
select is((select count(*)::int from public.audit_events
           where entity_type='sales_rep_assignment' and event_type='sales_rep_assignment.removed'
             and entity_id='aaaaaaaa-0000-4000-8000-000000000001'
             and metadata->>'rep_user_id'='10000000-0000-4000-8000-000000000008'
             and metadata->>'source'='member_joined'),
  1, 'rejoin purged the stale cA with a member_joined removed event');
select is((select count(*)::int from public.audit_events
           where entity_type='sales_rep_assignment' and event_type='sales_rep_assignment.created'
             and metadata->>'rep_user_id'='10000000-0000-4000-8000-000000000008'),
  0, 'joining as sales_rep emits NO created event');
select is((select count(*)::int from public.audit_events
           where entity_type='team' and event_type='team.member_joined'
             and entity_id='10000000-0000-4000-8000-000000000008'),
  1, 'rejoin still emits exactly ONE team.member_joined');

-- ══ Same-role no-op emits nothing ══════════════════════════════════════════════
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}';
select lives_ok(
  $$ select public.update_tenant_member_role('33333333-3333-4333-8333-333333333333',
       '10000000-0000-4000-8000-000000000004', 'admin') $$,
  'a same-role (admin→admin) request is an accepted no-op');
reset role;
select is((select count(*)::int from public.audit_events
           where entity_type='team' and event_type='team.role_changed'
             and entity_id='10000000-0000-4000-8000-000000000004'),
  0, 'the same-role no-op emitted no team.role_changed');

-- ══ Customer DELETION cascades the assignment with NO assignment event ═════════
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}';
select lives_ok(
  $$ select public.assign_customer_to_rep('33333333-3333-4333-8333-333333333333',
       '10000000-0000-4000-8000-00000000000b', 'aaaaaaaa-0000-4000-8000-000000000004') $$,
  'owner assigns delrep→cD (before customer deletion)');
reset role;
-- Capture the assignment-removed count before deleting the customer directly.
create temporary table _c (k text primary key, v int) on commit drop;
insert into _c(k, v) values ('before', (select count(*)::int from public.audit_events
  where entity_type='sales_rep_assignment' and event_type='sales_rep_assignment.removed'));
delete from public.customers where id='aaaaaaaa-0000-4000-8000-000000000004';
select is((select count(*)::int from public.sales_rep_customers
           where tenant_id='33333333-3333-4333-8333-333333333333' and customer_id='aaaaaaaa-0000-4000-8000-000000000004'),
  0, 'customer deletion cascades away the assignment row');
select is((select count(*)::int from public.audit_events
           where entity_type='sales_rep_assignment' and event_type='sales_rep_assignment.removed'),
  (select v from _c where k='before'), 'customer deletion emits NO sales_rep_assignment.removed event');

-- ══ ROLLBACK: a NULL-email rep forces the audit helper to fail → nothing commits ══
-- noemail-rep (email null) is a sales_rep with a direct assignment. Removing them
-- makes the purge emit with a null rep_email → the helper raises → the whole
-- remove_tenant_member transaction (assignments + membership + team event) rolls back.
insert into public.sales_rep_customers (tenant_id, user_id, customer_id, assigned_by) values
  ('33333333-3333-4333-8333-333333333333', '10000000-0000-4000-8000-00000000000c', 'aaaaaaaa-0000-4000-8000-000000000002', null);
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok(
  $$ select public.remove_tenant_member('33333333-3333-4333-8333-333333333333',
       '10000000-0000-4000-8000-00000000000c') $$,
  '22023', NULL, 'a null-email rep makes the audit helper fail (identity never invented)');
reset role;
select is((select count(*)::int from public.tenant_users
           where tenant_id='33333333-3333-4333-8333-333333333333' and user_id='10000000-0000-4000-8000-00000000000c'),
  1, 'the failed removal ROLLED BACK — the membership still exists');
select is((select count(*)::int from public.sales_rep_customers
           where tenant_id='33333333-3333-4333-8333-333333333333' and user_id='10000000-0000-4000-8000-00000000000c'),
  1, 'the failed removal ROLLED BACK — the assignment still exists');
select is((select count(*)::int from public.audit_events
           where entity_type='team' and event_type='team.member_removed'
             and entity_id='10000000-0000-4000-8000-00000000000c'),
  0, 'the failed removal left NO team.member_removed');

-- ══ Secret / PII safety + shape over EVERY assignment row ══════════════════════
select is((select count(*)::int from public.audit_events
           where entity_type='sales_rep_assignment'
             and (metadata ?| array['token','token_hash','jwt','session','password','phone',
                                     'email','address','balance','order','notes','api_key'])),
  0, 'NO assignment audit row carries a secret / extra-PII key');
select is((select count(*)::int from public.audit_events
           where entity_type='sales_rep_assignment'
             and (metadata->>'rep_email' is null or metadata->>'customer_name' is null
                  or metadata->>'rep_user_id' is null or metadata->>'source' is null)),
  0, 'EVERY assignment row carries rep_user_id + rep_email + customer_name + source');
select is((select count(*)::int from public.audit_events
           where entity_type='sales_rep_assignment' and entity_id is null),
  0, 'EVERY assignment row has a non-null entity id (customer)');
select is((select count(distinct k)::int from (
             select jsonb_object_keys(metadata) as k from public.audit_events
             where entity_type='sales_rep_assignment'
           ) s
           where k not in ('rep_user_id','rep_email','customer_name','source')),
  0, 'assignment metadata uses ONLY the four allowlisted keys');
select is((select count(*)::int from public.audit_events
           where entity_type='sales_rep_assignment'
             and event_type not in ('sales_rep_assignment.created','sales_rep_assignment.removed')),
  0, 'assignment rows use ONLY the two allowlisted event types');
select is((select count(*)::int from public.audit_events
           where entity_type='sales_rep_assignment' and event_type='sales_rep_assignment.created'
             and metadata->>'source' <> 'manual'),
  0, 'every created row has source=manual');
select is((select count(*)::int from public.audit_events
           where entity_type='sales_rep_assignment' and event_type='sales_rep_assignment.removed'
             and metadata->>'source' not in ('manual','member_removed','role_changed','member_joined')),
  0, 'every removed row has an allowlisted source');

-- ══ RLS visibility (owner/admin read; sales_rep + other tenant read none) ══════
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}';
select ok((select count(*) from public.audit_events
           where tenant_id='33333333-3333-4333-8333-333333333333' and entity_type='sales_rep_assignment') > 0,
  'an owner reads the tenant Assignment activity');
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000004","role":"authenticated"}';
select ok((select count(*) from public.audit_events
           where tenant_id='33333333-3333-4333-8333-333333333333' and entity_type='sales_rep_assignment') > 0,
  'an admin reads the tenant Assignment activity');
-- entry-user is NOW a sales_rep (id 07): reads NO assignment activity, incl. its own.
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000007","role":"authenticated"}';
select is((select count(*)::int from public.audit_events
           where tenant_id='33333333-3333-4333-8333-333333333333' and entity_type='sales_rep_assignment'),
  0, 'a sales_rep reads NO Assignment activity (including its own)');
set local request.jwt.claims = '{"sub":"20000000-0000-4000-8000-000000000001","role":"authenticated"}';
select is((select count(*)::int from public.audit_events
           where tenant_id='33333333-3333-4333-8333-333333333333' and entity_type='sales_rep_assignment'),
  0, 'another tenant reads NONE of this tenant''s Assignment activity');
reset role;

-- ══ RLS policy shape preserved (single SELECT policy; prior clauses intact) ═════
select is((select count(*)::int from pg_policies
           where schemaname='public' and tablename='audit_events'
             and policyname='audit_events: members read; entity rows scoped'),
  1, 'the audit_events SELECT policy exists under the concise name');
select is((select count(*)::int from pg_policies
           where schemaname='public' and tablename='audit_events' and cmd='SELECT'),
  1, 'there is exactly ONE audit_events SELECT policy (no competing permissive one)');
select ok((select qual from pg_policies
           where schemaname='public' and tablename='audit_events'
             and policyname='audit_events: members read; entity rows scoped')
          like '%sales_rep_assignment%', 'the assignment clause is present');
select ok((select qual from pg_policies
           where schemaname='public' and tablename='audit_events'
             and policyname='audit_events: members read; entity rows scoped')
          like '%can_access_customer%', 'the customer clause is preserved');
select ok((select qual from pg_policies
           where schemaname='public' and tablename='audit_events'
             and policyname='audit_events: members read; entity rows scoped')
          like '%settings%', 'the settings clause is preserved');

-- ══ RPC / predicate preservation ═══════════════════════════════════════════════
select ok(to_regprocedure('public.assign_customer_to_rep(uuid,uuid,uuid)') is not null,
  'assign_customer_to_rep signature preserved');
select ok(to_regprocedure('public.unassign_customer_from_rep(uuid,uuid,uuid)') is not null,
  'unassign_customer_from_rep signature preserved');
select ok(to_regprocedure('public.can_access_customer(uuid,uuid)') is not null,
  'can_access_customer signature preserved');
select ok(to_regprocedure('public.can_access_order(uuid,uuid)') is not null,
  'can_access_order signature preserved');
select is((select bool_and(prosecdef) from pg_proc
           where proname in ('assign_customer_to_rep','unassign_customer_from_rep',
                             'can_access_customer','can_access_order','accept_tenant_invite')
             and pronamespace='public'::regnamespace),
  true, 'the redefined assignment RPCs + predicates + accept remain SECURITY DEFINER');
select ok((select pg_get_functiondef('public.can_access_customer(uuid,uuid)'::regprocedure))
          ~ 'tu.role = ''sales_rep''', 'can_access_customer requires a current sales_rep membership');
select ok((select pg_get_functiondef('public.can_access_order(uuid,uuid)'::regprocedure))
          ~ 'tu.role = ''sales_rep''', 'can_access_order requires a current sales_rep membership');
select ok((select pg_get_functiondef('public.assign_customer_to_rep(uuid,uuid,uuid)'::regprocedure))
          ~ 'for update', 'assign_customer_to_rep locks its rows FOR UPDATE');

-- ══ The tenant-wide Assignment Timeline partial index exists ═══════════════════
select has_index('public', 'audit_events', 'audit_events_tenant_assignment_time_idx',
  'the tenant-wide Assignment Timeline partial index exists');

select * from finish();
rollback;
