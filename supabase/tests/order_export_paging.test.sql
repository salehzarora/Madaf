-- ═══════════════════════════════════════════════════════════════════════
-- pgTAP — Orders CSV export paging (PILOT-READINESS-BATCH-A / P1)
--
-- The P1 defect: the export issued ONE `.range(0, 5000)` PostgREST request,
-- which the HTTP layer silently clamps to `max_rows` (1000), so a tenant with
-- >1000 matching orders received a CSV of only the 1000 newest — presented as
-- complete, because the truncation check compared against 5000.
--
-- The fix pages the filtered set server-side in ≤500-row batches (below the
-- ceiling) and dedupes by id. PostgREST's `max_rows` is an HTTP-layer clamp that
-- pgTAP (talking straight to Postgres) does not see, so this suite proves the
-- DB-LAYER half of the contract that collectExportRows relies on:
--   • the SAME `created_at DESC, id DESC` ordering the list/export use retrieves
--     ALL 1001 rows of a large tenant across 3 batches (500 + 500 + 1);
--   • paging is DISTINCT (no duplicate id) and COMPLETE (no skipped id);
--   • tenant scope holds on every batch (a second tenant's rows never appear).
-- The JS half — that every request stays ≤ ORDERS_EXPORT_BATCH so the clamp can
-- never fire, plus the cap/dedupe algorithm — is covered by the injected-reader
-- unit tests in src/lib/orders-query.test.ts (the SAME production function).
--
-- Run with the local stack up:  supabase test db
-- Disposable tenants X (1001 orders) + Y (1 order) in THIS transaction; rolls back.
-- ═══════════════════════════════════════════════════════════════════════
begin;
select plan(8);

set local request.jwt.claims = '{"role":"service_role"}';

insert into auth.users (id, email) values
  ('a1a00000-0000-4000-8000-000000000001', 'owner-x@madaf.test'),
  ('b1b00000-0000-4000-8000-000000000001', 'owner-y@madaf.test');
insert into public.tenants (id, name_ar, name_he, name_en) values
  ('a1111111-1111-4111-8111-111111111111', 'إكس', 'איקס', 'X'),
  ('b2222222-2222-4222-8222-222222222222', 'واي', 'וואי', 'Y');
insert into public.tenant_users (tenant_id, user_id, role) values
  ('a1111111-1111-4111-8111-111111111111', 'a1a00000-0000-4000-8000-000000000001', 'owner'),
  ('b2222222-2222-4222-8222-222222222222', 'b1b00000-0000-4000-8000-000000000001', 'owner');

-- 1001 orders for tenant X — more than PostgREST max_rows (1000). Distinct
-- created_at (one minute apart) so the DESC ordering is total and the id
-- tie-break is exercised too. order_number is unique per tenant (required).
insert into public.orders (tenant_id, order_number, public_ref, status, source, created_at)
select
  'a1111111-1111-4111-8111-111111111111',
  'X-' || lpad(g::text, 5, '0'),
  'MDF-X' || lpad(g::text, 5, '0'),
  'new',
  'sales_visit',
  timestamptz '2026-06-01T00:00:00Z' + (g || ' minutes')::interval
from generate_series(1, 1001) as g;

-- One order for tenant Y (isolation control).
insert into public.orders (tenant_id, order_number, public_ref, status, source, created_at) values
  ('b2222222-2222-4222-8222-222222222222', 'Y-1', 'MDF-Y1', 'new', 'sales_visit', '2026-06-01T00:00:00Z');

-- ── 1. The tenant genuinely has more rows than the server ceiling ──────────
select is(
  (select count(*)::int from public.orders
     where tenant_id = 'a1111111-1111-4111-8111-111111111111'),
  1001, 'tenant X has 1001 orders (> PostgREST max_rows of 1000)');

-- ── 2–4. Batched paging (created_at DESC, id DESC) across 3 batches ────────
-- Each batch mirrors the production ORDER BY + LIMIT/OFFSET the export issues.
create temporary table export_pages (batch int, ord int, id uuid) on commit drop;
insert into export_pages (batch, ord, id)
select 1, row_number() over (order by created_at desc, id desc), id
  from public.orders
 where tenant_id = 'a1111111-1111-4111-8111-111111111111'
 order by created_at desc, id desc limit 500 offset 0;
insert into export_pages (batch, ord, id)
select 2, 500 + row_number() over (order by created_at desc, id desc), id
  from public.orders
 where tenant_id = 'a1111111-1111-4111-8111-111111111111'
 order by created_at desc, id desc limit 500 offset 500;
insert into export_pages (batch, ord, id)
select 3, 1000 + row_number() over (order by created_at desc, id desc), id
  from public.orders
 where tenant_id = 'a1111111-1111-4111-8111-111111111111'
 order by created_at desc, id desc limit 500 offset 1000;

select is((select count(*)::int from export_pages), 1001,
  'three ≤500 batches together retrieve ALL 1001 rows (nothing truncated)');
select is((select count(distinct id)::int from export_pages), 1001,
  'every retrieved row is DISTINCT — no duplicate across batch boundaries');
select is((select count(*)::int from export_pages where batch = 3), 1,
  'the third batch carries exactly the final 1 row (the cap-probe boundary)');

-- ── 5. No skipped id: the paged set equals the full tenant set ─────────────
select ok(
  not exists (
    select 1 from public.orders o
     where o.tenant_id = 'a1111111-1111-4111-8111-111111111111'
       and o.id not in (select id from export_pages)),
  'no order id is skipped — the paged union equals the full tenant set');

-- ── 6. Global DESC order is preserved across the batch seams ───────────────
select is(
  (select bool_and(a.created_at >= b.created_at)
     from export_pages ep
     join public.orders a on a.id = ep.id
     join export_pages ep2 on ep2.ord = ep.ord + 1
     join public.orders b on b.id = ep2.id),
  true, 'created_at is non-increasing across the whole paged sequence (seams included)');

-- ── 7. Tenant isolation holds on the paged set (no tenant-Y row leaks) ─────
select is(
  (select count(*)::int from export_pages ep
     join public.orders o on o.id = ep.id
    where o.tenant_id <> 'a1111111-1111-4111-8111-111111111111'),
  0, 'no cross-tenant row appears in tenant X''s export paging');

-- ── 8. RLS still scopes the same query for a real member (owner X) ─────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"a1a00000-0000-4000-8000-000000000001","role":"authenticated"}';
select is(
  (select count(*)::int from public.orders
     where tenant_id = 'a1111111-1111-4111-8111-111111111111'),
  1001, 'owner X reads all 1001 of its own orders under RLS (export scope intact)');

select finish();
rollback;
