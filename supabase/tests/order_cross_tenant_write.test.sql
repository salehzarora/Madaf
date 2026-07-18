-- ═══════════════════════════════════════════════════════════════════════
-- pgTAP — M8I.7 CROSS-TENANT ORDER MUTATION ISOLATION
--
-- Focused proof that the authenticated order-write RPCs never let a member of
-- one tenant read, order for, or mutate ANOTHER tenant's data — and never leave
-- a residual row/movement/event when they refuse. Tenant A's owner attempts to:
--   • create an order in A using B's customer            → 22023, nothing written
--   • create an order in A using B's product             → 22023
--   • create an order in A mixing A's + B's products     → 22023 (fully rejected)
--   • create an order naming tenant B (not a member)     → 42501 (authorize_tenant)
--   • link A's guest order to B's customer               → 22023
--   • change the status of B's order (naming A)          → 22023 (order not in A)
--   • change the status of B's order (naming B)          → 42501 (not a member)
--   • edit B's order (naming A)                          → 22023
-- Then the RESIDUAL invariants are checked from a privileged role: B keeps
-- exactly its own one order, still at 'new'; no A order references a B customer;
-- no order_item ever crosses a product/order tenant boundary; B's audit stream
-- shows only its own creation. The client-supplied tenant/customer/product is
-- NEVER trusted — every attack is rejected by server-side ownership checks.
--
-- (The token/showcase order paths resolve the tenant FROM the token itself, so
-- there is no client-supplied tenant to cross — they are covered by order_audit.)
--
-- Run with the local stack up: supabase test db. Rolls back.
-- ═══════════════════════════════════════════════════════════════════════
begin;
select plan(16);

set local request.jwt.claims = '{"role":"service_role"}';

-- ── Fixtures: tenant A (owner) and tenant B (owner), each with own data ────
insert into auth.users (id) values
  ('a0a00000-0000-4000-8000-000000000001'),  -- ownerA
  ('b0b00000-0000-4000-8000-000000000001');  -- ownerB
insert into public.tenants (id, name_ar, name_he, name_en) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'أ', 'א', 'A'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'ب', 'ב', 'B');
insert into public.tenant_users (tenant_id, user_id, role) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0a00000-0000-4000-8000-000000000001', 'owner'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'b0b00000-0000-4000-8000-000000000001', 'owner');
insert into public.customers (id, tenant_id, name, customer_type, phone, origin, is_active) values
  ('ca000000-0000-4000-8000-0000000000a1', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Store A1', 'grocery', '050-a', 'manual', true),
  ('cb000000-0000-4000-8000-0000000000b1', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Store B1', 'grocery', '050-b', 'manual', true);
insert into public.products (id, tenant_id, name_ar, name_he, name_en, package_unit,
                             package_quantity, base_unit, wholesale_price, vat_rate, is_active) values
  ('40000000-0000-4000-8000-0000000000a1', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'أ1','א1','PA','carton',6,'bottles',10.00,0.17,true),
  ('40000000-0000-4000-8000-0000000000b1', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'ب1','ב1','PB','carton',6,'bottles',20.00,0.17,true);

-- ── 1. ownerB creates ONE legitimate order in tenant B ────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"b0b00000-0000-4000-8000-000000000001","role":"authenticated"}';
select lives_ok(
  $$ select public.create_order_request('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
       '[{"product_id":"40000000-0000-4000-8000-0000000000b1","quantity":2}]'::jsonb,
       'cb000000-0000-4000-8000-0000000000b1', p_submission_key => gen_random_uuid()) $$,
  'ownerB creates a legitimate order in tenant B');

-- ═══ ownerA attempts to reach across the tenant boundary ═══════════════════
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0a00000-0000-4000-8000-000000000001","role":"authenticated"}';

-- ── 2. Baseline: ownerA's OWN order in A succeeds (path works) ────────────
select lives_ok(
  $$ select public.create_order_request('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
       '[{"product_id":"40000000-0000-4000-8000-0000000000a1","quantity":1}]'::jsonb,
       'ca000000-0000-4000-8000-0000000000a1', p_submission_key => gen_random_uuid()) $$,
  'ownerA creates a legitimate order in tenant A');

-- ── 3. Order in A using B's CUSTOMER → rejected ───────────────────────────
select throws_ok(
  $$ select public.create_order_request('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
       '[{"product_id":"40000000-0000-4000-8000-0000000000a1","quantity":1}]'::jsonb,
       'cb000000-0000-4000-8000-0000000000b1', p_submission_key => gen_random_uuid()) $$,
  '22023', NULL, 'ownerA cannot order in A for B''s customer');

-- ── 4. Order in A using B's PRODUCT → rejected ────────────────────────────
select throws_ok(
  $$ select public.create_order_request('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
       '[{"product_id":"40000000-0000-4000-8000-0000000000b1","quantity":1}]'::jsonb,
       'ca000000-0000-4000-8000-0000000000a1', p_submission_key => gen_random_uuid()) $$,
  '22023', NULL, 'ownerA cannot order in A using B''s product');

-- ── 5. Order in A MIXING A's and B's products → fully rejected ────────────
select throws_ok(
  $$ select public.create_order_request('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
       '[{"product_id":"40000000-0000-4000-8000-0000000000a1","quantity":1},
         {"product_id":"40000000-0000-4000-8000-0000000000b1","quantity":1}]'::jsonb,
       'ca000000-0000-4000-8000-0000000000a1', p_submission_key => gen_random_uuid()) $$,
  '22023', NULL, 'a mixed-tenant item list is rejected as a whole (no partial order)');

-- ── 6. Order naming tenant B (ownerA is NOT a member) → authorize denies ──
select throws_ok(
  $$ select public.create_order_request('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
       '[{"product_id":"40000000-0000-4000-8000-0000000000a1","quantity":1}]'::jsonb,
       'ca000000-0000-4000-8000-0000000000a1', p_submission_key => gen_random_uuid()) $$,
  '42501', NULL, 'ownerA cannot create an order under a tenant they do not belong to');

-- ── 7. ownerA creates a GUEST order in A (for the link attempt below) ──────
select lives_ok(
  $$ select public.create_order_request('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
       '[{"product_id":"40000000-0000-4000-8000-0000000000a1","quantity":1}]'::jsonb,
       p_submission_key => gen_random_uuid()) $$,
  'ownerA creates an unlinked guest order in tenant A');

-- ── 8. Link A's guest order to B's customer → rejected ────────────────────
select throws_ok(
  $$ select public.link_order_to_customer('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
       (select id from public.orders where tenant_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and customer_id is null limit 1),
       'cb000000-0000-4000-8000-0000000000b1') $$,
  '22023', NULL, 'ownerA cannot link an A order to B''s customer');

-- ── 9. Status-change B's order, naming tenant A → order not found in A ─────
select throws_ok(
  $$ select public.update_order_status('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
       (select id from public.orders where tenant_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' limit 1), 'confirmed') $$,
  '22023', NULL, 'ownerA cannot change B''s order status while naming their OWN tenant');

-- ── 10. Status-change B's order, naming tenant B → not a member ───────────
select throws_ok(
  $$ select public.update_order_status('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
       (select id from public.orders where tenant_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' limit 1), 'confirmed') $$,
  '42501', NULL, 'ownerA cannot change B''s order status while naming tenant B (not a member)');

-- ── 11. Edit B's order, naming tenant A → order not found in A ─────────────
select throws_ok(
  $$ select public.update_order_items('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
       (select id from public.orders where tenant_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' limit 1),
       '[{"product_id":"40000000-0000-4000-8000-0000000000a1","quantity":1}]'::jsonb) $$,
  '22023', NULL, 'ownerA cannot edit B''s order');

-- ═══ RESIDUAL INVARIANTS (privileged read — RLS-independent truth) ═════════
reset role;

-- ── 12. Tenant B still has EXACTLY its one legitimate order ────────────────
select is((select count(*) from public.orders where tenant_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
  1::bigint, 'no cross-tenant attempt created any row in tenant B');

-- ── 13. B's order was never mutated (still new) ───────────────────────────
select is((select status::text from public.orders where tenant_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' limit 1),
  'new', 'B''s order status is untouched by A''s attempts');

-- ── 14. No order in A references a customer from another tenant ────────────
select ok(not exists (
    select 1 from public.orders o
    join public.customers c on c.id = o.customer_id
    where o.tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and c.tenant_id <> o.tenant_id),
  'no order in A carries a foreign-tenant customer');

-- ── 15. No order_item ever crosses an order/product tenant boundary ───────
select ok(not exists (
    select 1 from public.order_items i
    join public.orders o on o.id = i.order_id
    join public.products p on p.id = i.product_id
    where i.tenant_id <> o.tenant_id or p.tenant_id <> o.tenant_id),
  'every order_item stays within its order''s tenant and its product''s tenant');

-- ── 16. Tenant B's audit stream shows only its OWN order creation ──────────
select is((select count(*) from public.audit_events
           where tenant_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and entity_type='order'),
  1::bigint, 'tenant B has exactly one order audit event (its own creation)');

select finish();
rollback;
