-- ═══════════════════════════════════════════════════════════════════════
-- pgTAP — C2 signup review STATE MACHINE + terminal-transition hardening
--
-- Sequential (single-session) proof of the signup-request state machine enforced
-- by approve_customer_signup_request / reject_customer_signup_request and the
-- terminal-state CHECK constraint:
--   PENDING → APPROVED (one Customer + one customer.created audit event) OR
--   PENDING → REJECTED, never both; a losing terminal transition raises and
--   writes no Customer/audit; missing / cross-tenant / non-member / sales_rep
--   callers are rejected; the CHECK makes the BOTH-set state unreachable even by
--   a direct write; RPC signatures / SECURITY DEFINER / empty search_path /
--   grants are preserved.
--
-- The CONCURRENT interleavings (approve/approve, approve/reject) are proven
-- deterministically over real sessions in
-- src/lib/data/signup-concurrency.live.test.ts (pgTAP is single-session).
--
-- Run with the local stack up:  supabase test db
-- Disposable tenants A + B in THIS transaction; everything rolls back. No
-- secrets/tokens printed.
-- ═══════════════════════════════════════════════════════════════════════
begin;
select plan(45);

set local request.jwt.claims = '{"role":"service_role"}';

-- Users: ownerA, adminA, repA (sales_rep), ownerB
insert into auth.users (id) values
  ('a0000000-0000-4000-8000-000000000001'),
  ('a0000000-0000-4000-8000-000000000002'),
  ('a0000000-0000-4000-8000-000000000003'),
  ('b0000000-0000-4000-8000-000000000001');
-- Tenants A + B
insert into public.tenants (id, name_ar, name_he, name_en) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'أ', 'א', 'A'),
  ('bbbbbbbb-0000-4000-8000-000000000001', 'ب', 'ב', 'B');
insert into public.tenant_users (tenant_id, user_id, role) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'owner'),
  ('aaaaaaaa-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', 'admin'),
  ('aaaaaaaa-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000003', 'sales_rep'),
  ('bbbbbbbb-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'owner');
insert into public.customer_signup_links (id, tenant_id, token_hash) values
  ('aa100000-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', repeat('a', 64)),
  ('bb100000-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000001', repeat('b', 64));
-- Pending requests: R1 approve, R2 reject, R3 approve-then-reject, R4 reject-then-approve,
-- R5 rep/admin, RB cross-tenant (tenant B).
insert into public.customer_signup_requests (id, tenant_id, link_id, name, phone) values
  ('a1000000-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', 'aa100000-0000-4000-8000-000000000001', 'R1 Approve', '050-1'),
  ('a2000000-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000001', 'aa100000-0000-4000-8000-000000000001', 'R2 Reject', '050-2'),
  ('a3000000-0000-4000-8000-000000000003', 'aaaaaaaa-0000-4000-8000-000000000001', 'aa100000-0000-4000-8000-000000000001', 'R3 ApproveThenReject', '050-3'),
  ('a4000000-0000-4000-8000-000000000004', 'aaaaaaaa-0000-4000-8000-000000000001', 'aa100000-0000-4000-8000-000000000001', 'R4 RejectThenApprove', '050-4'),
  ('a5000000-0000-4000-8000-000000000005', 'aaaaaaaa-0000-4000-8000-000000000001', 'aa100000-0000-4000-8000-000000000001', 'R5 RepThenAdmin', '050-5'),
  ('b1000000-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000001', 'bb100000-0000-4000-8000-000000000001', 'RB CrossTenant', '050-6');

-- ═══ Hardening: signatures / security / search_path / grants preserved ═══════
select is(
  (select pg_get_function_identity_arguments('public.approve_customer_signup_request(uuid,uuid)'::regprocedure)),
  'p_tenant_id uuid, p_request_id uuid', 'approve keeps its 2-arg (uuid,uuid) signature');
select is(
  (select pg_get_function_identity_arguments('public.reject_customer_signup_request(uuid,uuid)'::regprocedure)),
  'p_tenant_id uuid, p_request_id uuid', 'reject keeps its 2-arg (uuid,uuid) signature');
select is((select prosecdef from pg_proc where oid='public.approve_customer_signup_request(uuid,uuid)'::regprocedure), true, 'approve is SECURITY DEFINER');
select is((select prosecdef from pg_proc where oid='public.reject_customer_signup_request(uuid,uuid)'::regprocedure), true, 'reject is SECURITY DEFINER');
select ok((select 'search_path=""' = any(proconfig) from pg_proc where oid='public.approve_customer_signup_request(uuid,uuid)'::regprocedure), 'approve pins an empty search_path');
select ok((select 'search_path=""' = any(proconfig) from pg_proc where oid='public.reject_customer_signup_request(uuid,uuid)'::regprocedure), 'reject pins an empty search_path');
select ok(has_function_privilege('authenticated', 'public.approve_customer_signup_request(uuid,uuid)', 'EXECUTE'), 'authenticated may execute approve');
select ok(has_function_privilege('service_role', 'public.approve_customer_signup_request(uuid,uuid)', 'EXECUTE'), 'service_role may execute approve');
select ok(not has_function_privilege('anon', 'public.approve_customer_signup_request(uuid,uuid)', 'EXECUTE'), 'anon may NOT execute approve');
select ok(not has_function_privilege('public', 'public.approve_customer_signup_request(uuid,uuid)', 'EXECUTE'), 'PUBLIC may NOT execute approve');
select ok(has_function_privilege('authenticated', 'public.reject_customer_signup_request(uuid,uuid)', 'EXECUTE'), 'authenticated may execute reject');
select ok(not has_function_privilege('anon', 'public.reject_customer_signup_request(uuid,uuid)', 'EXECUTE'), 'anon may NOT execute reject');

-- ═══ Authenticated owner (ownerA) ════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';

-- ── 1. PENDING → APPROVED: one Customer + one audit event ──────────────────
select lives_ok(
  $$ select public.approve_customer_signup_request('aaaaaaaa-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001') $$,
  'approve a pending request succeeds');
select ok((select approved_at is not null and rejected_at is null from public.customer_signup_requests where id='a1000000-0000-4000-8000-000000000001'),
  'R1 is APPROVED only (approved_at set, rejected_at null)');
select is((select count(*) from public.customers where tenant_id='aaaaaaaa-0000-4000-8000-000000000001' and origin='signup' and name='R1 Approve'),
  1::bigint, 'approval created exactly one signup Customer');
select is((select count(*) from public.audit_events where event_type='customer.created' and metadata->>'signup_request_id'='a1000000-0000-4000-8000-000000000001'),
  1::bigint, 'approval wrote exactly one customer.created audit event for R1');
select is((select approved_customer_id from public.customer_signup_requests where id='a1000000-0000-4000-8000-000000000001'),
  (select id from public.customers where name='R1 Approve' and tenant_id='aaaaaaaa-0000-4000-8000-000000000001'),
  'approved_customer_id points at the created Customer');

-- ── 2. PENDING → REJECTED: no Customer ─────────────────────────────────────
select lives_ok(
  $$ select public.reject_customer_signup_request('aaaaaaaa-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000002') $$,
  'reject a pending request succeeds');
select ok((select rejected_at is not null and approved_at is null from public.customer_signup_requests where id='a2000000-0000-4000-8000-000000000002'),
  'R2 is REJECTED only (rejected_at set, approved_at null)');
select is((select count(*) from public.customers where name='R2 Reject'), 0::bigint, 'rejection created no Customer');

-- ── 3. APPROVED cannot be rejected ─────────────────────────────────────────
select lives_ok(
  $$ select public.approve_customer_signup_request('aaaaaaaa-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000003') $$,
  'approve R3 (arrange an approved request)');
select throws_ok(
  $$ select public.reject_customer_signup_request('aaaaaaaa-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000003') $$,
  '22023', NULL, 'an already-APPROVED request cannot be rejected');
select ok((select approved_at is not null and rejected_at is null from public.customer_signup_requests where id='a3000000-0000-4000-8000-000000000003'),
  'R3 stays APPROVED only after a refused reject');

-- ── 4. REJECTED cannot be approved (no Customer, no audit) ──────────────────
select lives_ok(
  $$ select public.reject_customer_signup_request('aaaaaaaa-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000004') $$,
  'reject R4 (arrange a rejected request)');
select throws_ok(
  $$ select public.approve_customer_signup_request('aaaaaaaa-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000004') $$,
  '22023', NULL, 'an already-REJECTED request cannot be approved');
select ok((select rejected_at is not null and approved_at is null from public.customer_signup_requests where id='a4000000-0000-4000-8000-000000000004'),
  'R4 stays REJECTED only after a refused approve');
select is((select count(*) from public.customers where name='R4 RejectThenApprove'), 0::bigint, 'the refused approve created NO Customer');
select is((select count(*) from public.audit_events where metadata->>'signup_request_id'='a4000000-0000-4000-8000-000000000004'), 0::bigint, 'the refused approve wrote NO audit event');

-- ── 5. reject/reject idempotency error contract ────────────────────────────
select throws_ok(
  $$ select public.reject_customer_signup_request('aaaaaaaa-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000002') $$,
  '22023', NULL, 'rejecting an already-REJECTED request raises (idempotency-error contract preserved)');

-- ── 6. re-approve idempotency: no second Customer / audit ──────────────────
select throws_ok(
  $$ select public.approve_customer_signup_request('aaaaaaaa-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001') $$,
  '22023', NULL, 're-approving an already-APPROVED request raises');
select is((select count(*) from public.customers where name='R1 Approve'), 1::bigint, 're-approve created no second Customer');
select is((select count(*) from public.audit_events where metadata->>'signup_request_id'='a1000000-0000-4000-8000-000000000001'), 1::bigint, 're-approve wrote no second audit event');

-- ── 7. missing request ─────────────────────────────────────────────────────
select throws_ok(
  $$ select public.approve_customer_signup_request('aaaaaaaa-0000-4000-8000-000000000001','a9999999-0000-4000-8000-000000000099') $$,
  '22023', NULL, 'approving a missing request raises');
select throws_ok(
  $$ select public.reject_customer_signup_request('aaaaaaaa-0000-4000-8000-000000000001','a9999999-0000-4000-8000-000000000099') $$,
  '22023', NULL, 'rejecting a missing request raises');

-- ── 8. cross-tenant / non-member ───────────────────────────────────────────
select throws_ok(
  $$ select public.approve_customer_signup_request('aaaaaaaa-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001') $$,
  '22023', NULL, 'approving another tenant''s request (scoped to my tenant) raises unknown/another-tenant');
select throws_ok(
  $$ select public.approve_customer_signup_request('bbbbbbbb-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001') $$,
  NULL, NULL, 'approving with a tenant I am not a member of raises (authorize_tenant)');
-- Verify the tenant-B request is untouched. ownerA cannot SELECT tenant-B rows
-- under RLS, so read the state through the privileged (RLS-bypassing) role.
reset role;
select ok((select approved_at is null and rejected_at is null from public.customer_signup_requests where id='b1000000-0000-4000-8000-000000000001'),
  'the tenant-B request stays PENDING after cross-tenant attempts');

-- ── 9. sales_rep is not authorized for either terminal transition ──────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}';
select throws_ok(
  $$ select public.approve_customer_signup_request('aaaaaaaa-0000-4000-8000-000000000001','a5000000-0000-4000-8000-000000000005') $$,
  NULL, NULL, 'a sales_rep cannot approve (authorize_tenant blocks)');
select throws_ok(
  $$ select public.reject_customer_signup_request('aaaaaaaa-0000-4000-8000-000000000001','a5000000-0000-4000-8000-000000000005') $$,
  NULL, NULL, 'a sales_rep cannot reject (authorize_tenant blocks)');
-- A sales_rep cannot SELECT signup_requests under RLS (owner/admin only), so read
-- the untouched state through the privileged role.
reset role;
select ok((select approved_at is null and rejected_at is null from public.customer_signup_requests where id='a5000000-0000-4000-8000-000000000005'),
  'R5 stays PENDING after the blocked sales_rep attempts');

-- ── 10. an ADMIN is authorized to approve (owner/admin allowed) ────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}';
select lives_ok(
  $$ select public.approve_customer_signup_request('aaaaaaaa-0000-4000-8000-000000000001','a5000000-0000-4000-8000-000000000005') $$,
  'an admin can approve (owner/admin authorized)');
select ok((select approved_at is not null and rejected_at is null from public.customer_signup_requests where id='a5000000-0000-4000-8000-000000000005'),
  'R5 is APPROVED only after the admin approval');

-- ── 11. terminal-state CHECK: BOTH-set is unreachable even by a direct write ─
reset role;
select ok(
  exists(select 1 from pg_constraint where conname='customer_signup_requests_terminal_state_ck'
         and conrelid='public.customer_signup_requests'::regclass),
  'the terminal-state CHECK constraint exists');
select throws_ok(
  $$ update public.customer_signup_requests set rejected_at = now() where id='a1000000-0000-4000-8000-000000000001' $$,
  '23514', NULL, 'setting rejected_at on an APPROVED row violates the terminal-state CHECK');
select throws_ok(
  $$ insert into public.customer_signup_requests (tenant_id, link_id, name, approved_at, rejected_at)
     values ('aaaaaaaa-0000-4000-8000-000000000001','aa100000-0000-4000-8000-000000000001','Both', now(), now()) $$,
  '23514', NULL, 'inserting a BOTH-set row violates the terminal-state CHECK');

select finish();
rollback;
