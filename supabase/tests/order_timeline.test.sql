-- ═══════════════════════════════════════════════════════════════════════
-- pgTAP — M8H.3 Order Timeline READ-PATH contract
--
-- M8H.3 adds NO migration. It reads the M8H.1 order audit rows through the
-- EXISTING contract, and this suite proves that contract is genuinely sufficient
-- and genuinely safe for an order-scoped, tenant-scoped, bounded read:
--
--   • the M8G.3 index (tenant_id, entity_type, entity_id, created_at DESC,
--     id DESC) is entity-GENERIC — it serves the ORDER query as an index scan
--     with NO Sort node, so no new index is needed;
--   • the read is READ-ONLY BY CONSTRUCTION: `authenticated` holds no INSERT /
--     UPDATE / DELETE on audit_events and cannot execute the private producer,
--     so viewing a Timeline can never create audit noise even if it tried;
--   • the M8H.1 SELECT policy scopes ORDER rows by can_access_order (and fails
--     closed on a NULL entity_id): a sales_rep sees ONLY the history of orders
--     whose customer is assigned to them — never an unassigned customer's order,
--     never a guest (null-customer) order, never another tenant's;
--   • the (created_at DESC, id DESC) order is deterministic with an id tie-break,
--     and the row-value keyset pages with no overlap and no skip;
--   • the bounded actor-label lookup stays owner/admin-only and cross-tenant-safe.
--
-- Run with the local stack up:  supabase test db
-- Disposable tenants D + E in THIS transaction; everything rolls back.
-- ═══════════════════════════════════════════════════════════════════════
begin;
select plan(23);

set local request.jwt.claims = '{"role":"service_role"}';

-- Users / tenants / membership (owner + admin + assigned rep in D; owner in E).
insert into auth.users (id, email) values
  ('d0d00000-0000-4000-8000-000000000001', 'owner-d@madaf.test'),  -- ownerD
  ('d0d00000-0000-4000-8000-000000000002', 'rep-d@madaf.test'),    -- repD (assigned to da…01)
  ('d0d00000-0000-4000-8000-000000000003', 'admin-d@madaf.test'),  -- adminD
  ('e0e00000-0000-4000-8000-000000000001', 'owner-e@madaf.test');  -- ownerE (other tenant)
insert into public.tenants (id, name_ar, name_he, name_en) values
  ('44444444-4444-4444-8444-444444444444', 'د', 'ד', 'D'),
  ('55555555-5555-4555-8555-555555555555', 'هـ', 'ה', 'E');
insert into public.tenant_users (tenant_id, user_id, role) values
  ('44444444-4444-4444-8444-444444444444', 'd0d00000-0000-4000-8000-000000000001', 'owner'),
  ('44444444-4444-4444-8444-444444444444', 'd0d00000-0000-4000-8000-000000000002', 'sales_rep'),
  ('44444444-4444-4444-8444-444444444444', 'd0d00000-0000-4000-8000-000000000003', 'admin'),
  ('55555555-5555-4555-8555-555555555555', 'e0e00000-0000-4000-8000-000000000001', 'owner');

-- da…01 assigned to repD; da…02 UNASSIGNED (same tenant); ea…01 in tenant E.
insert into public.customers (id, tenant_id, name, customer_type, phone, origin, is_active) values
  ('da000000-0000-4000-8000-000000000001', '44444444-4444-4444-8444-444444444444', 'Store D1', 'grocery', '050-1', 'manual', true),
  ('da000000-0000-4000-8000-000000000002', '44444444-4444-4444-8444-444444444444', 'Store D2', 'grocery', '050-2', 'manual', true),
  ('ea000000-0000-4000-8000-000000000001', '55555555-5555-4555-8555-555555555555', 'Store E1', 'grocery', '050-9', 'manual', true);
insert into public.sales_rep_customers (tenant_id, user_id, customer_id, assigned_by) values
  ('44444444-4444-4444-8444-444444444444', 'd0d00000-0000-4000-8000-000000000002',
   'da000000-0000-4000-8000-000000000001', 'd0d00000-0000-4000-8000-000000000001');

-- Four orders: ASSIGNED (rep may read), UNASSIGNED, GUEST (null customer →
-- owner/admin only), and one in tenant E.
insert into public.orders
  (id, tenant_id, customer_id, order_number, public_ref, status, customer_snapshot, created_at) values
  ('70000000-0000-4000-8000-000000000001', '44444444-4444-4444-8444-444444444444',
   'da000000-0000-4000-8000-000000000001', 'OT-1', 'MDF-OT001', 'new', '{}', '2026-06-01T10:00:00Z'),
  ('70000000-0000-4000-8000-000000000002', '44444444-4444-4444-8444-444444444444',
   'da000000-0000-4000-8000-000000000002', 'OT-2', 'MDF-OT002', 'new', '{}', '2026-06-01T11:00:00Z'),
  ('70000000-0000-4000-8000-000000000003', '44444444-4444-4444-8444-444444444444',
   null, 'OT-3', 'MDF-OT003', 'new', '{"name":"Guest Shop","phone":"050-secret","guest":true}', '2026-06-01T12:00:00Z'),
  ('70000000-0000-4000-8000-000000000004', '55555555-5555-4555-8555-555555555555',
   'ea000000-0000-4000-8000-000000000001', 'OT-4', 'MDF-OT004', 'new', '{}', '2026-06-01T13:00:00Z');

-- Order audit rows (service_role bypasses the append-only client grant).
-- SIX events for the ASSIGNED order, inserted chronologically so id ascends with
-- created_at — EXCEPT seq 3 & 4 SHARE a timestamp (id 4 later → higher) to
-- exercise the (created_at, id) tie-break. Then one row each for the unassigned,
-- guest and cross-tenant orders (for the read-scope checks).
insert into public.audit_events (tenant_id, actor_user_id, event_type, entity_type, entity_id, metadata, created_at) values
  ('44444444-4444-4444-8444-444444444444', 'd0d00000-0000-4000-8000-000000000001', 'order.created',         'order', '70000000-0000-4000-8000-000000000001', '{"seq":1}', '2026-06-02T00:00:00Z'),
  ('44444444-4444-4444-8444-444444444444', 'd0d00000-0000-4000-8000-000000000001', 'order.status_changed',  'order', '70000000-0000-4000-8000-000000000001', '{"seq":2}', '2026-06-03T00:00:00Z'),
  ('44444444-4444-4444-8444-444444444444', 'd0d00000-0000-4000-8000-000000000003', 'order.updated',         'order', '70000000-0000-4000-8000-000000000001', '{"seq":3}', '2026-06-04T00:00:00Z'),
  ('44444444-4444-4444-8444-444444444444', 'd0d00000-0000-4000-8000-000000000003', 'order.status_changed',  'order', '70000000-0000-4000-8000-000000000001', '{"seq":4}', '2026-06-04T00:00:00Z'),
  ('44444444-4444-4444-8444-444444444444', null,                                   'order.customer_linked', 'order', '70000000-0000-4000-8000-000000000001', '{"seq":5}', '2026-06-05T00:00:00Z'),
  -- A LEGACY, unrecognized event type carrying a forbidden key — exactly the row
  -- still present in supabase/seed.sql. The DB stores it; the app projects it away.
  ('44444444-4444-4444-8444-444444444444', 'd0d00000-0000-4000-8000-000000000001', 'order.delivered',       'order', '70000000-0000-4000-8000-000000000001', '{"seq":6,"order_number":"MDF-OT001"}', '2026-06-06T00:00:00Z'),
  ('44444444-4444-4444-8444-444444444444', 'd0d00000-0000-4000-8000-000000000001', 'order.created',         'order', '70000000-0000-4000-8000-000000000002', '{"seq":97}', '2026-06-07T00:00:00Z'),
  ('44444444-4444-4444-8444-444444444444', 'd0d00000-0000-4000-8000-000000000001', 'order.created',         'order', '70000000-0000-4000-8000-000000000003', '{"seq":98}', '2026-06-08T00:00:00Z'),
  ('55555555-5555-4555-8555-555555555555', 'e0e00000-0000-4000-8000-000000000001', 'order.created',         'order', '70000000-0000-4000-8000-000000000004', '{"seq":99}', '2026-06-09T00:00:00Z');

-- ── 1. The M8G.3 index is entity-GENERIC (no M8H.3 index needed) ───────────
select matches(
  (select pg_get_indexdef('public.audit_events_customer_timeline_idx'::regclass)),
  '\(tenant_id, entity_type, entity_id, created_at DESC, id DESC\)',
  'the audit index is entity-generic — entity_type is a KEY column, so it serves order rows too');

-- ── 2–3. The app''s exact ORDER timeline query: index scan, NO Sort ─────────
-- enable_seqscan=off forces the planner to prefer any usable index, so this
-- proves the index is CORRECTLY SHAPED for the access pattern regardless of the
-- (tiny, in-txn) row count; the absence of a Sort node proves the DESC,DESC key
-- order already satisfies ORDER BY created_at DESC, id DESC for an ORDER read.
reset role;
create function pg_temp.plan_of(q text) returns setof text language plpgsql as $$
begin return query execute 'explain (format text) ' || q; end $$;
set local enable_seqscan = off;

select ok(
  exists(select 1 from pg_temp.plan_of($q$
    select id, event_type, actor_user_id, metadata, created_at
      from public.audit_events
     where tenant_id='44444444-4444-4444-8444-444444444444'
       and entity_type='order'
       and entity_id='70000000-0000-4000-8000-000000000001'
     order by created_at desc, id desc limit 21 $q$) l
   where l ilike '%audit_events_customer_timeline_idx%'),
  'the bounded ORDER timeline query is served by the existing composite index');
select ok(
  not exists(select 1 from pg_temp.plan_of($q$
    select id, event_type, actor_user_id, metadata, created_at
      from public.audit_events
     where tenant_id='44444444-4444-4444-8444-444444444444'
       and entity_type='order'
       and entity_id='70000000-0000-4000-8000-000000000001'
     order by created_at desc, id desc limit 21 $q$) l
   where l ~* 'Sort'),
  'the ordered ORDER timeline read needs NO Sort node (index order matches ORDER BY)');

reset enable_seqscan;

-- ── 4–6. READ-ONLY BY CONSTRUCTION: a viewer cannot write an audit row ──────
-- This is what makes "opening the Timeline creates no audit event" a STRUCTURAL
-- guarantee rather than a promise about application code.
select ok(not has_table_privilege('authenticated', 'public.audit_events', 'INSERT'),
  'authenticated cannot INSERT audit_events — viewing can never create audit noise');
select ok(not has_table_privilege('authenticated', 'public.audit_events', 'UPDATE'),
  'authenticated cannot UPDATE audit_events (history is not rewritable)');
select ok(not has_table_privilege('authenticated', 'public.audit_events', 'DELETE'),
  'authenticated cannot DELETE audit_events (history is not erasable)');

-- ── 7–8. The private order producer stays unreachable from any client ───────
select ok(not has_function_privilege('authenticated',
  'public._log_order_audit_event(uuid,text,uuid,jsonb)', 'EXECUTE'),
  'authenticated cannot invoke the private ORDER audit producer');
select is(
  (select prosecdef from pg_proc where oid='public._log_order_audit_event(uuid,text,uuid,jsonb)'::regprocedure),
  false, 'the private ORDER producer is still SECURITY INVOKER');

-- ── 9–10. The M8H.1 SELECT policy scopes ORDER rows and fails closed ────────
select isnt_empty(
  $$ select 1 from pg_policies where tablename='audit_events'
     and cmd = 'SELECT'
     and qual like '%can_access_order(tenant_id, entity_id)%' $$,
  'the order-scoped audit SELECT rule is present (can_access_order)');
select isnt_empty(
  $$ select 1 from pg_policies where tablename='audit_events'
     and cmd = 'SELECT'
     and qual like '%entity_id IS NOT NULL%' $$,
  'the order clause FAILS CLOSED on a NULL entity_id');

-- ── 11–16. M4D read scoping for ORDER history ──────────────────────────────
-- sales_rep repD: may read the ASSIGNED order's history and NOTHING else.
set local role authenticated;
set local request.jwt.claims = '{"sub":"d0d00000-0000-4000-8000-000000000002","role":"authenticated"}';
select is(
  (select count(*) from public.audit_events
    where entity_type='order' and entity_id='70000000-0000-4000-8000-000000000001'),
  6::bigint,
  'sales_rep reads the full history of an order whose customer is ASSIGNED to them');
select is(
  (select count(*) from public.audit_events
    where entity_type='order' and entity_id='70000000-0000-4000-8000-000000000002'),
  0::bigint,
  'sales_rep reads NO history for an UNASSIGNED customer''s order');
select is(
  (select count(*) from public.audit_events
    where entity_type='order' and entity_id='70000000-0000-4000-8000-000000000003'),
  0::bigint,
  'sales_rep reads NO history for a GUEST (null-customer) order — owner/admin only');
select is(
  (select count(*) from public.audit_events
    where entity_type='order' and entity_id='70000000-0000-4000-8000-000000000004'),
  0::bigint,
  'sales_rep reads NO history for another TENANT''s order');

-- adminD: the guest order IS visible to owner/admin.
set local request.jwt.claims = '{"sub":"d0d00000-0000-4000-8000-000000000003","role":"authenticated"}';
select is(
  (select count(*) from public.audit_events
    where entity_type='order' and entity_id='70000000-0000-4000-8000-000000000003'),
  1::bigint,
  'admin reads the GUEST order''s history (owner/admin scope)');

-- ownerD: tenant-wide, but NOTHING from tenant E.
set local request.jwt.claims = '{"sub":"d0d00000-0000-4000-8000-000000000001","role":"authenticated"}';
select is(
  (select count(*) from public.audit_events
    where entity_type='order' and tenant_id='55555555-5555-4555-8555-555555555555'),
  0::bigint,
  'owner of tenant D reads NO tenant-E order history (cross-tenant isolation)');

-- ── 17–18. Deterministic order + equal-timestamp tie-break (id DESC) ────────
select is(
  (select array_agg((metadata->>'seq')::int order by created_at desc, id desc)
     from public.audit_events
    where tenant_id='44444444-4444-4444-8444-444444444444'
      and entity_type='order' and entity_id='70000000-0000-4000-8000-000000000001'),
  array[6,5,4,3,2,1],
  'the order timeline is created_at DESC then id DESC (newest first)');
-- At the shared 2026-06-04 timestamp, the later-inserted row (seq 4, higher id)
-- MUST precede seq 3 — an id-only or ascending tie-break would flip these.
select is(
  (select array_agg((metadata->>'seq')::int order by created_at desc, id desc)
     from public.audit_events
    where tenant_id='44444444-4444-4444-8444-444444444444'
      and entity_type='order' and entity_id='70000000-0000-4000-8000-000000000001'
      and created_at='2026-06-04T00:00:00Z'),
  array[4,3], 'equal timestamps tie-break by higher id first');

-- ── 19. Row-value keyset: page 2 continues after page 1 (no overlap/skip) ───
select is(
  (with cur as (
     select created_at, id from public.audit_events
      where tenant_id='44444444-4444-4444-8444-444444444444'
        and entity_type='order' and entity_id='70000000-0000-4000-8000-000000000001'
      order by created_at desc, id desc offset 1 limit 1)          -- page-1 last row
   select array_agg(seq order by ord) from (
     select (a.metadata->>'seq')::int as seq,
            row_number() over (order by a.created_at desc, a.id desc) as ord
       from public.audit_events a, cur
      where a.tenant_id='44444444-4444-4444-8444-444444444444'
        and a.entity_type='order' and a.entity_id='70000000-0000-4000-8000-000000000001'
        and (a.created_at, a.id) < (cur.created_at, cur.id)         -- row-value keyset
      order by a.created_at desc, a.id desc limit 2) p),
  array[4,3],
  'row-value keyset page 2 = the next 2 older rows (no overlap, no skip)');

-- ── 20. The Customer Timeline is NOT polluted by order rows (entity split) ──
-- The dual-entity linking model relies on each row serving exactly ONE timeline.
select is(
  (select count(*) from public.audit_events
    where tenant_id='44444444-4444-4444-8444-444444444444'
      and entity_type='customer'),
  0::bigint,
  'the ORDER events are entity_type=order only — no row leaks into a Customer Timeline');

-- ── 21–23. The bounded actor-label lookup (reused, unchanged) ───────────────
-- owner/admin only, bounded to the requested ids, cross-tenant-safe.
select is(
  (select count(*) from public.get_timeline_actor_labels_for_ids(
     '44444444-4444-4444-8444-444444444444',
     array['d0d00000-0000-4000-8000-000000000001',
           'd0d00000-0000-4000-8000-000000000003']::uuid[])),
  2::bigint,
  'owner resolves labels for ONLY the requested page actors');
select is(
  (select count(*) from public.get_timeline_actor_labels_for_ids(
     '44444444-4444-4444-8444-444444444444',
     array['e0e00000-0000-4000-8000-000000000001']::uuid[])),
  0::bigint,
  'a CROSS-TENANT actor id resolves to nothing (no actor leakage)');
-- A sales_rep may never resolve a named actor — the identity boundary is the
-- same as the team roster''s. The Timeline degrades to "a team member".
set local request.jwt.claims = '{"sub":"d0d00000-0000-4000-8000-000000000002","role":"authenticated"}';
select throws_ok(
  $$ select * from public.get_timeline_actor_labels_for_ids(
       '44444444-4444-4444-8444-444444444444',
       array['d0d00000-0000-4000-8000-000000000001']::uuid[]) $$,
  '42501',
  null,
  'a sales_rep is DENIED the actor-label lookup (no identity exposure)');

select finish();
rollback;
