-- ═══════════════════════════════════════════════════════════════════════
-- pgTAP — M8I.6 CUSTOMER SIGNUP REQUEST DECISION AUDIT (PILOT-OPS-AUDIT-006)
--
-- Verifies the transactional review-decision producers on public.audit_events for
-- tenant-scoped customer/store signup requests (approval creates a customer; no
-- platform/Tenant provisioning):
--   • the private helper is SECURITY INVOKER, search_path='', executable by NO
--     client role; closed 2-event allowlist; entity_type='customer_signup_request';
--     metadata EXACTLY {business_name} for rejected and {business_name,
--     resulting_customer_id} for approved, with bounds + UUID validation;
--   • approve (C2 lock/claim PRESERVED) emits exactly one customer.created(origin=
--     signup) AND one customer_signup_request.approved; reject emits one
--     customer_signup_request.rejected — each only on the effective transition;
--   • owner/admin allowed; sales_rep/non-member/cross-tenant denied; already-
--     reviewed → 22023 + no event; the terminal-state CHECK still bars both-set;
--   • helper failure rolls back the whole decision (customer + request + events);
--   • anonymous submission produces NO audit event and cannot forge decisions;
--   • the audit_events RLS policy scopes signup rows to owner/admin, leaving the
--     customer/order/product/inventory/team/settings/assignment clauses intact;
--   • every redefined RPC keeps its signature / DEFINER / search_path / grants.
--
-- Run with the local stack up:  supabase test db
-- Disposable tenants T + T2 in THIS transaction; everything rolls back.
-- ═══════════════════════════════════════════════════════════════════════
begin;
select plan(80);

set local request.jwt.claims = '{"role":"service_role"}';

-- ── Fixtures ────────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('10000000-0000-4000-8000-000000000001', 'owner@t.local'),
  ('10000000-0000-4000-8000-000000000004', 'admin@t.local'),
  ('10000000-0000-4000-8000-000000000005', 'rep@t.local'),
  ('20000000-0000-4000-8000-000000000001', 'owner@t2.local');
insert into public.tenants (id, name_ar, name_he, name_en) values
  ('33333333-3333-4333-8333-333333333333', 'ت', 'ט', 'T'),
  ('44444444-4444-4444-8444-444444444444', 'ت٢', 'ט٢', 'T2');
insert into public.tenant_users (tenant_id, user_id, role) values
  ('33333333-3333-4333-8333-333333333333', '10000000-0000-4000-8000-000000000001', 'owner'),
  ('33333333-3333-4333-8333-333333333333', '10000000-0000-4000-8000-000000000004', 'admin'),
  ('33333333-3333-4333-8333-333333333333', '10000000-0000-4000-8000-000000000005', 'sales_rep'),
  ('44444444-4444-4444-8444-444444444444', '20000000-0000-4000-8000-000000000001', 'owner');
-- Signup links (required FK for requests). token_hash for the anon submit test.
insert into public.customer_signup_links (id, tenant_id, token_hash) values
  ('11111111-0000-4000-8000-000000000001', '33333333-3333-4333-8333-333333333333',
   encode(sha256(convert_to('rawtoken-signup-0001', 'UTF8')), 'hex')),
  ('11111111-0000-4000-8000-000000000002', '44444444-4444-4444-8444-444444444444',
   encode(sha256(convert_to('rawtoken-signup-0002', 'UTF8')), 'hex'));
-- Pending requests (inserted directly — status derived, both timestamps NULL).
insert into public.customer_signup_requests (id, tenant_id, link_id, name) values
  ('aaaaaaaa-0000-4000-8000-000000000001', '33333333-3333-4333-8333-333333333333', '11111111-0000-4000-8000-000000000001', 'Store One'),
  ('aaaaaaaa-0000-4000-8000-000000000002', '33333333-3333-4333-8333-333333333333', '11111111-0000-4000-8000-000000000001', 'Store Two'),
  ('aaaaaaaa-0000-4000-8000-000000000003', '33333333-3333-4333-8333-333333333333', '11111111-0000-4000-8000-000000000001', 'Store Three'),
  ('aaaaaaaa-0000-4000-8000-000000000004', '33333333-3333-4333-8333-333333333333', '11111111-0000-4000-8000-000000000001', 'Store Four'),
  ('aaaaaaaa-0000-4000-8000-000000000005', '33333333-3333-4333-8333-333333333333', '11111111-0000-4000-8000-000000000001', 'Store Five'),
  ('aaaaaaaa-0000-4000-8000-000000000006', '33333333-3333-4333-8333-333333333333', '11111111-0000-4000-8000-000000000001', 'Store Six'),
  ('aaaaaaaa-0000-4000-8000-000000000007', '33333333-3333-4333-8333-333333333333', '11111111-0000-4000-8000-000000000001', 'Store Seven'),
  -- whitespace-only name → helper rejects → rollback probes (bypasses submit validation)
  ('aaaaaaaa-0000-4000-8000-0000000000f1', '33333333-3333-4333-8333-333333333333', '11111111-0000-4000-8000-000000000001', '   '),
  ('aaaaaaaa-0000-4000-8000-0000000000f2', '33333333-3333-4333-8333-333333333333', '11111111-0000-4000-8000-000000000001', '   ');

create temporary table _t (k text primary key, v uuid) on commit drop;

-- ══ 1–8. Helper: exists, INVOKER, empty search_path, void, no client grant ══
select has_function('public', '_log_customer_signup_request_audit_event',
  array['uuid', 'text', 'uuid', 'jsonb'], 'the private signup audit helper exists');
select is((select prosecdef from pg_proc where oid='public._log_customer_signup_request_audit_event(uuid,text,uuid,jsonb)'::regprocedure),
  false, 'helper is SECURITY INVOKER');
select is((select array_to_string(proconfig, ',') from pg_proc where oid='public._log_customer_signup_request_audit_event(uuid,text,uuid,jsonb)'::regprocedure),
  'search_path=""', 'helper pins an EMPTY search_path');
select is(pg_get_function_result('public._log_customer_signup_request_audit_event(uuid,text,uuid,jsonb)'::regprocedure),
  'void', 'helper returns void');
select ok(not has_function_privilege('public', 'public._log_customer_signup_request_audit_event(uuid,text,uuid,jsonb)', 'EXECUTE'),
  'PUBLIC cannot invoke the helper');
select ok(not has_function_privilege('anon', 'public._log_customer_signup_request_audit_event(uuid,text,uuid,jsonb)', 'EXECUTE'),
  'anon cannot invoke the helper');
select ok(not has_function_privilege('authenticated', 'public._log_customer_signup_request_audit_event(uuid,text,uuid,jsonb)', 'EXECUTE'),
  'authenticated cannot invoke the helper');
select ok(not has_function_privilege('service_role', 'public._log_customer_signup_request_audit_event(uuid,text,uuid,jsonb)', 'EXECUTE'),
  'service_role has NO explicit helper grant');

-- ══ 9–22. Helper metadata validation (as superuser; raises before insert) ════
select throws_ok(
  $$ select public._log_customer_signup_request_audit_event('33333333-3333-4333-8333-333333333333', 'customer_signup_request.bogus',
       'aaaaaaaa-0000-4000-8000-000000000001', jsonb_build_object('business_name','X')) $$,
  '22023', NULL, 'helper rejects an unknown event type (no "Other")');
select throws_ok(
  $$ select public._log_customer_signup_request_audit_event('33333333-3333-4333-8333-333333333333', 'customer_signup_request.rejected',
       'aaaaaaaa-0000-4000-8000-000000000001', '[1,2]'::jsonb) $$,
  '22023', NULL, 'helper rejects non-object metadata');
select throws_ok(
  $$ select public._log_customer_signup_request_audit_event('33333333-3333-4333-8333-333333333333', 'customer_signup_request.rejected',
       'aaaaaaaa-0000-4000-8000-000000000001', jsonb_build_object('business_name', repeat('a',5000))) $$,
  '22023', NULL, 'helper rejects oversized metadata');
select throws_ok(
  $$ select public._log_customer_signup_request_audit_event('33333333-3333-4333-8333-333333333333', 'customer_signup_request.rejected',
       'aaaaaaaa-0000-4000-8000-000000000001', jsonb_build_object('resulting_customer_id','44444444-4444-4444-8444-444444444444')) $$,
  '22023', NULL, 'rejected rejects a missing business_name');
select throws_ok(
  $$ select public._log_customer_signup_request_audit_event('33333333-3333-4333-8333-333333333333', 'customer_signup_request.rejected',
       'aaaaaaaa-0000-4000-8000-000000000001', jsonb_build_object('business_name','X','token','secret')) $$,
  '22023', NULL, 'rejected rejects an unknown extra key (token)');
select throws_ok(
  $$ select public._log_customer_signup_request_audit_event('33333333-3333-4333-8333-333333333333', 'customer_signup_request.rejected',
       'aaaaaaaa-0000-4000-8000-000000000001', jsonb_build_object('business_name','X','resulting_customer_id','44444444-4444-4444-8444-444444444444')) $$,
  '22023', NULL, 'rejected rejects a resulting_customer_id');
select throws_ok(
  $$ select public._log_customer_signup_request_audit_event('33333333-3333-4333-8333-333333333333', 'customer_signup_request.approved',
       'aaaaaaaa-0000-4000-8000-000000000001', jsonb_build_object('business_name','X')) $$,
  '22023', NULL, 'approved rejects a missing resulting_customer_id');
select throws_ok(
  $$ select public._log_customer_signup_request_audit_event('33333333-3333-4333-8333-333333333333', 'customer_signup_request.approved',
       'aaaaaaaa-0000-4000-8000-000000000001', jsonb_build_object('business_name','X','resulting_customer_id','not-a-uuid')) $$,
  '22023', NULL, 'approved rejects a malformed resulting_customer_id');
select throws_ok(
  $$ select public._log_customer_signup_request_audit_event('33333333-3333-4333-8333-333333333333', 'customer_signup_request.approved',
       'aaaaaaaa-0000-4000-8000-000000000001', jsonb_build_object('business_name','X','resulting_customer_id','44444444-4444-4444-8444-444444444444','extra','y')) $$,
  '22023', NULL, 'approved rejects an unknown extra key');
select throws_ok(
  $$ select public._log_customer_signup_request_audit_event('33333333-3333-4333-8333-333333333333', 'customer_signup_request.rejected',
       'aaaaaaaa-0000-4000-8000-000000000001', jsonb_build_object('business_name','')) $$,
  '22023', NULL, 'helper rejects an empty business_name');
select throws_ok(
  $$ select public._log_customer_signup_request_audit_event('33333333-3333-4333-8333-333333333333', 'customer_signup_request.rejected',
       'aaaaaaaa-0000-4000-8000-000000000001', jsonb_build_object('business_name', repeat('a',201))) $$,
  '22023', NULL, 'helper rejects an oversized business_name');
select throws_ok(
  $$ select public._log_customer_signup_request_audit_event('33333333-3333-4333-8333-333333333333', 'customer_signup_request.rejected',
       'aaaaaaaa-0000-4000-8000-000000000001', jsonb_build_object('business_name','  X  ')) $$,
  '22023', NULL, 'helper rejects a non-trimmed business_name');
select throws_ok(
  $$ select public._log_customer_signup_request_audit_event('33333333-3333-4333-8333-333333333333', 'customer_signup_request.rejected',
       null, jsonb_build_object('business_name','X')) $$,
  '22023', NULL, 'helper rejects a null entity id (request)');
select throws_ok(
  $$ select public._log_customer_signup_request_audit_event(null, 'customer_signup_request.rejected',
       'aaaaaaaa-0000-4000-8000-000000000001', jsonb_build_object('business_name','X')) $$,
  '22023', NULL, 'helper rejects a null tenant');

-- ══ Anonymous submission → NO audit event, cannot forge decisions ════════════
set local request.jwt.claims = '{"role":"anon"}';
select is(public.submit_customer_signup_request('rawtoken-signup-0001', 'Anon Store'),
  true, 'a valid anonymous signup submission succeeds');
reset role;
select is((select count(*)::int from public.audit_events where entity_type='customer_signup_request'),
  0, 'anonymous submission produces NO signup audit event');
select is((select count(*)::int from public.customer_signup_requests
           where name='Anon Store' and approved_at is null and rejected_at is null),
  1, 'the submitted request is PENDING with no forged decision fields');

-- ══ Approval (owner) ═════════════════════════════════════════════════════════
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}';
insert into _t(k,v) values ('c1', public.approve_customer_signup_request(
  '33333333-3333-4333-8333-333333333333', 'aaaaaaaa-0000-4000-8000-000000000001'));
-- admin may also approve.
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000004","role":"authenticated"}';
insert into _t(k,v) values ('c2', public.approve_customer_signup_request(
  '33333333-3333-4333-8333-333333333333', 'aaaaaaaa-0000-4000-8000-000000000002'));
-- sales_rep denied.
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000005","role":"authenticated"}';
select throws_ok(
  $$ select public.approve_customer_signup_request('33333333-3333-4333-8333-333333333333','aaaaaaaa-0000-4000-8000-000000000003') $$,
  '42501', NULL, 'a sales_rep cannot approve a signup request');
-- cross-tenant: T2 owner approving a T request → unknown/another tenant.
set local request.jwt.claims = '{"sub":"20000000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok(
  $$ select public.approve_customer_signup_request('44444444-4444-4444-8444-444444444444','aaaaaaaa-0000-4000-8000-000000000003') $$,
  '22023', NULL, 'cross-tenant approval fails closed');

-- ══ Rejection (owner + admin) ════════════════════════════════════════════════
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}';
select is(public.reject_customer_signup_request('33333333-3333-4333-8333-333333333333','aaaaaaaa-0000-4000-8000-000000000004'),
  'aaaaaaaa-0000-4000-8000-000000000004', 'owner rejects a signup request (returns the request id)');
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000005","role":"authenticated"}';
select throws_ok(
  $$ select public.reject_customer_signup_request('33333333-3333-4333-8333-333333333333','aaaaaaaa-0000-4000-8000-000000000005') $$,
  '42501', NULL, 'a sales_rep cannot reject a signup request');
set local request.jwt.claims = '{"sub":"20000000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok(
  $$ select public.reject_customer_signup_request('44444444-4444-4444-8444-444444444444','aaaaaaaa-0000-4000-8000-000000000005') $$,
  '22023', NULL, 'cross-tenant rejection fails closed');

-- ══ Idempotency / terminal transitions ═══════════════════════════════════════
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok(
  $$ select public.approve_customer_signup_request('33333333-3333-4333-8333-333333333333','aaaaaaaa-0000-4000-8000-000000000001') $$,
  '22023', NULL, 'approving an already-approved request → 22023');
select throws_ok(
  $$ select public.reject_customer_signup_request('33333333-3333-4333-8333-333333333333','aaaaaaaa-0000-4000-8000-000000000004') $$,
  '22023', NULL, 'rejecting an already-rejected request → 22023');
select throws_ok(
  $$ select public.approve_customer_signup_request('33333333-3333-4333-8333-333333333333','aaaaaaaa-0000-4000-8000-000000000004') $$,
  '22023', NULL, 'approving a rejected request → 22023');
select throws_ok(
  $$ select public.reject_customer_signup_request('33333333-3333-4333-8333-333333333333','aaaaaaaa-0000-4000-8000-000000000001') $$,
  '22023', NULL, 'rejecting an approved request → 22023');

-- ══ Rollback: whitespace-only name → helper fails → nothing commits ══════════
select throws_ok(
  $$ select public.approve_customer_signup_request('33333333-3333-4333-8333-333333333333','aaaaaaaa-0000-4000-8000-0000000000f1') $$,
  '22023', NULL, 'approval with an unloggable business_name fails');
select throws_ok(
  $$ select public.reject_customer_signup_request('33333333-3333-4333-8333-333333333333','aaaaaaaa-0000-4000-8000-0000000000f2') $$,
  '22023', NULL, 'rejection with an unloggable business_name fails');
reset role;
select is((select count(*)::int from public.customer_signup_requests
           where id='aaaaaaaa-0000-4000-8000-0000000000f1' and approved_at is null and rejected_at is null),
  1, 'the failed approval ROLLED BACK — request still pending');
select is((select count(*)::int from public.customers where tenant_id='33333333-3333-4333-8333-333333333333' and name='   '),
  0, 'the failed approval ROLLED BACK — no customer created');
select is((select count(*)::int from public.customer_signup_requests
           where id='aaaaaaaa-0000-4000-8000-0000000000f2' and approved_at is null and rejected_at is null),
  1, 'the failed rejection ROLLED BACK — request still pending');

-- ══ Cardinality + metadata (as superuser) ════════════════════════════════════
-- Approval r1: one customer, one customer.created(origin=signup), one approved event.
select is((select count(*)::int from public.audit_events
           where entity_type='customer_signup_request' and event_type='customer_signup_request.approved'
             and entity_id='aaaaaaaa-0000-4000-8000-000000000001'),
  1, 'exactly ONE approved event for request r1');
select is((select count(*)::int from public.audit_events
           where entity_type='customer' and event_type='customer.created'
             and metadata->>'origin'='signup' and metadata->>'signup_request_id'='aaaaaaaa-0000-4000-8000-000000000001'),
  1, 'the existing customer.created(origin=signup) is preserved for r1');
select is((select metadata->>'business_name' from public.audit_events
           where entity_type='customer_signup_request' and event_type='customer_signup_request.approved'
             and entity_id='aaaaaaaa-0000-4000-8000-000000000001'),
  'Store One', 'approved carries the business_name snapshot');
select is((select metadata->>'resulting_customer_id' from public.audit_events
           where entity_type='customer_signup_request' and event_type='customer_signup_request.approved'
             and entity_id='aaaaaaaa-0000-4000-8000-000000000001'),
  (select v::text from _t where k='c1'), 'approved resulting_customer_id equals the returned Customer id');
select is((select approved_customer_id from public.customer_signup_requests where id='aaaaaaaa-0000-4000-8000-000000000001'),
  (select v from _t where k='c1'), 'the request approved_customer_id equals the returned Customer id');
select is((select reviewed_by from public.customer_signup_requests where id='aaaaaaaa-0000-4000-8000-000000000001'),
  '10000000-0000-4000-8000-000000000001'::uuid, 'r1 reviewed_by = the approving owner');
select ok((select approved_at is not null and rejected_at is null from public.customer_signup_requests where id='aaaaaaaa-0000-4000-8000-000000000001'),
  'r1 is APPROVED (approved_at set, rejected_at null)');
select is((select count(*)::int from public.customers where id = (select v from _t where k='c1') and origin='signup'),
  1, 'approval created exactly one signup-origin customer for r1');
-- Rejection r4: one rejected event, no customer.
select is((select count(*)::int from public.audit_events
           where entity_type='customer_signup_request' and event_type='customer_signup_request.rejected'
             and entity_id='aaaaaaaa-0000-4000-8000-000000000004'),
  1, 'exactly ONE rejected event for request r4');
select is((select metadata->>'business_name' from public.audit_events
           where entity_type='customer_signup_request' and event_type='customer_signup_request.rejected'
             and entity_id='aaaaaaaa-0000-4000-8000-000000000004'),
  'Store Four', 'rejected carries the business_name snapshot');
select ok((select metadata->'resulting_customer_id' is null from public.audit_events
           where entity_type='customer_signup_request' and event_type='customer_signup_request.rejected'
             and entity_id='aaaaaaaa-0000-4000-8000-000000000004'),
  'rejected event carries NO resulting_customer_id');
select is((select count(*)::int from public.audit_events
           where entity_type='customer' and metadata->>'signup_request_id'='aaaaaaaa-0000-4000-8000-000000000004'),
  0, 'rejection created no customer / customer.created');
select is((select reviewed_by from public.customer_signup_requests where id='aaaaaaaa-0000-4000-8000-000000000004'),
  '10000000-0000-4000-8000-000000000001'::uuid, 'r4 reviewed_by = the rejecting owner');
select ok((select rejected_at is not null and approved_at is null from public.customer_signup_requests where id='aaaaaaaa-0000-4000-8000-000000000004'),
  'r4 is REJECTED (rejected_at set, approved_at null)');

-- Total decision-event cardinality: 2 approvals (r1,r2) + 1 rejection (r4).
select is((select count(*)::int from public.audit_events
           where entity_type='customer_signup_request' and event_type='customer_signup_request.approved'),
  2, 'exactly two approved events overall (r1, r2)');
select is((select count(*)::int from public.audit_events
           where entity_type='customer_signup_request' and event_type='customer_signup_request.rejected'),
  1, 'exactly one rejected event overall (r4)');

-- ══ Privacy / shape over EVERY signup row ════════════════════════════════════
select is((select count(*)::int from public.audit_events
           where entity_type='customer_signup_request'
             and (metadata ?| array['email','phone','contact_name','address','city','notes',
                                     'token','jwt','session','password','api_key'])),
  0, 'NO signup audit row carries applicant contact / secret keys');
select is((select count(*)::int from public.audit_events
           where entity_type='customer_signup_request' and metadata->>'business_name' is null),
  0, 'EVERY signup row carries a business_name');
select is((select count(*)::int from public.audit_events
           where entity_type='customer_signup_request' and entity_id is null),
  0, 'EVERY signup row has a non-null entity id (request)');
select is((select count(distinct k)::int from (
             select jsonb_object_keys(metadata) as k from public.audit_events
             where entity_type='customer_signup_request'
           ) s
           where k not in ('business_name','resulting_customer_id')),
  0, 'signup metadata uses ONLY the allowlisted keys');
select is((select count(*)::int from public.audit_events
           where entity_type='customer_signup_request'
             and event_type not in ('customer_signup_request.approved','customer_signup_request.rejected')),
  0, 'signup rows use ONLY the two allowlisted event types');

-- ══ RLS visibility (owner/admin read; sales_rep + other tenant read none) ════
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}';
select ok((select count(*) from public.audit_events
           where tenant_id='33333333-3333-4333-8333-333333333333' and entity_type='customer_signup_request') > 0,
  'an owner reads the tenant Signup activity');
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000004","role":"authenticated"}';
select ok((select count(*) from public.audit_events
           where tenant_id='33333333-3333-4333-8333-333333333333' and entity_type='customer_signup_request') > 0,
  'an admin reads the tenant Signup activity');
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000005","role":"authenticated"}';
select is((select count(*)::int from public.audit_events
           where tenant_id='33333333-3333-4333-8333-333333333333' and entity_type='customer_signup_request'),
  0, 'a sales_rep reads NO Signup activity');
set local request.jwt.claims = '{"sub":"20000000-0000-4000-8000-000000000001","role":"authenticated"}';
select is((select count(*)::int from public.audit_events
           where tenant_id='33333333-3333-4333-8333-333333333333' and entity_type='customer_signup_request'),
  0, 'another tenant reads NONE of this tenant''s Signup activity');
reset role;

-- ══ RLS policy shape preserved (single SELECT policy; prior clauses intact) ═══
select is((select count(*)::int from pg_policies
           where schemaname='public' and tablename='audit_events'
             and policyname='audit_events: members read; entity rows scoped'),
  1, 'the audit_events SELECT policy exists under the concise name');
select is((select count(*)::int from pg_policies
           where schemaname='public' and tablename='audit_events' and cmd='SELECT'),
  1, 'there is exactly ONE audit_events SELECT policy');
select ok((select qual from pg_policies
           where schemaname='public' and tablename='audit_events'
             and policyname='audit_events: members read; entity rows scoped')
          like '%customer_signup_request%', 'the signup clause is present');
select ok((select qual from pg_policies
           where schemaname='public' and tablename='audit_events'
             and policyname='audit_events: members read; entity rows scoped')
          like '%sales_rep_assignment%', 'the assignment clause is preserved');
select ok((select qual from pg_policies
           where schemaname='public' and tablename='audit_events'
             and policyname='audit_events: members read; entity rows scoped')
          like '%can_access_customer%', 'the customer clause is preserved');
select ok((select qual from pg_policies
           where schemaname='public' and tablename='audit_events'
             and policyname='audit_events: members read; entity rows scoped')
          like '%settings%', 'the settings clause is preserved');

-- ══ RPC preservation ═════════════════════════════════════════════════════════
select ok(to_regprocedure('public.approve_customer_signup_request(uuid,uuid)') is not null,
  'approve_customer_signup_request signature preserved');
select ok(to_regprocedure('public.reject_customer_signup_request(uuid,uuid)') is not null,
  'reject_customer_signup_request signature preserved');
select ok(to_regprocedure('public.submit_customer_signup_request(text,text,text,text,text,text,text,text,text,text)') is not null,
  'submit_customer_signup_request signature preserved (not redefined)');
select ok(to_regprocedure('public.create_tenant_with_owner(text,text,text,public.locale_code)') is not null,
  'create_tenant_with_owner signature preserved (untouched)');
select is((select bool_and(prosecdef) from pg_proc
           where proname in ('approve_customer_signup_request','reject_customer_signup_request')
             and pronamespace='public'::regnamespace),
  true, 'both review RPCs remain SECURITY DEFINER');
select ok((select pg_get_functiondef('public.approve_customer_signup_request(uuid,uuid)'::regprocedure)) ~ 'for update',
  'approve keeps the C2 request-row FOR UPDATE lock');
select ok((select pg_get_functiondef('public.approve_customer_signup_request(uuid,uuid)'::regprocedure)) ~ 'customer\.created',
  'approve keeps the existing customer.created event');
select ok((select pg_get_functiondef('public.reject_customer_signup_request(uuid,uuid)'::regprocedure)) ~ 'returning',
  'reject uses RETURNING to change-gate the event');

-- ══ Terminal-state CHECK still bars the both-set state ═══════════════════════
select throws_ok(
  $$ update public.customer_signup_requests set approved_at = now(), rejected_at = now()
     where id = 'aaaaaaaa-0000-4000-8000-000000000006' $$,
  '23514', NULL, 'the terminal-state CHECK bars an approved+rejected row');

-- ══ Partial index ════════════════════════════════════════════════════════════
select has_index('public', 'audit_events', 'audit_events_tenant_customer_signup_time_idx',
  'the tenant-wide Signup Activity partial index exists');

select * from finish();
rollback;
