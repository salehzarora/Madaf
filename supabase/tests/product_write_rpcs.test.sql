-- ═══════════════════════════════════════════════════════════════════════
-- pgTAP — product WRITE RPCs: authorization + inventory-preservation
-- (PILOT-READINESS-BATCH-B · B1 backend authority + B2 inventory contract)
--
-- B1 (defense-in-depth): the new route-level role gate is UX/belt-and-braces;
--     the real authority is here — create_product / update_product /
--     upsert_inventory_item are owner/admin only. A sales_rep is denied
--     (errcode 42501 from authorize_tenant); a non-member (cross-tenant) too.
--
-- B2 (the fix's downstream contract): update_product runs the inventory upsert
--     ONLY when p_inventory is non-null. So the app omitting inventory on an
--     unrelated edit of an inventory-LESS product creates NO 0-stock row (which
--     would flip availability In-stock → Out-of-stock). Passing inventory still
--     creates/updates the row; a product that already tracks stock is preserved
--     when inventory is omitted, and an intentional zero-stock edit persists.
--
-- Run with the local stack up:  supabase test db
-- Creates disposable tenants C + B in THIS transaction; everything rolls back.
-- No tokens/secrets are printed.
-- ═══════════════════════════════════════════════════════════════════════
begin;
select plan(22);

-- ── Fixtures (as the transaction's superuser — RLS bypassed for setup) ──────
--   tenant C  33333333-…  ownerC + adminC + repC; P_NOINV (no inventory row),
--                          P_INV (inventory row @ qty 7)
--   tenant B  22222222-…  ownerB (cross-tenant non-member of C)
set local request.jwt.claims = '{"role":"service_role"}';

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
  ('c2c00000-0000-4000-8000-000000000001', '33333333-3333-4333-8333-333333333333', 'ف', 'ק', 'Cat');

-- P_NOINV: a product with NO inventory row (the B2 case → derives In-stock).
insert into public.products
  (id, tenant_id, category_id, name_ar, name_he, name_en, wholesale_price)
values
  ('cbc00000-0000-4000-8000-000000000001', '33333333-3333-4333-8333-333333333333',
   'c2c00000-0000-4000-8000-000000000001', 'أ', 'א', 'NoInv', 5);

-- P_INV: a product WITH an inventory row @ qty 7 (the preserve case).
insert into public.products
  (id, tenant_id, category_id, name_ar, name_he, name_en, wholesale_price)
values
  ('cbc00000-0000-4000-8000-000000000002', '33333333-3333-4333-8333-333333333333',
   'c2c00000-0000-4000-8000-000000000001', 'ب', 'ב', 'HasInv', 5);
insert into public.inventory_items
  (tenant_id, product_id, quantity_available, low_stock_threshold)
values
  ('33333333-3333-4333-8333-333333333333', 'cbc00000-0000-4000-8000-000000000002', 7, 10);

-- ── 1–3. Functions exist with the intended signatures ──────────────────────
select has_function('public', 'create_product', array['uuid','jsonb','jsonb'],
  'create_product(uuid,jsonb,jsonb) exists');
select has_function('public', 'update_product', array['uuid','uuid','jsonb','jsonb'],
  'update_product(uuid,uuid,jsonb,jsonb) exists');
select has_function('public', 'upsert_inventory_item', array['uuid','uuid','jsonb'],
  'upsert_inventory_item(uuid,uuid,jsonb) exists');

-- ── 4. SECURITY DEFINER (the RPC — not RLS — mediates the write) ────────────
select is(
  (select prosecdef from pg_proc where oid = 'public.update_product(uuid,uuid,jsonb,jsonb)'::regprocedure),
  true, 'update_product is SECURITY DEFINER');

-- ── 5–6. Privilege matrix (authenticated only; anon cannot) ────────────────
select ok(not has_function_privilege('anon',          'public.create_product(uuid,jsonb,jsonb)', 'EXECUTE'), 'anon cannot execute create_product');
select ok(    has_function_privilege('authenticated',  'public.create_product(uuid,jsonb,jsonb)', 'EXECUTE'), 'authenticated CAN execute create_product');

-- ── Switch to an authenticated caller: ownerC ──────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"c0c00000-0000-4000-8000-000000000001","role":"authenticated"}';

-- ── 7–9. B2: an unrelated edit (p_inventory NULL) of an inventory-LESS
-- product succeeds, creates NO inventory row, and DOES update the metadata ──
select lives_ok(
  $$ select public.update_product(
       '33333333-3333-4333-8333-333333333333',
       'cbc00000-0000-4000-8000-000000000001',
       jsonb_build_object('name_ar','أ','name_he','א','name_en','NoInvX',
         'category_id','c2c00000-0000-4000-8000-000000000001','wholesale_price',6),
       null) $$,
  'owner can update_product with p_inventory NULL (metadata-only edit)');
select is(
  (select count(*) from public.inventory_items where product_id = 'cbc00000-0000-4000-8000-000000000001'),
  0::bigint, 'B2: a NULL-inventory edit creates NO inventory row (stays In-stock)');
select is(
  (select name_en from public.products where id = 'cbc00000-0000-4000-8000-000000000001'),
  'NoInvX', 'the metadata edit itself DID persist (name updated)');

-- ── 10–11. Passing inventory DOES create the row (first-time stock entry) ───
select lives_ok(
  $$ select public.update_product(
       '33333333-3333-4333-8333-333333333333',
       'cbc00000-0000-4000-8000-000000000001',
       jsonb_build_object('name_ar','أ','name_he','א','name_en','NoInvX',
         'category_id','c2c00000-0000-4000-8000-000000000001','wholesale_price',6),
       jsonb_build_object('quantity_available',4,'low_stock_threshold',10)) $$,
  'owner can update_product WITH inventory (creates the row)');
select is(
  (select quantity_available from public.inventory_items where product_id = 'cbc00000-0000-4000-8000-000000000001'),
  4, 'explicit inventory input creates the row at the given quantity');

-- ── 12–13. Preserve: a NULL-inventory edit of a product that ALREADY tracks
-- stock leaves the existing row untouched ──────────────────────────────────
select lives_ok(
  $$ select public.update_product(
       '33333333-3333-4333-8333-333333333333',
       'cbc00000-0000-4000-8000-000000000002',
       jsonb_build_object('name_ar','ب','name_he','ב','name_en','HasInvX',
         'category_id','c2c00000-0000-4000-8000-000000000001','wholesale_price',6),
       null) $$,
  'owner update_product (p_inventory NULL) on a stock-tracked product');
select is(
  (select quantity_available from public.inventory_items where product_id = 'cbc00000-0000-4000-8000-000000000002'),
  7, 'preserve: the existing inventory row is untouched by a NULL-inventory edit');

-- ── 14–15. Intentional zero-stock edit persists (explicit qty 0) ───────────
select lives_ok(
  $$ select public.update_product(
       '33333333-3333-4333-8333-333333333333',
       'cbc00000-0000-4000-8000-000000000002',
       jsonb_build_object('name_ar','ب','name_he','ב','name_en','HasInvX',
         'category_id','c2c00000-0000-4000-8000-000000000001','wholesale_price',6),
       jsonb_build_object('quantity_available',0,'low_stock_threshold',10)) $$,
  'owner can set stock to 0 explicitly on a tracked product');
select is(
  (select quantity_available from public.inventory_items where product_id = 'cbc00000-0000-4000-8000-000000000002'),
  0, 'an intentional zero-stock edit persists (would derive Out-of-stock)');

-- ── 16–17. admin is also allowed (owner/admin, not just owner) ─────────────
set local request.jwt.claims = '{"sub":"c0c00000-0000-4000-8000-000000000003","role":"authenticated"}';
select lives_ok(
  $$ select public.update_product(
       '33333333-3333-4333-8333-333333333333',
       'cbc00000-0000-4000-8000-000000000002',
       jsonb_build_object('name_ar','ب','name_he','ב','name_en','HasInvX',
         'category_id','c2c00000-0000-4000-8000-000000000001','wholesale_price',6),
       null) $$,
  'admin can update_product');
select lives_ok(
  $$ select public.create_product(
       '33333333-3333-4333-8333-333333333333',
       jsonb_build_object('name_ar','ج','name_he','ג','name_en','AdminNew',
         'category_id','c2c00000-0000-4000-8000-000000000001','wholesale_price',3),
       null) $$,
  'admin can create_product');

-- ── 18–20. sales_rep is DENIED all three write RPCs (errcode 42501) ────────
set local request.jwt.claims = '{"sub":"c0c00000-0000-4000-8000-000000000002","role":"authenticated"}';
select throws_ok(
  $$ select public.create_product(
       '33333333-3333-4333-8333-333333333333',
       jsonb_build_object('name_ar','ر','name_he','ר','name_en','RepGhost',
         'category_id','c2c00000-0000-4000-8000-000000000001','wholesale_price',1),
       null) $$,
  '42501', NULL, 'sales_rep cannot create_product (authorize_tenant 42501)');
select throws_ok(
  $$ select public.update_product(
       '33333333-3333-4333-8333-333333333333',
       'cbc00000-0000-4000-8000-000000000001',
       jsonb_build_object('name_ar','أ','name_he','א','name_en','RepEdit',
         'category_id','c2c00000-0000-4000-8000-000000000001','wholesale_price',9),
       null) $$,
  '42501', NULL, 'sales_rep cannot update_product (authorize_tenant 42501)');
select throws_ok(
  $$ select public.upsert_inventory_item(
       '33333333-3333-4333-8333-333333333333',
       'cbc00000-0000-4000-8000-000000000002',
       jsonb_build_object('quantity_available',99,'low_stock_threshold',10)) $$,
  '42501', NULL, 'sales_rep cannot upsert_inventory_item (authorize_tenant 42501)');

-- ── 21. Cross-tenant: ownerB cannot update tenant C's product ──────────────
set local request.jwt.claims = '{"sub":"b0b00000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok(
  $$ select public.update_product(
       '33333333-3333-4333-8333-333333333333',
       'cbc00000-0000-4000-8000-000000000001',
       jsonb_build_object('name_ar','أ','name_he','א','name_en','Xtenant',
         'category_id','c2c00000-0000-4000-8000-000000000001','wholesale_price',9),
       null) $$,
  '42501', NULL, 'a non-member of tenant C cannot update_product (42501)');

-- ── 22. Integrity: no stray inventory rows from any blocked/again op ────────
-- (Only P_NOINV [row from test 10] and P_INV [seeded] exist; the sales_rep
--  upsert and every metadata-only edit added none.)
reset role;
select is(
  (select count(*) from public.inventory_items where tenant_id = '33333333-3333-4333-8333-333333333333'),
  2::bigint, 'tenant C has exactly 2 inventory rows (no stray rows created)');

select finish();
rollback;
