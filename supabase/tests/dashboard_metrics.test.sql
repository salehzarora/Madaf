-- ═══════════════════════════════════════════════════════════════════════
-- pgTAP — public.get_dashboard_metrics (PILOT-C1 bounded dashboard aggregate)
--
-- Verifies the read-only SECURITY INVOKER aggregate RPC against a fully known
-- dataset: metadata + privilege matrix; exact status counts, today/month
-- count+ex-VAT revenue, guest-pending, 14-day tenant-local trend, top products
-- (line revenue), top shops (subtotal), active product/shop counts, low-stock
-- summary; tenant-local (Asia/Jerusalem) date bucketing incl. a UTC-date-crossing
-- boundary; RLS-scoped per-role visibility (sales_rep not broadened, cross-tenant
-- yields zero); and >1000 orders aggregated completely (no PostgREST truncation).
--
-- Money is numeric(12,2) ex-VAT (SUM of stored subtotal / line_subtotal).
--
-- Run with the local stack up:  supabase test db
-- Disposable tenants C/B/D created in THIS transaction; everything rolls back.
-- ═══════════════════════════════════════════════════════════════════════
begin;
select plan(47);

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

-- ── 1–8. Metadata + privilege matrix ───────────────────────────────────────
select has_function('public', 'get_dashboard_metrics', array['uuid','text','timestamptz'],
  'get_dashboard_metrics(uuid,text,timestamptz) exists');
select is(
  (select prosecdef from pg_proc where oid = 'public.get_dashboard_metrics(uuid,text,timestamptz)'::regprocedure),
  false, 'SECURITY INVOKER (prosecdef false)');
select is(
  (select provolatile::text from pg_proc where oid = 'public.get_dashboard_metrics(uuid,text,timestamptz)'::regprocedure),
  's', 'STABLE');
select ok(
  (select array_to_string(proconfig, ',') from pg_proc where oid = 'public.get_dashboard_metrics(uuid,text,timestamptz)'::regprocedure)
    in ('search_path=', 'search_path=""'),
  'search_path is empty');
select ok(not has_function_privilege('public',        'public.get_dashboard_metrics(uuid,text,timestamptz)', 'EXECUTE'), 'PUBLIC cannot execute');
select ok(not has_function_privilege('anon',          'public.get_dashboard_metrics(uuid,text,timestamptz)', 'EXECUTE'), 'anon cannot execute');
select ok(    has_function_privilege('authenticated', 'public.get_dashboard_metrics(uuid,text,timestamptz)', 'EXECUTE'), 'authenticated CAN execute');
select ok(not has_function_privilege('service_role',  'public.get_dashboard_metrics(uuid,text,timestamptz)', 'EXECUTE'), 'service_role has no explicit execute grant');

-- ── ownerC: exact metric values ────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"c0c00000-0000-4000-8000-000000000001","role":"authenticated"}';

select is(
  (public.get_dashboard_metrics('33333333-3333-4333-8333-333333333333','Asia/Jerusalem','2026-07-15T10:00:00Z'::timestamptz) ->> 'total_orders')::int,
  7, 'total_orders counts every order (incl. cancelled + guest)');
select is(
  public.get_dashboard_metrics('33333333-3333-4333-8333-333333333333','Asia/Jerusalem','2026-07-15T10:00:00Z'::timestamptz) -> 'status_counts',
  '{"new":3,"confirmed":1,"preparing":1,"delivered":1,"cancelled":1}'::jsonb,
  'status_counts per status (all statuses)');
select is(
  (public.get_dashboard_metrics('33333333-3333-4333-8333-333333333333','Asia/Jerusalem','2026-07-15T10:00:00Z'::timestamptz) #>> '{today,count}')::int,
  4, 'today count = tenant-local today, non-cancelled (incl. UTC-crossing o7)');
select is(
  (public.get_dashboard_metrics('33333333-3333-4333-8333-333333333333','Asia/Jerusalem','2026-07-15T10:00:00Z'::timestamptz) #>> '{today,revenue}')::numeric,
  340::numeric, 'today revenue = ex-VAT SUM(subtotal) for today (100+200+30+10)');
select is(
  (public.get_dashboard_metrics('33333333-3333-4333-8333-333333333333','Asia/Jerusalem','2026-07-15T10:00:00Z'::timestamptz) #>> '{month,count}')::int,
  6, 'month count = non-cancelled orders this tenant-local month');
select is(
  (public.get_dashboard_metrics('33333333-3333-4333-8333-333333333333','Asia/Jerusalem','2026-07-15T10:00:00Z'::timestamptz) #>> '{month,revenue}')::numeric,
  465::numeric, 'month revenue = ex-VAT SUM(subtotal) this month (100+200+50+30+75+10)');
select is(
  (public.get_dashboard_metrics('33333333-3333-4333-8333-333333333333','Asia/Jerusalem','2026-07-15T10:00:00Z'::timestamptz) ->> 'guest_pending')::int,
  1, 'guest_pending = new + no customer + snapshot.guest');
select is(
  jsonb_array_length(public.get_dashboard_metrics('33333333-3333-4333-8333-333333333333','Asia/Jerusalem','2026-07-15T10:00:00Z'::timestamptz) -> 'trend'),
  2, 'trend = the 2 tenant-local days with non-cancelled orders');
select is(
  public.get_dashboard_metrics('33333333-3333-4333-8333-333333333333','Asia/Jerusalem','2026-07-15T10:00:00Z'::timestamptz) #>> '{trend,0,day}',
  '2026-07-14', 'trend ascending: earliest day first');
select is(
  (public.get_dashboard_metrics('33333333-3333-4333-8333-333333333333','Asia/Jerusalem','2026-07-15T10:00:00Z'::timestamptz) #>> '{trend,0,total}')::numeric,
  125::numeric, 'trend 07-14 total (50 delivered + 75 preparing)');
select is(
  public.get_dashboard_metrics('33333333-3333-4333-8333-333333333333','Asia/Jerusalem','2026-07-15T10:00:00Z'::timestamptz) #>> '{trend,1,day}',
  '2026-07-15', 'trend newest day last');
select is(
  (public.get_dashboard_metrics('33333333-3333-4333-8333-333333333333','Asia/Jerusalem','2026-07-15T10:00:00Z'::timestamptz) #>> '{trend,1,total}')::numeric,
  340::numeric, 'trend 07-15 total (100+200+30+10)');
select is(
  jsonb_array_length(public.get_dashboard_metrics('33333333-3333-4333-8333-333333333333','Asia/Jerusalem','2026-07-15T10:00:00Z'::timestamptz) -> 'top_products'),
  2, 'top_products has both sold products');
select is(
  public.get_dashboard_metrics('33333333-3333-4333-8333-333333333333','Asia/Jerusalem','2026-07-15T10:00:00Z'::timestamptz) #>> '{top_products,0,product_id}',
  'cbc00000-0000-4000-8000-000000000002', 'top product by line revenue is ProdB');
select is(
  (public.get_dashboard_metrics('33333333-3333-4333-8333-333333333333','Asia/Jerusalem','2026-07-15T10:00:00Z'::timestamptz) #>> '{top_products,0,revenue}')::numeric,
  275::numeric, 'ProdB revenue = 200+75 (cancelled 999 excluded)');
select is(
  public.get_dashboard_metrics('33333333-3333-4333-8333-333333333333','Asia/Jerusalem','2026-07-15T10:00:00Z'::timestamptz) #>> '{top_products,1,product_id}',
  'cbc00000-0000-4000-8000-000000000001', 'second product is ProdA');
select is(
  (public.get_dashboard_metrics('33333333-3333-4333-8333-333333333333','Asia/Jerusalem','2026-07-15T10:00:00Z'::timestamptz) #>> '{top_products,1,revenue}')::numeric,
  190::numeric, 'ProdA revenue = 100+50+30+10');
select is(
  jsonb_array_length(public.get_dashboard_metrics('33333333-3333-4333-8333-333333333333','Asia/Jerusalem','2026-07-15T10:00:00Z'::timestamptz) -> 'top_shops'),
  2, 'top_shops = the 2 customers with non-cancelled orders (guest excluded)');
select is(
  public.get_dashboard_metrics('33333333-3333-4333-8333-333333333333','Asia/Jerusalem','2026-07-15T10:00:00Z'::timestamptz) #>> '{top_shops,0,customer_id}',
  'caa00000-0000-4000-8000-000000000001', 'top shop is Shop One');
select is(
  (public.get_dashboard_metrics('33333333-3333-4333-8333-333333333333','Asia/Jerusalem','2026-07-15T10:00:00Z'::timestamptz) #>> '{top_shops,0,total}')::numeric,
  385::numeric, 'Shop One total = 100+200+75+10');
select is(
  (public.get_dashboard_metrics('33333333-3333-4333-8333-333333333333','Asia/Jerusalem','2026-07-15T10:00:00Z'::timestamptz) #>> '{top_shops,0,count}')::int,
  4, 'Shop One order count = 4 (non-cancelled)');
select is(
  public.get_dashboard_metrics('33333333-3333-4333-8333-333333333333','Asia/Jerusalem','2026-07-15T10:00:00Z'::timestamptz) #>> '{top_shops,1,customer_id}',
  'caa00000-0000-4000-8000-000000000002', 'second shop is Shop Two');
select is(
  (public.get_dashboard_metrics('33333333-3333-4333-8333-333333333333','Asia/Jerusalem','2026-07-15T10:00:00Z'::timestamptz) ->> 'active_product_count')::int,
  3, 'active_product_count excludes the inactive product');
select is(
  (public.get_dashboard_metrics('33333333-3333-4333-8333-333333333333','Asia/Jerusalem','2026-07-15T10:00:00Z'::timestamptz) ->> 'active_shop_count')::int,
  2, 'active_shop_count excludes the inactive customer');
select is(
  (public.get_dashboard_metrics('33333333-3333-4333-8333-333333333333','Asia/Jerusalem','2026-07-15T10:00:00Z'::timestamptz) #>> '{low_stock,count}')::int,
  2, 'low_stock count = active products below threshold (inactive excluded)');
select is(
  (public.get_dashboard_metrics('33333333-3333-4333-8333-333333333333','Asia/Jerusalem','2026-07-15T10:00:00Z'::timestamptz) #>> '{low_stock,out_of_stock_count}')::int,
  1, 'out_of_stock_count = low-stock items at quantity 0');
select is(
  jsonb_array_length(public.get_dashboard_metrics('33333333-3333-4333-8333-333333333333','Asia/Jerusalem','2026-07-15T10:00:00Z'::timestamptz) #> '{low_stock,items}'),
  2, 'low_stock items list (ordered by location, ≤4)');
select is(
  public.get_dashboard_metrics('33333333-3333-4333-8333-333333333333','Asia/Jerusalem','2026-07-15T10:00:00Z'::timestamptz) #>> '{low_stock,items,0,product_id}',
  'cbc00000-0000-4000-8000-000000000001', 'first low-stock item (location A1) is ProdA');
select is(
  (public.get_dashboard_metrics('33333333-3333-4333-8333-333333333333','Asia/Jerusalem','2026-07-15T10:00:00Z'::timestamptz) #>> '{low_stock,items,0,stock}')::int,
  5, 'ProdA stock = 5');
select is(
  public.get_dashboard_metrics('33333333-3333-4333-8333-333333333333','Asia/Jerusalem','2026-07-15T10:00:00Z'::timestamptz) #>> '{low_stock,items,1,product_id}',
  'cbc00000-0000-4000-8000-000000000002', 'second low-stock item (location B1) is ProdB');
select is(
  (public.get_dashboard_metrics('33333333-3333-4333-8333-333333333333','Asia/Jerusalem','2026-07-15T10:00:00Z'::timestamptz) #>> '{low_stock,items,1,stock}')::int,
  0, 'ProdB stock = 0 (out of stock)');

-- ── Tenant isolation: ownerC asking for tenant B sees nothing (RLS) ────────
select is(
  (public.get_dashboard_metrics('22222222-2222-4222-8222-222222222222','Asia/Jerusalem','2026-07-15T10:00:00Z'::timestamptz) ->> 'total_orders')::int,
  0, 'ownerC passing tenant B gets ZERO (RLS, not the arg, authorizes)');

-- ── sales_rep scoping: repC sees only assigned-customer orders ─────────────
set local request.jwt.claims = '{"sub":"c0c00000-0000-4000-8000-000000000002","role":"authenticated"}';
select is(
  (public.get_dashboard_metrics('33333333-3333-4333-8333-333333333333','Asia/Jerusalem','2026-07-15T10:00:00Z'::timestamptz) ->> 'total_orders')::int,
  4, 'repC sees ONLY its assigned customer (Shop One): 4 orders, not broadened');
select is(
  (public.get_dashboard_metrics('33333333-3333-4333-8333-333333333333','Asia/Jerusalem','2026-07-15T10:00:00Z'::timestamptz) #>> '{status_counts,new}')::int,
  2, 'repC new-order count is scoped to its orders');
select is(
  jsonb_array_length(public.get_dashboard_metrics('33333333-3333-4333-8333-333333333333','Asia/Jerusalem','2026-07-15T10:00:00Z'::timestamptz) -> 'top_shops'),
  1, 'repC top_shops shows only its one assigned shop');
select is(
  (public.get_dashboard_metrics('33333333-3333-4333-8333-333333333333','Asia/Jerusalem','2026-07-15T10:00:00Z'::timestamptz) ->> 'guest_pending')::int,
  0, 'repC never sees guest/null-customer orders');

-- ── >1000 orders aggregate completely (no PostgREST truncation) ────────────
set local request.jwt.claims = '{"sub":"d0d00000-0000-4000-8000-000000000001","role":"authenticated"}';
select is(
  (public.get_dashboard_metrics('44444444-4444-4444-8444-444444444444','Asia/Jerusalem','2026-07-15T10:00:00Z'::timestamptz) ->> 'total_orders')::int,
  1001, 'aggregate counts ALL 1001 orders (not capped at 1000)');
select is(
  (public.get_dashboard_metrics('44444444-4444-4444-8444-444444444444','Asia/Jerusalem','2026-07-15T10:00:00Z'::timestamptz) #>> '{today,count}')::int,
  1001, 'today count includes all 1001 (no silent truncation)');
select is(
  (public.get_dashboard_metrics('44444444-4444-4444-8444-444444444444','Asia/Jerusalem','2026-07-15T10:00:00Z'::timestamptz) #>> '{today,revenue}')::numeric,
  1001::numeric, 'today revenue sums all 1001 (1 each) — complete');

reset role;
select finish();
rollback;
