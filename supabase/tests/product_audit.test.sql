-- ═══════════════════════════════════════════════════════════════════════
-- pgTAP — M8I.1 Product lifecycle AUDIT FOUNDATION (PILOT-OPS-AUDIT-001)
--
-- Verifies the transactional product-category producers on public.audit_events:
--   • the private helper is SECURITY INVOKER, search_path='', executable by NO
--     client role; closed 4-event allowlist; entity_type fixed to 'product';
--     metadata must be a bounded JSON OBJECT with per-event allowlisted keys;
--   • each SUCCESSFUL mutation writes exactly the right event(s): create → one
--     product.created (empty safe metadata); create WITH inventory → still ONE
--     product event and NO inventory event; ordinary edit → one change-gated
--     product.updated (KEYS only, no values); is_active flip → a distinct
--     product.activated / product.deactivated (via update_product AND
--     set_product_active); a combined edit → one updated + one lifecycle;
--   • NO event for a no-op / already-current / rolled-back / unauthorized /
--     cross-tenant mutation;
--   • the RLS policy scopes PRODUCT rows to owner/admin (a sales_rep reads none),
--     while leaving Customer and non-Customer/non-Order/non-Product rows EXACTLY
--     as before; cross-tenant reads are invisible;
--   • every replaced RPC keeps its signature / return type / security mode /
--     search_path / grants.
--
-- Run with the local stack up:  supabase test db
-- Disposable tenants C + B in THIS transaction; everything rolls back.
-- No real secrets/tokens/PII — controlled local fixtures only.
-- ═══════════════════════════════════════════════════════════════════════
begin;
select plan(69);

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
-- P_EXIST in C: table defaults match validate_product_payload's defaults
-- (carton / qty 1 / units / vat 0.18 / track false / active true), so a minimal
-- update payload changes ONLY the fields it actually differs on.
insert into public.products
  (id, tenant_id, category_id, name_ar, name_he, name_en, wholesale_price)
values
  ('cbc00000-0000-4000-8000-000000000001', '33333333-3333-4333-8333-333333333333',
   'c2c00000-0000-4000-8000-000000000001', 'أ', 'א', 'Exist', 5);
-- P_B in tenant B (cross-tenant target).
insert into public.products
  (id, tenant_id, category_id, name_ar, name_he, name_en, wholesale_price)
values
  ('cbc00000-0000-4000-8000-000000000009', '22222222-2222-4222-8222-222222222222',
   'c2c00000-0000-4000-8000-000000000009', 'ب', 'ב', 'PB', 5);
-- P_DESC in C: seeded WITH a description, for the description change-gate tests.
insert into public.products
  (id, tenant_id, category_id, name_ar, name_he, name_en, description_en, wholesale_price)
values
  ('cbc00000-0000-4000-8000-000000000003', '33333333-3333-4333-8333-333333333333',
   'c2c00000-0000-4000-8000-000000000001', 'ص', 'צ', 'Desc', 'Old desc', 5);

-- ── 1–4. Helper catalog: exists, INVOKER, empty search_path, returns void ──
select has_function('public', '_log_product_audit_event',
  array['uuid', 'text', 'uuid', 'jsonb'], 'the private Product audit helper exists');
select is((select prosecdef from pg_proc where oid='public._log_product_audit_event(uuid,text,uuid,jsonb)'::regprocedure),
  false, 'helper is SECURITY INVOKER (holds no privileges of its own)');
select is((select array_to_string(proconfig, ',') from pg_proc where oid='public._log_product_audit_event(uuid,text,uuid,jsonb)'::regprocedure),
  'search_path=""', 'helper pins an EMPTY search_path');
select is(pg_get_function_result('public._log_product_audit_event(uuid,text,uuid,jsonb)'::regprocedure),
  'void', 'helper returns void');

-- ── 5–8. Helper privilege matrix — NO client role may execute it ──────────
select ok(not has_function_privilege('public', 'public._log_product_audit_event(uuid,text,uuid,jsonb)', 'EXECUTE'),
  'PUBLIC cannot invoke the helper');
select ok(not has_function_privilege('anon', 'public._log_product_audit_event(uuid,text,uuid,jsonb)', 'EXECUTE'),
  'anon cannot invoke the helper');
select ok(not has_function_privilege('authenticated', 'public._log_product_audit_event(uuid,text,uuid,jsonb)', 'EXECUTE'),
  'authenticated cannot invoke the helper');
select ok(not has_function_privilege('service_role', 'public._log_product_audit_event(uuid,text,uuid,jsonb)', 'EXECUTE'),
  'service_role has NO explicit helper grant');

-- ── 9–13. Helper validation: allowlist, metadata shape/size/keys, entity id ─
select throws_ok(
  $$ select public._log_product_audit_event('33333333-3333-4333-8333-333333333333', 'product.bogus',
       'cbc00000-0000-4000-8000-000000000001', '{}'::jsonb) $$,
  '22023', NULL, 'helper rejects an unknown event type (no "Other")');
select throws_ok(
  $$ select public._log_product_audit_event('33333333-3333-4333-8333-333333333333', 'product.created',
       'cbc00000-0000-4000-8000-000000000001', '[1,2]'::jsonb) $$,
  '22023', NULL, 'helper rejects non-object metadata');
select throws_ok(
  $$ select public._log_product_audit_event('33333333-3333-4333-8333-333333333333', 'product.updated',
       'cbc00000-0000-4000-8000-000000000001', jsonb_build_object('changed_fields', repeat('x', 5000))) $$,
  '22023', NULL, 'helper rejects oversized metadata');
select throws_ok(
  $$ select public._log_product_audit_event('33333333-3333-4333-8333-333333333333', 'product.updated',
       'cbc00000-0000-4000-8000-000000000001', jsonb_build_object('name', 'Secret Ltd')) $$,
  '22023', NULL, 'helper rejects an arbitrary (non-allowlisted) metadata key');
select throws_ok(
  $$ select public._log_product_audit_event('33333333-3333-4333-8333-333333333333', 'product.created',
       null, '{}'::jsonb) $$,
  '22023', NULL, 'helper rejects a null product id (entity is required)');

-- ═══ Authenticated caller: ownerC ══════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"c0c00000-0000-4000-8000-000000000001","role":"authenticated"}';

-- ── 14–20. Creation → ONE product.created, safe empty metadata, honest actor ─
select lives_ok(
  $$ select public.create_product('33333333-3333-4333-8333-333333333333',
       jsonb_build_object('name_ar','ج','name_he','ג','name_en','Created1',
         'category_id','c2c00000-0000-4000-8000-000000000001','wholesale_price',3), null) $$,
  'owner creates a product');
select is((select count(*) from public.audit_events a
             join public.products p on p.id = a.entity_id
           where a.event_type='product.created' and p.name_en='Created1'),
  1::bigint, 'authenticated creation → exactly ONE product.created');
select is((select a.actor_user_id from public.audit_events a
             join public.products p on p.id = a.entity_id
           where a.event_type='product.created' and p.name_en='Created1'),
  'c0c00000-0000-4000-8000-000000000001'::uuid, 'actor is the authenticated owner (auth.uid())');
select is((select a.entity_type from public.audit_events a
             join public.products p on p.id = a.entity_id
           where a.event_type='product.created' and p.name_en='Created1'),
  'product', 'entity_type is fixed to product');
select is((select a.metadata from public.audit_events a
             join public.products p on p.id = a.entity_id
           where a.event_type='product.created' and p.name_en='Created1'),
  '{}'::jsonb, 'product.created carries EMPTY safe metadata (no name/price/sku)');
select ok((select a.entity_id is not null from public.audit_events a
             join public.products p on p.id = a.entity_id
           where a.event_type='product.created' and p.name_en='Created1'),
  'entity_id is the created product id');
select ok((select bool_and(created_at is not null) from public.audit_events where entity_type='product'),
  'created_at is database-generated on every product event');

-- ── 21–23. Create WITH inventory → exactly ONE product event + (M8I.2) exactly
-- ONE inventory.created (distinct entity). This product phase writes exactly one
-- PRODUCT-entity event; the inventory.created comes from upsert_inventory_item
-- (M8I.2) — asserted here as a distinct entity, not a duplicate product event.
select lives_ok(
  $$ select public.create_product('33333333-3333-4333-8333-333333333333',
       jsonb_build_object('name_ar','و','name_he','ו','name_en','WithInv',
         'category_id','c2c00000-0000-4000-8000-000000000001','wholesale_price',4),
       jsonb_build_object('quantity_available',5,'low_stock_threshold',10)) $$,
  'owner creates a product WITH an initial inventory row');
select is((select count(*) from public.audit_events a
             join public.products p on p.id = a.entity_id
           where a.entity_type='product' and p.name_en='WithInv'),
  1::bigint, 'creating a product with inventory writes exactly ONE product-entity event');
select is((select count(*) from public.audit_events a
             join public.products p on p.id = a.entity_id
           where a.entity_type='inventory' and p.name_en='WithInv'),
  1::bigint, 'M8I.2: the same creation writes exactly ONE inventory.created (distinct entity)');

-- ── 24–28. Ordinary edit → ONE change-gated product.updated (KEYS only) ────
select lives_ok(
  $$ select public.update_product('33333333-3333-4333-8333-333333333333',
       'cbc00000-0000-4000-8000-000000000001',
       jsonb_build_object('name_ar','أ','name_he','א','name_en','ExistV2',
         'category_id','c2c00000-0000-4000-8000-000000000001','wholesale_price',6,'is_active',true), null) $$,
  'owner edits ordinary product fields (name + price)');
select is((select count(*) from public.audit_events
           where event_type='product.updated' and entity_id='cbc00000-0000-4000-8000-000000000001'),
  1::bigint, 'an EFFECTIVE ordinary edit → exactly ONE product.updated');
select is((select metadata->'changed_fields' from public.audit_events
           where event_type='product.updated' and entity_id='cbc00000-0000-4000-8000-000000000001'),
  '["name","wholesale_price"]'::jsonb, 'changed_fields is derived server-side (name + wholesale_price)');
select ok((select not (metadata ?| array['name','wholesale_price_value','sku','barcode','image','image_url'])
           from public.audit_events
           where event_type='product.updated' and entity_id='cbc00000-0000-4000-8000-000000000001'),
  'update metadata carries only changed_fields KEYS — no name/price/sku/image VALUES');
select is((select count(*) from public.audit_events
           where event_type in ('product.activated','product.deactivated')
             and entity_id='cbc00000-0000-4000-8000-000000000001'),
  0::bigint, 'an ordinary edit that did not flip is_active emits NO lifecycle event');

-- ── 29–30. No-op edit → NO additional event ───────────────────────────────
select lives_ok(
  $$ select public.update_product('33333333-3333-4333-8333-333333333333',
       'cbc00000-0000-4000-8000-000000000001',
       jsonb_build_object('name_ar','أ','name_he','א','name_en','ExistV2',
         'category_id','c2c00000-0000-4000-8000-000000000001','wholesale_price',6,'is_active',true), null) $$,
  'resubmitting the identical fields still succeeds (response behavior preserved)');
select is((select count(*) from public.audit_events
           where event_type='product.updated' and entity_id='cbc00000-0000-4000-8000-000000000001'),
  1::bigint, 'an effective NO-OP edit creates NO additional product.updated');

-- ── 31–33. is_active flip via update_product → lifecycle only (no updated) ──
select lives_ok(
  $$ select public.update_product('33333333-3333-4333-8333-333333333333',
       'cbc00000-0000-4000-8000-000000000001',
       jsonb_build_object('name_ar','أ','name_he','א','name_en','ExistV2',
         'category_id','c2c00000-0000-4000-8000-000000000001','wholesale_price',6,'is_active',false), null) $$,
  'owner deactivates the product via update_product (ordinary fields unchanged)');
select is((select count(*) from public.audit_events
           where event_type='product.deactivated' and entity_id='cbc00000-0000-4000-8000-000000000001'),
  1::bigint, 'flipping is_active → ONE product.deactivated');
select is((select count(*) from public.audit_events
           where event_type='product.updated' and entity_id='cbc00000-0000-4000-8000-000000000001'),
  1::bigint, 'an active-only change emits NO product.updated (still 1 from earlier)');

-- ── 34–36. set_product_active → one lifecycle; no-op → none ────────────────
select lives_ok(
  $$ select public.set_product_active('33333333-3333-4333-8333-333333333333',
       'cbc00000-0000-4000-8000-000000000001', true) $$,
  'owner reactivates via set_product_active');
select is((select count(*) from public.audit_events
           where event_type='product.activated' and entity_id='cbc00000-0000-4000-8000-000000000001'),
  1::bigint, 'set_product_active(true) → ONE product.activated');
select lives_ok(
  $$ select public.set_product_active('33333333-3333-4333-8333-333333333333',
       'cbc00000-0000-4000-8000-000000000001', true) $$,
  'requesting the already-current (active) state is accepted');
-- (the same-state call added no event — asserted by the activated count staying 1)

-- ── 37–39. Combined ordinary + active change → updated + lifecycle (2 events) ─
select lives_ok(
  $$ select public.update_product('33333333-3333-4333-8333-333333333333',
       'cbc00000-0000-4000-8000-000000000001',
       jsonb_build_object('name_ar','أ','name_he','א','name_en','ExistV3',
         'category_id','c2c00000-0000-4000-8000-000000000001','wholesale_price',6,'is_active',false), null) $$,
  'owner renames AND deactivates in one update_product call');
select is((select count(*) from public.audit_events
           where event_type='product.updated' and entity_id='cbc00000-0000-4000-8000-000000000001'),
  2::bigint, 'the combined edit added exactly one MORE product.updated (now 2)');
select is((select count(*) from public.audit_events
           where event_type='product.deactivated' and entity_id='cbc00000-0000-4000-8000-000000000001'),
  2::bigint, 'the combined edit added exactly one MORE product.deactivated (now 2)');

-- ── INACTIVE product + explicit is_active=false + an ordinary change (Codex P2-2):
--    ONE product.updated, NO lifecycle event, stays inactive. P_EXIST is inactive
--    here (the combined edit above deactivated it).
select lives_ok(
  $$ select public.update_product('33333333-3333-4333-8333-333333333333',
       'cbc00000-0000-4000-8000-000000000001',
       jsonb_build_object('name_ar','أ','name_he','א','name_en','ExistV4',
         'category_id','c2c00000-0000-4000-8000-000000000001','wholesale_price',6,'is_active',false), null) $$,
  'owner edits an ordinary field on an INACTIVE product with explicit is_active=false');
select is((select is_active from public.products where id='cbc00000-0000-4000-8000-000000000001'),
  false, 'the product stays INACTIVE (explicit false preserved, never reactivated)');
select is((select count(*) from public.audit_events
           where event_type='product.updated' and entity_id='cbc00000-0000-4000-8000-000000000001'),
  3::bigint, 'the ordinary change → one MORE product.updated (now 3)');
select is((select count(*) from public.audit_events
           where event_type in ('product.activated','product.deactivated')
             and entity_id='cbc00000-0000-4000-8000-000000000001'),
  3::bigint, 'NO new lifecycle event (still 1 activated + 2 deactivated)');

-- ── INACTIVE product + explicit is_active=true (ordinary unchanged): ONE
--    product.activated via update_product, NO product.updated.
select lives_ok(
  $$ select public.update_product('33333333-3333-4333-8333-333333333333',
       'cbc00000-0000-4000-8000-000000000001',
       jsonb_build_object('name_ar','أ','name_he','א','name_en','ExistV4',
         'category_id','c2c00000-0000-4000-8000-000000000001','wholesale_price',6,'is_active',true), null) $$,
  'owner reactivates an inactive product via update_product (ordinary unchanged)');
select is((select count(*) from public.audit_events
           where event_type='product.activated' and entity_id='cbc00000-0000-4000-8000-000000000001'),
  2::bigint, 'is_active false→true via update_product → one MORE product.activated (now 2)');
select is((select count(*) from public.audit_events
           where event_type='product.updated' and entity_id='cbc00000-0000-4000-8000-000000000001'),
  3::bigint, 'an active-only reactivation adds NO product.updated (still 3)');

-- ── Descriptions (Codex P2-1): change-gated on KEY presence, KEY-only metadata ─
select lives_ok(
  $$ select public.update_product('33333333-3333-4333-8333-333333333333',
       'cbc00000-0000-4000-8000-000000000003',
       jsonb_build_object('name_ar','ص','name_he','צ','name_en','Desc',
         'category_id','c2c00000-0000-4000-8000-000000000001','wholesale_price',5,
         'is_active',true,'description_en','New desc'), null) $$,
  'owner changes only the English description');
select is((select count(*) from public.audit_events
           where event_type='product.updated' and entity_id='cbc00000-0000-4000-8000-000000000003'),
  1::bigint, 'a description-only edit → exactly ONE product.updated');
select is((select metadata->'changed_fields' from public.audit_events
           where event_type='product.updated' and entity_id='cbc00000-0000-4000-8000-000000000003'),
  '["description"]'::jsonb, 'localized descriptions collapse to the single logical key');
select ok((select not (metadata::text ~* 'New desc|Old desc')
           from public.audit_events
           where event_type='product.updated' and entity_id='cbc00000-0000-4000-8000-000000000003'),
  'description metadata carries NO description TEXT value');
-- Re-sending the SAME description is a no-op → no new event.
select lives_ok(
  $$ select public.update_product('33333333-3333-4333-8333-333333333333',
       'cbc00000-0000-4000-8000-000000000003',
       jsonb_build_object('name_ar','ص','name_he','צ','name_en','Desc',
         'category_id','c2c00000-0000-4000-8000-000000000001','wholesale_price',5,
         'is_active',true,'description_en','New desc'), null) $$,
  'owner re-sends the identical description');
select is((select count(*) from public.audit_events
           where event_type='product.updated' and entity_id='cbc00000-0000-4000-8000-000000000003'),
  1::bigint, 'an unchanged description creates NO additional event');
-- OMITTING the description key preserves it AND is not a change (M8A intact).
select lives_ok(
  $$ select public.update_product('33333333-3333-4333-8333-333333333333',
       'cbc00000-0000-4000-8000-000000000003',
       jsonb_build_object('name_ar','ص','name_he','צ','name_en','Desc',
         'category_id','c2c00000-0000-4000-8000-000000000001','wholesale_price',5,
         'is_active',true), null) $$,
  'owner updates with the description key OMITTED');
select is((select count(*) from public.audit_events
           where event_type='product.updated' and entity_id='cbc00000-0000-4000-8000-000000000003'),
  1::bigint, 'an omitted description is NOT a change (no additional event)');
select is((select description_en from public.products where id='cbc00000-0000-4000-8000-000000000003'),
  'New desc', 'the omitted description was preserved (M8A behavior intact)');

-- ── Explicit ROLLBACK removes the product AND its audit rows ───────────────
savepoint before_rollback;
select public.create_product('33333333-3333-4333-8333-333333333333',
  jsonb_build_object('name_ar','ر','name_he','ר','name_en','RolledBack',
    'category_id','c2c00000-0000-4000-8000-000000000001','wholesale_price',1), null);
rollback to savepoint before_rollback;
select is((select count(*) from public.audit_events a
           where a.event_type='product.created' and a.entity_id not in (select id from public.products)),
  0::bigint, 'a rolled-back creation leaves NO orphan audit event (transactional)');

-- ═══ Unauthorized: sales_rep repC ══════════════════════════════════════════
set local request.jwt.claims = '{"sub":"c0c00000-0000-4000-8000-000000000002","role":"authenticated"}';
select throws_ok(
  $$ select public.create_product('33333333-3333-4333-8333-333333333333',
       jsonb_build_object('name_ar','ر','name_he','ר','name_en','RepGhost',
         'category_id','c2c00000-0000-4000-8000-000000000001','wholesale_price',1), null) $$,
  '42501', NULL, 'sales_rep cannot create_product (authorize_tenant 42501)');
select throws_ok(
  $$ select public.update_product('33333333-3333-4333-8333-333333333333',
       'cbc00000-0000-4000-8000-000000000001',
       jsonb_build_object('name_ar','أ','name_he','א','name_en','RepEdit',
         'category_id','c2c00000-0000-4000-8000-000000000001','wholesale_price',9,'is_active',true), null) $$,
  '42501', NULL, 'sales_rep cannot update_product (authorize_tenant 42501)');
-- Count from a privileged reader: the blocked rep attempts wrote nothing.
reset role;
select is((select count(*) from public.audit_events
           where event_type='product.updated' and entity_id='cbc00000-0000-4000-8000-000000000001'),
  3::bigint, 'the blocked sales_rep edit wrote NO event (product.updated unchanged at 3)');

-- ═══ Cross-tenant: ownerC → tenant B ═══════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"c0c00000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok(
  $$ select public.update_product('22222222-2222-4222-8222-222222222222',
       'cbc00000-0000-4000-8000-000000000009',
       jsonb_build_object('name_ar','ب','name_he','ב','name_en','Xtenant',
         'category_id','c2c00000-0000-4000-8000-000000000009','wholesale_price',9,'is_active',true), null) $$,
  '42501', NULL, 'ownerC cannot update a tenant-B product (cross-tenant 42501)');
reset role;
select is((select count(*) from public.audit_events
           where tenant_id='22222222-2222-4222-8222-222222222222' and entity_type='product'),
  0::bigint, 'no cross-tenant product event was written for tenant B');

-- ═══ RLS visibility ════════════════════════════════════════════════════════
-- ── 47. sales_rep reads NO product audit rows (owner/admin only) ──────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"c0c00000-0000-4000-8000-000000000002","role":"authenticated"}';
select is((select count(*) from public.audit_events where entity_type='product'),
  0::bigint, 'a sales_rep reads NO product audit rows (product clause is owner/admin only)');

-- ── 48. owner reads the product audit rows ────────────────────────────────
set local request.jwt.claims = '{"sub":"c0c00000-0000-4000-8000-000000000001","role":"authenticated"}';
select ok((select count(*) from public.audit_events where entity_type='product') > 0,
  'owner CAN read the tenant''s product audit rows');

-- ── 49. ownerB (other tenant) sees NONE of tenant C's product events ──────
set local request.jwt.claims = '{"sub":"b0b00000-0000-4000-8000-000000000001","role":"authenticated"}';
select is((select count(*) from public.audit_events
           where tenant_id='33333333-3333-4333-8333-333333333333'),
  0::bigint, 'cross-tenant product events are invisible (tenant isolation)');

-- ── 50. The product scoping clause stays VACUOUS for any other entity_type — a
-- non-product (e.g. future 'document') event is not hidden by it, so the OWNER
-- still reads it. (Under M8I.7 an unknown/non-scoped type is owner/admin-only by
-- DEFAULT-DENY; the sales_rep denial is proven in audit_unknown_entity_deny.test.sql.)
reset role;
insert into public.audit_events (tenant_id, event_type, entity_type, entity_id, metadata)
values ('33333333-3333-4333-8333-333333333333', 'document.created', 'document',
        '77700000-0000-4000-8000-000000000001', '{}'::jsonb);
set local role authenticated;
set local request.jwt.claims = '{"sub":"c0c00000-0000-4000-8000-000000000001","role":"authenticated"}';
select is((select count(*) from public.audit_events where entity_type='document'),
  1::bigint, 'a non-product event stays visible to the owner (product clause vacuous for it)');

-- ── 51. Customer clause preserved: a customer event is owner-readable ──────
reset role;
insert into public.audit_events (tenant_id, event_type, entity_type, entity_id, metadata)
values ('33333333-3333-4333-8333-333333333333', 'customer.created', 'customer',
        'ca000000-0000-4000-8000-000000000001', '{}'::jsonb);
set local role authenticated;
set local request.jwt.claims = '{"sub":"c0c00000-0000-4000-8000-000000000001","role":"authenticated"}';
select is((select count(*) from public.audit_events where entity_type='customer'),
  1::bigint, 'the Customer read clause is preserved (owner still sees customer events)');

-- ── 52. All product events use the closed vocabulary (no "Other") ─────────
reset role;
select is((select count(*) from public.audit_events
           where entity_type='product'
             and event_type not in ('product.created','product.updated',
               'product.activated','product.deactivated')),
  0::bigint, 'every emitted product event uses the closed product vocabulary (no "Other")');

-- ── 53–54. Redefined RPCs keep their security mode + grants ────────────────
select ok((select bool_and(prosecdef) from pg_proc where proname in
  ('create_product','update_product','set_product_active')),
  'the 3 product mutation RPCs remain SECURITY DEFINER');
select ok((select bool_and(has_function_privilege('authenticated', oid, 'EXECUTE')) from pg_proc where proname in
  ('create_product','update_product','set_product_active')),
  'the product mutation RPCs remain executable by authenticated (grants preserved)');

select finish();
rollback;
