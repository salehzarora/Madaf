-- ═══════════════════════════════════════════════════════════════════════
-- pgTAP — M8G.3 bounded Timeline actor-label RPC
--
-- public.get_timeline_actor_labels_for_ids(p_tenant_id, p_actor_user_ids[]):
--   • exists with the intended signature; returns ONLY (actor_user_id, email);
--     SECURITY DEFINER, STABLE, search_path='' ; PUBLIC/anon/service_role cannot
--     execute, authenticated may (gated internally by authorize_tenant);
--   • BOUNDED input — dedup + null-strip; ≤50 distinct accepted; 51 → 22023;
--   • resolves ONLY the requested ids that are CURRENT members of the NAMED
--     tenant — no full roster, no unrequested member, no cross-tenant actor, no
--     fabricated row for an unknown/removed id, never > 50 rows;
--   • owner + admin resolve; sales_rep is denied (no emails); a caller cannot
--     forge tenant authorization; only email (no other auth metadata) is exposed;
--   • additive — M8G.2 audit RLS + eight producers + Timeline index intact; the
--     call mutates no audit / customer / order / membership rows.
--
-- Run with the local stack up:  supabase test db
-- Disposable tenants C + B in THIS transaction; everything rolls back. Emails
-- are controlled local fixtures (never real addresses).
-- ═══════════════════════════════════════════════════════════════════════
begin;
select plan(33);

set local request.jwt.claims = '{"role":"service_role"}';

-- Users (with controlled fixture emails) — 5 in C, 2 in B, 1 non-member ghost.
insert into auth.users (id, email) values
  ('c0c00000-0000-4000-8000-000000000001', 'ownerc@fixture.local'),
  ('c0c00000-0000-4000-8000-000000000002', 'repc@fixture.local'),
  ('c0c00000-0000-4000-8000-000000000003', 'adminc@fixture.local'),
  ('c0c00000-0000-4000-8000-000000000004', 'memberc1@fixture.local'),
  ('c0c00000-0000-4000-8000-000000000005', 'memberc2@fixture.local'),
  ('b0b00000-0000-4000-8000-000000000001', 'ownerb@fixture.local'),
  ('b0b00000-0000-4000-8000-000000000002', 'memberb@fixture.local'),
  ('dead0000-0000-4000-8000-000000000001', 'ghost@fixture.local');
insert into public.tenants (id, name_ar, name_he, name_en) values
  ('33333333-3333-4333-8333-333333333333', 'ج', 'ג', 'C'),
  ('22222222-2222-4222-8222-222222222222', 'ب', 'ב', 'B');
insert into public.tenant_users (tenant_id, user_id, role) values
  ('33333333-3333-4333-8333-333333333333', 'c0c00000-0000-4000-8000-000000000001', 'owner'),
  ('33333333-3333-4333-8333-333333333333', 'c0c00000-0000-4000-8000-000000000002', 'sales_rep'),
  ('33333333-3333-4333-8333-333333333333', 'c0c00000-0000-4000-8000-000000000003', 'admin'),
  ('33333333-3333-4333-8333-333333333333', 'c0c00000-0000-4000-8000-000000000004', 'sales_rep'),
  ('33333333-3333-4333-8333-333333333333', 'c0c00000-0000-4000-8000-000000000005', 'admin'),
  ('22222222-2222-4222-8222-222222222222', 'b0b00000-0000-4000-8000-000000000001', 'owner'),
  ('22222222-2222-4222-8222-222222222222', 'b0b00000-0000-4000-8000-000000000002', 'sales_rep');

-- ── 1–2. Signature + return columns ────────────────────────────────────────
select has_function('public', 'get_timeline_actor_labels_for_ids',
  array['uuid', 'uuid[]'], 'the bounded actor RPC exists with (uuid, uuid[])');
select is(
  pg_get_function_result('public.get_timeline_actor_labels_for_ids(uuid,uuid[])'::regprocedure),
  'TABLE(actor_user_id uuid, actor_email text)',
  'returns ONLY actor_user_id + actor_email (no role/tenant/auth metadata)');

-- ── 3–5. Security mode / volatility / search_path ──────────────────────────
select is((select prosecdef from pg_proc where oid='public.get_timeline_actor_labels_for_ids(uuid,uuid[])'::regprocedure),
  true, 'function is SECURITY DEFINER (auth.users read)');
select is((select provolatile from pg_proc where oid='public.get_timeline_actor_labels_for_ids(uuid,uuid[])'::regprocedure),
  's', 'function is STABLE');
select is((select array_to_string(proconfig, ',') from pg_proc where oid='public.get_timeline_actor_labels_for_ids(uuid,uuid[])'::regprocedure),
  'search_path=""', 'function pins an EMPTY search_path');

-- ── 6–9. Privilege matrix ──────────────────────────────────────────────────
select ok(not has_function_privilege('public', 'public.get_timeline_actor_labels_for_ids(uuid,uuid[])', 'EXECUTE'),
  'PUBLIC cannot execute');
select ok(not has_function_privilege('anon', 'public.get_timeline_actor_labels_for_ids(uuid,uuid[])', 'EXECUTE'),
  'anon cannot execute');
select ok(has_function_privilege('authenticated', 'public.get_timeline_actor_labels_for_ids(uuid,uuid[])', 'EXECUTE'),
  'authenticated may execute (gated internally by authorize_tenant)');
select ok(not has_function_privilege('service_role', 'public.get_timeline_actor_labels_for_ids(uuid,uuid[])', 'EXECUTE'),
  'service_role has NO explicit execute grant');

-- ═══ Authenticated caller: ownerC ══════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"c0c00000-0000-4000-8000-000000000001","role":"authenticated"}';

-- ── 10. Empty array → zero rows (no query fan-out) ─────────────────────────
select is(
  (select count(*) from public.get_timeline_actor_labels_for_ids('33333333-3333-4333-8333-333333333333', '{}'::uuid[])),
  0::bigint, 'an empty actor-id array returns zero rows');

-- ── 11. Duplicate ids → one row ────────────────────────────────────────────
select is(
  (select count(*) from public.get_timeline_actor_labels_for_ids(
    '33333333-3333-4333-8333-333333333333',
    array['c0c00000-0000-4000-8000-000000000004','c0c00000-0000-4000-8000-000000000004','c0c00000-0000-4000-8000-000000000004']::uuid[])),
  1::bigint, 'duplicate ids collapse to one row');

-- ── 12. 50 distinct ids accepted (no error) ────────────────────────────────
select lives_ok(
  $$ select * from public.get_timeline_actor_labels_for_ids(
       '33333333-3333-4333-8333-333333333333',
       (select array_agg(('00000000-0000-4000-8000-' || lpad(g::text,12,'0'))::uuid) from generate_series(1,50) g)) $$,
  '50 distinct actor ids are accepted');

-- ── 13. 51 distinct ids rejected with 22023 ────────────────────────────────
select throws_ok(
  $$ select * from public.get_timeline_actor_labels_for_ids(
       '33333333-3333-4333-8333-333333333333',
       (select array_agg(('00000000-0000-4000-8000-' || lpad(g::text,12,'0'))::uuid) from generate_series(1,51) g)) $$,
  '22023', NULL, '51 distinct actor ids are rejected (22023)');

-- ── 14–16. Requested-only: no unrequested member, no full roster ───────────
select results_eq(
  $$ select actor_user_id, actor_email from public.get_timeline_actor_labels_for_ids(
       '33333333-3333-4333-8333-333333333333', array['c0c00000-0000-4000-8000-000000000004']::uuid[]) $$,
  $$ values ('c0c00000-0000-4000-8000-000000000004'::uuid, 'memberc1@fixture.local') $$,
  'returns EXACTLY the one requested member (id + email)');
select is(
  (select count(*) from public.get_timeline_actor_labels_for_ids(
    '33333333-3333-4333-8333-333333333333', array['c0c00000-0000-4000-8000-000000000004']::uuid[])
   where actor_user_id = 'c0c00000-0000-4000-8000-000000000005'),
  0::bigint, 'an unrequested same-tenant member (memberC2) is NOT returned');
select ok(
  (select count(*) from public.get_timeline_actor_labels_for_ids(
    '33333333-3333-4333-8333-333333333333', array['c0c00000-0000-4000-8000-000000000004']::uuid[]))
   < (select count(*) from public.tenant_users where tenant_id='33333333-3333-4333-8333-333333333333'),
  'result is smaller than the roster — no full-roster read');

-- ── 17. owner resolves multiple requested current members ──────────────────
select is(
  (select count(*) from public.get_timeline_actor_labels_for_ids(
    '33333333-3333-4333-8333-333333333333',
    array['c0c00000-0000-4000-8000-000000000004','c0c00000-0000-4000-8000-000000000005']::uuid[])),
  2::bigint, 'owner resolves the two requested current members');

-- ── 20. cross-tenant id does not resolve (owner C requests a tenant-B member) ─
select is(
  (select count(*) from public.get_timeline_actor_labels_for_ids(
    '33333333-3333-4333-8333-333333333333', array['b0b00000-0000-4000-8000-000000000002']::uuid[])),
  0::bigint, 'a tenant-B member does NOT resolve for tenant C (cross-tenant isolation)');

-- ── 21–22. unknown / non-member id fabricates no row ───────────────────────
select is(
  (select count(*) from public.get_timeline_actor_labels_for_ids(
    '33333333-3333-4333-8333-333333333333', array['dead0000-0000-4000-8000-000000000001']::uuid[])),
  0::bigint, 'a non-member ghost user resolves to no row');
select is(
  (select count(*) from public.get_timeline_actor_labels_for_ids(
    '33333333-3333-4333-8333-333333333333', array['99999999-9999-4999-8999-999999999999']::uuid[])),
  0::bigint, 'an entirely unknown id fabricates no row');

-- ── 23. Result never exceeds 50 (broad request of all C members) ───────────
select ok(
  (select count(*) from public.get_timeline_actor_labels_for_ids(
    '33333333-3333-4333-8333-333333333333',
    array['c0c00000-0000-4000-8000-000000000001','c0c00000-0000-4000-8000-000000000002',
          'c0c00000-0000-4000-8000-000000000003','c0c00000-0000-4000-8000-000000000004',
          'c0c00000-0000-4000-8000-000000000005']::uuid[])) <= 50,
  'the result never exceeds 50 rows');

-- ── 25. Only email is exposed (the resolved email is the fixture value) ────
select is(
  (select actor_email from public.get_timeline_actor_labels_for_ids(
    '33333333-3333-4333-8333-333333333333', array['c0c00000-0000-4000-8000-000000000001']::uuid[])),
  'ownerc@fixture.local', 'the resolved label is exactly the member email (no other field)');

-- ── 24. Cross-tenant authorization cannot be forged (owner C names tenant B) ─
select throws_ok(
  $$ select * from public.get_timeline_actor_labels_for_ids('22222222-2222-4222-8222-222222222222', array['b0b00000-0000-4000-8000-000000000002']::uuid[]) $$,
  '42501', NULL, 'owner C cannot name tenant B (authorize_tenant denies)');

-- ═══ admin caller: adminC ══════════════════════════════════════════════════
set local request.jwt.claims = '{"sub":"c0c00000-0000-4000-8000-000000000003","role":"authenticated"}';
-- ── 18. admin resolves requested current members ───────────────────────────
select is(
  (select count(*) from public.get_timeline_actor_labels_for_ids(
    '33333333-3333-4333-8333-333333333333', array['c0c00000-0000-4000-8000-000000000004']::uuid[])),
  1::bigint, 'admin resolves a requested current member');

-- ═══ sales_rep caller: repC ════════════════════════════════════════════════
set local request.jwt.claims = '{"sub":"c0c00000-0000-4000-8000-000000000002","role":"authenticated"}';
-- ── 19. sales_rep cannot obtain actor emails (owner/admin only) ────────────
select throws_ok(
  $$ select * from public.get_timeline_actor_labels_for_ids('33333333-3333-4333-8333-333333333333', array['c0c00000-0000-4000-8000-000000000004']::uuid[]) $$,
  '42501', NULL, 'a sales_rep is denied actor-email resolution (authorize_tenant)');

-- ═══ non-member caller: ghost ══════════════════════════════════════════════
set local request.jwt.claims = '{"sub":"dead0000-0000-4000-8000-000000000001","role":"authenticated"}';
-- ── 24b. A non-member cannot resolve any tenant's actors ───────────────────
select throws_ok(
  $$ select * from public.get_timeline_actor_labels_for_ids('33333333-3333-4333-8333-333333333333', array['c0c00000-0000-4000-8000-000000000004']::uuid[]) $$,
  '42501', NULL, 'a non-member is denied (cannot forge tenant membership)');

-- ═══ Regression: M8G.2 + Timeline index intact; no mutation ════════════════
reset role;
-- ── 26–27. audit_events RLS policy unchanged ───────────────────────────────
-- M8H.1 renamed the policy when it AND-ed on an Order clause; the CUSTOMER
-- scoping rule itself must survive verbatim, so assert the clause, not the name.
select isnt_empty(
  $$ select 1 from pg_policies where tablename='audit_events'
     and cmd = 'SELECT'
     and qual like '%can_access_customer(tenant_id, entity_id)%' $$,
  'the M8G.2 customer-scoped audit SELECT rule is intact');
select is((select relrowsecurity from pg_class where oid='public.audit_events'::regclass),
  true, 'RLS remains enabled on audit_events');

-- ── 28. All eight audit producers remain SECURITY DEFINER ──────────────────
select ok((select bool_and(prosecdef) from pg_proc where proname in
  ('create_customer','update_customer','set_customer_active','approve_customer_signup_request',
   'create_customer_from_order','link_order_to_customer','replace_customer_access_link','revoke_customer_access_link')),
  'all eight M8G.2 audit producers remain SECURITY DEFINER');

-- ── 29. Timeline index intact ──────────────────────────────────────────────
select has_index('public', 'audit_events', 'audit_events_customer_timeline_idx',
  'the M8G.3 Timeline index is intact');

-- ── 30. list_tenant_members is untouched (still the roster RPC) ────────────
select has_function('public', 'list_tenant_members', array['uuid'],
  'list_tenant_members(uuid) is left intact for the team roster');

-- ── 31–32. The read RPC mutated no membership / audit rows ─────────────────
select is((select count(*) from public.tenant_users where tenant_id='33333333-3333-4333-8333-333333333333'),
  5::bigint, 'tenant_users membership rows are unchanged (read-only RPC)');
select is((select count(*) from public.audit_events where tenant_id='33333333-3333-4333-8333-333333333333'),
  0::bigint, 'no audit rows were written by the actor lookup');

select finish();
rollback;
