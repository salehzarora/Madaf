-- ═══════════════════════════════════════════════════════════════════════
-- M8G.3 — entity-scoped index for the Customer Timeline read
--
-- The Customer Timeline (M8G.3) reads audit_events for ONE customer, newest
-- first, with cursor pagination:
--   WHERE tenant_id = $1 AND entity_type = 'customer' AND entity_id = $2
--   ORDER BY created_at DESC, id DESC
--   LIMIT pageSize + 1   (optionally after a (created_at,id) cursor)
--
-- The M8G.2 report deferred this index to M8G.3. The existing indexes are
-- (tenant_id, created_at DESC) and (actor_user_id) — neither is entity-scoped,
-- so the read scans the tenant-wide timeline and FILTERS by entity + sorts.
--
-- MEASURED evidence (local, 63k rows: 3k for the target customer + 60k for
-- other customers in the tenant), first page LIMIT 21:
--   • WITHOUT this index: Index Scan on (tenant_id, created_at) + Filter
--     (Rows Removed by Filter: 1319) + Incremental Sort — buffers hit=84.
--   • WITH this index: Index Scan using this index, Index Cond covers
--     tenant_id+entity_type+entity_id, NO filter, NO sort — buffers hit=1
--     read=3. The DESC/DESC column order lets the index satisfy the ORDER BY
--     and the (created_at,id) cursor directly, so pagination is a range scan.
-- Not claimed from the empty seed table — this is the real query shape for an
-- unbounded per-customer event stream.
--
-- Additive: ONE CREATE INDEX. No policy/grant/function/data change; no audit
-- mutation; no backfill; no Customer/Order mutation; no producer/taxonomy
-- change. Created in the normal transactional migration (NOT CONCURRENTLY — the
-- repo's migrations are transactional).
-- ═══════════════════════════════════════════════════════════════════════

create index audit_events_customer_timeline_idx
  on public.audit_events (tenant_id, entity_type, entity_id, created_at desc, id desc);

comment on index public.audit_events_customer_timeline_idx is
  'M8G.3 — supports the per-customer Timeline read (entity_type/entity_id scoped, '
  'created_at DESC, id DESC) with cursor pagination as an index range scan. No '
  'policy/grant/producer change; RLS remains the authorization boundary.';
