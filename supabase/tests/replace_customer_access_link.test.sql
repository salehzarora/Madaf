-- ═══════════════════════════════════════════════════════════════════════
-- pgTAP — atomic private shop-link replacement + one-active invariant (M8E.2)
--
-- Verifies:
--   • the OBSOLETE two-step RPCs are executable by NO role (bypass closed);
--   • the atomic replace_customer_access_link is executable ONLY by the
--     intended roles;
--   • the partial unique index rejects a second active link (invariant);
--   • exactly-one-active after repeated atomic replacement;
--   • rollback-on-failure (a failed replace never revokes the surviving link);
--   • hash-only persistence; tenant/customer scoping with a REAL second-tenant
--     fixture (the other tenant's links stay untouched).
--
-- Concurrency (FOR UPDATE serialization) is proven separately + reproducibly by
-- scripts/concurrency-replace-link.sh — a pg_get_functiondef() text search is
-- NOT used as behavioural concurrency proof.
--
-- Run with the local stack up:  supabase test db
-- Uses the seeded demo tenant/customers, creates a disposable second tenant in
-- THIS transaction, and simulates a service_role caller (authorize_tenant
-- accepts an explicit existing tenant for service_role).
-- ═══════════════════════════════════════════════════════════════════════
begin;
select plan(27);

-- Signatures used for privilege assertions.
--   insert_customer_access_link(uuid,uuid,text,text,text,timestamptz)   [OBSOLETE]
--   revoke_customer_access_links_for_customer(uuid,uuid)                [OBSOLETE]
--   replace_customer_access_link(uuid,uuid,text,text,text,timestamptz)  [atomic]

-- ── Privilege: the OBSOLETE insert RPC is executable by NO role ────────────
select ok(not has_function_privilege('authenticated', 'public.insert_customer_access_link(uuid,uuid,text,text,text,timestamptz)', 'EXECUTE'), 'authenticated cannot EXECUTE obsolete insert');
select ok(not has_function_privilege('anon',          'public.insert_customer_access_link(uuid,uuid,text,text,text,timestamptz)', 'EXECUTE'), 'anon cannot EXECUTE obsolete insert');
select ok(not has_function_privilege('service_role',  'public.insert_customer_access_link(uuid,uuid,text,text,text,timestamptz)', 'EXECUTE'), 'service_role cannot EXECUTE obsolete insert');
select ok(not has_function_privilege('public',        'public.insert_customer_access_link(uuid,uuid,text,text,text,timestamptz)', 'EXECUTE'), 'PUBLIC cannot EXECUTE obsolete insert');

-- ── Privilege: the OBSOLETE bulk-revoke RPC is executable by NO role ───────
select ok(not has_function_privilege('authenticated', 'public.revoke_customer_access_links_for_customer(uuid,uuid)', 'EXECUTE'), 'authenticated cannot EXECUTE obsolete bulk-revoke');
select ok(not has_function_privilege('anon',          'public.revoke_customer_access_links_for_customer(uuid,uuid)', 'EXECUTE'), 'anon cannot EXECUTE obsolete bulk-revoke');
select ok(not has_function_privilege('service_role',  'public.revoke_customer_access_links_for_customer(uuid,uuid)', 'EXECUTE'), 'service_role cannot EXECUTE obsolete bulk-revoke');
select ok(not has_function_privilege('public',        'public.revoke_customer_access_links_for_customer(uuid,uuid)', 'EXECUTE'), 'PUBLIC cannot EXECUTE obsolete bulk-revoke');

-- ── Privilege: the ATOMIC RPC is executable ONLY by intended roles ─────────
select ok(has_function_privilege('authenticated', 'public.replace_customer_access_link(uuid,uuid,text,text,text,timestamptz)', 'EXECUTE'), 'authenticated CAN EXECUTE the atomic replace');
select ok(has_function_privilege('service_role',  'public.replace_customer_access_link(uuid,uuid,text,text,text,timestamptz)', 'EXECUTE'), 'service_role CAN EXECUTE the atomic replace');
select ok(not has_function_privilege('anon',   'public.replace_customer_access_link(uuid,uuid,text,text,text,timestamptz)', 'EXECUTE'), 'anon cannot EXECUTE the atomic replace');
select ok(not has_function_privilege('public', 'public.replace_customer_access_link(uuid,uuid,text,text,text,timestamptz)', 'EXECUTE'), 'PUBLIC cannot EXECUTE the atomic replace');

-- ── Fixtures ──────────────────────────────────────────────────────────────
--   tenant A   11111111-1111-4111-8111-111111111111  (seeded)
--   customerA  cc000000-0000-4000-8000-000000000001  (seeded)
--   tenant B   22222222-2222-4222-8222-222222222222  (created here)
--   customerB  cc000000-0000-4000-8000-0000000000b0  (created here)
set local request.jwt.claims = '{"role":"service_role"}';
delete from public.customer_access_links where customer_id = 'cc000000-0000-4000-8000-000000000001';

insert into public.tenants (id, name_ar, name_he, name_en)
  values ('22222222-2222-4222-8222-222222222222', 'ب', 'ב', 'B');
insert into public.customers (id, tenant_id, name)
  values ('cc000000-0000-4000-8000-0000000000b0', '22222222-2222-4222-8222-222222222222', 'Store B');
insert into public.customer_access_links (tenant_id, customer_id, token_hash)
  values ('22222222-2222-4222-8222-222222222222', 'cc000000-0000-4000-8000-0000000000b0', repeat('e', 64));

-- ── Atomic replace: one-active invariant + last-writer-wins ────────────────
select lives_ok(
  $$ select public.replace_customer_access_link('11111111-1111-4111-8111-111111111111','cc000000-0000-4000-8000-000000000001', repeat('a',64),'aaaaaa','first', null) $$,
  'first atomic replace succeeds');
select is((select count(*)::int from public.customer_access_links where customer_id='cc000000-0000-4000-8000-000000000001' and revoked_at is null), 1, 'exactly one active link after first replace');

select lives_ok(
  $$ select public.replace_customer_access_link('11111111-1111-4111-8111-111111111111','cc000000-0000-4000-8000-000000000001', repeat('b',64),'bbbbbb','second', null) $$,
  'second atomic replace succeeds');
select is((select count(*)::int from public.customer_access_links where customer_id='cc000000-0000-4000-8000-000000000001' and revoked_at is null), 1, 'still exactly one active link after second replace (last writer wins)');
select is((select count(*)::int from public.customer_access_links where customer_id='cc000000-0000-4000-8000-000000000001' and revoked_at is not null), 1, 'the first link was revoked by the second replace');

-- ── Hash-only persistence ──────────────────────────────────────────────────
select is((select token_hash from public.customer_access_links where customer_id='cc000000-0000-4000-8000-000000000001' and revoked_at is null), repeat('b',64), 'the active link stores the token hash');
select ok(not exists (select 1 from information_schema.columns where table_schema='public' and table_name='customer_access_links' and column_name in ('token','raw_token','secret')), 'no raw-token column exists (hash-only)');

-- ── Invariant: a SECOND active link (even a direct insert) is rejected ──────
select throws_ok(
  $$ insert into public.customer_access_links (tenant_id, customer_id, token_hash) values ('11111111-1111-4111-8111-111111111111','cc000000-0000-4000-8000-000000000001', repeat('f',64)) $$,
  '23505',
  NULL,
  'the partial unique index rejects a second active link for the same customer');

-- ── Rollback on failure: inactive store → MDF33, prior link SURVIVES ───────
update public.customers set is_active = false where id = 'cc000000-0000-4000-8000-000000000001';
select throws_ok(
  $$ select public.replace_customer_access_link('11111111-1111-4111-8111-111111111111','cc000000-0000-4000-8000-000000000001', repeat('c',64),'cccccc','third', null) $$,
  'MDF33', NULL, 'replace on a deactivated store raises MDF33');
select is((select token_hash from public.customer_access_links where customer_id='cc000000-0000-4000-8000-000000000001' and revoked_at is null), repeat('b',64), 'a failed replace revokes nothing — the prior link survives');
update public.customers set is_active = true where id = 'cc000000-0000-4000-8000-000000000001';

-- ── Wrong tenant: a REAL second-tenant customer is rejected, B untouched ───
select throws_ok(
  $$ select public.replace_customer_access_link('11111111-1111-4111-8111-111111111111','cc000000-0000-4000-8000-0000000000b0', repeat('d',64),'dddddd','x', null) $$,
  '22023', NULL, 'replace for a customer owned by ANOTHER tenant is rejected');
select is((select token_hash from public.customer_access_links where customer_id='cc000000-0000-4000-8000-0000000000b0' and revoked_at is null), repeat('e',64), 'the other tenant''s link is unchanged by the cross-tenant attempt');
select is((select count(*)::int from public.customer_access_links where customer_id='cc000000-0000-4000-8000-0000000000b0' and revoked_at is null), 1, 'the other tenant still has exactly one active link');

-- ── Behavioural bypass: as `authenticated`, the obsolete RPCs are denied ────
set local role authenticated;
select throws_ok(
  $$ select public.insert_customer_access_link('11111111-1111-4111-8111-111111111111','cc000000-0000-4000-8000-000000000001', repeat('a',64), null, null, null) $$,
  '42501', NULL, 'authenticated is DENIED the obsolete insert RPC (permission denied)');
select throws_ok(
  $$ select public.revoke_customer_access_links_for_customer('11111111-1111-4111-8111-111111111111','cc000000-0000-4000-8000-000000000001') $$,
  '42501', NULL, 'authenticated is DENIED the obsolete bulk-revoke RPC (permission denied)');
reset role;

select finish();
rollback;
