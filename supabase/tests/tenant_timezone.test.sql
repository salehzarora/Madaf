-- ═══════════════════════════════════════════════════════════════════════
-- pgTAP — M8H.2 Tenant TIMEZONE foundation
--
-- Verifies:
--   • tenants.timezone exists, is NOT NULL, and every EXISTING tenant was
--     backfilled with the approved initial IANA value;
--   • validation is enforced AT THE TABLE (a BEFORE INSERT OR UPDATE trigger
--     against pg_catalog.pg_timezone_names), so even a DIRECT table UPDATE —
--     which `authenticated` owner/admins hold a grant for — cannot persist an
--     invalid name, an empty string, a NULL, or a fixed offset like '+03:00'
--     (an offset cannot express DST);
--   • update_tenant_timezone is SECURITY DEFINER / search_path='' / owner+admin
--     only; sales_rep, non-members and cross-tenant callers are refused, and
--     p_tenant_id never self-authorizes; PUBLIC + anon cannot execute;
--   • changing the timezone rewrites NO instant: order / customer / audit
--     created_at values and customer origin are byte-identical afterwards;
--   • M8G/M8H audit RLS, producers and rows are untouched; no row is lost.
--
-- Run with the local stack up:  supabase test db
-- Disposable tenants C + B in THIS transaction; everything rolls back.
-- ═══════════════════════════════════════════════════════════════════════
begin;
select plan(62);

set local request.jwt.claims = '{"role":"service_role"}';

-- ── 1–3. The column ───────────────────────────────────────────────────────
select has_column('public', 'tenants', 'timezone', 'tenants.timezone exists');
select col_not_null('public', 'tenants', 'timezone', 'tenants.timezone is NOT NULL');
select is(
  (select count(*) from public.tenants where timezone <> 'Asia/Jerusalem'),
  0::bigint,
  'every pre-existing tenant was backfilled with the approved initial timezone');

-- ── Fixtures ──────────────────────────────────────────────────────────────
insert into auth.users (id) values
  ('c0c00000-0000-4000-8000-000000000001'),  -- ownerC
  ('c0c00000-0000-4000-8000-000000000002'),  -- repC (sales_rep)
  ('c0c00000-0000-4000-8000-000000000003'),  -- adminC
  ('c0c00000-0000-4000-8000-000000000009'),  -- outsider (no membership)
  ('b0b00000-0000-4000-8000-000000000001');  -- ownerB
insert into public.tenants (id, name_ar, name_he, name_en) values
  ('33333333-3333-4333-8333-333333333333', 'ج', 'ג', 'C'),
  ('22222222-2222-4222-8222-222222222222', 'ب', 'ב', 'B');
insert into public.tenant_users (tenant_id, user_id, role) values
  ('33333333-3333-4333-8333-333333333333', 'c0c00000-0000-4000-8000-000000000001', 'owner'),
  ('33333333-3333-4333-8333-333333333333', 'c0c00000-0000-4000-8000-000000000002', 'sales_rep'),
  ('33333333-3333-4333-8333-333333333333', 'c0c00000-0000-4000-8000-000000000003', 'admin'),
  ('22222222-2222-4222-8222-222222222222', 'b0b00000-0000-4000-8000-000000000001', 'owner');
insert into public.customers (id, tenant_id, name, customer_type, phone, origin, is_active, created_at) values
  ('ca000000-0000-4000-8000-000000000001', '33333333-3333-4333-8333-333333333333',
   'Store C1', 'grocery', '050-1', 'manual', true, '2026-07-13T09:57:17.908Z');
insert into public.orders (id, tenant_id, customer_id, order_number, public_ref, status, created_at) values
  ('60000000-0000-4000-8000-000000000001', '33333333-3333-4333-8333-333333333333',
   'ca000000-0000-4000-8000-000000000001', 'TZ-1', 'MDF-TZ001', 'new',
   '2026-07-13T09:57:17.908Z');
insert into public.audit_events (tenant_id, event_type, entity_type, entity_id, metadata, created_at) values
  ('33333333-3333-4333-8333-333333333333', 'customer.created', 'customer',
   'ca000000-0000-4000-8000-000000000001', '{"origin":"manual"}', '2026-07-13T09:57:17.908Z');

-- New tenants also default to the approved initial timezone.
select is(
  (select timezone from public.tenants where id='33333333-3333-4333-8333-333333333333'),
  'Asia/Jerusalem', 'a new tenant defaults to the approved initial timezone');

-- ── 5–7. VALID IANA names are accepted (direct table write) ───────────────
select lives_ok(
  $$ update public.tenants set timezone = 'UTC' where id='33333333-3333-4333-8333-333333333333' $$,
  'UTC is accepted');
select lives_ok(
  $$ update public.tenants set timezone = 'America/New_York' where id='33333333-3333-4333-8333-333333333333' $$,
  'another valid IANA zone (America/New_York) is accepted');
select lives_ok(
  $$ update public.tenants set timezone = 'Asia/Jerusalem' where id='33333333-3333-4333-8333-333333333333' $$,
  'Asia/Jerusalem is accepted');

-- ── 8–12. INVALID values are rejected AT THE TABLE (the trigger is the gate) ─
select throws_ok(
  $$ update public.tenants set timezone = 'Not/AZone' where id='33333333-3333-4333-8333-333333333333' $$,
  '22023', NULL, 'an unrecognized timezone is rejected (22023)');
select throws_ok(
  $$ update public.tenants set timezone = '' where id='33333333-3333-4333-8333-333333333333' $$,
  '22023', NULL, 'an empty timezone is rejected');
select throws_ok(
  $$ update public.tenants set timezone = '+03:00' where id='33333333-3333-4333-8333-333333333333' $$,
  '22023', NULL, 'a fixed offset (+03:00) is rejected — it cannot express DST');
select throws_ok(
  $$ update public.tenants set timezone = 'UTC+2' where id='33333333-3333-4333-8333-333333333333' $$,
  '22023', NULL, 'a UTC-offset string is rejected');
select throws_ok(
  $$ update public.tenants set timezone = null where id='33333333-3333-4333-8333-333333333333' $$,
  '22023', NULL, 'a NULL timezone is rejected');

-- ── FIXED-OFFSET ALIASES + LEGACY ABBREVIATIONS (Codex M8H2-02) ───────────
-- PostgreSQL RECOGNIZES every one of these — they are all in pg_timezone_names —
-- and every one of them breaks the DST contract. The picker never showed them, but
-- a crafted Server Action call or a permitted owner/admin table UPDATE could have
-- persisted them. The stored contract is now POSITIVE (UTC or Region/City), so the
-- TRIGGER refuses them on the direct table path too.
select throws_ok(
  $$ update public.tenants set timezone = 'Etc/GMT+3' where id='33333333-3333-4333-8333-333333333333' $$,
  '22023', NULL,
  'Etc/GMT+3 is rejected — a fixed offset, and POSIX-signed (it is really UTC-3)');
select throws_ok(
  $$ update public.tenants set timezone = 'Etc/GMT-2' where id='33333333-3333-4333-8333-333333333333' $$,
  '22023', NULL, 'Etc/GMT-2 is rejected');
select throws_ok(
  $$ update public.tenants set timezone = 'EST' where id='33333333-3333-4333-8333-333333333333' $$,
  '22023', NULL, 'EST is rejected — a legacy abbreviation pinned to one offset');
select throws_ok(
  $$ update public.tenants set timezone = 'HST' where id='33333333-3333-4333-8333-333333333333' $$,
  '22023', NULL, 'HST is rejected');
select throws_ok(
  $$ update public.tenants set timezone = 'MST' where id='33333333-3333-4333-8333-333333333333' $$,
  '22023', NULL, 'MST is rejected');
select throws_ok(
  $$ update public.tenants set timezone = 'Factory' where id='33333333-3333-4333-8333-333333333333' $$,
  '22023', NULL, 'Factory is rejected — an internal alias, not a place');
select throws_ok(
  $$ update public.tenants set timezone = 'posix/America/New_York' where id='33333333-3333-4333-8333-333333333333' $$,
  '22023', NULL, 'posix/* is rejected');
select throws_ok(
  $$ update public.tenants set timezone = 'right/UTC' where id='33333333-3333-4333-8333-333333333333' $$,
  '22023', NULL, 'right/* (leap-second) is rejected');
select throws_ok(
  $$ update public.tenants set timezone = '-0500' where id='33333333-3333-4333-8333-333333333333' $$,
  '22023', NULL, 'a bare negative offset is rejected');
-- …and PostgreSQL really does recognize them, which is exactly why the positive
-- Region/City rule (not a pg_timezone_names membership test) is what saves us.
select ok(
  exists (select 1 from pg_catalog.pg_timezone_names where name = 'Etc/GMT+3')
  and exists (select 1 from pg_catalog.pg_timezone_names where name = 'EST'),
  'PostgreSQL DOES recognize Etc/GMT+3 and EST — membership alone is not enough');
-- The legitimate multi-segment Region/City zones must still pass.
select lives_ok(
  $$ update public.tenants set timezone = 'America/Argentina/La_Rioja' where id='33333333-3333-4333-8333-333333333333' $$,
  'a multi-segment Region/City zone is still accepted');
select lives_ok(
  $$ update public.tenants set timezone = 'America/Port-au-Prince' where id='33333333-3333-4333-8333-333333333333' $$,
  'a hyphenated Region/City zone is still accepted');
select lives_ok(
  $$ update public.tenants set timezone = 'Africa/Abidjan' where id='33333333-3333-4333-8333-333333333333' $$,
  'a real Region/City zone with NO DST is not rejected for that reason');
select lives_ok(
  $$ update public.tenants set timezone = 'UTC' where id='33333333-3333-4333-8333-333333333333' $$,
  'UTC remains storable');

-- ── 13–14. Validation really uses PostgreSQL's own timezone data ──────────
select ok(public._is_valid_timezone('Asia/Jerusalem'), 'validator accepts a pg-recognized name');
select ok(not public._is_valid_timezone('Mars/Olympus'), 'validator rejects an unknown name');

-- ── ICU ⇄ PostgreSQL catalog compatibility ────────────────────────────────
-- The picker offers the RUNTIME's (Node/ICU) canonical zones; the database judges
-- them against ITS OWN (IANA) catalog. These are different datasets, so the awkward
-- ones are pinned here — including Nepal, where ECMA-402 hands us the deprecated
-- spelling `Asia/Katmandu` while IANA prefers `Asia/Kathmandu`. BOTH must be
-- accepted, or the UI would advertise a timezone that cannot be saved.
-- (`npm run check:timezone-catalog` proves the whole 418-name list against this
-- very function; this is the pinned regression subset.)
select ok(
  public._is_valid_timezone('Asia/Kathmandu')      -- IANA canonical (+05:45)
  and public._is_valid_timezone('Asia/Katmandu')   -- ICU/ECMA-402 canonical, same zone
  and public._is_valid_timezone('Pacific/Chatham')     -- +12:45 / +13:45
  and public._is_valid_timezone('Australia/Lord_Howe') -- 30-minute DST step
  and public._is_valid_timezone('Antarctica/Troll')    -- TWO-hour DST step
  and public._is_valid_timezone('America/Santiago')    -- nonexistent local midnight
  and public._is_valid_timezone('UTC'),
  'every awkward selectable zone (incl. both Kathmandu spellings) is DB-accepted');

-- ── 15–19. The write RPC: catalog + privileges ────────────────────────────
select has_function('public', 'update_tenant_timezone', array['uuid', 'text'],
  'update_tenant_timezone(uuid, text) exists');
select is(pg_get_function_result('public.update_tenant_timezone(uuid,text)'::regprocedure),
  'text', 'the RPC returns the persisted timezone');
select is((select prosecdef from pg_proc where oid='public.update_tenant_timezone(uuid,text)'::regprocedure),
  true, 'the RPC is SECURITY DEFINER');
select is((select array_to_string(proconfig, ',') from pg_proc where oid='public.update_tenant_timezone(uuid,text)'::regprocedure),
  'search_path=""', 'the RPC pins an EMPTY search_path');
select ok(
  not has_function_privilege('public', 'public.update_tenant_timezone(uuid,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.update_tenant_timezone(uuid,text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.update_tenant_timezone(uuid,text)', 'EXECUTE'),
  'PUBLIC + anon denied; authenticated granted (gated internally)');
-- service_role must not pick up a grant it has no use for.
select ok(
  not has_function_privilege('service_role', 'public.update_tenant_timezone(uuid,text)', 'EXECUTE'),
  'service_role has NO grant on the write RPC (it never needs one)');

-- ── The two PRIVATE helpers: no application role may execute them ─────────
-- PostgreSQL grants EXECUTE to PUBLIC on every new function by default. These are
-- internal (one probes pg_timezone_names, one is a trigger body) and no app role
-- ever calls them, so that default is revoked.
select ok(
  not has_function_privilege('public', 'public._is_valid_timezone(text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public._is_valid_timezone(text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public._is_valid_timezone(text)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public._is_valid_timezone(text)', 'EXECUTE'),
  '_is_valid_timezone is PRIVATE — PUBLIC/anon/authenticated/service_role all denied');
select ok(
  not has_function_privilege('public', 'public._tenants_validate_timezone()', 'EXECUTE')
  and not has_function_privilege('anon', 'public._tenants_validate_timezone()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public._tenants_validate_timezone()', 'EXECUTE')
  and not has_function_privilege('service_role', 'public._tenants_validate_timezone()', 'EXECUTE'),
  'the trigger function is PRIVATE — every application role is denied');
-- It must be SECURITY DEFINER, otherwise the trigger body would call
-- _is_valid_timezone as the CALLING role and the revoke above would break the
-- legitimate owner/admin write.
select is(
  (select prosecdef from pg_proc where oid='public._tenants_validate_timezone()'::regprocedure),
  true, 'the trigger function is SECURITY DEFINER (so the private helper stays private)');

-- ═══ owner ════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"c0c00000-0000-4000-8000-000000000001","role":"authenticated"}';

-- ── The privilege lockdown did NOT break the trigger ──────────────────────
-- A trigger function's EXECUTE privilege is checked when the trigger is CREATED,
-- not each time it fires — so validation still runs for a caller who cannot invoke
-- the helper at all. These three assertions are what make the revoke safe.
select throws_ok(
  $$ select public._is_valid_timezone('UTC') $$,
  '42501', NULL, 'an authenticated owner CANNOT call the private validator directly');
-- M8I.4 (PILOT-OPS-AUDIT-004): the direct authenticated tenants UPDATE grant +
-- policy were REMOVED so the owner/admin timezone RPC is the only write path (the
-- settings audit is non-bypassable). An owner can therefore no longer write the
-- column directly — BOTH a bad and a valid value are refused at the privilege
-- layer (42501). The trigger still guards the table (superuser tests above), and
-- a valid zone still saves through the RPC (tests 20-21 below).
select throws_ok(
  $$ update public.tenants set timezone = '+03:00'
       where id = '33333333-3333-4333-8333-333333333333' $$,
  '42501', NULL,
  'a direct authenticated tenants UPDATE (bad value) is denied — RPC-only after M8I.4');
select throws_ok(
  $$ update public.tenants set timezone = 'Pacific/Chatham'
       where id = '33333333-3333-4333-8333-333333333333' $$,
  '42501', NULL,
  'a direct authenticated tenants UPDATE (valid value) is also denied — RPC-only after M8I.4');

-- ── 20–21. owner can update; only the timezone changes ───────────────────
select is(
  (select public.update_tenant_timezone('33333333-3333-4333-8333-333333333333', 'Europe/London')),
  'Europe/London', 'owner can set the tenant timezone');
select is(
  (select timezone from public.tenants where id='33333333-3333-4333-8333-333333333333'),
  'Europe/London', 'the value is persisted');

-- ── 22. an invalid value through the RPC does NOT update ─────────────────
select throws_ok(
  $$ select public.update_tenant_timezone('33333333-3333-4333-8333-333333333333', '+03:00') $$,
  '22023', NULL, 'the RPC rejects a fixed offset');
-- The RPC path must refuse the recognized-but-unstorable aliases too: this is the
-- endpoint a crafted Server Action call would reach.
select throws_ok(
  $$ select public.update_tenant_timezone('33333333-3333-4333-8333-333333333333', 'Etc/GMT+3') $$,
  '22023', NULL, 'the RPC rejects Etc/GMT+3');
select throws_ok(
  $$ select public.update_tenant_timezone('33333333-3333-4333-8333-333333333333', 'EST') $$,
  '22023', NULL, 'the RPC rejects EST');
select throws_ok(
  $$ select public.update_tenant_timezone('33333333-3333-4333-8333-333333333333', 'Factory') $$,
  '22023', NULL, 'the RPC rejects Factory');
select is(
  (select timezone from public.tenants where id='33333333-3333-4333-8333-333333333333'),
  'Europe/London', 'a rejected update left the previous value intact');

-- ── 24. cross-tenant update is refused (p_tenant_id never self-authorizes) ─
select throws_ok(
  $$ select public.update_tenant_timezone('22222222-2222-4222-8222-222222222222', 'UTC') $$,
  '42501', NULL, 'owner of C cannot set tenant B''s timezone');

-- ═══ admin ════════════════════════════════════════════════════════════════
set local request.jwt.claims = '{"sub":"c0c00000-0000-4000-8000-000000000003","role":"authenticated"}';
select is(
  (select public.update_tenant_timezone('33333333-3333-4333-8333-333333333333', 'Asia/Jerusalem')),
  'Asia/Jerusalem', 'admin can set the tenant timezone');

-- ═══ sales_rep ════════════════════════════════════════════════════════════
set local request.jwt.claims = '{"sub":"c0c00000-0000-4000-8000-000000000002","role":"authenticated"}';
select throws_ok(
  $$ select public.update_tenant_timezone('33333333-3333-4333-8333-333333333333', 'UTC') $$,
  '42501', NULL, 'a sales_rep CANNOT change the timezone');

-- ═══ non-member ═══════════════════════════════════════════════════════════
set local request.jwt.claims = '{"sub":"c0c00000-0000-4000-8000-000000000009","role":"authenticated"}';
select throws_ok(
  $$ select public.update_tenant_timezone('33333333-3333-4333-8333-333333333333', 'UTC') $$,
  '42501', NULL, 'a non-member CANNOT change the timezone');

-- ═══ Timestamps are NOT rewritten ═════════════════════════════════════════
reset role;

-- ── 29–32. The stored INSTANTS are byte-identical after all those changes ─
select is(
  (select created_at from public.orders where id='60000000-0000-4000-8000-000000000001'),
  '2026-07-13T09:57:17.908Z'::timestamptz,
  'the order created_at instant is UNCHANGED by timezone edits');
select is(
  (select created_at from public.customers where id='ca000000-0000-4000-8000-000000000001'),
  '2026-07-13T09:57:17.908Z'::timestamptz,
  'the customer created_at instant is UNCHANGED');
select is(
  (select created_at from public.audit_events
    where tenant_id='33333333-3333-4333-8333-333333333333' limit 1),
  '2026-07-13T09:57:17.908Z'::timestamptz,
  'the audit_event created_at instant is UNCHANGED');
select is(
  (select origin::text from public.customers where id='ca000000-0000-4000-8000-000000000001'),
  'manual', 'M8G.1 customer origin is UNCHANGED');

-- ── 33. The SAME instant simply RENDERS differently per zone (the whole point) ─
select is(
  to_char(
    ('2026-07-13T09:57:17.908Z'::timestamptz at time zone 'Asia/Jerusalem'), 'HH24:MI'),
  '12:57', '09:57Z is 12:57 in Asia/Jerusalem (summer, +03)');
select is(
  to_char(
    ('2026-01-13T09:57:17.908Z'::timestamptz at time zone 'Asia/Jerusalem'), 'HH24:MI'),
  '11:57', 'the SAME wall clock is 11:57 in winter (+02) — no fixed offset');

-- ── 35–36. list_memberships carries the timezone (no extra query) ─────────
select has_function('public', 'list_memberships', array[]::text[],
  'list_memberships() still exists with no arguments');
select is(
  pg_get_function_result('public.list_memberships()'::regprocedure),
  'TABLE(tenant_id uuid, role tenant_role, name_ar text, name_he text, name_en text, timezone text)',
  'list_memberships now returns the tenant timezone too');

-- ── 37–38. No audit / RLS / producer regression; nothing lost ─────────────
select ok(
  (select count(*) from pg_policies where tablename='audit_events' and cmd='SELECT') = 1
  and (select bool_and(prosecdef) from pg_proc where proname in
        ('_log_customer_audit_event') ) is not null
  and exists (select 1 from pg_proc where proname='_log_order_audit_event'),
  'M8G/M8H audit policy + producers remain intact');
select ok(
  (select count(*) from public.tenants) >= 3
  and (select count(*) from public.orders where tenant_id='33333333-3333-4333-8333-333333333333') = 1
  and (select count(*) from public.customers where tenant_id='33333333-3333-4333-8333-333333333333') = 1,
  'no tenant / order / customer row was lost');

select finish();
rollback;
