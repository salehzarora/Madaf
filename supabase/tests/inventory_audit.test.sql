-- ═══════════════════════════════════════════════════════════════════════
-- pgTAP — M8I.2 Inventory INTEGRITY + AUDIT (PILOT-OPS-AUDIT-002)
--
-- Verifies the redefined upsert_inventory_item:
--   • QUANTITY INTEGRITY — an existing row's quantity_available is PRESERVED; a
--     submitted/stale quantity never overwrites a ledger-maintained balance
--     (manual adjustment OR order reservation); only threshold/location/expiry
--     update; no movement is fabricated;
--   • AUDIT — the first row emits ONE inventory.created ({quantity, threshold}
--     only); an effective config change emits ONE inventory.updated (closed
--     changed_fields + safe before/after, NEVER quantity); a no-op / quantity-only
--     stale submit / rolled-back call emits none; the first-row path does not
--     double-emit;
--   • the private helper is SECURITY INVOKER, search_path='', callable by NO
--     client role; closed 2-event allowlist; entity_type=inventory; per-event key
--     allowlist; metadata bounded;
--   • RLS scopes inventory rows to owner/admin (sales_rep denied) while leaving
--     customer/order/product/other rows EXACTLY as before; cross-tenant fails;
--   • manual adjust_inventory_stock writes NO inventory audit event (ledger only);
--   • create_product with inventory → product.created + inventory.created, once each.
--
-- Run with the local stack up:  supabase test db
-- Disposable tenants C + B in THIS transaction; everything rolls back.
-- ═══════════════════════════════════════════════════════════════════════
begin;
select plan(46);

set local request.jwt.claims = '{"role":"service_role"}';

-- ── Fixtures ───────────────────────────────────────────────────────────────
insert into auth.users (id) values
  ('c0c00000-0000-4000-8000-000000000001'),  -- ownerC
  ('c0c00000-0000-4000-8000-000000000002'),  -- repC (sales_rep)
  ('c0c00000-0000-4000-8000-000000000003'),  -- adminC
  ('b0b00000-0000-4000-8000-000000000001');  -- ownerB
insert into public.tenants (id, name_ar, name_he, name_en) values
  ('33333333-3333-4333-8333-333333333333', 'ج', 'ג', 'C'),
  ('22222222-2222-4222-8222-222222222222', 'ب', 'ב', 'B');
insert into public.tenant_users (tenant_id, user_id, role) values
  ('33333333-3333-4333-8333-333333333333', 'c0c00000-0000-4000-8000-000000000001', 'owner'),
  ('33333333-3333-4333-8333-333333333333', 'c0c00000-0000-4000-8000-000000000002', 'sales_rep'),
  ('33333333-3333-4333-8333-333333333333', 'c0c00000-0000-4000-8000-000000000003', 'admin'),
  ('22222222-2222-4222-8222-222222222222', 'b0b00000-0000-4000-8000-000000000001', 'owner');
insert into public.categories (id, tenant_id, name_ar, name_he, name_en) values
  ('c2c00000-0000-4000-8000-000000000001', '33333333-3333-4333-8333-333333333333', 'ف', 'ק', 'Cat'),
  ('c2c00000-0000-4000-8000-000000000009', '22222222-2222-4222-8222-222222222222', 'ب', 'ב', 'CatB');
-- P_NEW: no inventory row. P_TRACK: inv qty 50. P_RESERVE: inv qty 100 (order
-- reservation test). P_B: tenant B.
insert into public.products (id, tenant_id, category_id, name_ar, name_he, name_en, wholesale_price) values
  ('cbc00000-0000-4000-8000-000000000001', '33333333-3333-4333-8333-333333333333', 'c2c00000-0000-4000-8000-000000000001', 'أ','א','New', 5),
  ('cbc00000-0000-4000-8000-000000000002', '33333333-3333-4333-8333-333333333333', 'c2c00000-0000-4000-8000-000000000001', 'ب','ב','Track', 5),
  ('cbc00000-0000-4000-8000-000000000003', '33333333-3333-4333-8333-333333333333', 'c2c00000-0000-4000-8000-000000000001', 'ج','ג','Reserve', 5),
  ('cbc00000-0000-4000-8000-000000000009', '22222222-2222-4222-8222-222222222222', 'c2c00000-0000-4000-8000-000000000009', 'د','ד','PB', 5);
insert into public.inventory_items (tenant_id, product_id, quantity_available, low_stock_threshold, warehouse_location, expiry_date) values
  ('33333333-3333-4333-8333-333333333333', 'cbc00000-0000-4000-8000-000000000002', 50, 10, 'A-1', '2026-12-31'),
  ('33333333-3333-4333-8333-333333333333', 'cbc00000-0000-4000-8000-000000000003', 100, 5, null, null);

-- ── 1–5. Helper: exists, INVOKER, empty search_path, void, revoked ─────────
select has_function('public', '_log_inventory_audit_event',
  array['uuid', 'text', 'uuid', 'jsonb'], 'the private Inventory audit helper exists');
select is((select prosecdef from pg_proc where oid='public._log_inventory_audit_event(uuid,text,uuid,jsonb)'::regprocedure),
  false, 'helper is SECURITY INVOKER');
select is((select array_to_string(proconfig, ',') from pg_proc where oid='public._log_inventory_audit_event(uuid,text,uuid,jsonb)'::regprocedure),
  'search_path=""', 'helper pins an EMPTY search_path');
select ok(not has_function_privilege('authenticated', 'public._log_inventory_audit_event(uuid,text,uuid,jsonb)', 'EXECUTE'),
  'authenticated cannot invoke the helper');
select ok(not has_function_privilege('anon', 'public._log_inventory_audit_event(uuid,text,uuid,jsonb)', 'EXECUTE'),
  'anon cannot invoke the helper');

-- ── 6–9. Helper validation: allowlist, entity, metadata shape/keys ─────────
select throws_ok(
  $$ select public._log_inventory_audit_event('33333333-3333-4333-8333-333333333333', 'inventory.bogus',
       'cbc00000-0000-4000-8000-000000000002', '{}'::jsonb) $$,
  '22023', NULL, 'helper rejects an unknown event type (no "Other")');
select throws_ok(
  $$ select public._log_inventory_audit_event('33333333-3333-4333-8333-333333333333', 'inventory.updated',
       'cbc00000-0000-4000-8000-000000000002', jsonb_build_object('quantity', 5)) $$,
  '22023', NULL, 'helper rejects quantity as a key on inventory.updated');
select throws_ok(
  $$ select public._log_inventory_audit_event('33333333-3333-4333-8333-333333333333', 'inventory.created',
       'cbc00000-0000-4000-8000-000000000002', '[1]'::jsonb) $$,
  '22023', NULL, 'helper rejects non-object metadata');
select throws_ok(
  $$ select public._log_inventory_audit_event('33333333-3333-4333-8333-333333333333', 'inventory.created',
       null, '{}'::jsonb) $$,
  '22023', NULL, 'helper rejects a null product id');

-- ═══ Authenticated caller: ownerC ══════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"c0c00000-0000-4000-8000-000000000001","role":"authenticated"}';

-- ── 10–14. First row → ONE inventory.created, safe metadata, no updated ────
select lives_ok(
  $$ select public.upsert_inventory_item('33333333-3333-4333-8333-333333333333',
       'cbc00000-0000-4000-8000-000000000001',
       jsonb_build_object('quantity_available', 12, 'low_stock_threshold', 4,
         'warehouse_location', 'C-9', 'expiry_date', '2027-05-01')) $$,
  'owner creates the first inventory row for a product');
select is((select quantity_available from public.inventory_items where product_id='cbc00000-0000-4000-8000-000000000001'),
  12, 'the initial quantity is honored on the first row');
select is((select count(*) from public.audit_events where entity_type='inventory' and event_type='inventory.created'
             and entity_id='cbc00000-0000-4000-8000-000000000001'),
  1::bigint, 'first row → exactly ONE inventory.created');
select is((select metadata from public.audit_events where event_type='inventory.created'
             and entity_id='cbc00000-0000-4000-8000-000000000001'),
  jsonb_build_object('quantity', 12, 'threshold', 4), 'created metadata is safe {quantity, threshold} only');
select is((select count(*) from public.audit_events where entity_type='inventory' and event_type='inventory.updated'
             and entity_id='cbc00000-0000-4000-8000-000000000001'),
  0::bigint, 'the first row emits NO inventory.updated');

-- ── 15–16. Actor + entity_type ─────────────────────────────────────────────
select is((select actor_user_id from public.audit_events where event_type='inventory.created'
             and entity_id='cbc00000-0000-4000-8000-000000000001'),
  'c0c00000-0000-4000-8000-000000000001'::uuid, 'actor is the authenticated owner (auth.uid())');
select is((select entity_type from public.audit_events where entity_id='cbc00000-0000-4000-8000-000000000001' and entity_type='inventory' limit 1),
  'inventory', 'entity_type is fixed to inventory');

-- ── 17–18. Second upsert on the now-existing row → no duplicate created ────
select lives_ok(
  $$ select public.upsert_inventory_item('33333333-3333-4333-8333-333333333333',
       'cbc00000-0000-4000-8000-000000000001',
       jsonb_build_object('quantity_available', 999, 'low_stock_threshold', 4,
         'warehouse_location', 'C-9', 'expiry_date', '2027-05-01')) $$,
  'a second upsert on the existing row succeeds');
select is((select count(*) from public.audit_events where event_type='inventory.created'
             and entity_id='cbc00000-0000-4000-8000-000000000001'),
  1::bigint, 'no duplicate inventory.created for the existing row');

-- ── 19. Quantity is PRESERVED on the existing row (submitted 999 ignored) ──
select is((select quantity_available from public.inventory_items where product_id='cbc00000-0000-4000-8000-000000000001'),
  12, 'a submitted quantity is IGNORED for an existing row (12 preserved, not 999)');

-- ── 20–24. Config change on P_TRACK → ONE inventory.updated, no quantity ───
select lives_ok(
  $$ select public.upsert_inventory_item('33333333-3333-4333-8333-333333333333',
       'cbc00000-0000-4000-8000-000000000002',
       jsonb_build_object('quantity_available', 50, 'low_stock_threshold', 24,
         'warehouse_location', 'B-11', 'expiry_date', '2026-12-31')) $$,
  'owner changes threshold + location on a tracked product');
select is((select count(*) from public.audit_events where event_type='inventory.updated'
             and entity_id='cbc00000-0000-4000-8000-000000000002'),
  1::bigint, 'a config change → exactly ONE inventory.updated');
select is((select metadata->'changed_fields' from public.audit_events where event_type='inventory.updated'
             and entity_id='cbc00000-0000-4000-8000-000000000002'),
  '["threshold","location"]'::jsonb, 'changed_fields are the config keys only (order preserved)');
select is((select metadata#>>'{threshold,to}' from public.audit_events where event_type='inventory.updated'
             and entity_id='cbc00000-0000-4000-8000-000000000002'),
  '24', 'safe before/after recorded for threshold');
select ok((select not (metadata ?| array['quantity','quantity_available'])
             from public.audit_events where event_type='inventory.updated'
             and entity_id='cbc00000-0000-4000-8000-000000000002'),
  'inventory.updated metadata carries NO quantity key');

-- ── 25. quantity preserved on the config edit (still 50, not overwritten) ──
select is((select quantity_available from public.inventory_items where product_id='cbc00000-0000-4000-8000-000000000002'),
  50, 'quantity is preserved during a configuration edit');

-- ── 26–27. No-op config edit → NO additional event ─────────────────────────
select lives_ok(
  $$ select public.upsert_inventory_item('33333333-3333-4333-8333-333333333333',
       'cbc00000-0000-4000-8000-000000000002',
       jsonb_build_object('quantity_available', 50, 'low_stock_threshold', 24,
         'warehouse_location', 'B-11', 'expiry_date', '2026-12-31')) $$,
  're-sending identical config succeeds');
select is((select count(*) from public.audit_events where event_type='inventory.updated'
             and entity_id='cbc00000-0000-4000-8000-000000000002'),
  1::bigint, 'a no-op config edit creates NO additional event');

-- ── 28–30. Stale quantity cannot overwrite a MANUAL-adjusted balance ───────
select public.adjust_inventory_stock('33333333-3333-4333-8333-333333333333',
  'cbc00000-0000-4000-8000-000000000002', 10, 'manual_supplier_delivery');  -- 50 → 60
select is((select quantity_available from public.inventory_items where product_id='cbc00000-0000-4000-8000-000000000002'),
  60, 'a manual adjustment moved the balance to 60');
select lives_ok(
  $$ select public.upsert_inventory_item('33333333-3333-4333-8333-333333333333',
       'cbc00000-0000-4000-8000-000000000002',
       jsonb_build_object('quantity_available', 50, 'low_stock_threshold', 24,
         'warehouse_location', 'B-11', 'expiry_date', '2026-12-31')) $$,
  'a stale Product-form save (quantity 50) still succeeds');
select is((select quantity_available from public.inventory_items where product_id='cbc00000-0000-4000-8000-000000000002'),
  60, 'the stale quantity did NOT overwrite the newer manual-adjusted balance (still 60)');

-- ── 31. The stale save emitted NO inventory event (config unchanged) ───────
select is((select count(*) from public.audit_events where event_type='inventory.updated'
             and entity_id='cbc00000-0000-4000-8000-000000000002'),
  1::bigint, 'the stale quantity-only save emitted NO new inventory event');

-- ── 32–33. Manual adjust_inventory_stock emits NO inventory audit event ────
select is((select count(*) from public.audit_events where entity_type='inventory'
             and entity_id='cbc00000-0000-4000-8000-000000000002' and event_type='inventory.created'),
  0::bigint, 'a manual adjustment (first or later) emits NO inventory.created');
select ok((select count(*) from public.order_inventory_movements
             where tenant_id='33333333-3333-4333-8333-333333333333'
               and product_id='cbc00000-0000-4000-8000-000000000002' and reason='manual_supplier_delivery') = 1,
  'the manual adjustment IS recorded once in the movement ledger (not audit_events)');

-- ── 34–36. Stale quantity cannot overwrite an ORDER-RESERVED balance ───────
select public.create_order_request('33333333-3333-4333-8333-333333333333',
  '[{"product_id":"cbc00000-0000-4000-8000-000000000003","quantity":30}]'::jsonb);
select public.update_order_status('33333333-3333-4333-8333-333333333333',
  (select id from public.orders where tenant_id='33333333-3333-4333-8333-333333333333' limit 1), 'confirmed');  -- reserves 30 → 70
select is((select quantity_available from public.inventory_items where product_id='cbc00000-0000-4000-8000-000000000003'),
  70, 'confirming the order reserved 30 (100 → 70)');
select lives_ok(
  $$ select public.upsert_inventory_item('33333333-3333-4333-8333-333333333333',
       'cbc00000-0000-4000-8000-000000000003',
       jsonb_build_object('quantity_available', 100, 'low_stock_threshold', 5)) $$,
  'a stale Product-form save (quantity 100) still succeeds on the reserved product');
select is((select quantity_available from public.inventory_items where product_id='cbc00000-0000-4000-8000-000000000003'),
  70, 'the stale quantity did NOT overwrite the order-reserved balance (still 70)');

-- ── 37. Config + stale quantity on P_RESERVE → quantity preserved + updated ─
select public.upsert_inventory_item('33333333-3333-4333-8333-333333333333',
  'cbc00000-0000-4000-8000-000000000003',
  jsonb_build_object('quantity_available', 100, 'low_stock_threshold', 9));
select is(
  (select quantity_available from public.inventory_items where product_id='cbc00000-0000-4000-8000-000000000003') || ':' ||
  (select count(*) from public.audit_events where event_type='inventory.updated' and entity_id='cbc00000-0000-4000-8000-000000000003')::text,
  '70:1', 'config change preserves quantity (70) AND emits exactly one inventory.updated');

-- ── 38. Explicit ROLLBACK leaves no orphan inventory event ─────────────────
savepoint before_rollback;
select public.upsert_inventory_item('33333333-3333-4333-8333-333333333333',
  'cbc00000-0000-4000-8000-000000000003',
  jsonb_build_object('quantity_available', 100, 'low_stock_threshold', 33));
rollback to savepoint before_rollback;
select is((select count(*) from public.audit_events where event_type='inventory.updated'
             and entity_id='cbc00000-0000-4000-8000-000000000003'),
  1::bigint, 'a rolled-back config change leaves NO event (transactional)');

-- ── 39–40. Product creation WITH inventory → product.created + inventory.created ─
select public.create_product('33333333-3333-4333-8333-333333333333',
  jsonb_build_object('name_ar','ه','name_he','ה','name_en','WithInv',
    'category_id','c2c00000-0000-4000-8000-000000000001','wholesale_price',7),
  jsonb_build_object('quantity_available', 8, 'low_stock_threshold', 2));
select is((select count(*) from public.audit_events a join public.products p on p.id=a.entity_id
             where p.name_en='WithInv' and a.entity_type='product' and a.event_type='product.created'),
  1::bigint, 'create_product with inventory → one product.created');
select is((select count(*) from public.audit_events a join public.products p on p.id=a.entity_id
             where p.name_en='WithInv' and a.entity_type='inventory' and a.event_type='inventory.created'),
  1::bigint, 'create_product with inventory → one inventory.created (distinct entity)');

-- ═══ Unauthorized: sales_rep repC ══════════════════════════════════════════
set local request.jwt.claims = '{"sub":"c0c00000-0000-4000-8000-000000000002","role":"authenticated"}';
select throws_ok(
  $$ select public.upsert_inventory_item('33333333-3333-4333-8333-333333333333',
       'cbc00000-0000-4000-8000-000000000002', jsonb_build_object('low_stock_threshold', 99)) $$,
  '42501', NULL, 'sales_rep cannot upsert inventory config (authorize_tenant 42501)');

-- ═══ Cross-tenant: ownerC → tenant B ═══════════════════════════════════════
set local request.jwt.claims = '{"sub":"c0c00000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok(
  $$ select public.upsert_inventory_item('22222222-2222-4222-8222-222222222222',
       'cbc00000-0000-4000-8000-000000000009', jsonb_build_object('quantity_available', 5)) $$,
  '42501', NULL, 'ownerC cannot upsert a tenant-B product (cross-tenant 42501)');
reset role;
select is((select count(*) from public.audit_events where tenant_id='22222222-2222-4222-8222-222222222222' and entity_type='inventory'),
  0::bigint, 'no cross-tenant inventory event was written for tenant B');

-- ═══ RLS visibility ════════════════════════════════════════════════════════
-- ── 44. sales_rep reads NO inventory audit rows (owner/admin only) ────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"c0c00000-0000-4000-8000-000000000002","role":"authenticated"}';
select is((select count(*) from public.audit_events where entity_type='inventory'),
  0::bigint, 'a sales_rep reads NO inventory audit rows (owner/admin only)');
-- ── 45. owner reads them ──────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"c0c00000-0000-4000-8000-000000000001","role":"authenticated"}';
select ok((select count(*) from public.audit_events where entity_type='inventory') > 0,
  'owner CAN read the tenant''s inventory audit rows');
-- ── 46. ownerB (other tenant) sees NONE of tenant C's inventory events ────
set local request.jwt.claims = '{"sub":"b0b00000-0000-4000-8000-000000000001","role":"authenticated"}';
select is((select count(*) from public.audit_events where tenant_id='33333333-3333-4333-8333-333333333333' and entity_type='inventory'),
  0::bigint, 'cross-tenant inventory events are invisible (tenant isolation)');

select finish();
rollback;
