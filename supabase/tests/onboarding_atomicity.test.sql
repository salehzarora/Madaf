-- ═══════════════════════════════════════════════════════════════════════
-- pgTAP — ONBOARDING ATOMICITY & DUPLICATE PROTECTION (regression)
--
-- create_tenant_with_owner is the self-service onboarding path: a membership-
-- less authenticated user creates a tenant, becomes its owner and receives the
-- starter category set — ALL in one transaction. This locks in the Pilot-
-- critical guarantees against regression:
--   • a fresh user onboards exactly ONE tenant with an owner membership and the
--     6 seeded starter categories;
--   • a user who already belongs to a tenant is refused (42501) with NO second
--     tenant created (the M4C multi-tenant model adds further memberships only
--     through invitations, never through a second self-onboard);
--   • blank names are refused (22023) and leave NO tenant/membership/category
--     behind (atomic rollback);
--   • an unauthenticated caller is refused (42501);
--   • the function keeps its SECURITY DEFINER / empty search_path / client grants.
--
-- Run with the local stack up: supabase test db. Rolls back.
-- ═══════════════════════════════════════════════════════════════════════
begin;
select plan(13);

-- ── Two membership-less users to onboard with ─────────────────────────────
set local request.jwt.claims = '{"role":"service_role"}';
insert into auth.users (id) values
  ('11100000-0000-4000-8000-000000000001'),  -- u1 (onboards)
  ('11100000-0000-4000-8000-000000000002');  -- u2 (blank-name attempt)

-- ── 1–5. Structural regression: signature / security / search_path / grants ─
select has_function('public', 'create_tenant_with_owner',
  array['text', 'text', 'text', 'public.locale_code'], 'create_tenant_with_owner keeps its signature');
select is((select prosecdef from pg_proc where oid='public.create_tenant_with_owner(text,text,text,public.locale_code)'::regprocedure),
  true, 'create_tenant_with_owner stays SECURITY DEFINER');
select is((select array_to_string(proconfig, ',') from pg_proc where oid='public.create_tenant_with_owner(text,text,text,public.locale_code)'::regprocedure),
  'search_path=""', 'create_tenant_with_owner pins an empty search_path');
select ok(has_function_privilege('authenticated', 'public.create_tenant_with_owner(text,text,text,public.locale_code)', 'EXECUTE'),
  'authenticated may onboard a tenant');
select ok(not has_function_privilege('anon', 'public.create_tenant_with_owner(text,text,text,public.locale_code)', 'EXECUTE'),
  'anon may NOT onboard a tenant');

-- ── 6–8. A fresh user onboards: one owner membership + 6 categories ───────
set local role authenticated;
set local request.jwt.claims = '{"sub":"11100000-0000-4000-8000-000000000001","role":"authenticated"}';
select lives_ok(
  $$ select public.create_tenant_with_owner('متجر', 'חנות', 'Shop') $$,
  'a membership-less user onboards a new tenant');
select is(
  (select count(*) || ':' || coalesce(max(role::text), '')
   from public.tenant_users where user_id='11100000-0000-4000-8000-000000000001'),
  '1:owner', 'the onboarding user has exactly ONE membership, as owner');
select is(
  (select count(*) from public.categories
   where tenant_id = (select tenant_id from public.tenant_users where user_id='11100000-0000-4000-8000-000000000001')),
  6::bigint, 'the new tenant is seeded with the 6 starter categories');

-- ── 9–10. The same user cannot self-onboard a SECOND tenant ───────────────
select throws_ok(
  $$ select public.create_tenant_with_owner('ثانٍ', 'שני', 'Second') $$,
  '42501', NULL, 'a user who already belongs to a tenant cannot self-onboard another');
select is((select count(*) from public.tenant_users where user_id='11100000-0000-4000-8000-000000000001'),
  1::bigint, 'the refused second onboard created NO extra membership (still one)');

-- ── 11–12. Blank names are refused and leave nothing behind (atomic) ──────
set local request.jwt.claims = '{"sub":"11100000-0000-4000-8000-000000000002","role":"authenticated"}';
select throws_ok(
  $$ select public.create_tenant_with_owner('', '   ', null) $$,
  '22023', NULL, 'blank names are refused');
select is((select count(*) from public.tenant_users where user_id='11100000-0000-4000-8000-000000000002'),
  0::bigint, 'the failed onboard left NO membership (fully rolled back)');

-- ── 13. An unauthenticated caller is refused ──────────────────────────────
set local request.jwt.claims = '{"role":"authenticated"}';  -- no sub → auth.uid() is null
select throws_ok(
  $$ select public.create_tenant_with_owner('مجهول', 'אנונימי', 'Anon') $$,
  '42501', NULL, 'onboarding requires authentication');

select finish();
rollback;
