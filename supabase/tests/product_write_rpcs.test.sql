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
select plan(38);

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

-- P_ZERO + P_THRESH: inventory-less products used to prove EXPLICIT tracking
-- intent (P2) — turning tracking on with quantity 0 / a threshold-only edit.
insert into public.products
  (id, tenant_id, category_id, name_ar, name_he, name_en, wholesale_price)
values
  ('cbc00000-0000-4000-8000-000000000003', '33333333-3333-4333-8333-333333333333',
   'c2c00000-0000-4000-8000-000000000001', 'ج', 'ג', 'Zero', 5),
  ('cbc00000-0000-4000-8000-000000000004', '33333333-3333-4333-8333-333333333333',
   'c2c00000-0000-4000-8000-000000000001', 'د', 'ד', 'Thresh', 5),
  ('cbc00000-0000-4000-8000-000000000005', '33333333-3333-4333-8333-333333333333',
   'c2c00000-0000-4000-8000-000000000001', 'ه', 'ה', 'Loc', 5),
  ('cbc00000-0000-4000-8000-000000000006', '33333333-3333-4333-8333-333333333333',
   'c2c00000-0000-4000-8000-000000000001', 'و', 'ו', 'Exp', 5);

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

-- ── 14–15. QUANTITY INTEGRITY (M8I.2): a tracked product's quantity is
-- PRESERVED by a Product-form/upsert edit — it is changed only through the
-- stock-adjustment ledger, so a submitted quantity here is safely ignored while
-- the configuration edit still succeeds. (Pre-M8I.2 this SET the quantity; the
-- quantity change now lives on /admin/inventory adjustments.)
select lives_ok(
  $$ select public.update_product(
       '33333333-3333-4333-8333-333333333333',
       'cbc00000-0000-4000-8000-000000000002',
       jsonb_build_object('name_ar','ب','name_he','ב','name_en','HasInvX',
         'category_id','c2c00000-0000-4000-8000-000000000001','wholesale_price',6),
       jsonb_build_object('quantity_available',0,'low_stock_threshold',10)) $$,
  'owner edits a tracked product with a submitted quantity (config edit succeeds)');
select is(
  (select quantity_available from public.inventory_items where product_id = 'cbc00000-0000-4000-8000-000000000002'),
  7, 'the tracked quantity is PRESERVED (still 7) — a submitted 0 never overwrites the ledger balance');

-- ── P2: EXPLICIT tracking-ON with quantity 0 creates a zero-stock row ──────
-- The form's "Track inventory" toggle → p_inventory {quantity 0}. A row is
-- created at 0 (→ Out-of-stock), proving intentional zero is honoured (not
-- discarded like the old value-based heuristic did).
select lives_ok(
  $$ select public.update_product(
       '33333333-3333-4333-8333-333333333333',
       'cbc00000-0000-4000-8000-000000000003',
       jsonb_build_object('name_ar','ج','name_he','ג','name_en','Zero',
         'category_id','c2c00000-0000-4000-8000-000000000001','wholesale_price',5),
       jsonb_build_object('quantity_available',0,'low_stock_threshold',10)) $$,
  'tracking ON with quantity 0 succeeds (intentional zero)');
select is(
  (select quantity_available from public.inventory_items where product_id = 'cbc00000-0000-4000-8000-000000000003'),
  0, 'tracking-on-zero creates a row at quantity 0 (→ Out-of-stock)');

-- ── P2: threshold-only intent (quantity 0, a chosen threshold) persists ────
select lives_ok(
  $$ select public.update_product(
       '33333333-3333-4333-8333-333333333333',
       'cbc00000-0000-4000-8000-000000000004',
       jsonb_build_object('name_ar','د','name_he','ד','name_en','Thresh',
         'category_id','c2c00000-0000-4000-8000-000000000001','wholesale_price',5),
       jsonb_build_object('quantity_available',0,'low_stock_threshold',7)) $$,
  'tracking ON with a threshold-only edit succeeds');
select is(
  (select quantity_available from public.inventory_items where product_id = 'cbc00000-0000-4000-8000-000000000004'),
  0, 'threshold-only intent still records quantity 0');
select is(
  (select low_stock_threshold from public.inventory_items where product_id = 'cbc00000-0000-4000-8000-000000000004'),
  7, 'threshold-only intent persists the chosen threshold');

-- ── P2: malformed inventory is rejected by the RPC (server authority) ──────
-- Covers negative quantity, out-of-range quantity, over-long location and a
-- malformed date — the values a forged client could send past the UI.
select throws_ok(
  $$ select public.update_product(
       '33333333-3333-4333-8333-333333333333',
       'cbc00000-0000-4000-8000-000000000003',
       jsonb_build_object('name_ar','ج','name_he','ג','name_en','Zero',
         'category_id','c2c00000-0000-4000-8000-000000000001','wholesale_price',5),
       jsonb_build_object('quantity_available',-1,'low_stock_threshold',10)) $$,
  '22023', NULL, 'a negative quantity is rejected (upsert_inventory_item validation)');
select throws_ok(
  $$ select public.update_product(
       '33333333-3333-4333-8333-333333333333',
       'cbc00000-0000-4000-8000-000000000003',
       jsonb_build_object('name_ar','ج','name_he','ג','name_en','Zero',
         'category_id','c2c00000-0000-4000-8000-000000000001','wholesale_price',5),
       jsonb_build_object('quantity_available',0,'low_stock_threshold',-1)) $$,
  '22023', NULL, 'a negative low_stock_threshold is rejected (validation)');
select throws_ok(
  $$ select public.update_product(
       '33333333-3333-4333-8333-333333333333',
       'cbc00000-0000-4000-8000-000000000003',
       jsonb_build_object('name_ar','ج','name_he','ג','name_en','Zero',
         'category_id','c2c00000-0000-4000-8000-000000000001','wholesale_price',5),
       jsonb_build_object('quantity_available',200000000,'low_stock_threshold',10)) $$,
  '22023', NULL, 'an out-of-range quantity (> 1e8) is rejected (validation)');
select throws_ok(
  $$ select public.update_product(
       '33333333-3333-4333-8333-333333333333',
       'cbc00000-0000-4000-8000-000000000003',
       jsonb_build_object('name_ar','ج','name_he','ג','name_en','Zero',
         'category_id','c2c00000-0000-4000-8000-000000000001','wholesale_price',5),
       jsonb_build_object('quantity_available',0,'warehouse_location',repeat('x',41))) $$,
  '22023', NULL, 'an over-long warehouse_location (> 40 chars) is rejected');
select throws_ok(
  $$ select public.update_product(
       '33333333-3333-4333-8333-333333333333',
       'cbc00000-0000-4000-8000-000000000003',
       jsonb_build_object('name_ar','ج','name_he','ג','name_en','Zero',
         'category_id','c2c00000-0000-4000-8000-000000000001','wholesale_price',5),
       jsonb_build_object('quantity_available',0,'expiry_date','not-a-date')) $$,
  NULL, NULL, 'a malformed expiry_date is rejected (date cast fails)');

-- ── P2: location-only tracking intent (quantity 0 + a warehouse location) ──
select lives_ok(
  $$ select public.update_product(
       '33333333-3333-4333-8333-333333333333',
       'cbc00000-0000-4000-8000-000000000005',
       jsonb_build_object('name_ar','ه','name_he','ה','name_en','Loc',
         'category_id','c2c00000-0000-4000-8000-000000000001','wholesale_price',5),
       jsonb_build_object('quantity_available',0,'warehouse_location','A-9')) $$,
  'tracking ON with a location-only edit succeeds');
select is(
  (select warehouse_location from public.inventory_items where product_id = 'cbc00000-0000-4000-8000-000000000005'),
  'A-9', 'location-only intent creates a row and persists the location (quantity 0)');

-- ── P2: expiry-only tracking intent (quantity 0 + a nearest expiry date) ───
select lives_ok(
  $$ select public.update_product(
       '33333333-3333-4333-8333-333333333333',
       'cbc00000-0000-4000-8000-000000000006',
       jsonb_build_object('name_ar','و','name_he','ו','name_en','Exp',
         'category_id','c2c00000-0000-4000-8000-000000000001','wholesale_price',5),
       jsonb_build_object('quantity_available',0,'expiry_date','2027-01-15')) $$,
  'tracking ON with an expiry-only edit succeeds');
select is(
  (select expiry_date from public.inventory_items where product_id = 'cbc00000-0000-4000-8000-000000000006'),
  '2027-01-15'::date, 'expiry-only intent creates a row and persists the expiry (quantity 0)');

-- ── P2: a threshold-only change on an EXISTING inventory row updates it ─────
select lives_ok(
  $$ select public.update_product(
       '33333333-3333-4333-8333-333333333333',
       'cbc00000-0000-4000-8000-000000000002',
       jsonb_build_object('name_ar','ب','name_he','ב','name_en','HasInvX',
         'category_id','c2c00000-0000-4000-8000-000000000001','wholesale_price',6),
       jsonb_build_object('quantity_available',0,'low_stock_threshold',3)) $$,
  'owner updates only the threshold on an already-tracked product');
select is(
  (select low_stock_threshold from public.inventory_items where product_id = 'cbc00000-0000-4000-8000-000000000002'),
  3, 'the threshold change persists on the existing row');

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

-- ── Integrity: no stray inventory rows from any blocked/malformed op ────────
-- Exactly six rows exist: P_NOINV (explicit inventory edit), P_INV (seeded),
-- P_ZERO + P_THRESH + P_LOC + P_EXP (tracking-on). The sales_rep upsert, the
-- cross-tenant attempt, the malformed payloads and every metadata-only edit
-- added none.
reset role;
select is(
  (select count(*) from public.inventory_items where tenant_id = '33333333-3333-4333-8333-333333333333'),
  6::bigint, 'tenant C has exactly 6 inventory rows (no stray rows created)');

select finish();
rollback;
