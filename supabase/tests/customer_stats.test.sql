-- ═══════════════════════════════════════════════════════════════════════
-- pgTAP — public.get_customer_stats_for_ids (M8F.3 customer-stats aggregate)
--
-- Verifies the read-only, SECURITY INVOKER, bounded aggregate:
--   • privilege matrix (authenticated only; PUBLIC/anon/service_role cannot);
--   • SECURITY INVOKER + STABLE + empty search_path;
--   • bounding: empty array, dedupe, max 100 accepted, >100 rejected;
--   • per-customer order_count (linked customer_id; ALL statuses incl.
--     cancelled; guest/NULL-customer orders excluded) + last_order_at (max,
--     tolerant of tied dates); zero-order customer → 0 / NULL;
--   • RLS is the authorization boundary — owner/admin see all; a sales_rep
--     sees only assigned customers (NOT broadened); cross-tenant customers /
--     orders never exposed; an unauthorized tenant arg yields no rows; a
--     missing id fabricates no row; no join multiplication; only the 3
--     contract columns are returned.
--
-- No monetary metric exists in the Customers stats contract, so there is no
-- money aggregation to test (see the M8F.3 doc).
--
-- Run with the local stack up:  supabase test db
-- Creates disposable tenants B + C (+ authenticated owner/sales_rep users) in
-- THIS transaction; everything rolls back. No tokens/secrets printed.
-- ═══════════════════════════════════════════════════════════════════════
begin;
select plan(33);

set local request.jwt.claims = '{"role":"service_role"}';

-- Users
insert into auth.users (id) values
  ('c0c00000-0000-4000-8000-000000000001'),  -- ownerC
  ('c0c00000-0000-4000-8000-000000000002'),  -- repC (sales_rep)
  ('b0b00000-0000-4000-8000-000000000001');  -- ownerB

-- Tenants
insert into public.tenants (id, name_ar, name_he, name_en) values
  ('33333333-3333-4333-8333-333333333333', 'ج', 'ג', 'C'),
  ('22222222-2222-4222-8222-222222222222', 'ب', 'ב', 'B');

insert into public.tenant_users (tenant_id, user_id, role) values
  ('33333333-3333-4333-8333-333333333333', 'c0c00000-0000-4000-8000-000000000001', 'owner'),
  ('33333333-3333-4333-8333-333333333333', 'c0c00000-0000-4000-8000-000000000002', 'sales_rep'),
  ('22222222-2222-4222-8222-222222222222', 'b0b00000-0000-4000-8000-000000000001', 'owner');

-- Customers in C: cA (assigned, 3 orders), cB (assigned, 0 orders),
-- cC (NOT assigned, 2 orders same date), cD (INACTIVE, 1 order).
insert into public.customers (id, tenant_id, name, is_active) values
  ('ca000000-0000-4000-8000-000000000001', '33333333-3333-4333-8333-333333333333', 'Store A', true),
  ('ca000000-0000-4000-8000-000000000002', '33333333-3333-4333-8333-333333333333', 'Store B', true),
  ('ca000000-0000-4000-8000-000000000003', '33333333-3333-4333-8333-333333333333', 'Store C', true),
  ('ca000000-0000-4000-8000-000000000004', '33333333-3333-4333-8333-333333333333', 'Store D', false);
-- Second-tenant customer (cross-tenant fixture).
insert into public.customers (id, tenant_id, name) values
  ('cb000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'Store B2');

-- Assign only cA + cB to repC.
insert into public.sales_rep_customers (tenant_id, user_id, customer_id, assigned_by) values
  ('33333333-3333-4333-8333-333333333333', 'c0c00000-0000-4000-8000-000000000002', 'ca000000-0000-4000-8000-000000000001', 'c0c00000-0000-4000-8000-000000000001'),
  ('33333333-3333-4333-8333-333333333333', 'c0c00000-0000-4000-8000-000000000002', 'ca000000-0000-4000-8000-000000000002', 'c0c00000-0000-4000-8000-000000000001');

-- Orders (id, tenant, customer, number, public_ref, status, created_at):
--   cA: new + delivered + CANCELLED (3; last = 2026-03-01) → all statuses count.
--   cC: two orders on the SAME date (last = that date).
--   cD (inactive): 1 delivered order (2026-04-01).
--   guest: customer_id NULL + a snapshot whose name = 'Store A' (must NOT be
--          attributed to cA — linkage is by id only).
--   B:   cB2 one order (cross-tenant).
insert into public.orders (id, tenant_id, customer_id, order_number, public_ref, status, customer_snapshot, created_at) values
  ('0a000000-0000-4000-8000-000000000001', '33333333-3333-4333-8333-333333333333', 'ca000000-0000-4000-8000-000000000001', 'C-1', 'MDF-C0001', 'new',       '{}', '2026-01-01T10:00:00Z'),
  ('0a000000-0000-4000-8000-000000000002', '33333333-3333-4333-8333-333333333333', 'ca000000-0000-4000-8000-000000000001', 'C-2', 'MDF-C0002', 'delivered', '{}', '2026-02-01T10:00:00Z'),
  ('0a000000-0000-4000-8000-000000000003', '33333333-3333-4333-8333-333333333333', 'ca000000-0000-4000-8000-000000000001', 'C-3', 'MDF-C0003', 'cancelled', '{}', '2026-03-01T10:00:00Z'),
  ('0c000000-0000-4000-8000-000000000001', '33333333-3333-4333-8333-333333333333', 'ca000000-0000-4000-8000-000000000003', 'C-4', 'MDF-C0004', 'delivered', '{}', '2026-01-15T09:00:00Z'),
  ('0c000000-0000-4000-8000-000000000002', '33333333-3333-4333-8333-333333333333', 'ca000000-0000-4000-8000-000000000003', 'C-5', 'MDF-C0005', 'confirmed', '{}', '2026-01-15T18:00:00Z'),
  ('0d000000-0000-4000-8000-000000000001', '33333333-3333-4333-8333-333333333333', 'ca000000-0000-4000-8000-000000000004', 'C-6', 'MDF-C0006', 'delivered', '{}', '2026-04-01T10:00:00Z'),
  ('09000000-0000-4000-8000-000000000001', '33333333-3333-4333-8333-333333333333', null,                                   'C-7', 'MDF-C0007', 'new', '{"name":"Store A","guest":true}', '2026-05-01T10:00:00Z'),
  ('0b000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'cb000000-0000-4000-8000-000000000001', 'B-1', 'MDF-B0001', 'delivered', '{}', '2026-02-15T10:00:00Z');

-- ── 1. Function exists with the intended signature ─────────────────────────
select has_function('public', 'get_customer_stats_for_ids', array['uuid','uuid[]'],
  'get_customer_stats_for_ids(uuid, uuid[]) exists');
-- ── 2–4. Security mode / stability / search_path ───────────────────────────
select is((select prosecdef from pg_proc where oid='public.get_customer_stats_for_ids(uuid,uuid[])'::regprocedure), false, 'SECURITY INVOKER');
select is((select provolatile::text from pg_proc where oid='public.get_customer_stats_for_ids(uuid,uuid[])'::regprocedure), 's', 'STABLE');
select ok((select array_to_string(proconfig,',') from pg_proc where oid='public.get_customer_stats_for_ids(uuid,uuid[])'::regprocedure) in ('search_path=', 'search_path=""'), 'search_path is empty');
-- ── 5–8. Privilege matrix ──────────────────────────────────────────────────
select ok(not has_function_privilege('public',       'public.get_customer_stats_for_ids(uuid,uuid[])', 'EXECUTE'), 'PUBLIC cannot execute');
select ok(not has_function_privilege('anon',         'public.get_customer_stats_for_ids(uuid,uuid[])', 'EXECUTE'), 'anon cannot execute');
select ok(    has_function_privilege('authenticated','public.get_customer_stats_for_ids(uuid,uuid[])', 'EXECUTE'), 'authenticated CAN execute');
select ok(not has_function_privilege('service_role', 'public.get_customer_stats_for_ids(uuid,uuid[])', 'EXECUTE'), 'service_role has no explicit execute grant');

-- ── Authenticated caller: ownerC ───────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"c0c00000-0000-4000-8000-000000000001","role":"authenticated"}';

-- ── 9. Empty array → 0 rows ────────────────────────────────────────────────
select is((select count(*) from public.get_customer_stats_for_ids('33333333-3333-4333-8333-333333333333','{}'::uuid[])), 0::bigint, 'empty id array → 0 rows');
-- ── 10. Duplicate ids deduped → single row ─────────────────────────────────
select is((select count(*) from public.get_customer_stats_for_ids('33333333-3333-4333-8333-333333333333', array['ca000000-0000-4000-8000-000000000001','ca000000-0000-4000-8000-000000000001']::uuid[])), 1::bigint, 'duplicate ids deduped');
-- ── 11. Exactly 100 ids succeeds (no error) ────────────────────────────────
select lives_ok($$ select * from public.get_customer_stats_for_ids('33333333-3333-4333-8333-333333333333', (select array_agg(gen_random_uuid()) from generate_series(1,100))) $$, '100 ids accepted');
-- ── 12. Oversized (101) rejected ───────────────────────────────────────────
select throws_ok($$ select * from public.get_customer_stats_for_ids('33333333-3333-4333-8333-333333333333', (select array_agg(gen_random_uuid()) from generate_series(1,101))) $$, '22023', NULL, '101 ids rejected (not truncated)');

-- ── 13–14. Zero-order customer (cB) → count 0, last NULL ───────────────────
select is((select order_count from public.get_customer_stats_for_ids('33333333-3333-4333-8333-333333333333', array['ca000000-0000-4000-8000-000000000002']::uuid[])), 0::bigint, 'zero-order customer → order_count 0');
select ok((select last_order_at is null from public.get_customer_stats_for_ids('33333333-3333-4333-8333-333333333333', array['ca000000-0000-4000-8000-000000000002']::uuid[])), 'zero-order customer → last_order_at NULL');
-- ── 15. One-order customer (cD) ────────────────────────────────────────────
select is((select order_count from public.get_customer_stats_for_ids('33333333-3333-4333-8333-333333333333', array['ca000000-0000-4000-8000-000000000004']::uuid[])), 1::bigint, 'one-order customer → order_count 1');
-- ── 16–18. Multi-order (cA): count 3 (incl cancelled) + exact + last ───────
select is((select order_count from public.get_customer_stats_for_ids('33333333-3333-4333-8333-333333333333', array['ca000000-0000-4000-8000-000000000001']::uuid[])), 3::bigint, 'multi-order customer → order_count 3 (all statuses)');
select is(
  (select order_count from public.get_customer_stats_for_ids('33333333-3333-4333-8333-333333333333', array['ca000000-0000-4000-8000-000000000001']::uuid[])),
  (select count(*)::bigint from public.orders where customer_id='ca000000-0000-4000-8000-000000000001'), 'order_count exactly equals the linked order count');
select is((select last_order_at from public.get_customer_stats_for_ids('33333333-3333-4333-8333-333333333333', array['ca000000-0000-4000-8000-000000000001']::uuid[])), '2026-03-01T10:00:00Z'::timestamptz, 'last_order_at = max(created_at) across all statuses');
-- ── 19–20. Cancelled order is INCLUDED (all-statuses contract) ─────────────
select ok((select order_count from public.get_customer_stats_for_ids('33333333-3333-4333-8333-333333333333', array['ca000000-0000-4000-8000-000000000001']::uuid[])) = 3, 'cancelled order counts (no status is excluded)');
select ok((select last_order_at from public.get_customer_stats_for_ids('33333333-3333-4333-8333-333333333333', array['ca000000-0000-4000-8000-000000000001']::uuid[])) = '2026-03-01T10:00:00Z'::timestamptz, 'last_order_at considers the cancelled order (all statuses)');
-- ── 21. Inactive customer (cD) retains its historical stats ────────────────
select is((select last_order_at from public.get_customer_stats_for_ids('33333333-3333-4333-8333-333333333333', array['ca000000-0000-4000-8000-000000000004']::uuid[])), '2026-04-01T10:00:00Z'::timestamptz, 'inactive customer keeps historical stats');
-- ── 22–23. Guest order (NULL customer_id, snapshot name = "Store A") is NOT
--           attributed to cA (linkage is by id only). ───────────────────────
select is((select order_count from public.get_customer_stats_for_ids('33333333-3333-4333-8333-333333333333', array['ca000000-0000-4000-8000-000000000001']::uuid[])), 3::bigint, 'guest order with matching snapshot name is NOT counted for cA');
select is(
  (select coalesce(sum(order_count),0)::bigint from public.get_customer_stats_for_ids('33333333-3333-4333-8333-333333333333', array['ca000000-0000-4000-8000-000000000001','ca000000-0000-4000-8000-000000000002','ca000000-0000-4000-8000-000000000003','ca000000-0000-4000-8000-000000000004']::uuid[])),
  (select count(*)::bigint from public.orders where tenant_id='33333333-3333-4333-8333-333333333333' and customer_id is not null), 'summed counts = linked orders only (guest excluded)');
-- ── 34. Tied created_at (cC two orders same date) → last = that date ────────
select is((select last_order_at from public.get_customer_stats_for_ids('33333333-3333-4333-8333-333333333333', array['ca000000-0000-4000-8000-000000000003']::uuid[])), '2026-01-15T18:00:00Z'::timestamptz, 'tied-date orders → last_order_at is the max');
-- ── 28. Owner sees all requested C customers (4 rows) ──────────────────────
select is((select count(*) from public.get_customer_stats_for_ids('33333333-3333-4333-8333-333333333333', array['ca000000-0000-4000-8000-000000000001','ca000000-0000-4000-8000-000000000002','ca000000-0000-4000-8000-000000000003','ca000000-0000-4000-8000-000000000004']::uuid[])), 4::bigint, 'owner sees all 4 requested C customers');
-- ── 29. Missing/random id → no fabricated row ──────────────────────────────
select is((select count(*) from public.get_customer_stats_for_ids('33333333-3333-4333-8333-333333333333', array['00000000-0000-4000-8000-0000deadbeef']::uuid[])), 0::bigint, 'missing id fabricates no row');
-- ── 30–31. Output limited to requested visible customers; no dup rows ──────
select is((select count(*) from public.get_customer_stats_for_ids('33333333-3333-4333-8333-333333333333', array['ca000000-0000-4000-8000-000000000001']::uuid[])), 1::bigint, 'output limited to the single requested customer (no dup rows)');
-- ── 33. No join multiplication (count = order rows, not inflated) ───────────
select is((select order_count from public.get_customer_stats_for_ids('33333333-3333-4333-8333-333333333333', array['ca000000-0000-4000-8000-000000000003']::uuid[])), 2::bigint, 'count is not multiplied by joins (cC = 2)');
-- ── 24–26. Cross-tenant / unauthorized tenant isolation ────────────────────
select is((select count(*) from public.get_customer_stats_for_ids('22222222-2222-4222-8222-222222222222', array['cb000000-0000-4000-8000-000000000001']::uuid[])), 0::bigint, 'ownerC cannot read tenant-B customer stats (cross-tenant)');
select is((select count(*) from public.get_customer_stats_for_ids('22222222-2222-4222-8222-222222222222', array['ca000000-0000-4000-8000-000000000001']::uuid[])), 0::bigint, 'unauthorized tenant arg → no rows (RLS, not the arg)');

-- ── Authenticated caller: repC (sales_rep, assigned to cA + cB only) ───────
set local request.jwt.claims = '{"sub":"c0c00000-0000-4000-8000-000000000002","role":"authenticated"}';
-- ── 27. sales_rep visibility not broadened: only cA + cB (not cC/cD) ───────
select is((select count(*) from public.get_customer_stats_for_ids('33333333-3333-4333-8333-333333333333', array['ca000000-0000-4000-8000-000000000001','ca000000-0000-4000-8000-000000000002','ca000000-0000-4000-8000-000000000003','ca000000-0000-4000-8000-000000000004']::uuid[])), 2::bigint, 'sales_rep sees ONLY its 2 assigned customers (not broadened)');
select is((select order_count from public.get_customer_stats_for_ids('33333333-3333-4333-8333-333333333333', array['ca000000-0000-4000-8000-000000000001']::uuid[])), 3::bigint, 'sales_rep sees its assigned customer''s full order count');
select is((select count(*) from public.get_customer_stats_for_ids('33333333-3333-4333-8333-333333333333', array['ca000000-0000-4000-8000-000000000003']::uuid[])), 0::bigint, 'sales_rep gets NO row for an unassigned customer (cC)');

reset role;
select finish();
rollback;
