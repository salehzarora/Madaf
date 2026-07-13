-- ═══════════════════════════════════════════════════════════════════════
-- pgTAP — M8G.2 Customer lifecycle AUDIT FOUNDATION
--
-- Verifies the transactional customer-category producers on public.audit_events:
--   • audit_events stays SELECT-only for clients (no direct insert; helper not
--     callable by public/anon/authenticated); actor/tenant derived server-side;
--   • each SUCCESSFUL mutation writes exactly ONE correct event (created with
--     manual/signup/guest_conversion origin; updated with change-gated, PII-
--     redacted changed_fields; activated/deactivated; access_link created/
--     rotated/revoked with NO token/URL; order_linked with no origin change);
--   • no event for no-op / already-current / already-linked / already-revoked /
--     failed / rolled-back / unauthorized / cross-tenant mutations;
--   • closed vocabulary (no "Other"); bounded metadata; tenant-isolated reads;
--   • existing RPC signatures/security/search_path/grants preserved; M8G.1
--     origin immutable; M8F.2/M8F.3/access-link RPCs intact; no rows lost.
--
-- Run with the local stack up:  supabase test db
-- Disposable tenants C + B (+ owner/admin/sales_rep users) in THIS transaction;
-- everything rolls back. No tokens/secrets/PII printed.
-- ═══════════════════════════════════════════════════════════════════════
begin;
select plan(55);

set local request.jwt.claims = '{"role":"service_role"}';

-- Users
insert into auth.users (id) values
  ('c0c00000-0000-4000-8000-000000000001'),  -- ownerC
  ('c0c00000-0000-4000-8000-000000000002'),  -- repC (sales_rep)
  ('c0c00000-0000-4000-8000-000000000003'),  -- adminC
  ('b0b00000-0000-4000-8000-000000000001');  -- ownerB
-- Tenants
insert into public.tenants (id, name_ar, name_he, name_en) values
  ('33333333-3333-4333-8333-333333333333', 'ج', 'ג', 'C'),
  ('22222222-2222-4222-8222-222222222222', 'ب', 'ב', 'B');
insert into public.tenant_users (tenant_id, user_id, role) values
  ('33333333-3333-4333-8333-333333333333', 'c0c00000-0000-4000-8000-000000000001', 'owner'),
  ('33333333-3333-4333-8333-333333333333', 'c0c00000-0000-4000-8000-000000000002', 'sales_rep'),
  ('33333333-3333-4333-8333-333333333333', 'c0c00000-0000-4000-8000-000000000003', 'admin'),
  ('22222222-2222-4222-8222-222222222222', 'b0b00000-0000-4000-8000-000000000001', 'owner');
-- A customer in C (assigned to repC) + a cross-tenant customer in B.
insert into public.customers (id, tenant_id, name, customer_type, phone, origin, is_active) values
  ('ca000000-0000-4000-8000-000000000001', '33333333-3333-4333-8333-333333333333', 'Store C1', 'grocery', '050-1', 'manual', true),
  ('cb000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'Store B1', 'grocery', '050-9', 'manual', true);
insert into public.sales_rep_customers (tenant_id, user_id, customer_id, assigned_by) values
  ('33333333-3333-4333-8333-333333333333', 'c0c00000-0000-4000-8000-000000000002', 'ca000000-0000-4000-8000-000000000001', 'c0c00000-0000-4000-8000-000000000001');
-- A pending signup request in C (approve path) + an unlinked guest order in C.
insert into public.customer_signup_links (id, tenant_id, token_hash) values
  ('51000000-0000-4000-8000-000000000001', '33333333-3333-4333-8333-333333333333',
   'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
insert into public.customer_signup_requests (id, tenant_id, link_id, name, phone, email) values
  ('52000000-0000-4000-8000-000000000001', '33333333-3333-4333-8333-333333333333',
   '51000000-0000-4000-8000-000000000001', 'Signed-Up Store', '050-2', 'shop@example.com');
insert into public.orders
  (id, tenant_id, customer_id, order_number, public_ref, status, customer_snapshot, created_at) values
  ('60000000-0000-4000-8000-000000000001', '33333333-3333-4333-8333-333333333333', null,
   'AU-1', 'MDF-AU001', 'new',
   '{"name":"Guest Shop","phone":"050-secret","address":"1 Secret St","guest":true}', '2026-05-01T10:00:00Z'),
  ('60000000-0000-4000-8000-000000000002', '33333333-3333-4333-8333-333333333333', null,
   'AU-2', 'MDF-AU002', 'new', '{"name":"Another Guest","phone":"050-x"}', '2026-05-02T10:00:00Z');

-- ── 1–2. audit_events schema still valid (key columns) ─────────────────────
select has_column('public', 'audit_events', 'event_type', 'audit_events.event_type exists');
select has_column('public', 'audit_events', 'entity_id', 'audit_events.entity_id exists');

-- ── 3–5. audit_events NOT directly writable by clients ─────────────────────
select ok(not has_table_privilege('authenticated', 'public.audit_events', 'INSERT'),
  'authenticated cannot INSERT audit_events directly');
select ok(not has_table_privilege('anon', 'public.audit_events', 'INSERT'),
  'anon cannot INSERT audit_events directly');
select ok(not has_table_privilege('authenticated', 'public.audit_events', 'UPDATE'),
  'authenticated cannot UPDATE audit_events (append-only for clients)');

-- ── 6–9. Private helper is not callable by any client role ─────────────────
select ok(not has_function_privilege('public',        'public._log_customer_audit_event(uuid,text,uuid,jsonb)', 'EXECUTE'), 'PUBLIC cannot invoke the helper');
select ok(not has_function_privilege('anon',          'public._log_customer_audit_event(uuid,text,uuid,jsonb)', 'EXECUTE'), 'anon cannot invoke the helper');
select ok(not has_function_privilege('authenticated', 'public._log_customer_audit_event(uuid,text,uuid,jsonb)', 'EXECUTE'), 'authenticated cannot invoke the helper');
select is((select prosecdef from pg_proc where oid='public._log_customer_audit_event(uuid,text,uuid,jsonb)'::regprocedure), false, 'helper is SECURITY INVOKER');

-- ── 10–11. Helper enforces the closed vocabulary + bounded metadata (as owner) ─
select throws_ok(
  $$ select public._log_customer_audit_event('33333333-3333-4333-8333-333333333333', 'customer.bogus', 'ca000000-0000-4000-8000-000000000001', '{}'::jsonb) $$,
  '22023', NULL, 'helper rejects an unknown event type (no "Other")');
select throws_ok(
  $$ select public._log_customer_audit_event('33333333-3333-4333-8333-333333333333', 'customer.created', 'ca000000-0000-4000-8000-000000000001', jsonb_build_object('x', repeat('y', 5000))) $$,
  '22023', NULL, 'helper rejects oversized metadata');

-- ═══ Authenticated caller: ownerC ══════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"c0c00000-0000-4000-8000-000000000001","role":"authenticated"}';

-- ── 12–15. Manual creation → one customer.created (origin manual), actor+tenant ─
select public.create_customer('33333333-3333-4333-8333-333333333333', 'Manual Store', null, null, null, null, null, null, 'kiosk', null);
select is((select count(*) from public.audit_events where event_type='customer.created' and metadata->>'origin'='manual'), 1::bigint, 'manual create → one customer.created (origin manual)');
select is((select actor_user_id from public.audit_events where metadata->>'origin'='manual'), 'c0c00000-0000-4000-8000-000000000001'::uuid, 'actor is the authenticated owner (server-derived)');
select is((select tenant_id from public.audit_events where metadata->>'origin'='manual'), '33333333-3333-4333-8333-333333333333'::uuid, 'event tenant is server-derived');
select is((select entity_type from public.audit_events where metadata->>'origin'='manual'), 'customer', 'entity_type is customer');

-- ── 16–17. Signup approval → one customer.created (origin signup + request id) ─
select public.approve_customer_signup_request('33333333-3333-4333-8333-333333333333', '52000000-0000-4000-8000-000000000001');
select is((select count(*) from public.audit_events where event_type='customer.created' and metadata->>'origin'='signup'), 1::bigint, 'signup approval → one customer.created (origin signup)');
select is((select metadata->>'signup_request_id' from public.audit_events where metadata->>'origin'='signup'), '52000000-0000-4000-8000-000000000001', 'signup event carries the safe request id');

-- ── 18–20. Guest conversion → one event (origin guest_conversion, no PII) ───
select public.create_customer_from_order('33333333-3333-4333-8333-333333333333', '60000000-0000-4000-8000-000000000001');
select is((select count(*) from public.audit_events where event_type='customer.created' and metadata->>'origin'='guest_conversion'), 1::bigint, 'guest conversion → one customer.created (origin guest_conversion)');
select is((select metadata->>'source_order_id' from public.audit_events where metadata->>'origin'='guest_conversion'), '60000000-0000-4000-8000-000000000001', 'guest event carries the safe source order id');
select ok((select not (metadata ?| array['name','phone','address','contact_name','email']) from public.audit_events where metadata->>'origin'='guest_conversion'), 'guest conversion metadata contains NO snapshot name/phone/address/email');

-- ── 21–24. Update → one change-gated event; only changed fields; PII redacted ─
select public.update_customer('33333333-3333-4333-8333-333333333333', 'ca000000-0000-4000-8000-000000000001', 'Store C1 v2', null, '050-1', null, null, null, null, 'minimarket', null);
select is((select count(*) from public.audit_events where event_type='customer.updated' and entity_id='ca000000-0000-4000-8000-000000000001'), 1::bigint, 'update → one customer.updated');
select is(
  (select (metadata->'changed_fields') from public.audit_events where event_type='customer.updated'),
  '["name","customer_type"]'::jsonb, 'only actually-changed fields are listed (name+customer_type; phone unchanged)');
select is((select metadata#>>'{customer_type,to}' from public.audit_events where event_type='customer.updated'), 'minimarket', 'safe enum before/after recorded for customer_type');
select ok((select not (metadata::text ilike '%050-1%' or metadata::text ilike '%Store C1 v2%') from public.audit_events where event_type='customer.updated'), 'update metadata redacts PII values (no phone/name values)');

-- ── 25. No-op update → NO new event ────────────────────────────────────────
select public.update_customer('33333333-3333-4333-8333-333333333333', 'ca000000-0000-4000-8000-000000000001', 'Store C1 v2', null, '050-1', null, null, null, null, 'minimarket', null);
select is((select count(*) from public.audit_events where event_type='customer.updated' and entity_id='ca000000-0000-4000-8000-000000000001'), 1::bigint, 'a no-op update creates no additional event');

-- ── 26–29. Deactivate / reactivate distinct; already-current state no event ─
select public.set_customer_active('33333333-3333-4333-8333-333333333333', 'ca000000-0000-4000-8000-000000000001', false);
select is((select count(*) from public.audit_events where event_type='customer.deactivated' and entity_id='ca000000-0000-4000-8000-000000000001'), 1::bigint, 'deactivate → one customer.deactivated');
select public.set_customer_active('33333333-3333-4333-8333-333333333333', 'ca000000-0000-4000-8000-000000000001', false);
select is((select count(*) from public.audit_events where event_type='customer.deactivated' and entity_id='ca000000-0000-4000-8000-000000000001'), 1::bigint, 'requesting the already-current (inactive) state creates no event');
select public.set_customer_active('33333333-3333-4333-8333-333333333333', 'ca000000-0000-4000-8000-000000000001', true);
select is((select count(*) from public.audit_events where event_type='customer.activated' and entity_id='ca000000-0000-4000-8000-000000000001'), 1::bigint, 'reactivate → one customer.activated (distinct from deactivated)');

-- ── 30–33. Access link created → rotated → revoked; never a token/URL ───────
select public.replace_customer_access_link('33333333-3333-4333-8333-333333333333', 'ca000000-0000-4000-8000-000000000001',
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1');
select is((select count(*) from public.audit_events where event_type='customer.access_link.created' and entity_id='ca000000-0000-4000-8000-000000000001'), 1::bigint, 'first link → customer.access_link.created');
select public.replace_customer_access_link('33333333-3333-4333-8333-333333333333', 'ca000000-0000-4000-8000-000000000001',
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa2');
select is((select count(*) from public.audit_events where event_type='customer.access_link.rotated' and entity_id='ca000000-0000-4000-8000-000000000001'), 1::bigint, 'replacing an active link → customer.access_link.rotated');
select public.revoke_customer_access_link('33333333-3333-4333-8333-333333333333',
  (select id from public.customer_access_links where customer_id='ca000000-0000-4000-8000-000000000001' and revoked_at is null));
select is((select count(*) from public.audit_events where event_type='customer.access_link.revoked' and entity_id='ca000000-0000-4000-8000-000000000001'), 1::bigint, 'revoking an active link → customer.access_link.revoked');
select ok((select bool_and(not (metadata::text ~* 'token|hash|http|aaaa')) from public.audit_events where event_type like 'customer.access_link.%'), 'access-link events contain NO token/hash/URL');

-- ── 34. Revoking an already-revoked link → NO additional event ─────────────
select public.revoke_customer_access_link('33333333-3333-4333-8333-333333333333',
  (select id from public.customer_access_links where customer_id='ca000000-0000-4000-8000-000000000001' order by created_at desc limit 1));
select is((select count(*) from public.audit_events where event_type='customer.access_link.revoked' and entity_id='ca000000-0000-4000-8000-000000000001'), 1::bigint, 'revoking an already-revoked link creates no additional event');

-- ── 35–37. Order linking → one event; no origin change; no snapshot copied ─
select public.link_order_to_customer('33333333-3333-4333-8333-333333333333', '60000000-0000-4000-8000-000000000002', 'ca000000-0000-4000-8000-000000000001');
select is((select count(*) from public.audit_events where event_type='customer.order_linked' and entity_id='ca000000-0000-4000-8000-000000000001'), 1::bigint, 'order linking → one customer.order_linked (entity = customer)');
select is((select origin::text from public.customers where id='ca000000-0000-4000-8000-000000000001'), 'manual', 'order linking does NOT change customer origin');
select ok((select not (metadata::text ilike '%Another Guest%' or metadata::text ilike '%050-x%') from public.audit_events where event_type='customer.order_linked'), 'order_linked metadata copies no guest snapshot values');

-- ── 38. Already-linked order → raises, no event ────────────────────────────
select throws_ok(
  $$ select public.link_order_to_customer('33333333-3333-4333-8333-333333333333', '60000000-0000-4000-8000-000000000002', 'ca000000-0000-4000-8000-000000000001') $$,
  '22023', NULL, 'linking an already-linked order raises (and writes no event)');

-- ── 39. Failed mutation (blank name) → no event ────────────────────────────
select throws_ok(
  $$ select public.create_customer('33333333-3333-4333-8333-333333333333', '   ') $$,
  '22023', NULL, 'a failed create (blank name) raises');
select is((select count(*) from public.audit_events where tenant_id='33333333-3333-4333-8333-333333333333' and metadata->>'origin'='manual'), 1::bigint, 'the failed create added no event (still just the one earlier manual)');

-- ── 40. Rolled-back mutation leaves no event ───────────────────────────────
savepoint before_rollback;
select public.create_customer('33333333-3333-4333-8333-333333333333', 'Rollback Store');
rollback to savepoint before_rollback;
select is((select count(*) from public.audit_events where metadata->>'origin'='manual'), 1::bigint, 'a rolled-back create leaves no event (transactional)');

-- ═══ Unauthorized callers — no event ═══════════════════════════════════════
-- sales_rep cannot create a customer (owner/admin only) → raises, no event.
set local request.jwt.claims = '{"sub":"c0c00000-0000-4000-8000-000000000002","role":"authenticated"}';
select throws_ok(
  $$ select public.create_customer('33333333-3333-4333-8333-333333333333', 'Rep Store') $$,
  NULL, NULL, 'sales_rep cannot create a customer (authorize_tenant blocks)');
-- Count as ownerC (an authority that sees ALL tenant-C rows under the M4D-scoped
-- read policy) — the blocked rep attempt must have added no event.
set local request.jwt.claims = '{"sub":"c0c00000-0000-4000-8000-000000000001","role":"authenticated"}';
select is((select count(*) from public.audit_events where tenant_id='33333333-3333-4333-8333-333333333333' and metadata->>'origin'='manual'), 1::bigint, 'no event from the blocked sales_rep create');

-- ownerC cannot mutate tenant B → cross-tenant blocked, no event.
set local request.jwt.claims = '{"sub":"c0c00000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok(
  $$ select public.update_customer('22222222-2222-4222-8222-222222222222', 'cb000000-0000-4000-8000-000000000001', 'Hijacked') $$,
  NULL, NULL, 'ownerC cannot update a tenant-B customer (cross-tenant)');
select is((select count(*) from public.audit_events where tenant_id='22222222-2222-4222-8222-222222222222'), 0::bigint, 'no cross-tenant event was written for tenant B');

-- ── 45. Tenant isolation of READS (ownerC cannot see tenant-B events) ──────
-- Seed a legit tenant-B event via ownerB, then confirm ownerC cannot read it.
set local request.jwt.claims = '{"sub":"b0b00000-0000-4000-8000-000000000001","role":"authenticated"}';
select public.update_customer('22222222-2222-4222-8222-222222222222', 'cb000000-0000-4000-8000-000000000001', 'Store B1 v2', null, '050-9b');
set local request.jwt.claims = '{"sub":"c0c00000-0000-4000-8000-000000000001","role":"authenticated"}';
select is((select count(*) from public.audit_events where tenant_id='22222222-2222-4222-8222-222222222222'), 0::bigint, 'ownerC cannot READ tenant-B audit events (RLS tenant isolation)');

-- ── 46. adminC (admin role) event actor is correct ─────────────────────────
set local request.jwt.claims = '{"sub":"c0c00000-0000-4000-8000-000000000003","role":"authenticated"}';
select public.create_customer('33333333-3333-4333-8333-333333333333', 'Admin Store');
set local request.jwt.claims = '{"sub":"c0c00000-0000-4000-8000-000000000001","role":"authenticated"}';
select is((select actor_user_id from public.audit_events where entity_id in (select id from public.customers where name='Admin Store')), 'c0c00000-0000-4000-8000-000000000003'::uuid, 'admin action is attributed to the admin actor');

-- ── 47a–c. sales_rep audit READ scope: only ASSIGNED customers (M4D) ───────
-- repC is a sales_rep assigned ONLY to ca…01. It must read that customer's
-- audit rows but NONE for the other (unassigned) customers — the M8G.2 read
-- policy scopes customer-category rows by can_access_customer.
set local request.jwt.claims = '{"sub":"c0c00000-0000-4000-8000-000000000002","role":"authenticated"}';
select ok((select count(*) from public.audit_events where entity_id='ca000000-0000-4000-8000-000000000001') > 0,
  'sales_rep CAN read audit rows for its ASSIGNED customer');
select is((select count(*) from public.audit_events where entity_type='customer' and entity_id <> 'ca000000-0000-4000-8000-000000000001'),
  0::bigint, 'sales_rep CANNOT read audit rows for UNASSIGNED customers (no M4D scope leak)');
-- Contrast: ownerC (owner) still sees those same unassigned-customer rows.
set local request.jwt.claims = '{"sub":"c0c00000-0000-4000-8000-000000000001","role":"authenticated"}';
select ok((select count(*) from public.audit_events where entity_type='customer' and entity_id <> 'ca000000-0000-4000-8000-000000000001') > 0,
  'owner retains tenant-wide visibility of every customer''s audit rows');

-- ── 47. All customer events use the closed vocabulary (no "Other") ─────────
reset role;
-- Scoped to CUSTOMER-entity rows: since M8H.1, audit_events also carries
-- order-entity rows (their own closed vocabulary is asserted in order_audit).
select is((select count(*) from public.audit_events where tenant_id='33333333-3333-4333-8333-333333333333'
  and entity_type = 'customer'
  and event_type not in ('customer.created','customer.updated','customer.activated','customer.deactivated',
    'customer.access_link.created','customer.access_link.rotated','customer.access_link.revoked','customer.order_linked')),
  0::bigint, 'every emitted customer event uses the closed customer vocabulary (no "Other")');

-- ── 48. created_at is DB-generated (not null, recent) ──────────────────────
select ok((select bool_and(created_at is not null) from public.audit_events where tenant_id='33333333-3333-4333-8333-333333333333'), 'created_at is database-generated on every event');

-- ── 49–51. Existing RPC signatures/security/grants preserved ───────────────
select is((select array_agg(pg_get_function_identity_arguments(oid) order by 1)
  from pg_proc where proname='revoke_customer_access_link'),
  array['p_tenant_id uuid, p_link_id uuid'], 'revoke_customer_access_link keeps its single 2-arg signature (no resurrected overload)');
select ok((select bool_and(prosecdef) from pg_proc where proname in
  ('create_customer','update_customer','set_customer_active','approve_customer_signup_request',
   'create_customer_from_order','link_order_to_customer','replace_customer_access_link','revoke_customer_access_link')),
  'all mutation RPCs remain SECURITY DEFINER');
select ok((select bool_and(has_function_privilege('authenticated', oid, 'EXECUTE')) from pg_proc where proname in
  ('create_customer','update_customer','set_customer_active','link_order_to_customer','replace_customer_access_link')),
  'mutation RPCs remain executable by authenticated (grants preserved)');

-- ── 52. Existing RPCs still present; no customer/order rows lost ───────────
select ok(
  exists(select 1 from pg_proc where proname='get_customer_stats_for_ids')
  and exists(select 1 from pg_proc where proname='search_product_page_ids')
  and (select count(*) from public.customers where tenant_id='33333333-3333-4333-8333-333333333333') >= 4,
  'M8F.3 stats + M8F.2 product-search RPCs intact; no customer rows lost');

select finish();
rollback;
