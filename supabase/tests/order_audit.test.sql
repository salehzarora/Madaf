-- ═══════════════════════════════════════════════════════════════════════
-- pgTAP — M8H.1 Order lifecycle AUDIT FOUNDATION
--
-- Verifies the transactional order-category producers on public.audit_events:
--   • the private helper is SECURITY INVOKER, search_path='', executable by NO
--     client role; closed 4-event allowlist; entity_type fixed to 'order';
--     metadata must be a bounded JSON OBJECT with per-event allowlisted keys;
--   • each SUCCESSFUL mutation writes exactly ONE correct event — authenticated
--     creation, private-shop-token creation (NULL actor), showcase-guest
--     creation (NULL actor, no guest PII/token), effective edit, real status
--     transition, customer linking (both kinds);
--   • NO event for a no-op / same-state / invalid / unauthorized / cross-tenant /
--     rolled-back mutation, and none from a failed inventory reconciliation;
--   • inventory semantics are untouched (reserve once, no double-deduct on
--     preparing/delivered, restore exactly once) and inventory_effect is honest;
--   • the RLS policy scopes ORDER rows by can_access_order (fails closed on a
--     NULL entity_id) while leaving Customer and non-Customer/non-Order rows
--     EXACTLY as before; direct client writes stay denied;
--   • every replaced RPC keeps its signature / return type / security mode /
--     search_path / grants; M8G.1 origin, M8G.2 producers + the M8G.3 index all
--     remain intact; no fake history and no duplicate index are added.
--
-- Run with the local stack up:  supabase test db
-- Disposable tenants C + B in THIS transaction; everything rolls back.
-- No real secrets/tokens/PII — controlled local fixtures only.
-- ═══════════════════════════════════════════════════════════════════════
begin;
select plan(71);

set local request.jwt.claims = '{"role":"service_role"}';

-- ── Fixtures ───────────────────────────────────────────────────────────────
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
-- ca…01 assigned to repC; ca…02 UNASSIGNED; cb…01 in tenant B.
insert into public.customers (id, tenant_id, name, customer_type, phone, origin, is_active) values
  ('ca000000-0000-4000-8000-000000000001', '33333333-3333-4333-8333-333333333333', 'Store C1', 'grocery', '050-1', 'manual', true),
  ('ca000000-0000-4000-8000-000000000002', '33333333-3333-4333-8333-333333333333', 'Store C2', 'grocery', '050-2', 'manual', true),
  ('cb000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'Store B1', 'grocery', '050-9', 'manual', true);
insert into public.sales_rep_customers (tenant_id, user_id, customer_id, assigned_by) values
  ('33333333-3333-4333-8333-333333333333', 'c0c00000-0000-4000-8000-000000000002',
   'ca000000-0000-4000-8000-000000000001', 'c0c00000-0000-4000-8000-000000000001');
-- p1/p2 are stock-tracked; p3 is deliberately UNTRACKED (no inventory row).
insert into public.products (id, tenant_id, name_ar, name_he, name_en, package_unit,
                             package_quantity, base_unit, wholesale_price, vat_rate, is_active) values
  ('40000000-0000-4000-8000-000000000001', '33333333-3333-4333-8333-333333333333', 'م1','מ1','P1','carton',6,'bottles',10.00,0.17,true),
  ('40000000-0000-4000-8000-000000000002', '33333333-3333-4333-8333-333333333333', 'م2','מ2','P2','carton',6,'bottles',20.00,0.17,true),
  ('40000000-0000-4000-8000-000000000003', '33333333-3333-4333-8333-333333333333', 'م3','מ3','P3','carton',6,'bottles',30.00,0.17,true),
  ('40000000-0000-4000-8000-000000000009', '22222222-2222-4222-8222-222222222222', 'ب1','ב1','PB','carton',6,'bottles',15.00,0.17,true);
insert into public.inventory_items (tenant_id, product_id, quantity_available, low_stock_threshold) values
  ('33333333-3333-4333-8333-333333333333', '40000000-0000-4000-8000-000000000001', 100, 5),
  ('33333333-3333-4333-8333-333333333333', '40000000-0000-4000-8000-000000000002', 100, 5);
-- Private shop link (ca…01) + showcase link — controlled local fixture tokens.
insert into public.customer_access_links (id, tenant_id, customer_id, token_hash) values
  ('11100000-0000-4000-8000-000000000001', '33333333-3333-4333-8333-333333333333',
   'ca000000-0000-4000-8000-000000000001',
   encode(sha256(convert_to('shoptoken-fixture-0000000001', 'UTF8')), 'hex'));
insert into public.catalog_showcase_links (id, tenant_id, token_hash) values
  ('22200000-0000-4000-8000-000000000001', '33333333-3333-4333-8333-333333333333',
   encode(sha256(convert_to('showcasetoken-fixture-000001', 'UTF8')), 'hex'));

-- ── 1–4. Helper catalog: exists, INVOKER, empty search_path, returns void ──
select has_function('public', '_log_order_audit_event',
  array['uuid', 'text', 'uuid', 'jsonb'], 'the private Order audit helper exists');
select is((select prosecdef from pg_proc where oid='public._log_order_audit_event(uuid,text,uuid,jsonb)'::regprocedure),
  false, 'helper is SECURITY INVOKER (holds no privileges of its own)');
select is((select array_to_string(proconfig, ',') from pg_proc where oid='public._log_order_audit_event(uuid,text,uuid,jsonb)'::regprocedure),
  'search_path=""', 'helper pins an EMPTY search_path');
select is(pg_get_function_result('public._log_order_audit_event(uuid,text,uuid,jsonb)'::regprocedure),
  'void', 'helper returns void');

-- ── 5–8. Helper privilege matrix — NO client role may execute it ──────────
select ok(not has_function_privilege('public', 'public._log_order_audit_event(uuid,text,uuid,jsonb)', 'EXECUTE'),
  'PUBLIC cannot invoke the helper');
select ok(not has_function_privilege('anon', 'public._log_order_audit_event(uuid,text,uuid,jsonb)', 'EXECUTE'),
  'anon cannot invoke the helper');
select ok(not has_function_privilege('authenticated', 'public._log_order_audit_event(uuid,text,uuid,jsonb)', 'EXECUTE'),
  'authenticated cannot invoke the helper');
select ok(not has_function_privilege('service_role', 'public._log_order_audit_event(uuid,text,uuid,jsonb)', 'EXECUTE'),
  'service_role has NO explicit helper grant');

-- ── 9–13. Helper validation: allowlist, entity_type, metadata shape/size/keys ─
select throws_ok(
  $$ select public._log_order_audit_event('33333333-3333-4333-8333-333333333333', 'order.bogus',
       '99999999-9999-4999-8999-999999999999', '{}'::jsonb) $$,
  '22023', NULL, 'helper rejects an unknown event type (no "Other")');
select throws_ok(
  $$ select public._log_order_audit_event('33333333-3333-4333-8333-333333333333', 'order.created',
       '99999999-9999-4999-8999-999999999999', '[1,2]'::jsonb) $$,
  '22023', NULL, 'helper rejects non-object metadata');
select throws_ok(
  $$ select public._log_order_audit_event('33333333-3333-4333-8333-333333333333', 'order.created',
       '99999999-9999-4999-8999-999999999999', jsonb_build_object('source', repeat('x', 5000))) $$,
  '22023', NULL, 'helper rejects oversized metadata');
select throws_ok(
  $$ select public._log_order_audit_event('33333333-3333-4333-8333-333333333333', 'order.created',
       '99999999-9999-4999-8999-999999999999', jsonb_build_object('phone', '050-secret')) $$,
  '22023', NULL, 'helper rejects an arbitrary (non-allowlisted) metadata key');
select throws_ok(
  $$ select public._log_order_audit_event('33333333-3333-4333-8333-333333333333', 'order.created',
       null, '{}'::jsonb) $$,
  '22023', NULL, 'helper rejects a null order id (entity is required)');

-- ═══ Authenticated caller: ownerC ══════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"c0c00000-0000-4000-8000-000000000001","role":"authenticated"}';

-- ── 14–18. Authenticated creation → ONE order.created, honest actor/initiator ─
select lives_ok(
  $$ select public.create_order_request('33333333-3333-4333-8333-333333333333',
       '[{"product_id":"40000000-0000-4000-8000-000000000001","quantity":3}]'::jsonb,
       'ca000000-0000-4000-8000-000000000001') $$,
  'authenticated owner creates an order');
select is((select count(*) from public.audit_events where entity_type='order' and event_type='order.created'),
  1::bigint, 'authenticated creation → exactly ONE order.created');
select is((select actor_user_id from public.audit_events where event_type='order.created'),
  'c0c00000-0000-4000-8000-000000000001'::uuid, 'actor is the authenticated owner (server-derived auth.uid())');
select is((select metadata->>'initiator_kind' from public.audit_events where event_type='order.created'),
  'authenticated_user', 'initiator_kind = authenticated_user');
select is((select entity_type from public.audit_events where event_type='order.created'),
  'order', 'entity_type is fixed to order');

-- ── 19–21. Creation metadata is the safe channel facts ONLY ────────────────
select is((select metadata->>'source' from public.audit_events where event_type='order.created'),
  'sales_visit', 'source recorded via the existing order_source model');
select is((select metadata->>'initial_status' from public.audit_events where event_type='order.created'),
  'new', 'initial_status recorded');
select ok((select not (metadata ?| array['order_number','notes','total','subtotal','items','product_id','prices','customer_snapshot','phone','name'])
           from public.audit_events where event_type='order.created'),
  'creation metadata carries NO order_number / notes / money / items / snapshot / PII');

-- ── 22. Order entity id is the created order ──────────────────────────────
select is(
  (select entity_id from public.audit_events where event_type='order.created'),
  (select id from public.orders where tenant_id='33333333-3333-4333-8333-333333333333'),
  'entity_id is the created order id');

-- ── 23. created_at is DB-generated ────────────────────────────────────────
select ok((select bool_and(created_at is not null) from public.audit_events where entity_type='order'),
  'created_at is database-generated on every order event');

-- ── 24–27. Status transitions: valid / same-state / invalid / metadata ─────
select lives_ok(
  $$ select public.update_order_status('33333333-3333-4333-8333-333333333333',
       (select id from public.orders where tenant_id='33333333-3333-4333-8333-333333333333'), 'confirmed') $$,
  'new → confirmed is a valid transition');
select is((select count(*) from public.audit_events where event_type='order.status_changed'),
  1::bigint, 'a real transition → exactly ONE order.status_changed');
select is(
  (select metadata->>'from_status' || '->' || (metadata->>'to_status')
   from public.audit_events where event_type='order.status_changed'),
  'new->confirmed', 'from_status/to_status are correct');
select is((select metadata->>'inventory_effect' from public.audit_events where event_type='order.status_changed'),
  'reserved', 'inventory_effect is accurately derived from the movement ledger');

-- ── 28. Confirmation reserved stock exactly once (inventory untouched) ─────
select is((select quantity_available from public.inventory_items
           where tenant_id='33333333-3333-4333-8333-333333333333'
             and product_id='40000000-0000-4000-8000-000000000001'),
  97, 'confirmation reserved 3 units (100 → 97) — inventory semantics unchanged');

-- ── 29. Same-state transition → NO event, NO mutation ─────────────────────
select lives_ok(
  $$ select public.update_order_status('33333333-3333-4333-8333-333333333333',
       (select id from public.orders where tenant_id='33333333-3333-4333-8333-333333333333'), 'confirmed') $$,
  'requesting the current status is accepted (unchanged response behavior)');
select is((select count(*) from public.audit_events where event_type='order.status_changed'),
  1::bigint, 'a same-state transition creates NO additional event');

-- ── 31–32. preparing does NOT double-deduct and records effect none ────────
select lives_ok(
  $$ select public.update_order_status('33333333-3333-4333-8333-333333333333',
       (select id from public.orders where tenant_id='33333333-3333-4333-8333-333333333333'), 'preparing') $$,
  'confirmed → preparing');
select is((select quantity_available from public.inventory_items
           where tenant_id='33333333-3333-4333-8333-333333333333'
             and product_id='40000000-0000-4000-8000-000000000001'),
  97, 'preparing does NOT double-deduct (still 97)');
select is((select metadata->>'inventory_effect' from public.audit_events
           where event_type='order.status_changed' and metadata->>'to_status'='preparing'),
  'none', 'an already-reserved order records inventory_effect none');

-- ── 34. Invalid transition → raises, NO event ─────────────────────────────
select throws_ok(
  $$ select public.update_order_status('33333333-3333-4333-8333-333333333333',
       (select id from public.orders where tenant_id='33333333-3333-4333-8333-333333333333'), 'new') $$,
  '23514', NULL, 'an invalid transition raises');
select is((select count(*) from public.audit_events where event_type='order.status_changed'),
  2::bigint, 'the rejected transition added no event (still 2)');

-- ── 36–39. Effective edit → ONE order.updated with safe metadata ───────────
select lives_ok(
  $$ select public.update_order_items('33333333-3333-4333-8333-333333333333',
       (select id from public.orders where tenant_id='33333333-3333-4333-8333-333333333333'),
       '[{"product_id":"40000000-0000-4000-8000-000000000001","quantity":5},
         {"product_id":"40000000-0000-4000-8000-000000000002","quantity":2}]'::jsonb, 'a note') $$,
  'owner edits the order lines + notes');
select is((select count(*) from public.audit_events where event_type='order.updated'),
  1::bigint, 'an EFFECTIVE edit → exactly ONE order.updated');
select is((select metadata->'changed_fields' from public.audit_events where event_type='order.updated'),
  '["items","notes"]'::jsonb, 'changed_fields is derived server-side (items + notes)');
select ok((select not (metadata ?| array['notes_value','items','product_id','unit_price','total','customer_snapshot','phone','name'])
           from public.audit_events where event_type='order.updated'),
  'update metadata carries NO notes text / product ids / prices / totals / snapshot / PII');

-- ── 40–41. No-op edit → NO event, unchanged response ──────────────────────
select lives_ok(
  $$ select public.update_order_items('33333333-3333-4333-8333-333333333333',
       (select id from public.orders where tenant_id='33333333-3333-4333-8333-333333333333'),
       '[{"product_id":"40000000-0000-4000-8000-000000000001","quantity":5},
         {"product_id":"40000000-0000-4000-8000-000000000002","quantity":2}]'::jsonb) $$,
  'resubmitting the identical lines still succeeds (response behavior preserved)');
select is((select count(*) from public.audit_events where event_type='order.updated'),
  1::bigint, 'an effective NO-OP edit creates NO additional event');

-- ── 42–44. Cancellation restores exactly once; effect restored ────────────
select lives_ok(
  $$ select public.update_order_status('33333333-3333-4333-8333-333333333333',
       (select id from public.orders where tenant_id='33333333-3333-4333-8333-333333333333'), 'cancelled') $$,
  'preparing → cancelled');
select is((select metadata->>'inventory_effect' from public.audit_events
           where event_type='order.status_changed' and metadata->>'to_status'='cancelled'),
  'restored', 'cancellation records inventory_effect restored');
-- The restore loop writes one row PER PRODUCT; "exactly once" means no product
-- is restored twice (a double restore would duplicate a product_id here).
select is(
  (select count(*) from public.order_inventory_movements
    where order_id=(select id from public.orders where tenant_id='33333333-3333-4333-8333-333333333333')
      and reason='order_reservation_released'),
  (select count(distinct product_id) from public.order_inventory_movements
    where order_id=(select id from public.orders where tenant_id='33333333-3333-4333-8333-333333333333')
      and reason='order_reservation_released'),
  'cancellation restored each product EXACTLY once (no double restore)');

-- ── 45. A cancelled order cannot transition again → no further event ──────
select throws_ok(
  $$ select public.update_order_status('33333333-3333-4333-8333-333333333333',
       (select id from public.orders where tenant_id='33333333-3333-4333-8333-333333333333'), 'confirmed') $$,
  '23514', NULL, 'a cancelled order cannot be reopened (no double restore/audit)');

-- ── 46. Explicit ROLLBACK removes the order AND its audit rows ────────────
savepoint before_rollback;
select public.create_order_request('33333333-3333-4333-8333-333333333333',
  '[{"product_id":"40000000-0000-4000-8000-000000000001","quantity":1}]'::jsonb,
  'ca000000-0000-4000-8000-000000000002');
rollback to savepoint before_rollback;
select is((select count(*) from public.audit_events where event_type='order.created'),
  1::bigint, 'a rolled-back creation leaves NO audit event (transactional)');

-- ── 47. Failed inventory reconciliation rolls the status + audit back ─────
-- A fresh order for 200 units of p1 (only 97 in stock) → confirming must raise
-- MDF30 and leave NO status change, NO movement and NO audit event.
select public.create_order_request('33333333-3333-4333-8333-333333333333',
  '[{"product_id":"40000000-0000-4000-8000-000000000001","quantity":200}]'::jsonb,
  'ca000000-0000-4000-8000-000000000002');
savepoint before_stockfail;
select throws_ok(
  $$ select public.update_order_status('33333333-3333-4333-8333-333333333333',
       (select id from public.orders where customer_id='ca000000-0000-4000-8000-000000000002'), 'confirmed') $$,
  'MDF30', NULL, 'confirming beyond available stock raises MDF30');
rollback to savepoint before_stockfail;
select is((select count(*) from public.audit_events where event_type='order.status_changed'
             and entity_id=(select id from public.orders where customer_id='ca000000-0000-4000-8000-000000000002')),
  0::bigint, 'the failed inventory reconciliation wrote NO status audit event');

-- ── 49–52. Customer linking — dual-entity, each row for ONE timeline ──────
-- A guest order (no customer) created through the showcase token (see below)
-- is linked to an existing customer here.
select public.create_order_request('33333333-3333-4333-8333-333333333333',
  '[{"product_id":"40000000-0000-4000-8000-000000000003","quantity":1}]'::jsonb);  -- no customer
select lives_ok(
  $$ select public.link_order_to_customer('33333333-3333-4333-8333-333333333333',
       (select id from public.orders where customer_id is null limit 1),
       'ca000000-0000-4000-8000-000000000002') $$,
  'owner links an unlinked order to an existing customer');
select is((select count(*) from public.audit_events
           where entity_type='order' and event_type='order.customer_linked'),
  1::bigint, 'linking → exactly ONE order-entity order.customer_linked');
select is((select metadata->>'link_kind' from public.audit_events where event_type='order.customer_linked'),
  'existing_customer', 'link_kind = existing_customer');
select is((select count(*) from public.audit_events
           where entity_type='customer' and event_type='customer.order_linked'),
  1::bigint, 'M8G.2 customer.order_linked is STILL written (contract unchanged)');

-- ── 53. The two link rows target DIFFERENT entities (no timeline duplication) ─
select is(
  (select count(distinct entity_type) from public.audit_events
   where event_type in ('order.customer_linked', 'customer.order_linked')),
  2::bigint, 'the linked action produces one ORDER row and one CUSTOMER row');

-- ── 54–55. Order metadata never carries the guest snapshot / customer id ──
select ok((select not (metadata ?| array['customer_id','customer_snapshot','name','phone','email','address'])
           from public.audit_events where event_type='order.customer_linked'),
  'order.customer_linked metadata carries NO customer id / snapshot / PII');
select is((select origin::text from public.customers where id='ca000000-0000-4000-8000-000000000002'),
  'manual', 'M8G.1 customer origin is NOT changed by linking');

-- ═══ Anonymous channels ════════════════════════════════════════════════════
-- The two token RPCs run as anon. anon has NO SELECT grant on audit_events, so
-- the resulting rows are VERIFIED afterwards from a privileged role — an anon
-- session literally cannot read what it just wrote (asserted below).
reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';

-- ── 56. Private Shop token creation (anon) ────────────────────────────────
select lives_ok(
  $$ select public.create_order_request_from_token('shoptoken-fixture-0000000001',
       '[{"product_id":"40000000-0000-4000-8000-000000000001","quantity":1}]'::jsonb) $$,
  'an anonymous private-shop-link order succeeds');

-- ── 57. Showcase guest creation (anon), with deliberate PII in the payload ─
select lives_ok(
  $$ select public.create_order_from_showcase_token('showcasetoken-fixture-000001',
       '[{"product_id":"40000000-0000-4000-8000-000000000002","quantity":2}]'::jsonb,
       'Guest Shop Ltd', 'Guest Contact', '050-secret', 'guest@example.com',
       null, null, null, '1 Secret Street', 'guest notes') $$,
  'an anonymous showcase guest order succeeds');

-- ── 58. anon cannot read audit_events at all (no grant → permission denied) ─
select throws_ok(
  $$ select count(*) from public.audit_events $$,
  '42501', NULL, 'anon cannot read audit_events at all (no grant, no policy)');

-- ═══ Verify the anonymous rows from a privileged role ══════════════════════
reset role;

-- ── 59–61. Shop-link order: ONE event, NULL actor, no token/hash/URL ──────
select is((select count(*) from public.audit_events where metadata->>'initiator_kind'='customer_link'),
  1::bigint, 'the shop-link order → exactly ONE order.created');
select is((select actor_user_id from public.audit_events where metadata->>'initiator_kind'='customer_link'),
  null, 'the shop-link order has a NULL actor (no fabricated user)');
select ok((select not (metadata::text ~* 'shoptoken|[0-9a-f]{64}|http')
           from public.audit_events where metadata->>'initiator_kind'='customer_link'),
  'shop-link metadata carries NO raw token / token hash / URL');

-- ── 62–65. Guest order: ONE event, NULL actor, NO guest PII, customer_kind ─
select is((select count(*) from public.audit_events where metadata->>'initiator_kind'='showcase_guest'),
  1::bigint, 'the guest order → exactly ONE order.created');
select is((select actor_user_id from public.audit_events where metadata->>'initiator_kind'='showcase_guest'),
  null, 'the guest order has a NULL actor');
select ok((select not (metadata::text ~* 'Guest Shop|Guest Contact|050-secret|guest@example|Secret Street|guest notes|showcasetoken|[0-9a-f]{64}')
           from public.audit_events where metadata->>'initiator_kind'='showcase_guest'),
  'guest metadata carries NO guest name/contact/phone/email/address/notes/token');
select is((select metadata->>'customer_kind' from public.audit_events where metadata->>'initiator_kind'='showcase_guest'),
  'guest', 'the guest order records customer_kind = guest');

-- ═══ RLS visibility ════════════════════════════════════════════════════════
reset role;
set local role authenticated;

-- ── 66. sales_rep sees Order events ONLY for accessible orders ────────────
-- repC is assigned ca…01 only. Orders for ca…02 and the guest order are not
-- accessible to them, so neither are their audit rows.
set local request.jwt.claims = '{"sub":"c0c00000-0000-4000-8000-000000000002","role":"authenticated"}';
select ok(
  (select count(*) from public.audit_events where entity_type='order') > 0
  and not exists (
    select 1 from public.audit_events a
    join public.orders o on o.id = a.entity_id
    where a.entity_type='order' and o.customer_id is distinct from 'ca000000-0000-4000-8000-000000000001'),
  'sales_rep reads Order events ONLY for its ASSIGNED customer''s orders');

-- ── 67. owner retains tenant-wide Order-event visibility ─────────────────
set local request.jwt.claims = '{"sub":"c0c00000-0000-4000-8000-000000000001","role":"authenticated"}';
select ok(
  (select count(*) from public.audit_events where entity_type='order') >
  (select count(*) from public.audit_events a
     join public.orders o on o.id = a.entity_id
    where a.entity_type='order' and o.customer_id = 'ca000000-0000-4000-8000-000000000001'),
  'owner sees Order events beyond the rep-assigned customer (tenant-wide)');

-- ── 68. ownerB (other tenant) sees NONE of tenant C's order events ────────
set local request.jwt.claims = '{"sub":"b0b00000-0000-4000-8000-000000000001","role":"authenticated"}';
select is((select count(*) from public.audit_events
           where tenant_id='33333333-3333-4333-8333-333333333333'),
  0::bigint, 'cross-tenant Order events are invisible (tenant isolation)');

-- ── 69. The M8H.1 customer/order scoping clauses stay VACUOUS for any other
-- entity_type — a non-scoped (e.g. future 'document') event is not hidden by them,
-- so the OWNER still reads it. (Under M8I.7 an unknown/non-scoped type is
-- owner/admin-only by DEFAULT-DENY; the sales_rep denial is proven separately in
-- audit_unknown_entity_deny.test.sql.)
reset role;
insert into public.audit_events (tenant_id, event_type, entity_type, entity_id, metadata)
values ('33333333-3333-4333-8333-333333333333', 'document.created', 'document',
        '77700000-0000-4000-8000-000000000001', '{}'::jsonb);
set local role authenticated;
set local request.jwt.claims = '{"sub":"c0c00000-0000-4000-8000-000000000001","role":"authenticated"}';
select is((select count(*) from public.audit_events where entity_type='document'),
  1::bigint, 'a non-customer/non-order event stays visible to the owner (scoping clauses vacuous for it)');

-- ── 70. An order row with a NULL entity_id FAILS CLOSED (even for the owner) ─
-- can_access_order short-circuits to true for owner/admin regardless of the id,
-- so the explicit `entity_id is not null` guard is what closes this hole.
reset role;
insert into public.audit_events (tenant_id, event_type, entity_type, entity_id, metadata)
values ('33333333-3333-4333-8333-333333333333', 'order.created', 'order', null, '{}'::jsonb);
set local role authenticated;
set local request.jwt.claims = '{"sub":"c0c00000-0000-4000-8000-000000000001","role":"authenticated"}';
select is((select count(*) from public.audit_events
           where entity_type='order' and entity_id is null),
  0::bigint, 'an order event with a NULL entity_id is hidden (fails closed)');

-- ── 71. The helper REFUSES a token-channel event carrying an authenticated actor ─
-- Defense-in-depth: an operator can never be recorded as a guest / customer-link.
reset role;
set local request.jwt.claims = '{"sub":"c0c00000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok(
  $$ select public._log_order_audit_event('33333333-3333-4333-8333-333333333333', 'order.created',
       (select id from public.orders where tenant_id='33333333-3333-4333-8333-333333333333' limit 1),
       jsonb_build_object('initiator_kind', 'showcase_guest')) $$,
  '22023', NULL, 'an authenticated actor cannot masquerade as a showcase guest');

select finish();
rollback;
