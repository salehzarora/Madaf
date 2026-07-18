-- ═══════════════════════════════════════════════════════════════════════
-- pgTAP — M8I.7 AUDIT UNKNOWN-ENTITY DEFAULT-DENY
--
-- The audit_events SELECT policy scopes eight KNOWN entity_types; before this
-- change any OTHER entity_type fell through to the base is_tenant_member clause
-- and would be readable by a plain sales_rep. 20260812100000 AND-s a final
-- default-deny clause: an entity_type outside the known set additionally requires
-- owner/admin. This suite proves:
--   • an UNKNOWN entity_type row (a synthetic 'promotion' event) is readable by
--     owner and admin, but NOT by a sales_rep, NOT by another tenant's owner,
--     and NOT by anon (which has no grant at all);
--   • the eight KNOWN clauses are UNCHANGED — a sales_rep still sees an audit
--     event for a customer ASSIGNED to them, and still cannot see an
--     owner/admin-only 'settings' event, exactly as before.
--
-- Synthetic rows are inserted from a privileged role (clients cannot INSERT into
-- audit_events); reads are then performed as each client role. Rolls back.
-- ═══════════════════════════════════════════════════════════════════════
begin;
select plan(8);

set local request.jwt.claims = '{"role":"service_role"}';

-- ── Fixtures: tenant C (owner/admin/rep + assigned customer) and tenant B ──
insert into auth.users (id) values
  ('c0c00000-0000-4000-8000-000000000001'),  -- ownerC
  ('c0c00000-0000-4000-8000-000000000002'),  -- repC
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
insert into public.customers (id, tenant_id, name, customer_type, phone, origin, is_active) values
  ('ca000000-0000-4000-8000-000000000001', '33333333-3333-4333-8333-333333333333', 'Store C1', 'grocery', '050-1', 'manual', true);
insert into public.sales_rep_customers (tenant_id, user_id, customer_id, assigned_by) values
  ('33333333-3333-4333-8333-333333333333', 'c0c00000-0000-4000-8000-000000000002',
   'ca000000-0000-4000-8000-000000000001', 'c0c00000-0000-4000-8000-000000000001');

-- Synthetic audit rows (privileged insert — bypasses the no-client-INSERT rule):
--   • an UNKNOWN entity_type ('promotion') for tenant C;
--   • a KNOWN 'customer' event for the rep-assigned customer (rep-visible);
--   • a KNOWN owner/admin-only 'settings' event (rep-invisible).
reset role;
insert into public.audit_events (tenant_id, event_type, entity_type, entity_id, metadata) values
  ('33333333-3333-4333-8333-333333333333', 'promotion.launched', 'promotion',
   '99999999-9999-4999-8999-000000000001', '{}'::jsonb),
  ('33333333-3333-4333-8333-333333333333', 'customer.updated', 'customer',
   'ca000000-0000-4000-8000-000000000001', '{}'::jsonb),
  ('33333333-3333-4333-8333-333333333333', 'settings.updated', 'settings',
   null, '{}'::jsonb);

-- ── 1–2. Owner and admin CAN read the unknown-entity event ────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"c0c00000-0000-4000-8000-000000000001","role":"authenticated"}';
select is((select count(*) from public.audit_events where entity_type='promotion'),
  1::bigint, 'owner reads the unknown-entity (promotion) event');

set local request.jwt.claims = '{"sub":"c0c00000-0000-4000-8000-000000000003","role":"authenticated"}';
select is((select count(*) from public.audit_events where entity_type='promotion'),
  1::bigint, 'admin reads the unknown-entity (promotion) event');

-- ── 3. A sales_rep is DENIED the unknown-entity event (default-deny) ──────
set local request.jwt.claims = '{"sub":"c0c00000-0000-4000-8000-000000000002","role":"authenticated"}';
select is((select count(*) from public.audit_events where entity_type='promotion'),
  0::bigint, 'sales_rep is denied the unknown-entity event (default-deny to owner/admin)');

-- ── 4. Known behavior intact: the rep STILL sees its assigned-customer event ─
select is((select count(*) from public.audit_events where entity_type='customer'),
  1::bigint, 'sales_rep still reads a customer event for its ASSIGNED customer (known clause unchanged)');

-- ── 5. Known behavior intact: the rep still CANNOT see a settings event ───
select is((select count(*) from public.audit_events where entity_type='settings'),
  0::bigint, 'sales_rep still cannot read an owner/admin-only settings event (known clause unchanged)');

-- ── 6. Known behavior intact: the owner still sees the settings event ─────
set local request.jwt.claims = '{"sub":"c0c00000-0000-4000-8000-000000000001","role":"authenticated"}';
select is((select count(*) from public.audit_events where entity_type='settings'),
  1::bigint, 'owner still reads the settings event (known clause unchanged)');

-- ── 7. Cross-tenant: tenant B's owner sees NONE of tenant C's events ──────
set local request.jwt.claims = '{"sub":"b0b00000-0000-4000-8000-000000000001","role":"authenticated"}';
select is((select count(*) from public.audit_events where tenant_id='33333333-3333-4333-8333-333333333333'),
  0::bigint, 'another tenant''s owner cannot read tenant C''s unknown-entity (or any) event');

-- ── 8. anon has no grant on audit_events at all ───────────────────────────
reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok(
  $$ select count(*) from public.audit_events $$,
  '42501', NULL, 'anon cannot read audit_events at all (no grant, no policy)');

select finish();
rollback;
