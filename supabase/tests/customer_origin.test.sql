-- ═══════════════════════════════════════════════════════════════════════
-- pgTAP — M8G.1 immutable customer ORIGIN (public.customers.origin)
--
-- Verifies the acquisition-origin column + its create-path derivation, the
-- conservative backfill, immutability, and that existing RLS / RPCs are intact:
--   • column: exists, customer_origin enum, NOT NULL, default legacy_unknown;
--   • closed vocabulary (exactly manual|signup|guest_conversion|legacy_unknown);
--     valid values accepted, invalid rejected;
--   • backfill: a signup-linked legacy row → signup; an unlinked legacy row
--     stays legacy_unknown (manual is NEVER inferred for history);
--   • seed rows carry explicit valid origins; no row is lost/nulled;
--   • create paths DERIVE origin: create_customer → manual, signup approval →
--     signup (join == signup), guest promotion → guest_conversion; no create
--     path accepts a client origin arg;
--   • immutability: edit / activate-deactivate / a linked or guest order / a
--     re-approve / a direct authenticated UPDATE never rewrite origin;
--   • RLS unchanged: customers is SELECT-only (no INSERT/UPDATE/DELETE policy
--     or grant for authenticated); owner sees all, cross-tenant blocked,
--     sales_rep sees origin ONLY for assigned customers;
--   • existing stats / product-search / access-link RPCs still present.
--
-- Run with the local stack up:  supabase test db
-- Creates disposable tenants C + B (+ owner/sales_rep users) in THIS
-- transaction; everything rolls back. No tokens/secrets printed.
-- ═══════════════════════════════════════════════════════════════════════
begin;
select plan(33);

set local request.jwt.claims = '{"role":"service_role"}';

-- ── Fixtures (as the superuser test role; bypasses RLS) ────────────────────
insert into auth.users (id) values
  ('c0c00000-0000-4000-8000-000000000001'),  -- ownerC
  ('c0c00000-0000-4000-8000-000000000002'),  -- repC (sales_rep)
  ('b0b00000-0000-4000-8000-000000000001');  -- ownerB

insert into public.tenants (id, name_ar, name_he, name_en) values
  ('33333333-3333-4333-8333-333333333333', 'ج', 'ג', 'C'),
  ('22222222-2222-4222-8222-222222222222', 'ب', 'ב', 'B');

insert into public.tenant_users (tenant_id, user_id, role) values
  ('33333333-3333-4333-8333-333333333333', 'c0c00000-0000-4000-8000-000000000001', 'owner'),
  ('33333333-3333-4333-8333-333333333333', 'c0c00000-0000-4000-8000-000000000002', 'sales_rep'),
  ('22222222-2222-4222-8222-222222222222', 'b0b00000-0000-4000-8000-000000000001', 'owner');

-- Legacy fixtures inserted DIRECTLY (no origin → the column default fills them).
--   lg…01 unlinked (must stay legacy_unknown), lg…02 will be signup-linked.
insert into public.customers (id, tenant_id, name) values
  ('19000000-0000-4000-8000-000000000001', '33333333-3333-4333-8333-333333333333', 'Legacy Unlinked'),
  ('19000000-0000-4000-8000-000000000002', '33333333-3333-4333-8333-333333333333', 'Legacy Signup Linked');
-- Cross-tenant customer (tenant B) with a known origin.
insert into public.customers (id, tenant_id, name, origin) values
  ('cb000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'Store B2', 'manual');

-- Signup link + requests. sr…01 is PENDING (approved later via the RPC);
-- sr…02 is already approved and points at lg…02 (backfill evidence fixture).
insert into public.customer_signup_links (id, tenant_id, token_hash) values
  ('51000000-0000-4000-8000-000000000001', '33333333-3333-4333-8333-333333333333',
   'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
insert into public.customer_signup_requests
  (id, tenant_id, link_id, name, approved_at, approved_customer_id) values
  ('52000000-0000-4000-8000-000000000001', '33333333-3333-4333-8333-333333333333',
   '51000000-0000-4000-8000-000000000001', 'M8G1 Signup', null, null),
  ('52000000-0000-4000-8000-000000000002', '33333333-3333-4333-8333-333333333333',
   '51000000-0000-4000-8000-000000000001', 'Legacy Signup Linked', now(),
   '19000000-0000-4000-8000-000000000002');

-- An UNLINKED guest order (snapshot only) to promote via create_customer_from_order.
insert into public.orders
  (id, tenant_id, customer_id, order_number, public_ref, status, customer_snapshot, created_at) values
  ('60000000-0000-4000-8000-000000000001', '33333333-3333-4333-8333-333333333333', null,
   'G-1', 'MDF-G0001', 'new', '{"name":"M8G1 Guest","guest":true}', '2026-05-01T10:00:00Z');

-- ── 1–4. Column shape ──────────────────────────────────────────────────────
select is(
  (select udt_name from information_schema.columns
    where table_schema='public' and table_name='customers' and column_name='origin'),
  'customer_origin', 'customers.origin exists and is the customer_origin enum');
select is(
  (select is_nullable from information_schema.columns
    where table_schema='public' and table_name='customers' and column_name='origin'),
  'NO', 'customers.origin is NOT NULL');
select is(
  (select column_default from information_schema.columns
    where table_schema='public' and table_name='customers' and column_name='origin'),
  '''legacy_unknown''::customer_origin', 'default is legacy_unknown (defense-in-depth)');
select is(
  (select array_agg(e.enumlabel::text order by e.enumsortorder)
    from pg_enum e join pg_type t on t.oid=e.enumtypid where t.typname='customer_origin'),
  array['manual','signup','guest_conversion','legacy_unknown']::text[],
  'closed vocabulary: exactly the four origins, in order');

-- ── 5–6. Valid accepted / invalid rejected ─────────────────────────────────
select lives_ok($$ select 'manual'::public.customer_origin, 'signup'::public.customer_origin,
  'guest_conversion'::public.customer_origin, 'legacy_unknown'::public.customer_origin $$,
  'all four origin values are valid enum inputs');
select throws_ok($$ select 'partner'::public.customer_origin $$, '22P02', NULL,
  'an out-of-vocabulary origin is rejected by the enum');

-- ── 7–9. Seed rows carry explicit valid origins; nothing lost/nulled ───────
select is((select origin::text from public.customers
    where id='cc000000-0000-4000-8000-000000000001'), 'manual', 'seed store 1 → explicit manual');
select is((select origin::text from public.customers
    where id='cc000000-0000-4000-8000-000000000002'), 'signup', 'seed store 2 → explicit signup');
select is((select count(*) from public.customers
    where tenant_id='11111111-1111-4111-8111-111111111111' and origin is not null),
  8::bigint, 'all 8 seed stores retain a valid non-null origin (no row lost/nulled)');

-- ── 10–12. Backfill logic (the migration's UPDATE re-run on fresh fixtures) ─
update public.customers c
   set origin = 'signup'
  from public.customer_signup_requests r
 where r.approved_customer_id = c.id
   and r.tenant_id = c.tenant_id
   and c.origin = 'legacy_unknown';
select is((select origin::text from public.customers where id='19000000-0000-4000-8000-000000000002'),
  'signup', 'backfill: a signup-linked legacy row becomes signup (stable FK evidence)');
select is((select origin::text from public.customers where id='19000000-0000-4000-8000-000000000001'),
  'legacy_unknown', 'backfill: an unlinked legacy row stays legacy_unknown');
select isnt((select origin::text from public.customers where id='19000000-0000-4000-8000-000000000001'),
  'manual', 'manual is NEVER inferred for a historical row (no evidence)');

-- ── 13. No create_customer overload accepts an origin arg (client can't inject) ─
select is((select count(*) from pg_proc
    where proname='create_customer' and pg_get_function_identity_arguments(oid) ilike '%customer_origin%'),
  0::bigint, 'no create_customer variant accepts a client-supplied origin');

-- ── 14–16. RLS unchanged / equivalently secure ────────────────────────────
select is((select count(*) from pg_policies
    where schemaname='public' and tablename='customers' and cmd in ('INSERT','UPDATE','DELETE')),
  0::bigint, 'customers has NO INSERT/UPDATE/DELETE policy (RPC-only writes preserved)');
select ok((select relrowsecurity from pg_class where oid='public.customers'::regclass),
  'RLS still enabled on customers');
select ok(not has_table_privilege('authenticated','public.customers','UPDATE'),
  'authenticated has NO UPDATE grant on customers (origin cannot be directly changed)');

-- ── 17–19. Existing RPCs still present (regression) ────────────────────────
select ok(exists(select 1 from pg_proc where proname='get_customer_stats_for_ids'),
  'M8F.3 get_customer_stats_for_ids still present');
select ok(exists(select 1 from pg_proc where proname='search_product_page_ids'),
  'M8F.2 search_product_page_ids still present');
select ok(exists(select 1 from pg_proc where proname='replace_customer_access_link'),
  'customer-access-link RPC still present');

-- ═══ Authenticated caller: ownerC — create paths DERIVE origin ═════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"c0c00000-0000-4000-8000-000000000001","role":"authenticated"}';

-- ── 20. Manual create → manual ─────────────────────────────────────────────
select create_customer('33333333-3333-4333-8333-333333333333', 'M8G1 Manual');
select is((select origin::text from public.customers
    where tenant_id='33333333-3333-4333-8333-333333333333' and name='M8G1 Manual'),
  'manual', 'create_customer derives origin manual');

-- ── 21. Signup approval → signup (join flow == signup) ─────────────────────
select approve_customer_signup_request('33333333-3333-4333-8333-333333333333',
  '52000000-0000-4000-8000-000000000001');
select is((select origin::text from public.customers
    where tenant_id='33333333-3333-4333-8333-333333333333' and name='M8G1 Signup'),
  'signup', 'approve_customer_signup_request derives origin signup');

-- ── 22. Guest promotion → guest_conversion ─────────────────────────────────
select create_customer_from_order('33333333-3333-4333-8333-333333333333',
  '60000000-0000-4000-8000-000000000001');
select is((select origin::text from public.customers
    where tenant_id='33333333-3333-4333-8333-333333333333' and name='M8G1 Guest'),
  'guest_conversion', 'create_customer_from_order derives origin guest_conversion');

-- ── 23–24. Edit + activation/deactivation do NOT change origin ─────────────
select update_customer('33333333-3333-4333-8333-333333333333',
  (select id from public.customers where tenant_id='33333333-3333-4333-8333-333333333333' and name='M8G1 Manual'),
  'M8G1 Manual v2', null, null, null, null, null, null, 'grocery', null);
select is((select origin::text from public.customers
    where tenant_id='33333333-3333-4333-8333-333333333333' and name='M8G1 Manual v2'),
  'manual', 'update_customer (edit) does not change origin');
select set_customer_active('33333333-3333-4333-8333-333333333333',
  (select id from public.customers where tenant_id='33333333-3333-4333-8333-333333333333' and name='M8G1 Manual v2'),
  false);
select is((select origin::text from public.customers
    where tenant_id='33333333-3333-4333-8333-333333333333' and name='M8G1 Manual v2'),
  'manual', 'set_customer_active (deactivate) does not change origin');

-- ── 25–26. Idempotency: re-approving raises + origin stays signup ──────────
select throws_ok($$ select public.approve_customer_signup_request(
    '33333333-3333-4333-8333-333333333333', '52000000-0000-4000-8000-000000000001') $$,
  '22023', NULL, 're-approving an already-approved request is rejected');
select is((select origin::text from public.customers
    where tenant_id='33333333-3333-4333-8333-333333333333' and name='M8G1 Signup'),
  'signup', 'a re-approve attempt never rewrites the existing origin');

-- ── 27. A direct authenticated UPDATE of origin is denied (grant + policy) ─
select throws_ok($$ update public.customers set origin='guest_conversion'
    where tenant_id='33333333-3333-4333-8333-333333333333' and name='M8G1 Signup' $$,
  '42501', NULL, 'authenticated cannot directly UPDATE customers.origin');

-- ── 28. Owner sees origin for its tenant's customers ───────────────────────
select is((select origin::text from public.customers
    where tenant_id='33333333-3333-4333-8333-333333333333' and name='M8G1 Manual v2'),
  'manual', 'owner sees the origin of a customer in its own tenant');
-- ── 29. Cross-tenant: ownerC cannot read tenant-B customer origin ──────────
select is((select count(*) from public.customers
    where id='cb000000-0000-4000-8000-000000000001'), 0::bigint,
  'ownerC cannot see a tenant-B customer (origin isolated cross-tenant)');

-- ── 30. Orders never rewrite origin (shop link + guest showcase) ───────────
reset role;  -- assign the manual store to repC + attach orders as the superuser
insert into public.sales_rep_customers (tenant_id, user_id, customer_id, assigned_by) values
  ('33333333-3333-4333-8333-333333333333', 'c0c00000-0000-4000-8000-000000000002',
   (select id from public.customers where tenant_id='33333333-3333-4333-8333-333333333333' and name='M8G1 Manual v2'),
   'c0c00000-0000-4000-8000-000000000001');
insert into public.orders
  (id, tenant_id, customer_id, order_number, public_ref, status, customer_snapshot, created_at) values
  ('60000000-0000-4000-8000-000000000002', '33333333-3333-4333-8333-333333333333',
   (select id from public.customers where tenant_id='33333333-3333-4333-8333-333333333333' and name='M8G1 Manual v2'),
   'G-2', 'MDF-G0002', 'new', '{}', '2026-06-01T10:00:00Z'),
  ('60000000-0000-4000-8000-000000000003', '33333333-3333-4333-8333-333333333333', null,
   'G-3', 'MDF-G0003', 'new', '{"name":"Another Guest","guest":true}', '2026-06-02T10:00:00Z');
select is((select origin::text from public.customers
    where tenant_id='33333333-3333-4333-8333-333333333333' and name='M8G1 Manual v2'),
  'manual', 'a linked shop order + a guest showcase order do not rewrite origin');
-- ── 31. A guest showcase order (null customer) creates no customer ─────────
select is((select count(*) from public.customers
    where tenant_id='33333333-3333-4333-8333-333333333333' and name='Another Guest'), 0::bigint,
  'a guest order does not itself create a customer row');

-- ═══ Authenticated caller: repC (sales_rep, assigned to M8G1 Manual v2 only) ═
set local role authenticated;
set local request.jwt.claims = '{"sub":"c0c00000-0000-4000-8000-000000000002","role":"authenticated"}';
-- ── 32. sales_rep sees origin for an ASSIGNED customer ─────────────────────
select is((select origin::text from public.customers
    where tenant_id='33333333-3333-4333-8333-333333333333' and name='M8G1 Manual v2'),
  'manual', 'sales_rep sees the origin of an ASSIGNED customer');
-- ── 33. sales_rep sees NO row (no origin) for an UNASSIGNED customer ────────
select is((select count(*) from public.customers
    where tenant_id='33333333-3333-4333-8333-333333333333' and name='M8G1 Signup'), 0::bigint,
  'sales_rep cannot see the origin of an UNASSIGNED customer');

reset role;
select finish();
rollback;
