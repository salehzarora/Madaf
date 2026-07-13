-- ═══════════════════════════════════════════════════════════════════════
-- pgTAP — M8G.3 Customer Timeline INDEX + read-path contract
--
-- The M8G.3 migration adds ONE additive covering index for the bounded,
-- entity-scoped Customer Timeline read:
--   audit_events (tenant_id, entity_type, entity_id, created_at DESC, id DESC)
--
-- Verifies:
--   • the index exists with EXACTLY those columns + DESC ordering (btree);
--   • it is ADDITIVE — the M8G.2 indexes, RLS policy, append-only client grants,
--     the private helper's SECURITY INVOKER + no-client-EXECUTE, and all eight
--     producer RPCs' SECURITY DEFINER + grants are untouched;
--   • the exact timeline query the app runs is served by the index with NO Sort
--     node (the DESC,DESC key order matches ORDER BY created_at DESC, id DESC);
--   • the row-value keyset ((created_at, id) < cursor) paginates with no overlap
--     and no skip, and tie-breaks equal timestamps by id DESC;
--   • the M8G.2/M4D read scoping still holds WITH the index present — a sales_rep
--     reads only ASSIGNED customers' events, an owner sees tenant-wide, and
--     cross-tenant reads return nothing.
--
-- Run with the local stack up:  supabase test db
-- Disposable tenants C + B in THIS transaction; everything rolls back.
-- ═══════════════════════════════════════════════════════════════════════
begin;
select plan(22);

set local request.jwt.claims = '{"role":"service_role"}';

-- Users / tenants / membership (owner + assigned rep + admin in C; owner in B).
insert into auth.users (id) values
  ('c0c00000-0000-4000-8000-000000000001'),  -- ownerC
  ('c0c00000-0000-4000-8000-000000000002'),  -- repC (sales_rep, assigned to ca…01)
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
-- ca…01 assigned to repC; ca…02 UNASSIGNED (same tenant); cb…01 in tenant B.
insert into public.customers (id, tenant_id, name, customer_type, phone, origin, is_active) values
  ('ca000000-0000-4000-8000-000000000001', '33333333-3333-4333-8333-333333333333', 'Store C1', 'grocery', '050-1', 'manual', true),
  ('ca000000-0000-4000-8000-000000000002', '33333333-3333-4333-8333-333333333333', 'Store C2', 'grocery', '050-2', 'manual', true),
  ('cb000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'Store B1', 'grocery', '050-9', 'manual', true);
insert into public.sales_rep_customers (tenant_id, user_id, customer_id, assigned_by) values
  ('33333333-3333-4333-8333-333333333333', 'c0c00000-0000-4000-8000-000000000002',
   'ca000000-0000-4000-8000-000000000001', 'c0c00000-0000-4000-8000-000000000001');

-- Seed audit rows directly (service_role bypasses the append-only client grant).
-- Six events for the ASSIGNED customer, inserted in chronological order so id
-- ascends with created_at — EXCEPT seq 3 & 4 SHARE a timestamp (id 4 later →
-- higher) to exercise the (created_at, id) tie-break. Plus one row each for the
-- unassigned C customer and the tenant-B customer (for the read-scope checks).
insert into public.audit_events (tenant_id, actor_user_id, event_type, entity_type, entity_id, metadata, created_at) values
  ('33333333-3333-4333-8333-333333333333', 'c0c00000-0000-4000-8000-000000000001', 'customer.updated', 'customer', 'ca000000-0000-4000-8000-000000000001', '{"seq":1}', '2026-06-01T00:00:00Z'),
  ('33333333-3333-4333-8333-333333333333', 'c0c00000-0000-4000-8000-000000000001', 'customer.updated', 'customer', 'ca000000-0000-4000-8000-000000000001', '{"seq":2}', '2026-06-02T00:00:00Z'),
  ('33333333-3333-4333-8333-333333333333', 'c0c00000-0000-4000-8000-000000000001', 'customer.updated', 'customer', 'ca000000-0000-4000-8000-000000000001', '{"seq":3}', '2026-06-03T00:00:00Z'),
  ('33333333-3333-4333-8333-333333333333', 'c0c00000-0000-4000-8000-000000000001', 'customer.updated', 'customer', 'ca000000-0000-4000-8000-000000000001', '{"seq":4}', '2026-06-03T00:00:00Z'),
  ('33333333-3333-4333-8333-333333333333', 'c0c00000-0000-4000-8000-000000000001', 'customer.updated', 'customer', 'ca000000-0000-4000-8000-000000000001', '{"seq":5}', '2026-06-04T00:00:00Z'),
  ('33333333-3333-4333-8333-333333333333', 'c0c00000-0000-4000-8000-000000000001', 'customer.updated', 'customer', 'ca000000-0000-4000-8000-000000000001', '{"seq":6}', '2026-06-05T00:00:00Z'),
  ('33333333-3333-4333-8333-333333333333', 'c0c00000-0000-4000-8000-000000000001', 'customer.updated', 'customer', 'ca000000-0000-4000-8000-000000000002', '{"seq":99}', '2026-06-06T00:00:00Z'),
  ('22222222-2222-4222-8222-222222222222', 'b0b00000-0000-4000-8000-000000000001', 'customer.updated', 'customer', 'cb000000-0000-4000-8000-000000000001', '{"seq":98}', '2026-06-07T00:00:00Z');

-- ── 1–3. The index exists with EXACTLY the intended shape ──────────────────
select has_index('public', 'audit_events', 'audit_events_customer_timeline_idx',
  'the M8G.3 customer-timeline index exists on audit_events');
select index_is_type('public', 'audit_events', 'audit_events_customer_timeline_idx', 'btree',
  'the timeline index is a btree');
select matches(
  (select pg_get_indexdef('public.audit_events_customer_timeline_idx'::regclass)),
  '\(tenant_id, entity_type, entity_id, created_at DESC, id DESC\)',
  'the index covers (tenant_id, entity_type, entity_id, created_at DESC, id DESC) in order');

-- ── 4–5. The M8G.2 indexes are PRESERVED (additive, not replaced) ──────────
select has_index('public', 'audit_events', 'audit_events_tenant_created_idx',
  'M8G.2 (tenant_id, created_at DESC) index is preserved');
select has_index('public', 'audit_events', 'audit_events_actor_idx',
  'M8G.2 (actor_user_id) index is preserved');

-- ── 6–7. RLS + the read policy are untouched ───────────────────────────────
select is(
  (select relrowsecurity from pg_class where oid = 'public.audit_events'::regclass),
  true, 'row-level security is still enabled on audit_events');
-- M8H.1 renamed the policy when it AND-ed on an Order clause. What must remain
-- true is the CUSTOMER scoping — assert the clause itself, not just the name.
select isnt_empty(
  $$ select 1 from pg_policies where tablename='audit_events'
     and cmd = 'SELECT'
     and qual like '%can_access_customer(tenant_id, entity_id)%' $$,
  'the customer-scoped audit SELECT rule is still present (M8G.2 preserved)');

-- ── 8–9. audit_events stays append-only for clients (grants untouched) ─────
select ok(not has_table_privilege('authenticated', 'public.audit_events', 'INSERT'),
  'authenticated still cannot INSERT audit_events (append-only for clients)');
select ok(not has_table_privilege('authenticated', 'public.audit_events', 'UPDATE'),
  'authenticated still cannot UPDATE audit_events');

-- ── 10–11. The private producer helper is untouched (invoker + no EXECUTE) ──
select ok(not has_function_privilege('authenticated',
  'public._log_customer_audit_event(uuid,text,uuid,jsonb)', 'EXECUTE'),
  'authenticated still cannot invoke the private audit helper');
select is(
  (select prosecdef from pg_proc where oid='public._log_customer_audit_event(uuid,text,uuid,jsonb)'::regprocedure),
  false, 'the private helper is still SECURITY INVOKER');

-- ── 12–13. All eight producers are untouched (DEFINER + grants) ────────────
select ok((select bool_and(prosecdef) from pg_proc where proname in
  ('create_customer','update_customer','set_customer_active','approve_customer_signup_request',
   'create_customer_from_order','link_order_to_customer','replace_customer_access_link','revoke_customer_access_link')),
  'every audit producer RPC is still SECURITY DEFINER');
select ok((select bool_and(has_function_privilege('authenticated', oid, 'EXECUTE')) from pg_proc where proname in
  ('create_customer','update_customer','set_customer_active','link_order_to_customer','replace_customer_access_link')),
  'producer RPCs remain executable by authenticated (grants preserved)');

-- ── 14–15. Deterministic order + equal-timestamp tie-break (id DESC) ───────
select is(
  (select array_agg((metadata->>'seq')::int order by created_at desc, id desc)
     from public.audit_events
    where tenant_id='33333333-3333-4333-8333-333333333333'
      and entity_type='customer' and entity_id='ca000000-0000-4000-8000-000000000001'),
  array[6,5,4,3,2,1],
  'the timeline order is created_at DESC then id DESC (newest first)');
-- At the shared 2026-06-03 timestamp, the later-inserted row (seq 4, higher id)
-- MUST precede seq 3 — an id-only or ascending tie-break would flip these.
select is(
  (select array_agg((metadata->>'seq')::int order by created_at desc, id desc)
     from public.audit_events
    where tenant_id='33333333-3333-4333-8333-333333333333'
      and entity_type='customer' and entity_id='ca000000-0000-4000-8000-000000000001'
      and created_at='2026-06-03T00:00:00Z'),
  array[4,3], 'equal timestamps tie-break by higher id first');

-- ── 16. Row-value keyset: page 2 continues after page 1 (no overlap/skip) ──
-- Page 1 is the newest 2 rows (seq 6,5). The cursor is page 1's LAST row (seq 5).
-- Page 2 = rows strictly OLDER than the cursor via (created_at, id) < (c) → 4,3.
select is(
  (with cur as (
     select created_at, id from public.audit_events
      where tenant_id='33333333-3333-4333-8333-333333333333'
        and entity_type='customer' and entity_id='ca000000-0000-4000-8000-000000000001'
      order by created_at desc, id desc offset 1 limit 1)          -- page-1 last row
   select array_agg(seq order by ord) from (
     select (a.metadata->>'seq')::int as seq,
            row_number() over (order by a.created_at desc, a.id desc) as ord
       from public.audit_events a, cur
      where a.tenant_id='33333333-3333-4333-8333-333333333333'
        and a.entity_type='customer' and a.entity_id='ca000000-0000-4000-8000-000000000001'
        and (a.created_at, a.id) < (cur.created_at, cur.id)         -- row-value keyset
      order by a.created_at desc, a.id desc limit 2) p),
  array[4,3],
  'row-value keyset page 2 = the next 2 older rows (no overlap, no skip)');

-- ── 17–18. The app's exact timeline query is served by the index, NO Sort ──
-- Capture the plan for the precise select/filter/order/limit the data layer runs.
-- enable_seqscan=off forces the planner to prefer any usable index, so this
-- proves the index is CORRECTLY SHAPED for the access pattern regardless of the
-- (tiny, in-txn) row count; the absence of a Sort node proves the DESC,DESC key
-- order satisfies ORDER BY created_at DESC, id DESC. Run as the (superuser) test
-- role so the plan reflects the raw index path (RLS bypassed).
reset role;
create function pg_temp.plan_of(q text) returns setof text language plpgsql as $$
begin return query execute 'explain (format text) ' || q; end $$;
set local enable_seqscan = off;

select ok(
  exists(select 1 from pg_temp.plan_of($q$
    select id, event_type, actor_user_id, metadata, created_at
      from public.audit_events
     where tenant_id='33333333-3333-4333-8333-333333333333'
       and entity_type='customer'
       and entity_id='ca000000-0000-4000-8000-000000000001'
     order by created_at desc, id desc limit 21 $q$) l
   where l ilike '%audit_events_customer_timeline_idx%'),
  'the bounded timeline query is served by the composite index (index scan)');
select ok(
  not exists(select 1 from pg_temp.plan_of($q$
    select id, event_type, actor_user_id, metadata, created_at
      from public.audit_events
     where tenant_id='33333333-3333-4333-8333-333333333333'
       and entity_type='customer'
       and entity_id='ca000000-0000-4000-8000-000000000001'
     order by created_at desc, id desc limit 21 $q$) l
   where l ~* 'Sort'),
  'the ordered timeline read needs NO Sort node (index order matches ORDER BY)');

reset enable_seqscan;

-- ── 19–22. M8G.2/M4D read scoping still holds WITH the index present ───────
-- sales_rep repC: ASSIGNED ca…01 visible; UNASSIGNED ca…02 and tenant-B hidden.
set local role authenticated;
set local request.jwt.claims = '{"sub":"c0c00000-0000-4000-8000-000000000002","role":"authenticated"}';
select ok(
  (select count(*) from public.audit_events
    where entity_type='customer' and entity_id='ca000000-0000-4000-8000-000000000001') = 6,
  'sales_rep reads its ASSIGNED customer''s timeline events (all 6)');
select is(
  (select count(*) from public.audit_events
    where entity_type='customer' and entity_id <> 'ca000000-0000-4000-8000-000000000001'),
  0::bigint,
  'sales_rep reads NO events for unassigned or cross-tenant customers (no M4D leak)');
-- ownerC: tenant-wide visibility (assigned + unassigned in C), but not tenant B.
set local request.jwt.claims = '{"sub":"c0c00000-0000-4000-8000-000000000001","role":"authenticated"}';
select ok(
  (select count(*) from public.audit_events
    where tenant_id='33333333-3333-4333-8333-333333333333') = 7,
  'owner sees every customer''s timeline events tenant-wide (6 + 1 unassigned)');
select is(
  (select count(*) from public.audit_events
    where tenant_id='22222222-2222-4222-8222-222222222222'),
  0::bigint,
  'owner of tenant C reads NO tenant-B timeline events (cross-tenant isolation)');

select finish();
rollback;
