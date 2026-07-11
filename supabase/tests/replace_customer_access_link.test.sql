-- ═══════════════════════════════════════════════════════════════════════
-- pgTAP — atomic private shop-link replacement (M8E.2)
--
-- Verifies public.replace_customer_access_link: exactly-one-active invariant,
-- rollback-on-failure (a failed replace never revokes the surviving link),
-- hash-only persistence, tenant/customer scoping, and that the per-customer
-- FOR UPDATE lock (which serializes concurrent replacements) is present.
--
-- Run with the local stack up:  supabase test db
-- Uses the seeded demo tenant/customers and simulates a service_role caller
-- (authorize_tenant accepts an explicit existing tenant for service_role), so
-- no auth.users / membership fixtures are required.
-- ═══════════════════════════════════════════════════════════════════════
begin;
select plan(11);

-- Seeded fixtures (supabase/seed.sql).
--   tenant     11111111-1111-4111-8111-111111111111
--   customerA  cc000000-0000-4000-8000-000000000001
set local request.jwt.claims = '{"role":"service_role"}';

-- Deterministic starting point: no active links for customerA in THIS tx.
delete from public.customer_access_links
 where customer_id = 'cc000000-0000-4000-8000-000000000001';

-- 1. First replacement succeeds …
select lives_ok(
  $$ select public.replace_customer_access_link(
       '11111111-1111-4111-8111-111111111111',
       'cc000000-0000-4000-8000-000000000001',
       repeat('a', 64), 'aaaaaa', 'first', null) $$,
  'replace creates the first link');

-- 2. … leaving EXACTLY ONE active link.
select is(
  (select count(*)::int from public.customer_access_links
   where customer_id = 'cc000000-0000-4000-8000-000000000001' and revoked_at is null),
  1, 'exactly one active link after the first replace');

-- 3. Second replacement succeeds (revoke old + insert new in one tx).
select lives_ok(
  $$ select public.replace_customer_access_link(
       '11111111-1111-4111-8111-111111111111',
       'cc000000-0000-4000-8000-000000000001',
       repeat('b', 64), 'bbbbbb', 'second', null) $$,
  'second replace succeeds');

-- 4. Still exactly one active link (last writer wins).
select is(
  (select count(*)::int from public.customer_access_links
   where customer_id = 'cc000000-0000-4000-8000-000000000001' and revoked_at is null),
  1, 'still exactly one active link after the second replace');

-- 5. The previous link was revoked (every old URL dies).
select is(
  (select count(*)::int from public.customer_access_links
   where customer_id = 'cc000000-0000-4000-8000-000000000001' and revoked_at is not null),
  1, 'the first link was revoked by the second replace');

-- 6. Hash-only: the active link stores the passed token HASH.
select is(
  (select token_hash from public.customer_access_links
   where customer_id = 'cc000000-0000-4000-8000-000000000001' and revoked_at is null),
  repeat('b', 64), 'the active link stores the token hash');

-- 7. Hash-only: there is NO raw-token column anywhere on the table.
select ok(
  not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'customer_access_links'
      and column_name in ('token', 'raw_token', 'secret')),
  'no raw-token column exists (hash-only persistence)');

-- 8. ROLLBACK ON FAILURE: deactivate the store, then a replace must RAISE MDF33
--    (customer re-checked under the lock) …
update public.customers set is_active = false
 where id = 'cc000000-0000-4000-8000-000000000001';
select throws_ok(
  $$ select public.replace_customer_access_link(
       '11111111-1111-4111-8111-111111111111',
       'cc000000-0000-4000-8000-000000000001',
       repeat('c', 64), 'cccccc', 'third', null) $$,
  'MDF33',
  NULL,
  'replace on a deactivated store raises MDF33');

-- 9. … and the previously-active link SURVIVES (the failed tx revoked nothing).
select is(
  (select token_hash from public.customer_access_links
   where customer_id = 'cc000000-0000-4000-8000-000000000001' and revoked_at is null),
  repeat('b', 64), 'a failed replace revokes nothing — the prior link survives');
update public.customers set is_active = true
 where id = 'cc000000-0000-4000-8000-000000000001';

-- 10. Unknown / wrong-tenant customer is rejected (and revokes nothing).
select throws_ok(
  $$ select public.replace_customer_access_link(
       '11111111-1111-4111-8111-111111111111',
       '00000000-0000-4000-8000-0000000000ff',
       repeat('d', 64), 'dddddd', 'x', null) $$,
  '22023',
  NULL,
  'replace for an unknown customer is rejected');

-- 11. STRUCTURAL: the RPC locks the customer row FOR UPDATE, which is what
--     serializes concurrent replacements for the same customer (a second caller
--     blocks until the first commits → exactly one active link, never several).
--     Guards against the lock being removed in a future edit.
select ok(
  position('for update' in lower(
    pg_get_functiondef('public.replace_customer_access_link(uuid,uuid,text,text,text,timestamptz)'::regprocedure)
  )) > 0,
  'replace locks the customer row FOR UPDATE (serializes concurrent replacements)');

select finish();
rollback;
