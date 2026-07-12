-- ═══════════════════════════════════════════════════════════════════════
-- pgTAP — public.search_product_page_ids (M8F.2 product search + pagination)
--
-- Verifies the read-only, SECURITY INVOKER RPC:
--   • privilege matrix (authenticated only; PUBLIC/anon/service_role cannot);
--   • SECURITY INVOKER + RLS is the authorization boundary (tenant isolation;
--     an unauthorized tenant argument yields ZERO inaccessible rows);
--   • sales_rep visibility is not broadened; owner sees inactive too;
--   • complete search: product name / sku / barcode OR manufacturer name, with
--     direct-field-OR-manufacturer-field correctness (no product dropped);
--   • category / manufacturer / active / inactive / combined filters;
--   • exact count, page-size normalization, out-of-range page clamp,
--     zero-result metadata;
--   • COLLATE "C" ordering (mixed case, punctuation, Unicode, NULL/blank),
--     duplicate-SKU id tie-break, and no duplicate/skip across adjacent pages;
--   • no cross-tenant manufacturer JOIN leakage.
--
-- Run with the local stack up:  supabase test db
-- Creates disposable tenants B + C (with a fully-known product set) in THIS
-- transaction; everything rolls back. No tokens/secrets are printed.
-- ═══════════════════════════════════════════════════════════════════════
begin;
select plan(32);

-- ── Fixtures (as the transaction's superuser — RLS bypassed for setup) ──────
--   tenant C  33333333-…  a controlled product set; ownerC + repC members
--   tenant B  22222222-…  one product/brand; ownerB member (cross-tenant)
set local request.jwt.claims = '{"role":"service_role"}';

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

insert into public.categories (id, tenant_id, name_ar, name_he, name_en) values
  ('c2c00000-0000-4000-8000-000000000001', '33333333-3333-4333-8333-333333333333', 'ف1', 'ק1', 'C1'),
  ('c2c00000-0000-4000-8000-000000000002', '33333333-3333-4333-8333-333333333333', 'ف2', 'ק2', 'C2');

-- Brand whose NAME is in no product name (proves manufacturer-name search).
insert into public.manufacturers (id, tenant_id, name_ar, name_he, name_en) values
  ('c1c00000-0000-4000-8000-000000000001', '33333333-3333-4333-8333-333333333333', 'زيبرابراند', 'זברהמותג', 'ZebraBrand');

-- Controlled products in C. Columns: id, category, manufacturer, name_en, sku,
-- barcode, is_active. (chr(57344)=U+E000 high-BMP; chr(65536)=U+10000 astral.)
insert into public.products
  (id, tenant_id, category_id, manufacturer_id, name_ar, name_he, name_en, sku, barcode, is_active, wholesale_price)
values
  ('cbc00000-0000-4000-8000-000000000001', '33333333-3333-4333-8333-333333333333', 'c2c00000-0000-4000-8000-000000000001', 'c1c00000-0000-4000-8000-000000000001', 'تفاح', 'תפוח', 'Apple',  'C-APPLE', '111', true, 1),
  ('cbc00000-0000-4000-8000-000000000002', '33333333-3333-4333-8333-333333333333', 'c2c00000-0000-4000-8000-000000000001', null, 'موز', 'בננה', 'Banana', 'c-low', '222', true, 1),
  ('cbc00000-0000-4000-8000-000000000003', '33333333-3333-4333-8333-333333333333', 'c2c00000-0000-4000-8000-000000000002', null, 'كولا', 'קולה', 'Cola', 'C-A-C', null, true, 1),
  ('cbc00000-0000-4000-8000-000000000004', '33333333-3333-4333-8333-333333333333', 'c2c00000-0000-4000-8000-000000000002', null, 'دايت', 'דיאט', 'Diet', 'C-AB', null, true, 1),
  ('cbc00000-0000-4000-8000-000000000005', '33333333-3333-4333-8333-333333333333', 'c2c00000-0000-4000-8000-000000000001', null, 'بيض', 'ביצה', 'Egg', null, null, true, 1),
  ('cbc00000-0000-4000-8000-000000000006', '33333333-3333-4333-8333-333333333333', 'c2c00000-0000-4000-8000-000000000001', null, 'مجمد', 'קפוא', 'Frost', '   ', null, true, 1),
  -- Two DISTINCT raw SKUs that btrim to the SAME sort key "C-DUP" (the unique
  -- (tenant_id, sku) index forbids identical raw SKUs) → exercises the id
  -- tie-break AND btrim in the sort.
  ('cbc00000-0000-4000-8000-000000000007', '33333333-3333-4333-8333-333333333333', 'c2c00000-0000-4000-8000-000000000001', null, 'أ', 'א', 'DupOne', 'C-DUP', null, true, 1),
  ('cbc00000-0000-4000-8000-000000000008', '33333333-3333-4333-8333-333333333333', 'c2c00000-0000-4000-8000-000000000001', null, 'ب', 'ב', 'DupTwo', ' C-DUP', null, true, 1),
  ('cbc00000-0000-4000-8000-000000000009', '33333333-3333-4333-8333-333333333333', 'c2c00000-0000-4000-8000-000000000001', null, 'مخفي', 'מוסתר', 'Hidden', 'C-INACT', null, false, 1),
  ('cbc00000-0000-4000-8000-000000000010', '33333333-3333-4333-8333-333333333333', 'c2c00000-0000-4000-8000-000000000001', null, 'ي1', 'י1', 'UniBmp', chr(57344), null, true, 1),
  ('cbc00000-0000-4000-8000-000000000011', '33333333-3333-4333-8333-333333333333', 'c2c00000-0000-4000-8000-000000000001', null, 'ي2', 'י2', 'UniAstral', chr(65536), null, true, 1);

-- Tenant B: one product + brand (cross-tenant leakage fixtures).
insert into public.manufacturers (id, tenant_id, name_ar, name_he, name_en) values
  ('b1b00000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'ماركةب', 'מותגב', 'BrandB');
insert into public.products
  (id, tenant_id, manufacturer_id, name_ar, name_he, name_en, sku, wholesale_price)
values
  ('bcb00000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'b1b00000-0000-4000-8000-000000000001', 'منتجب', 'מוצרב', 'ProductB', 'B-SKU-1', 1);

-- ── 1. Function exists with the intended signature ─────────────────────────
select has_function('public', 'search_product_page_ids',
  array['uuid','text','uuid','uuid','text','integer','integer'],
  'search_product_page_ids(uuid,text,uuid,uuid,text,int,int) exists');

-- ── 2. SECURITY INVOKER (not DEFINER) ──────────────────────────────────────
select is(
  (select prosecdef from pg_proc where oid = 'public.search_product_page_ids(uuid,text,uuid,uuid,text,integer,integer)'::regprocedure),
  false, 'RPC is SECURITY INVOKER (prosecdef = false)');

-- ── 3–5. Privilege matrix ──────────────────────────────────────────────────
select ok(not has_function_privilege('public',       'public.search_product_page_ids(uuid,text,uuid,uuid,text,integer,integer)', 'EXECUTE'), 'PUBLIC cannot execute');
select ok(not has_function_privilege('anon',         'public.search_product_page_ids(uuid,text,uuid,uuid,text,integer,integer)', 'EXECUTE'), 'anon cannot execute');
select ok(    has_function_privilege('authenticated','public.search_product_page_ids(uuid,text,uuid,uuid,text,integer,integer)', 'EXECUTE'), 'authenticated CAN execute');
select ok(not has_function_privilege('service_role', 'public.search_product_page_ids(uuid,text,uuid,uuid,text,integer,integer)', 'EXECUTE'), 'service_role cannot execute (least privilege)');

-- ── Switch to an authenticated caller: ownerC ──────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"c0c00000-0000-4000-8000-000000000001","role":"authenticated"}';

-- ── 6. Tenant isolation: ownerC sees exactly tenant C (owner sees inactive) ─
select is((select total_count from public.search_product_page_ids('33333333-3333-4333-8333-333333333333','',null,null,'all',1,50)), 11::bigint, 'ownerC sees all 11 tenant-C products (incl. inactive)');

-- ── 7. Unauthorized tenant argument returns ZERO inaccessible rows (RLS) ────
select is((select total_count from public.search_product_page_ids('22222222-2222-4222-8222-222222222222','',null,null,'all',1,50)), 0::bigint, 'ownerC passing tenant B gets ZERO rows (RLS, not the arg, authorizes)');

-- (owner visibility incl. inactive is proven by the total of 11 above +
--  the active/inactive split below.)

-- ── 10. Zero-result metadata ───────────────────────────────────────────────
select is(
  (select total_count::int || '/' || page || '/' || total_pages || '/' || coalesce(array_length(product_ids,1),0)
   from public.search_product_page_ids('33333333-3333-4333-8333-333333333333','zzz-nomatch-xyz',null,null,'all',1,50)),
  '0/1/1/0', 'zero match → total 0, page 1, pages 1, empty ids');

-- ── 11. Exact count ────────────────────────────────────────────────────────
select is((select total_count from public.search_product_page_ids('33333333-3333-4333-8333-333333333333','',null,null,'all',1,5)), 11::bigint, 'exact count is independent of page size');

-- ── 12. Page-size normalization (bounded 1..100) ───────────────────────────
select is((select page_size from public.search_product_page_ids('33333333-3333-4333-8333-333333333333','',null,null,'all',1,999)), 100, 'page_size clamps to 100');
select is((select page_size from public.search_product_page_ids('33333333-3333-4333-8333-333333333333','',null,null,'all',1,0)), 1, 'page_size floors to 1');

-- ── 13. Out-of-range page clamps to the last page ──────────────────────────
select is(
  (select page || '/' || total_pages || '/' || coalesce(array_length(product_ids,1),0)
   from public.search_product_page_ids('33333333-3333-4333-8333-333333333333','',null,null,'all',99,5)),
  '3/3/1', '11 rows @ size 5 → page 99 clamps to 3 (1 row on last page)');

-- ── 14–16. Product-field search (name / sku / barcode) ─────────────────────
select is((select total_count from public.search_product_page_ids('33333333-3333-4333-8333-333333333333','Apple',null,null,'all',1,50)), 1::bigint, 'search by product name');
select is((select total_count from public.search_product_page_ids('33333333-3333-4333-8333-333333333333','C-APPLE',null,null,'all',1,50)), 1::bigint, 'search by SKU');
select is((select total_count from public.search_product_page_ids('33333333-3333-4333-8333-333333333333','111',null,null,'all',1,50)), 1::bigint, 'search by barcode');

-- ── 17. Manufacturer-name search (brand not in any product name) ───────────
select is((select product_ids from public.search_product_page_ids('33333333-3333-4333-8333-333333333333','Zebra',null,null,'all',1,50)), array['cbc00000-0000-4000-8000-000000000001']::uuid[], 'search by manufacturer name returns the brand''s product');

-- ── 18. direct-field OR manufacturer-field ─────────────────────────────────
-- Own-field match whose manufacturer does NOT contain the term is still returned…
select is((select total_count from public.search_product_page_ids('33333333-3333-4333-8333-333333333333','Banana',null,null,'all',1,50)), 1::bigint, 'own-name match kept even though its manufacturer is null/non-matching');
-- …and a manufacturer-only match (own fields do NOT contain the term) is included.
select ok((select 'cbc00000-0000-4000-8000-000000000001'::uuid = any(product_ids) from public.search_product_page_ids('33333333-3333-4333-8333-333333333333','ZebraBrand',null,null,'all',1,50)), 'manufacturer-only match included (own fields do not match)');

-- ── 19–22. Filters ─────────────────────────────────────────────────────────
select is((select total_count from public.search_product_page_ids('33333333-3333-4333-8333-333333333333','','c2c00000-0000-4000-8000-000000000002',null,'all',1,50)), 2::bigint, 'category filter (C2 = 2 products)');
select is((select total_count from public.search_product_page_ids('33333333-3333-4333-8333-333333333333','',null,'c1c00000-0000-4000-8000-000000000001','all',1,50)), 1::bigint, 'manufacturer filter (ZebraBrand = 1 product)');
select is((select total_count from public.search_product_page_ids('33333333-3333-4333-8333-333333333333','',null,null,'active',1,50)), 10::bigint, 'active filter');
select is((select total_count from public.search_product_page_ids('33333333-3333-4333-8333-333333333333','',null,null,'inactive',1,50)), 1::bigint, 'inactive filter');

-- ── 23. Combined filters (search + category + status) ──────────────────────
select is((select total_count from public.search_product_page_ids('33333333-3333-4333-8333-333333333333','Dup','c2c00000-0000-4000-8000-000000000001',null,'active',1,50)), 2::bigint, 'combined q=Dup + category C1 + active = 2');

-- ── 24–28. COLLATE "C" ordering (fetch the full ordered array once) ────────
-- Positions in the ordered product_ids array prove the sort contract.
select ok(
  (with r as (select product_ids as ids from public.search_product_page_ids('33333333-3333-4333-8333-333333333333','',null,null,'all',1,100))
   select array_position(ids,'cbc00000-0000-4000-8000-000000000009'::uuid) < array_position(ids,'cbc00000-0000-4000-8000-000000000002'::uuid) from r),
  'mixed case: uppercase "C-INACT" sorts before lowercase "c-low"');
select ok(
  (with r as (select product_ids as ids from public.search_product_page_ids('33333333-3333-4333-8333-333333333333','',null,null,'all',1,100))
   select array_position(ids,'cbc00000-0000-4000-8000-000000000003'::uuid) < array_position(ids,'cbc00000-0000-4000-8000-000000000004'::uuid) from r),
  'punctuation: "C-A-C" sorts before "C-AB" (hyphen < B)');
select ok(
  (with r as (select product_ids as ids from public.search_product_page_ids('33333333-3333-4333-8333-333333333333','',null,null,'all',1,100))
   select array_position(ids,'cbc00000-0000-4000-8000-000000000010'::uuid) < array_position(ids,'cbc00000-0000-4000-8000-000000000011'::uuid) from r),
  'Unicode: high-BMP (U+E000) sorts before astral (U+10000)');
select ok(
  (with r as (select product_ids as ids from public.search_product_page_ids('33333333-3333-4333-8333-333333333333','',null,null,'all',1,100))
   select array_position(ids,'cbc00000-0000-4000-8000-000000000005'::uuid) > array_position(ids,'cbc00000-0000-4000-8000-000000000011'::uuid)
      and array_position(ids,'cbc00000-0000-4000-8000-000000000006'::uuid) > array_position(ids,'cbc00000-0000-4000-8000-000000000011'::uuid) from r),
  'NULL + whitespace-only SKUs sort LAST (after every non-blank)');
select ok(
  (with r as (select product_ids as ids from public.search_product_page_ids('33333333-3333-4333-8333-333333333333','',null,null,'all',1,100))
   select array_position(ids,'cbc00000-0000-4000-8000-000000000007'::uuid) + 1 = array_position(ids,'cbc00000-0000-4000-8000-000000000008'::uuid) from r),
  'duplicate SKU "C-DUP" → adjacent, ordered by id (pc07 then pc08)');

-- ── 29. Two adjacent pages: no duplicate or skipped product ────────────────
select ok(
  (with p1 as (select product_ids as ids from public.search_product_page_ids('33333333-3333-4333-8333-333333333333','',null,null,'all',1,5)),
        p2 as (select product_ids as ids from public.search_product_page_ids('33333333-3333-4333-8333-333333333333','',null,null,'all',2,5))
   select (select array_length(ids,1) from p1) = 5
      and (select array_length(ids,1) from p2) = 5
      and not ((select ids from p1) && (select ids from p2))  -- disjoint (no overlap)
      and cardinality(array(
            select distinct u from unnest((select ids from p1) || (select ids from p2)) u
          )) = 10),
  'pages 1 and 2 (size 5) are disjoint and cover 10 distinct products');

-- ── 30. No cross-tenant manufacturer JOIN leakage ──────────────────────────
-- ownerC searching tenant B's brand name gets nothing (B's manufacturer + rows
-- are invisible to C under RLS; the JOIN cannot leak them).
select is((select total_count from public.search_product_page_ids('33333333-3333-4333-8333-333333333333','BrandB',null,null,'all',1,50)), 0::bigint, 'ownerC cannot find tenant B products via the brand JOIN');

-- ── 8. sales_rep visibility is not broadened ───────────────────────────────
set local request.jwt.claims = '{"sub":"c0c00000-0000-4000-8000-000000000002","role":"authenticated"}';
select is((select total_count from public.search_product_page_ids('33333333-3333-4333-8333-333333333333','',null,null,'all',1,50)), 11::bigint, 'repC (sales_rep) sees the SAME 11 tenant-C products (products are member-visible; not broadened)');

reset role;
select finish();
rollback;
