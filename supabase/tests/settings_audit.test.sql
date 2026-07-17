-- ═══════════════════════════════════════════════════════════════════════
-- pgTAP — M8I.4 TENANT SETTINGS & TIMEZONE AUDIT (PILOT-OPS-AUDIT-004)
--
-- Verifies the transactional Settings producers on public.audit_events:
--   • the private helper is SECURITY INVOKER, search_path='', executable by NO
--     client role; closed 3-event allowlist; entity_type='settings';
--     entity_id=tenant_id; STRICT metadata validation (canonical unique
--     allowlisted changed_fields; safe {from,to} only for approved fields;
--     sensitive fields keys-only; timezone exact contract; secret/unknown keys
--     rejected);
--   • each RPC emits exactly the right event with canonical changed_fields +
--     safe before/after (display_vat_rate / country_code / default_vat_rate /
--     invoice_language / legal_invoicing_ready / timezone) and NEVER a sensitive
--     value; a canonical no-op (incl. whitespace/case) emits nothing and returns
--     the established shape; tax first-create emits one tax_updated;
--   • the direct authenticated tenants UPDATE is denied while SELECT + the RPCs
--     still work and onboarding is unaffected;
--   • the audit_events RLS scopes settings rows to owner/admin (sales_rep + other
--     tenant read none), leaving customer/order/product/inventory/team intact;
--   • the three RPCs keep their signatures / DEFINER / grants; the partial index
--     exists.
--
-- Run with the local stack up:  supabase test db
-- Disposable tenants T + T2 in THIS transaction; everything rolls back.
-- ═══════════════════════════════════════════════════════════════════════
begin;
select plan(83);

set local request.jwt.claims = '{"role":"service_role"}';

-- ── Fixtures ───────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('50000000-0000-4000-8000-000000000001', 'owner@s.local'),
  ('50000000-0000-4000-8000-000000000002', 'admin@s.local'),
  ('50000000-0000-4000-8000-000000000003', 'rep@s.local'),
  ('50000000-0000-4000-8000-000000000009', 'newbie@s.local'),
  ('60000000-0000-4000-8000-000000000001', 'owner@s2.local');
insert into public.tenants (id, name_ar, name_he, name_en) values
  ('55555555-5555-4555-8555-555555555555', 'ت', 'ט', 'Ten-EN'),
  ('66666666-6666-4666-8666-666666666666', 'ت٢', 'ט٢', 'Ten2-EN');
insert into public.tenant_users (tenant_id, user_id, role) values
  ('55555555-5555-4555-8555-555555555555', '50000000-0000-4000-8000-000000000001', 'owner'),
  ('55555555-5555-4555-8555-555555555555', '50000000-0000-4000-8000-000000000002', 'admin'),
  ('55555555-5555-4555-8555-555555555555', '50000000-0000-4000-8000-000000000003', 'sales_rep'),
  ('66666666-6666-4666-8666-666666666666', '60000000-0000-4000-8000-000000000001', 'owner');

-- ══ 1–8. Helper: exists, INVOKER, empty search_path, void, no client execute ══
select has_function('public', '_log_settings_audit_event',
  array['uuid', 'text', 'uuid', 'jsonb'], 'the private Settings audit helper exists');
select is((select prosecdef from pg_proc where oid='public._log_settings_audit_event(uuid,text,uuid,jsonb)'::regprocedure),
  false, 'helper is SECURITY INVOKER');
select is((select array_to_string(proconfig, ',') from pg_proc where oid='public._log_settings_audit_event(uuid,text,uuid,jsonb)'::regprocedure),
  'search_path=""', 'helper pins an EMPTY search_path');
select is(pg_get_function_result('public._log_settings_audit_event(uuid,text,uuid,jsonb)'::regprocedure),
  'void', 'helper returns void');
select ok(not has_function_privilege('public', 'public._log_settings_audit_event(uuid,text,uuid,jsonb)', 'EXECUTE'),
  'PUBLIC cannot invoke the helper');
select ok(not has_function_privilege('anon', 'public._log_settings_audit_event(uuid,text,uuid,jsonb)', 'EXECUTE'),
  'anon cannot invoke the helper');
select ok(not has_function_privilege('authenticated', 'public._log_settings_audit_event(uuid,text,uuid,jsonb)', 'EXECUTE'),
  'authenticated cannot invoke the helper');
select ok(not has_function_privilege('service_role', 'public._log_settings_audit_event(uuid,text,uuid,jsonb)', 'EXECUTE'),
  'service_role has NO explicit helper grant');

-- ══ 9–27. Helper metadata validation (superuser; raises before insert) ═══════
-- All calls target tenant T with entity_id=T unless testing the entity_id guard.
select throws_ok(
  $$ select public._log_settings_audit_event('55555555-5555-4555-8555-555555555555','settings.bogus','55555555-5555-4555-8555-555555555555',
       jsonb_build_object('changed_fields', jsonb_build_array('name_en'))) $$,
  '22023', NULL, 'unknown event type raises');
select throws_ok(
  $$ select public._log_settings_audit_event('55555555-5555-4555-8555-555555555555','settings.business_updated','66666666-6666-4666-8666-666666666666',
       jsonb_build_object('changed_fields', jsonb_build_array('name_en'))) $$,
  '22023', NULL, 'entity_id must equal tenant_id');
select throws_ok(
  $$ select public._log_settings_audit_event('55555555-5555-4555-8555-555555555555','settings.business_updated','55555555-5555-4555-8555-555555555555',
       '[1,2]'::jsonb) $$,
  '22023', NULL, 'non-object metadata raises');
select throws_ok(
  $$ select public._log_settings_audit_event('55555555-5555-4555-8555-555555555555','settings.business_updated','55555555-5555-4555-8555-555555555555',
       jsonb_build_object('changed_fields', jsonb_build_array('name_en'), 'x', repeat('a',5000))) $$,
  '22023', NULL, 'oversized metadata raises');
select throws_ok(
  $$ select public._log_settings_audit_event('55555555-5555-4555-8555-555555555555','settings.business_updated','55555555-5555-4555-8555-555555555555',
       jsonb_build_object('name_en', jsonb_build_object('from','a','to','b'))) $$,
  '22023', NULL, 'missing changed_fields raises');
select throws_ok(
  $$ select public._log_settings_audit_event('55555555-5555-4555-8555-555555555555','settings.business_updated','55555555-5555-4555-8555-555555555555',
       jsonb_build_object('changed_fields', jsonb_build_array())) $$,
  '22023', NULL, 'empty changed_fields raises');
select throws_ok(
  $$ select public._log_settings_audit_event('55555555-5555-4555-8555-555555555555','settings.business_updated','55555555-5555-4555-8555-555555555555',
       jsonb_build_object('changed_fields', '"name_en"'::jsonb)) $$,
  '22023', NULL, 'changed_fields must be an array');
select throws_ok(
  $$ select public._log_settings_audit_event('55555555-5555-4555-8555-555555555555','settings.business_updated','55555555-5555-4555-8555-555555555555',
       jsonb_build_object('changed_fields', jsonb_build_array('name_en','name_en'))) $$,
  '22023', NULL, 'duplicate changed field raises');
select throws_ok(
  $$ select public._log_settings_audit_event('55555555-5555-4555-8555-555555555555','settings.business_updated','55555555-5555-4555-8555-555555555555',
       jsonb_build_object('changed_fields', jsonb_build_array('bogus_field'))) $$,
  '22023', NULL, 'unknown changed field raises');
select throws_ok(
  $$ select public._log_settings_audit_event('55555555-5555-4555-8555-555555555555','settings.business_updated','55555555-5555-4555-8555-555555555555',
       jsonb_build_object('changed_fields', jsonb_build_array('name_he','name_ar'))) $$,
  '22023', NULL, 'non-canonical changed_fields order raises');
select throws_ok(
  $$ select public._log_settings_audit_event('55555555-5555-4555-8555-555555555555','settings.business_updated','55555555-5555-4555-8555-555555555555',
       jsonb_build_object('changed_fields', jsonb_build_array('name_en'), 'display_vat_rate', jsonb_build_object('from',0,'to',0.1))) $$,
  '22023', NULL, 'a safe transition not listed in changed_fields raises');
select throws_ok(
  $$ select public._log_settings_audit_event('55555555-5555-4555-8555-555555555555','settings.business_updated','55555555-5555-4555-8555-555555555555',
       jsonb_build_object('changed_fields', jsonb_build_array('email'), 'email', jsonb_build_object('from','a@x','to','b@x'))) $$,
  '22023', NULL, 'a value object on a sensitive field raises');
select throws_ok(
  $$ select public._log_settings_audit_event('55555555-5555-4555-8555-555555555555','settings.business_updated','55555555-5555-4555-8555-555555555555',
       jsonb_build_object('changed_fields', jsonb_build_array('display_vat_rate'), 'display_vat_rate', jsonb_build_object('from',0.1))) $$,
  '22023', NULL, 'a transition missing to raises');
select throws_ok(
  $$ select public._log_settings_audit_event('55555555-5555-4555-8555-555555555555','settings.business_updated','55555555-5555-4555-8555-555555555555',
       jsonb_build_object('changed_fields', jsonb_build_array('display_vat_rate'), 'display_vat_rate', jsonb_build_object('from',0.1,'to',0.2,'extra',1))) $$,
  '22023', NULL, 'an extra key inside a transition raises');
select throws_ok(
  $$ select public._log_settings_audit_event('55555555-5555-4555-8555-555555555555','settings.business_updated','55555555-5555-4555-8555-555555555555',
       jsonb_build_object('changed_fields', jsonb_build_array('display_vat_rate'), 'display_vat_rate', jsonb_build_object('from',0.1,'to',0.1))) $$,
  '22023', NULL, 'equal from/to raises');
select throws_ok(
  $$ select public._log_settings_audit_event('55555555-5555-4555-8555-555555555555','settings.business_updated','55555555-5555-4555-8555-555555555555',
       jsonb_build_object('changed_fields', jsonb_build_array('display_vat_rate'), 'display_vat_rate', jsonb_build_object('from','x','to','y'))) $$,
  '22023', NULL, 'wrong transition value type raises');
select throws_ok(
  $$ select public._log_settings_audit_event('55555555-5555-4555-8555-555555555555','settings.timezone_changed','55555555-5555-4555-8555-555555555555',
       jsonb_build_object('changed_fields', jsonb_build_array('name_en'))) $$,
  '22023', NULL, 'timezone event with wrong changed_fields raises');
select throws_ok(
  $$ select public._log_settings_audit_event('55555555-5555-4555-8555-555555555555','settings.timezone_changed','55555555-5555-4555-8555-555555555555',
       jsonb_build_object('changed_fields', jsonb_build_array('timezone'))) $$,
  '22023', NULL, 'timezone event missing the transition raises');
select throws_ok(
  $$ select public._log_settings_audit_event('55555555-5555-4555-8555-555555555555','settings.tax_updated','55555555-5555-4555-8555-555555555555',
       jsonb_build_object('changed_fields', jsonb_build_array('legal_name'), 'token', 'secret')) $$,
  '22023', NULL, 'an unknown/secret top-level key raises');

-- ══ Producer sequence on T as ownerT (superuser + jwt; RLS bypassed for counts) ══
set local request.jwt.claims = '{"sub":"50000000-0000-4000-8000-000000000001","role":"authenticated"}';

-- 28. Business: change name_en + display_vat_rate.
select lives_ok(
  $$ select public.update_tenant_profile('55555555-5555-4555-8555-555555555555','ت','ט','Ten-EN2',
       null,null,null,null,null,null,null,0.18,null) $$,
  'owner updates the business profile (name_en + display_vat_rate)');
-- 29. No-op: same values again.
select lives_ok(
  $$ select public.update_tenant_profile('55555555-5555-4555-8555-555555555555','ت','ט','Ten-EN2',
       null,null,null,null,null,null,null,0.18,null) $$,
  'a business no-op save succeeds');
-- 30. Whitespace no-op: name_en with surrounding spaces normalizes identically.
select lives_ok(
  $$ select public.update_tenant_profile('55555555-5555-4555-8555-555555555555','ت','ט','  Ten-EN2  ',
       null,null,null,null,null,null,null,0.18,null) $$,
  'a whitespace-only business no-op succeeds');
-- 31. Timezone change.
select is(public.update_tenant_timezone('55555555-5555-4555-8555-555555555555','Europe/London'),
  'Europe/London', 'owner changes the timezone');
-- 32. Timezone no-op.
select is(public.update_tenant_timezone('55555555-5555-4555-8555-555555555555','Europe/London'),
  'Europe/London', 'a timezone no-op returns the current value');
-- 33. Invalid timezone rejected.
select throws_ok(
  $$ select public.update_tenant_timezone('55555555-5555-4555-8555-555555555555','+03:00') $$,
  '22023', NULL, 'a fixed-offset timezone is rejected');
-- 34. Tax first-create.
select lives_ok(
  $$ select public.upsert_tenant_tax_settings('55555555-5555-4555-8555-555555555555','Acme Ltd',
       null,null,null,null,0.17,null,null,null,null,null,null,null,false,null) $$,
  'owner creates the first tax settings');
-- 35. Tax no-op.
select lives_ok(
  $$ select public.upsert_tenant_tax_settings('55555555-5555-4555-8555-555555555555','Acme Ltd',
       null,null,null,null,0.17,null,null,null,null,null,null,null,false,null) $$,
  'a tax no-op save succeeds');
-- 36. Tax effective update (change default_vat_rate).
select lives_ok(
  $$ select public.upsert_tenant_tax_settings('55555555-5555-4555-8555-555555555555','Acme Ltd',
       null,null,null,null,0.16,null,null,null,null,null,null,null,false,null) $$,
  'owner updates the tax settings');

-- ══ Cardinality + metadata assertions (as superuser — bypass RLS) ══════════
reset role;

select is((select count(*)::int from public.audit_events
           where tenant_id='55555555-5555-4555-8555-555555555555' and event_type='settings.business_updated'),
  1, 'exactly ONE settings.business_updated (no-ops added none)');
select is((select count(*)::int from public.audit_events
           where tenant_id='55555555-5555-4555-8555-555555555555' and event_type='settings.timezone_changed'),
  1, 'exactly ONE settings.timezone_changed (no-op + invalid added none)');
select is((select count(*)::int from public.audit_events
           where tenant_id='55555555-5555-4555-8555-555555555555' and event_type='settings.tax_updated'),
  2, 'exactly TWO settings.tax_updated (first create + update; no-op added none)');

-- Business event metadata: canonical changed_fields + safe display_vat_rate; name_en keys-only.
select is((select metadata->'changed_fields' from public.audit_events
           where tenant_id='55555555-5555-4555-8555-555555555555' and event_type='settings.business_updated'),
  '["name_en", "display_vat_rate"]'::jsonb, 'business changed_fields are canonical + exact');
select is((select (metadata->'display_vat_rate'->>'to')::numeric from public.audit_events
           where tenant_id='55555555-5555-4555-8555-555555555555' and event_type='settings.business_updated'),
  0.18, 'business event carries the safe display_vat_rate after-value');
select ok((select not (metadata ? 'name_en') from public.audit_events
           where tenant_id='55555555-5555-4555-8555-555555555555' and event_type='settings.business_updated'),
  'business event does NOT carry a name_en value (keys-only)');

-- Timezone event metadata: exact IANA transition.
select is((select metadata->'timezone' from public.audit_events
           where tenant_id='55555555-5555-4555-8555-555555555555' and event_type='settings.timezone_changed'),
  '{"from": "Asia/Jerusalem", "to": "Europe/London"}'::jsonb, 'timezone event carries the exact IANA from/to');
select is((select metadata->'changed_fields' from public.audit_events
           where tenant_id='55555555-5555-4555-8555-555555555555' and event_type='settings.timezone_changed'),
  '["timezone"]'::jsonb, 'timezone changed_fields is exactly [timezone]');

-- Tax first-create metadata: legal_name key-only; safe null→value transitions.
select ok((select (metadata->'changed_fields') @> '["legal_name","country_code","default_vat_rate","legal_invoicing_ready"]'::jsonb
           from public.audit_events a
           where a.tenant_id='55555555-5555-4555-8555-555555555555' and a.event_type='settings.tax_updated'
           order by a.id asc limit 1),
  'tax first-create changed_fields include the created fields');
select ok((select not (metadata ? 'legal_name') from public.audit_events a
           where a.tenant_id='55555555-5555-4555-8555-555555555555' and a.event_type='settings.tax_updated'
           order by a.id asc limit 1),
  'tax event does NOT carry a legal_name value (keys-only)');
select is((select metadata->'country_code'->>'from' from public.audit_events a
           where a.tenant_id='55555555-5555-4555-8555-555555555555' and a.event_type='settings.tax_updated'
           order by a.id asc limit 1),
  NULL, 'tax first-create shows country_code from = null');
select is((select metadata->'country_code'->>'to' from public.audit_events a
           where a.tenant_id='55555555-5555-4555-8555-555555555555' and a.event_type='settings.tax_updated'
           order by a.id asc limit 1),
  'IL', 'tax first-create shows country_code to = IL');

-- ══ Secret / PII safety over EVERY settings row ════════════════════════════
select is((select count(*)::int from public.audit_events a
           where a.entity_type='settings'
             and exists (
               select 1 from jsonb_object_keys(a.metadata) k
               where k not in ('changed_fields','display_vat_rate','country_code',
                               'default_vat_rate','invoice_language','legal_invoicing_ready','timezone'))),
  0, 'NO settings row carries a metadata key outside the safe allowlist');
select is((select count(*)::int from public.audit_events
           where entity_type='settings' and entity_id <> tenant_id),
  0, 'EVERY settings row has entity_id = tenant_id');
select is((select count(*)::int from public.audit_events
           where entity_type='settings' and (metadata ? 'changed_fields') = false),
  0, 'EVERY settings row carries changed_fields');

-- ══ Authorization: sales_rep + cross-tenant denied; no event emitted ═══════
set local role authenticated;
set local request.jwt.claims = '{"sub":"50000000-0000-4000-8000-000000000003","role":"authenticated"}';
select throws_ok(
  $$ select public.update_tenant_profile('55555555-5555-4555-8555-555555555555','ت','ט','Rep',
       null,null,null,null,null,null,null,null,null) $$,
  '42501', NULL, 'a sales_rep cannot update the business profile');
select throws_ok(
  $$ select public.update_tenant_timezone('55555555-5555-4555-8555-555555555555','UTC') $$,
  '42501', NULL, 'a sales_rep cannot change the timezone');
set local request.jwt.claims = '{"sub":"50000000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok(
  $$ select public.update_tenant_timezone('66666666-6666-4666-8666-666666666666','UTC') $$,
  '42501', NULL, 'owner of T cannot change T2 timezone (cross-tenant)');

-- ══ Direct-write lockdown: authenticated cannot UPDATE tenants; SELECT + RPCs OK ══
select throws_ok(
  $$ update public.tenants set name_en='hack' where id='55555555-5555-4555-8555-555555555555' $$,
  '42501', NULL, 'a direct authenticated UPDATE on tenants is denied');
select is((select count(*)::int from public.tenants where id='55555555-5555-4555-8555-555555555555'),
  1, 'authenticated SELECT on tenants still works');
select is(public.update_tenant_timezone('55555555-5555-4555-8555-555555555555','Europe/London'),
  'Europe/London', 'the timezone RPC still works for an authenticated owner (no-op)');
select lives_ok(
  $$ select public.update_tenant_profile('55555555-5555-4555-8555-555555555555','ت','ט','Ten-EN2',
       null,null,null,null,null,null,null,0.18,null) $$,
  'the business RPC still works for an authenticated owner (no-op)');

-- ══ Onboarding regression: create_tenant_with_owner works for a fresh user ══
set local request.jwt.claims = '{"sub":"50000000-0000-4000-8000-000000000009","role":"authenticated"}';
select lives_ok(
  $$ select public.create_tenant_with_owner('جديد','חדש','Fresh','he') $$,
  'a membership-less user can still onboard (create_tenant_with_owner)');
reset role;
select is((select count(*)::int from public.tenant_users
           where user_id='50000000-0000-4000-8000-000000000009' and role='owner'),
  1, 'the onboarding user became an owner of a new tenant');

-- ══ Tax no-op returned the existing row (return-shape compatibility) ═══════
set local role authenticated;
set local request.jwt.claims = '{"sub":"50000000-0000-4000-8000-000000000001","role":"authenticated"}';
select is((select count(*)::int from public.upsert_tenant_tax_settings(
             '55555555-5555-4555-8555-555555555555','Acme Ltd',
             null,null,null,null,0.16,null,null,null,null,null,null,null,false,null)),
  1, 'a tax no-op returns the existing row (not an empty set)');
select is((select count(*)::int from public.update_tenant_profile(
             '55555555-5555-4555-8555-555555555555','ت','ט','Ten-EN2',
             null,null,null,null,null,null,null,0.18,null)),
  1, 'a business no-op returns the existing tenant row (not an empty set)');
reset role;

-- ══ RLS visibility ═════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"50000000-0000-4000-8000-000000000001","role":"authenticated"}';
select ok((select count(*) from public.audit_events
           where tenant_id='55555555-5555-4555-8555-555555555555' and entity_type='settings') > 0,
  'an owner reads the tenant Settings activity');
set local request.jwt.claims = '{"sub":"50000000-0000-4000-8000-000000000002","role":"authenticated"}';
select ok((select count(*) from public.audit_events
           where tenant_id='55555555-5555-4555-8555-555555555555' and entity_type='settings') > 0,
  'an admin reads the tenant Settings activity');
set local request.jwt.claims = '{"sub":"50000000-0000-4000-8000-000000000003","role":"authenticated"}';
select is((select count(*)::int from public.audit_events
           where tenant_id='55555555-5555-4555-8555-555555555555' and entity_type='settings'),
  0, 'a sales_rep reads NO Settings activity');
set local request.jwt.claims = '{"sub":"60000000-0000-4000-8000-000000000001","role":"authenticated"}';
select is((select count(*)::int from public.audit_events
           where tenant_id='55555555-5555-4555-8555-555555555555' and entity_type='settings'),
  0, 'another tenant reads NONE of this tenant''s Settings activity');
reset role;

-- ══ RLS policy shape preserved ═════════════════════════════════════════════
select is((select count(*)::int from pg_policies
           where schemaname='public' and tablename='audit_events'
             and policyname='audit_events: members read; entity rows scoped'),
  1, 'the audit_events SELECT policy exists under the concise name');
select is((select count(*)::int from pg_policies
           where schemaname='public' and tablename='audit_events' and cmd='SELECT'),
  1, 'there is exactly ONE audit_events SELECT policy');
select ok((select qual from pg_policies
           where schemaname='public' and tablename='audit_events'
             and policyname='audit_events: members read; entity rows scoped') like '%can_access_customer%',
  'the customer clause is preserved');
select ok((select qual from pg_policies
           where schemaname='public' and tablename='audit_events'
             and policyname='audit_events: members read; entity rows scoped') like '%<> ''team''%',
  'the team clause is preserved');
select ok((select qual from pg_policies
           where schemaname='public' and tablename='audit_events'
             and policyname='audit_events: members read; entity rows scoped') like '%<> ''settings''%',
  'the settings clause is present');

-- ══ tenants UPDATE policy removed; SELECT policy kept; grant removed ═══════
select is((select count(*)::int from pg_policies
           where schemaname='public' and tablename='tenants' and cmd='UPDATE'),
  0, 'the direct owner/admin tenants UPDATE policy is removed');
select is((select count(*)::int from pg_policies
           where schemaname='public' and tablename='tenants' and cmd='SELECT'),
  1, 'the tenants SELECT policy is preserved');
select ok(not has_table_privilege('authenticated', 'public.tenants', 'UPDATE'),
  'authenticated has NO direct UPDATE privilege on tenants');
select ok(has_table_privilege('authenticated', 'public.tenants', 'SELECT'),
  'authenticated retains SELECT on tenants');

-- ══ RPC preservation + partial index ═══════════════════════════════════════
select ok(to_regprocedure('public.update_tenant_profile(uuid,text,text,text,text,text,text,text,text,text,text,numeric,text)') is not null,
  'update_tenant_profile signature preserved');
select ok(to_regprocedure('public.update_tenant_timezone(uuid,text)') is not null,
  'update_tenant_timezone signature preserved');
select ok(to_regprocedure('public.upsert_tenant_tax_settings(uuid,text,text,text,text,text,numeric,text,text,text,text,text,text,text,boolean,text)') is not null,
  'upsert_tenant_tax_settings signature preserved');
select is((select bool_and(prosecdef) from pg_proc
           where proname in ('update_tenant_profile','update_tenant_timezone','upsert_tenant_tax_settings')
             and pronamespace='public'::regnamespace),
  true, 'every redefined settings RPC is SECURITY DEFINER');
select ok((select pg_get_functiondef('public.update_tenant_profile(uuid,text,text,text,text,text,text,text,text,text,text,numeric,text)'::regprocedure)) ~ 'for update',
  'update_tenant_profile locks the tenant row');
select ok((select pg_get_functiondef('public.update_tenant_timezone(uuid,text)'::regprocedure)) ~ 'for update',
  'update_tenant_timezone locks the tenant row');
select ok((select pg_get_functiondef('public.upsert_tenant_tax_settings(uuid,text,text,text,text,text,numeric,text,text,text,text,text,text,text,boolean,text)'::regprocedure)) ~ 'from public\.tenants where id = v_tenant for update',
  'upsert_tenant_tax_settings locks the PARENT tenant row');
select has_index('public', 'audit_events', 'audit_events_tenant_settings_time_idx',
  'the partial Settings Timeline index exists');

select * from finish();
rollback;
