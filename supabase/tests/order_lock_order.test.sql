-- ═══════════════════════════════════════════════════════════════════════
-- pgTAP — M8I.7 DETERMINISTIC INVENTORY LOCK ORDER (order RPCs)
--
-- The deadlock fix (20260812100000) redefines update_order_status and
-- update_order_items so EVERY inventory_items-locking loop drives on an
-- ascending product_id, giving all competing order operations one global lock
-- order (no 40P01 under concurrent overlapping orders). A single transaction
-- cannot observe a deadlock, so this suite proves the fix two ways:
--   • STRUCTURE — each redefined function still exists with its exact signature,
--     SECURITY DEFINER, empty search_path and client grants, and its
--     inventory loop now carries the deterministic `order by <product_id>`;
--   • SEMANTICS — a real 2-product order still reserves, reconciles on edit and
--     restores on cancel EXACTLY as before (the reordering changed only lock
--     acquisition order, never the amounts moved).
--
-- The live cross-session deadlock-freedom is proven separately by the committed
-- *.live.test.ts concurrency probes. Run with the local stack up: supabase test db
-- Disposable tenant D in THIS transaction; everything rolls back.
-- ═══════════════════════════════════════════════════════════════════════
begin;
select plan(25);

set local request.jwt.claims = '{"role":"service_role"}';

-- ── Fixtures: tenant D, owner, one assigned customer, two tracked products ──
insert into auth.users (id) values
  ('d0d00000-0000-4000-8000-000000000001');           -- ownerD
insert into public.tenants (id, name_ar, name_he, name_en) values
  ('44444444-4444-4444-8444-444444444444', 'د', 'ד', 'D');
insert into public.tenant_users (tenant_id, user_id, role) values
  ('44444444-4444-4444-8444-444444444444', 'd0d00000-0000-4000-8000-000000000001', 'owner');
insert into public.customers (id, tenant_id, name, customer_type, phone, origin, is_active) values
  ('da000000-0000-4000-8000-000000000001', '44444444-4444-4444-8444-444444444444', 'Store D1', 'grocery', '050-1', 'manual', true);
-- p1 < p2 by product_id so ascending order is well-defined and observable.
insert into public.products (id, tenant_id, name_ar, name_he, name_en, package_unit,
                             package_quantity, base_unit, wholesale_price, vat_rate, is_active) values
  ('4d000000-0000-4000-8000-000000000001', '44444444-4444-4444-8444-444444444444', 'م1','מ1','P1','carton',6,'bottles',10.00,0.17,true),
  ('4d000000-0000-4000-8000-000000000002', '44444444-4444-4444-8444-444444444444', 'م2','מ2','P2','carton',6,'bottles',20.00,0.17,true);
insert into public.inventory_items (tenant_id, product_id, quantity_available, low_stock_threshold) values
  ('44444444-4444-4444-8444-444444444444', '4d000000-0000-4000-8000-000000000001', 100, 5),
  ('44444444-4444-4444-8444-444444444444', '4d000000-0000-4000-8000-000000000002', 100, 5);

-- ── 1–4. update_order_status: signature / DEFINER / search_path / returns-set ──
select has_function('public', 'update_order_status',
  array['uuid', 'uuid', 'public.order_status'], 'update_order_status keeps its signature');
select is((select prosecdef from pg_proc where oid='public.update_order_status(uuid,uuid,public.order_status)'::regprocedure),
  true, 'update_order_status stays SECURITY DEFINER');
select is((select array_to_string(proconfig, ',') from pg_proc where oid='public.update_order_status(uuid,uuid,public.order_status)'::regprocedure),
  'search_path=""', 'update_order_status pins an empty search_path');
select is((select proretset from pg_proc where oid='public.update_order_status(uuid,uuid,public.order_status)'::regprocedure),
  true, 'update_order_status still RETURNS TABLE (a set)');

-- ── 5–6. Both inventory loops in update_order_status are now deterministic ──
select ok((select pg_get_functiondef('public.update_order_status(uuid,uuid,public.order_status)'::regprocedure)
             like '%order by oi.product_id%'),
  'update_order_status RESERVE loop locks in ascending product_id (order by oi.product_id)');
select ok((select pg_get_functiondef('public.update_order_status(uuid,uuid,public.order_status)'::regprocedure)
             like '%order by m.product_id%'),
  'update_order_status RESTORE loop locks in ascending product_id (order by m.product_id)');

-- ── 7–8. update_order_status client grants preserved ──────────────────────
select ok(has_function_privilege('authenticated', 'public.update_order_status(uuid,uuid,public.order_status)', 'EXECUTE'),
  'authenticated may execute update_order_status');
select ok(not has_function_privilege('anon', 'public.update_order_status(uuid,uuid,public.order_status)', 'EXECUTE'),
  'anon may NOT execute update_order_status');

-- ── 9–12. update_order_items: signature / DEFINER / search_path / loop ─────
select has_function('public', 'update_order_items',
  array['uuid', 'uuid', 'jsonb', 'text'], 'update_order_items keeps its signature');
select is((select prosecdef from pg_proc where oid='public.update_order_items(uuid,uuid,jsonb,text)'::regprocedure),
  true, 'update_order_items stays SECURITY DEFINER');
select is((select array_to_string(proconfig, ',') from pg_proc where oid='public.update_order_items(uuid,uuid,jsonb,text)'::regprocedure),
  'search_path=""', 'update_order_items pins an empty search_path');
select ok((select pg_get_functiondef('public.update_order_items(uuid,uuid,jsonb,text)'::regprocedure)
             like '%order by coalesce(n.pid, r.pid)%'),
  'update_order_items reconcile loop locks in ascending product_id (order by coalesce(n.pid, r.pid))');

-- ── 13–14. update_order_items client grants preserved ─────────────────────
select ok(has_function_privilege('authenticated', 'public.update_order_items(uuid,uuid,jsonb,text)', 'EXECUTE'),
  'authenticated may execute update_order_items');
select ok(not has_function_privilege('anon', 'public.update_order_items(uuid,uuid,jsonb,text)', 'EXECUTE'),
  'anon may NOT execute update_order_items');

-- ═══ SEMANTICS: multi-product reserve / reconcile / restore unchanged ══════
set local role authenticated;
set local request.jwt.claims = '{"sub":"d0d00000-0000-4000-8000-000000000001","role":"authenticated"}';

-- ── 15. Create a 2-product order (p1 qty 3, p2 qty 5) ─────────────────────
select lives_ok(
  $$ select public.create_order_request('44444444-4444-4444-8444-444444444444',
       '[{"product_id":"4d000000-0000-4000-8000-000000000001","quantity":3},
         {"product_id":"4d000000-0000-4000-8000-000000000002","quantity":5}]'::jsonb,
       'da000000-0000-4000-8000-000000000001') $$,
  'owner creates a two-product order');

-- ── 16–19. Confirm reserves BOTH products (ascending loop touches each) ────
select lives_ok(
  $$ select public.update_order_status('44444444-4444-4444-8444-444444444444',
       (select id from public.orders where tenant_id='44444444-4444-4444-8444-444444444444'), 'confirmed') $$,
  'new -> confirmed reserves both products');
select is((select quantity_available from public.inventory_items
           where tenant_id='44444444-4444-4444-8444-444444444444' and product_id='4d000000-0000-4000-8000-000000000001'),
  97, 'p1 reserved 3 (100 -> 97)');
select is((select quantity_available from public.inventory_items
           where tenant_id='44444444-4444-4444-8444-444444444444' and product_id='4d000000-0000-4000-8000-000000000002'),
  95, 'p2 reserved 5 (100 -> 95)');
select is((select count(*) from public.order_inventory_movements
           where order_id=(select id from public.orders where tenant_id='44444444-4444-4444-8444-444444444444')
             and reason='order_reserved'),
  2::bigint, 'exactly one reservation movement per product (both looped)');

-- ── 20–22. Edit reconciles per product (p1 -2 restore, p2 +2 deduct) ──────
select lives_ok(
  $$ select public.update_order_items('44444444-4444-4444-8444-444444444444',
       (select id from public.orders where tenant_id='44444444-4444-4444-8444-444444444444'),
       '[{"product_id":"4d000000-0000-4000-8000-000000000001","quantity":1},
         {"product_id":"4d000000-0000-4000-8000-000000000002","quantity":7}]'::jsonb) $$,
  'reserved order edited (p1 3->1, p2 5->7)');
select is((select quantity_available from public.inventory_items
           where tenant_id='44444444-4444-4444-8444-444444444444' and product_id='4d000000-0000-4000-8000-000000000001'),
  99, 'p1 restored 2 on edit (97 -> 99)');
select is((select quantity_available from public.inventory_items
           where tenant_id='44444444-4444-4444-8444-444444444444' and product_id='4d000000-0000-4000-8000-000000000002'),
  93, 'p2 deducted 2 more on edit (95 -> 93)');

-- ── 23–25. Cancel restores the net reservation for BOTH products ──────────
select lives_ok(
  $$ select public.update_order_status('44444444-4444-4444-8444-444444444444',
       (select id from public.orders where tenant_id='44444444-4444-4444-8444-444444444444'), 'cancelled') $$,
  'confirmed -> cancelled restores both products');
select is((select quantity_available from public.inventory_items
           where tenant_id='44444444-4444-4444-8444-444444444444' and product_id='4d000000-0000-4000-8000-000000000001'),
  100, 'p1 fully restored on cancel (99 -> 100)');
select is((select quantity_available from public.inventory_items
           where tenant_id='44444444-4444-4444-8444-444444444444' and product_id='4d000000-0000-4000-8000-000000000002'),
  100, 'p2 fully restored on cancel (93 -> 100)');

select finish();
rollback;
