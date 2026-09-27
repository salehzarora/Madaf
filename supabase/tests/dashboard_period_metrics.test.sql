-- 006B: known synthetic C/B/D dataset; transaction rolls back.
begin;
select no_plan();

set local request.jwt.claims = '{"role":"service_role"}';

-- ── Users ──────────────────────────────────────────────────────────────────
insert into auth.users (id) values
  ('c0c00000-0000-4000-8000-000000000001'),  -- ownerC
  ('c0c00000-0000-4000-8000-000000000002'),  -- repC (sales_rep)
  ('c0c00000-0000-4000-8000-000000000003'),  -- adminC
  ('b0b00000-0000-4000-8000-000000000001'),  -- ownerB
  ('d0d00000-0000-4000-8000-000000000001');  -- ownerD

insert into public.tenants (id, name_ar, name_he, name_en) values
  ('33333333-3333-4333-8333-333333333333', 'ج', 'ג', 'C'),
  ('22222222-2222-4222-8222-222222222222', 'ب', 'ב', 'B'),
  ('44444444-4444-4444-8444-444444444444', 'د', 'ד', 'D');

insert into public.tenant_users (tenant_id, user_id, role) values
  ('33333333-3333-4333-8333-333333333333', 'c0c00000-0000-4000-8000-000000000001', 'owner'),
  ('33333333-3333-4333-8333-333333333333', 'c0c00000-0000-4000-8000-000000000002', 'sales_rep'),
  ('33333333-3333-4333-8333-333333333333', 'c0c00000-0000-4000-8000-000000000003', 'admin'),
  ('22222222-2222-4222-8222-222222222222', 'b0b00000-0000-4000-8000-000000000001', 'owner'),
  ('44444444-4444-4444-8444-444444444444', 'd0d00000-0000-4000-8000-000000000001', 'owner');

insert into public.categories (id, tenant_id, name_ar, name_he, name_en) values
  ('c2c00000-0000-4000-8000-000000000001', '33333333-3333-4333-8333-333333333333', 'ف', 'ק', 'Cat');

-- Products: pA/pB/pC active, pInactive inactive.
insert into public.products
  (id, tenant_id, category_id, name_ar, name_he, name_en, wholesale_price, is_active)
values
  ('cbc00000-0000-4000-8000-000000000001', '33333333-3333-4333-8333-333333333333', 'c2c00000-0000-4000-8000-000000000001', 'أ', 'א', 'ProdA', 10, true),
  ('cbc00000-0000-4000-8000-000000000002', '33333333-3333-4333-8333-333333333333', 'c2c00000-0000-4000-8000-000000000001', 'ب', 'ב', 'ProdB', 10, true),
  ('cbc00000-0000-4000-8000-000000000003', '33333333-3333-4333-8333-333333333333', 'c2c00000-0000-4000-8000-000000000001', 'ج', 'ג', 'ProdC', 10, true),
  ('cbc00000-0000-4000-8000-000000000004', '33333333-3333-4333-8333-333333333333', 'c2c00000-0000-4000-8000-000000000001', 'د', 'ד', 'ProdInactive', 10, false);

-- Customers: cust1/cust2 active, cust3 inactive. Only cust1 assigned to repC.
insert into public.customers (id, tenant_id, name, is_active) values
  ('caa00000-0000-4000-8000-000000000001', '33333333-3333-4333-8333-333333333333', 'Shop One', true),
  ('caa00000-0000-4000-8000-000000000002', '33333333-3333-4333-8333-333333333333', 'Shop Two', true),
  ('caa00000-0000-4000-8000-000000000003', '33333333-3333-4333-8333-333333333333', 'Shop Three', false);

insert into public.sales_rep_customers (tenant_id, customer_id, user_id) values
  ('33333333-3333-4333-8333-333333333333', 'caa00000-0000-4000-8000-000000000001', 'c0c00000-0000-4000-8000-000000000002');

-- Inventory: pA low(5<10), pB low+out(0<10), pC normal(50), pInactive low but inactive.
insert into public.inventory_items
  (tenant_id, product_id, quantity_available, low_stock_threshold, warehouse_location)
values
  ('33333333-3333-4333-8333-333333333333', 'cbc00000-0000-4000-8000-000000000001', 5, 10, 'A1'),
  ('33333333-3333-4333-8333-333333333333', 'cbc00000-0000-4000-8000-000000000002', 0, 10, 'B1'),
  ('33333333-3333-4333-8333-333333333333', 'cbc00000-0000-4000-8000-000000000003', 50, 10, 'C1'),
  ('33333333-3333-4333-8333-333333333333', 'cbc00000-0000-4000-8000-000000000004', 0, 10, 'D1');

-- Orders (Asia/Jerusalem = UTC+3 in July). p_now = 2026-07-15T10:00Z → local
-- today = 2026-07-15. o7 crosses the UTC date but is tenant-local 2026-07-15.
insert into public.orders
  (id, tenant_id, customer_id, customer_snapshot, order_number, public_ref, status, subtotal, source, created_at)
values
  ('0da00000-0000-4000-8000-000000000001', '33333333-3333-4333-8333-333333333333', 'caa00000-0000-4000-8000-000000000001', null, 'MDF-1', 'MDF-P1', 'new',       100, 'sales_visit', '2026-07-15T08:00:00Z'),
  ('0da00000-0000-4000-8000-000000000002', '33333333-3333-4333-8333-333333333333', 'caa00000-0000-4000-8000-000000000001', null, 'MDF-2', 'MDF-P2', 'confirmed', 200, 'sales_visit', '2026-07-15T09:00:00Z'),
  ('0da00000-0000-4000-8000-000000000003', '33333333-3333-4333-8333-333333333333', 'caa00000-0000-4000-8000-000000000002', null, 'MDF-3', 'MDF-P3', 'delivered',  50, 'sales_visit', '2026-07-14T12:00:00Z'),
  ('0da00000-0000-4000-8000-000000000004', '33333333-3333-4333-8333-333333333333', 'caa00000-0000-4000-8000-000000000002', null, 'MDF-4', 'MDF-P4', 'cancelled', 999, 'sales_visit', '2026-07-15T07:00:00Z'),
  ('0da00000-0000-4000-8000-000000000005', '33333333-3333-4333-8333-333333333333', null, '{"guest": true, "name": "Guest"}'::jsonb, 'MDF-5', 'MDF-P5', 'new', 30, 'remote_customer', '2026-07-15T06:00:00Z'),
  ('0da00000-0000-4000-8000-000000000006', '33333333-3333-4333-8333-333333333333', 'caa00000-0000-4000-8000-000000000001', null, 'MDF-6', 'MDF-P6', 'preparing', 75, 'sales_visit', '2026-07-14T10:00:00Z'),
  ('0da00000-0000-4000-8000-000000000007', '33333333-3333-4333-8333-333333333333', 'caa00000-0000-4000-8000-000000000001', null, 'MDF-7', 'MDF-P7', 'new', 10, 'sales_visit', '2026-07-14T21:30:00Z');

-- Order items (line_subtotal drives top_products; a name snapshot is required).
insert into public.order_items
  (tenant_id, order_id, product_id, product_name_snapshot, package_unit_snapshot, quantity, unit_price_snapshot, line_subtotal, line_vat, line_total)
values
  ('33333333-3333-4333-8333-333333333333', '0da00000-0000-4000-8000-000000000001', 'cbc00000-0000-4000-8000-000000000001', '{"ar":"أ","he":"א","en":"ProdA"}'::jsonb, 'carton', 1, 100, 100, 0, 100),
  ('33333333-3333-4333-8333-333333333333', '0da00000-0000-4000-8000-000000000002', 'cbc00000-0000-4000-8000-000000000002', '{"ar":"ب","he":"ב","en":"ProdB"}'::jsonb, 'carton', 1, 200, 200, 0, 200),
  ('33333333-3333-4333-8333-333333333333', '0da00000-0000-4000-8000-000000000003', 'cbc00000-0000-4000-8000-000000000001', '{"ar":"أ","he":"א","en":"ProdA"}'::jsonb, 'carton', 1, 50, 50, 0, 50),
  ('33333333-3333-4333-8333-333333333333', '0da00000-0000-4000-8000-000000000004', 'cbc00000-0000-4000-8000-000000000002', '{"ar":"ب","he":"ב","en":"ProdB"}'::jsonb, 'carton', 1, 999, 999, 0, 999),
  ('33333333-3333-4333-8333-333333333333', '0da00000-0000-4000-8000-000000000005', 'cbc00000-0000-4000-8000-000000000001', '{"ar":"أ","he":"א","en":"ProdA"}'::jsonb, 'carton', 1, 30, 30, 0, 30),
  ('33333333-3333-4333-8333-333333333333', '0da00000-0000-4000-8000-000000000006', 'cbc00000-0000-4000-8000-000000000002', '{"ar":"ب","he":"ב","en":"ProdB"}'::jsonb, 'carton', 1, 75, 75, 0, 75),
  ('33333333-3333-4333-8333-333333333333', '0da00000-0000-4000-8000-000000000007', 'cbc00000-0000-4000-8000-000000000001', '{"ar":"أ","he":"א","en":"ProdA"}'::jsonb, 'carton', 1, 10, 10, 0, 10);

-- Tenant B: one order (cross-tenant leak fixture).
insert into public.customers (id, tenant_id, name, is_active) values
  ('cbb00000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'B Shop', true);
insert into public.orders
  (id, tenant_id, customer_id, order_number, public_ref, status, subtotal, source, created_at)
values
  ('0db00000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'cbb00000-0000-4000-8000-000000000001', 'B-1', 'B-P1', 'new', 500, 'sales_visit', '2026-07-15T08:00:00Z');

-- Tenant D: 1001 orders today (proves >1000 aggregation completeness).
insert into public.orders
  (id, tenant_id, customer_id, order_number, public_ref, status, subtotal, source, created_at)
select
  gen_random_uuid(),
  '44444444-4444-4444-8444-444444444444',
  null,
  'D-' || g,
  'D-P' || g,
  'new',
  1,
  'sales_visit',
  '2026-07-15T08:00:00Z'
from generate_series(1, 1001) as g;

select is((select prosecdef from pg_proc where oid = 'public.get_dashboard_period_metrics(uuid,timestamptz[])'::regprocedure), false, 'SECURITY INVOKER');
select ok(not has_function_privilege('anon', 'public.get_dashboard_period_metrics(uuid,timestamptz[])', 'execute'), 'anon denied');
select ok(not has_function_privilege('public', 'public.get_dashboard_period_metrics(uuid,timestamptz[])', 'execute'), 'PUBLIC denied');
set local role authenticated;
set local request.jwt.claims = '{"sub":"c0c00000-0000-4000-8000-000000000001","role":"authenticated"}';
select is(public.get_dashboard_period_metrics('33333333-3333-4333-8333-333333333333', array['2026-07-14T21:00Z','2026-07-15T21:00Z']::timestamptz[]) ->> 'totalOrders', '5', 'tenant local day includes UTC crossing');
select is(public.get_dashboard_period_metrics('33333333-3333-4333-8333-333333333333', array['2026-07-14T21:00Z','2026-07-15T21:00Z']::timestamptz[]) ->> 'count', '4', 'cancelled excluded from live count');
select is((public.get_dashboard_period_metrics('33333333-3333-4333-8333-333333333333', array['2026-07-14T21:00Z','2026-07-15T21:00Z']::timestamptz[]) ->> 'revenue')::numeric, 340::numeric, 'stored subtotal exact');
select is(public.get_dashboard_period_metrics('33333333-3333-4333-8333-333333333333', array['2026-07-15T08:00Z','2026-07-15T09:00Z']::timestamptz[]) ->> 'totalOrders', '1', 'inclusive start exclusive end');
select is((public.get_dashboard_period_metrics('33333333-3333-4333-8333-333333333333', array['2026-07-14T21:00Z','2026-07-15T21:00Z']::timestamptz[]) #>> '{topProducts,0,revenue}')::numeric, 200::numeric, 'top product sums stored lines without cancellation');
select is(jsonb_array_length(public.get_dashboard_period_metrics('33333333-3333-4333-8333-333333333333', array['2026-07-16T00:00Z','2026-07-17T00:00Z','2026-07-18T00:00Z']::timestamptz[]) -> 'buckets'), 2, 'empty buckets retained');
select is(public.get_dashboard_period_metrics('33333333-3333-4333-8333-333333333333', array['2026-07-16T00:00Z','2026-07-17T00:00Z']::timestamptz[]) #>> '{buckets,0,count}', '0', 'genuine empty zero');
select throws_ok($q$select public.get_dashboard_period_metrics('33333333-3333-4333-8333-333333333333', array['2026-07-16T00:00Z','2026-07-15T00:00Z']::timestamptz[])$q$, '22023', 'Invalid dashboard range', 'reject reversed boundaries');
select throws_ok($q$select public.get_dashboard_period_metrics('33333333-3333-4333-8333-333333333333', array['2024-07-16T00:00Z','2026-07-15T00:00Z']::timestamptz[])$q$, '22023', 'Invalid dashboard range', 'reject unbounded span');
select throws_ok($q$select public.get_dashboard_period_metrics('33333333-3333-4333-8333-333333333333', array['2026-07-16T00:00Z',null]::timestamptz[])$q$, '22023', 'Invalid dashboard range', 'reject null boundary');
select throws_ok($q$select public.get_dashboard_period_metrics('33333333-3333-4333-8333-333333333333', array['2026-07-16T00:00Z','infinity']::timestamptz[])$q$, '22023', 'Invalid dashboard range', 'reject infinity');
select throws_ok($q$select public.get_dashboard_period_metrics('33333333-3333-4333-8333-333333333333', array_fill(now(),array[95]))$q$, '22023', 'Invalid dashboard bucket count', 'reject >93 buckets');
select throws_ok($q$select public.get_dashboard_period_metrics('33333333-3333-4333-8333-333333333333', null)$q$, '22023', 'Invalid dashboard bucket count', 'reject null array');
select throws_ok($q$select public.get_dashboard_period_metrics('33333333-3333-4333-8333-333333333333', '{}'::timestamptz[])$q$, '22023', 'Invalid dashboard bucket count', 'reject empty array');
select throws_ok($q$select public.get_dashboard_period_metrics('33333333-3333-4333-8333-333333333333', array_fill(now(),array[2,2]))$q$, '22023', 'Invalid dashboard bucket count', 'reject multidimensional array');
select throws_ok($q$select public.get_dashboard_period_metrics('33333333-3333-4333-8333-333333333333', array_fill(now(),array[2],array[0]))$q$, '22023', 'Invalid dashboard bucket count', 'reject shifted index array');
select throws_ok($q$select public.get_dashboard_period_metrics('33333333-3333-4333-8333-333333333333', array_fill(now(),array[2]))$q$, '22023', 'Invalid dashboard range', 'reject equal edges');
set local request.jwt.claims = '{"sub":"c0c00000-0000-4000-8000-000000000002","role":"authenticated"}';
select is(public.get_dashboard_period_metrics('33333333-3333-4333-8333-333333333333', array['2026-07-14T21:00Z','2026-07-15T21:00Z']::timestamptz[]) ->> 'totalOrders', '3', 'rep sees assigned customer only');
select is(public.get_dashboard_period_metrics('22222222-2222-4222-8222-222222222222', array['2026-07-14T21:00Z','2026-07-15T21:00Z']::timestamptz[]) ->> 'totalOrders', '0', 'cross tenant empty');
set local request.jwt.claims = '{"sub":"c0c00000-0000-4000-8000-000000000003","role":"authenticated"}';
select is(public.get_dashboard_period_metrics('33333333-3333-4333-8333-333333333333', array['2026-07-14T21:00Z','2026-07-15T21:00Z']::timestamptz[]) ->> 'totalOrders', '5', 'admin sees all permitted orders');
set local request.jwt.claims = '{"sub":"d0d00000-0000-4000-8000-000000000001","role":"authenticated"}';
select is(public.get_dashboard_period_metrics('44444444-4444-4444-8444-444444444444', array['2026-07-14T21:00Z','2026-07-15T21:00Z']::timestamptz[]) ->> 'count', '1001', 'no 1000-row truncation');
select is((public.get_dashboard_period_metrics('44444444-4444-4444-8444-444444444444', array['2026-07-14T21:00Z','2026-07-15T21:00Z']::timestamptz[]) ->> 'revenue')::numeric, 1001::numeric, 'all 1001 amounts included');
select * from finish();
rollback;
