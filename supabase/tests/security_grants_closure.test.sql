-- Disposable pgTAP regression: all fixtures and future objects roll back.
begin;
select no_plan();

-- Effective privileges include inherited PUBLIC grants, not just ACL text.
select ok(not has_table_privilege(r, 'public.' || t, p),
  r || ' cannot directly ' || p || ' ' || t)
from unnest(array['anon','authenticated']) r
cross join unnest(array['audit_events','order_status_history','documents','tenants']) t
cross join unnest(array['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) p;
select ok(not has_any_column_privilege(r, 'public.' || t, p),
  r || ' has no column-only ' || p || ' bypass on ' || t)
from unnest(array['anon','authenticated']) r
cross join unnest(array['audit_events','order_status_history','documents','tenants']) t
cross join unnest(array['INSERT','UPDATE','REFERENCES']) p;
select ok(has_table_privilege('authenticated', 'public.' || t, 'SELECT'),
  'authenticated retains SELECT on ' || t)
from unnest(array['audit_events','order_status_history','documents','tenants']) t;
select ok(not has_table_privilege('anon', 'public.' || t, 'SELECT'),
  'anon has no direct SELECT on ' || t)
from unnest(array['audit_events','order_status_history','documents','tenants']) t;
select ok(has_table_privilege('service_role', 'public.' || t, p),
  'service_role retains ' || p || ' on ' || t)
from unnest(array['audit_events','order_status_history','documents','tenants']) t
cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) p;

select ok(not has_sequence_privilege(r, 'public.' || s, p),
  r || ' cannot ' || p || ' ' || s)
from unnest(array['anon','authenticated']) r
cross join unnest(array['audit_events_id_seq','token_access_attempts_id_seq','legal_document_events_id_seq']) s
cross join unnest(array['USAGE','SELECT','UPDATE']) p;
select ok(has_sequence_privilege('service_role', 'public.' || s, p),
  'service_role retains ' || p || ' ' || s)
from unnest(array['audit_events_id_seq','token_access_attempts_id_seq','legal_document_events_id_seq']) s
cross join unnest(array['USAGE','SELECT','UPDATE']) p;

select ok(not has_function_privilege(r, 'public.' || f || '()', 'EXECUTE'),
  r || ' cannot directly execute ' || f)
from unnest(array['public','anon','authenticated']) r
cross join unnest(array['log_order_status_change','_gen_order_public_ref','_orders_set_public_ref',
  'set_updated_at','_legal_documents_guard_immutable','_sandbox_writeonce_guard']) f;
select ok(has_function_privilege('service_role', 'public.' || f || '()', 'EXECUTE'),
  'service_role retains ' || f)
from unnest(array['log_order_status_change','_gen_order_public_ref','_orders_set_public_ref',
  'set_updated_at','_legal_documents_guard_immutable','_sandbox_writeonce_guard']) f;

-- Actual client operations reject at the privilege boundary, even with no
-- matching rows (rather than accidentally relying on current RLS only).
set local role anon;
select throws_ok(format('insert into public.%I default values', t), '42501', null,
  'anon INSERT denied on ' || t)
from unnest(array['audit_events','order_status_history','documents','tenants']) t;
select throws_ok(format('update public.%I set created_at=created_at where false', t), '42501', null,
  'anon UPDATE denied on ' || t)
from unnest(array['audit_events','order_status_history','documents','tenants']) t;
select throws_ok(format('delete from public.%I where false', t), '42501', null,
  'anon DELETE denied on ' || t)
from unnest(array['audit_events','order_status_history','documents','tenants']) t;
select throws_ok(format('select nextval(%L)', 'public.' || s), '42501', null,
  'anon cannot allocate ' || s)
from unnest(array['audit_events_id_seq','token_access_attempts_id_seq','legal_document_events_id_seq']) s;
select throws_ok(format('select setval(%L,1)', 'public.' || s), '42501', null,
  'anon cannot reset ' || s)
from unnest(array['audit_events_id_seq','token_access_attempts_id_seq','legal_document_events_id_seq']) s;
reset role;
set local role authenticated;
select throws_ok(format('insert into public.%I default values', t), '42501', null,
  'authenticated INSERT denied on ' || t)
from unnest(array['audit_events','order_status_history','documents','tenants']) t;
select throws_ok(format('update public.%I set created_at=created_at where false', t), '42501', null,
  'authenticated UPDATE denied on ' || t)
from unnest(array['audit_events','order_status_history','documents','tenants']) t;
select throws_ok(format('delete from public.%I where false', t), '42501', null,
  'authenticated DELETE denied on ' || t)
from unnest(array['audit_events','order_status_history','documents','tenants']) t;
select throws_ok(format('select nextval(%L)', 'public.' || s), '42501', null,
  'authenticated cannot allocate ' || s)
from unnest(array['audit_events_id_seq','token_access_attempts_id_seq','legal_document_events_id_seq']) s;
select throws_ok(format('select setval(%L,1)', 'public.' || s), '42501', null,
  'authenticated cannot reset ' || s)
from unnest(array['audit_events_id_seq','token_access_attempts_id_seq','legal_document_events_id_seq']) s;
reset role;

-- Exercise the relevant actual creator, not an inherited role's defaults.
set local role postgres;
create table public._grant_test_future_table(id bigint);
create sequence public._grant_test_future_sequence;
create function public._grant_test_future_function() returns int
  language sql set search_path='' as $$ select 1 $$;
select is((select pg_get_userbyid(relowner)::text from pg_class
  where oid='public._grant_test_future_table'::regclass), 'postgres', 'future table uses application owner');
select ok(not has_table_privilege(r, 'public._grant_test_future_table', p),
  'future postgres/public table denies ' || r || ' ' || p)
from unnest(array['anon','authenticated']) r
cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) p;
select ok(not has_sequence_privilege(r, 'public._grant_test_future_sequence', p),
  'future postgres/public sequence denies ' || r || ' ' || p)
from unnest(array['anon','authenticated']) r
cross join unnest(array['USAGE','SELECT','UPDATE']) p;
select ok(not has_function_privilege(r, 'public._grant_test_future_function()', 'EXECUTE'),
  'future postgres function denies ' || r || ' EXECUTE')
from unnest(array['public','anon','authenticated']) r;
select ok(has_table_privilege('service_role', 'public._grant_test_future_table', p),
  'future service table ' || p || ' preserved')
from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) p;
select ok(has_sequence_privilege('service_role', 'public._grant_test_future_sequence', p),
  'future service sequence ' || p || ' preserved')
from unnest(array['USAGE','SELECT','UPDATE']) p;
select ok(has_function_privilege('service_role', 'public._grant_test_future_function()', 'EXECUTE'),
  'future service function EXECUTE preserved');
select ok(not exists(select 1 from pg_default_acl d, lateral aclexplode(d.defaclacl) a
  where d.defaclrole='postgres'::regrole and d.defaclnamespace='public'::regnamespace
  and d.defaclobjtype in ('r','S','f')
  and a.grantee in (0,'anon'::regrole::oid,'authenticated'::regrole::oid)),
  'postgres/public defaults have no client grants');
select ok(not exists(select 1 from pg_default_acl d, lateral aclexplode(d.defaclacl) a
  where d.defaclrole='postgres'::regrole and d.defaclnamespace=0
  and d.defaclobjtype='f' and a.grantee=0 and a.privilege_type='EXECUTE'),
  'global postgres function default removes implicit PUBLIC EXECUTE');

-- Prove the attached triggers and protected document INSERT/UPSERT still run.
insert into auth.users(id) values ('ac100000-0000-4000-8000-000000000001');
insert into public.tenants(id,name_ar,name_he,name_en) values
  ('ac100000-0000-4000-8000-000000000010','اختبار','בדיקה','Grant test');
insert into public.tenant_users(tenant_id,user_id,role) values
  ('ac100000-0000-4000-8000-000000000010','ac100000-0000-4000-8000-000000000001','owner');
insert into public.products(id,tenant_id,name_ar,name_he,name_en,package_unit,package_quantity,wholesale_price,vat_rate)
  values ('ac100000-0000-4000-8000-000000000020','ac100000-0000-4000-8000-000000000010',
    'اختبار','בדיקה','Grant product','carton',6,10,.18);
set local role authenticated;
set local request.jwt.claims='{"sub":"ac100000-0000-4000-8000-000000000001","role":"authenticated"}';
select set_config('test.grants.order',(select order_id::text from public.create_order_request(
  'ac100000-0000-4000-8000-000000000010',
  '[{"product_id":"ac100000-0000-4000-8000-000000000020","quantity":1}]',
  p_submission_key=>'ac100000-0000-4000-8000-000000000030')),true);
select ok((select public_ref ~ '^MDF-[A-Z2-9]{8}$' from public.orders
  where id=current_setting('test.grants.order')::uuid), 'order trigger still generates public reference');
select is((select count(*) from public.order_status_history where order_id=current_setting('test.grants.order')::uuid),
  1::bigint, 'status-history trigger creates initial row');
select is((select count(*) from public.audit_events where entity_id=current_setting('test.grants.order')::uuid
  and event_type='order.created'), 1::bigint, 'trusted audit writer allocates identity');
select lives_ok($$select public.update_order_items('ac100000-0000-4000-8000-000000000010',
  current_setting('test.grants.order')::uuid,
  '[{"product_id":"ac100000-0000-4000-8000-000000000020","quantity":2}]')$$, 'authenticated guarded edit succeeds');
select lives_ok($$select public.update_order_status('ac100000-0000-4000-8000-000000000010',
  current_setting('test.grants.order')::uuid,'cancelled')$$, 'guarded status change fires revoked helper');
select is((select count(*) from public.order_status_history where order_id=current_setting('test.grants.order')::uuid),
  2::bigint, 'status-history trigger appends transition');
select lives_ok($$select public.create_order_document('ac100000-0000-4000-8000-000000000010',
  current_setting('test.grants.order')::uuid,'invoice_draft','he','Synthetic draft only')$$,
  'guarded document generation needs no direct INSERT');
select lives_ok($$select public.create_order_document('ac100000-0000-4000-8000-000000000010',
  current_setting('test.grants.order')::uuid,'invoice_draft','ar','Synthetic draft only')$$,
  'guarded regeneration needs no direct UPDATE');
select is((select count(*) from public.documents where order_id=current_setting('test.grants.order')::uuid),
  1::bigint, 'regeneration preserves one document');
select is((select status::text || ':' || document_locale::text from public.documents
  where order_id=current_setting('test.grants.order')::uuid), 'draft:ar', 'document remains non-legal draft with refreshed locale');
select lives_ok($$select public.set_document_storage(
  'ac100000-0000-4000-8000-000000000010', d.id,
  d.tenant_id::text || '/documents/' || d.order_id::text || '/' || d.document_type::text || '/' || d.id::text || '_ar.pdf',
  123, 'synthetic-checksum')
  from public.documents d where d.order_id=current_setting('test.grants.order')::uuid$$,
  'guarded document storage metadata update succeeds');
select is((select file_size_bytes::text || ':' || checksum from public.documents
  where order_id=current_setting('test.grants.order')::uuid), '123:synthetic-checksum',
  'guarded storage metadata is readable without direct UPDATE');
reset role;
set local role service_role;
set local request.jwt.claims='{"role":"service_role"}';
select lives_ok($$insert into public.orders(id,tenant_id,order_number) values (
  'ac100000-0000-4000-8000-000000000040','ac100000-0000-4000-8000-000000000010','GRANTS-SERVICE')$$,
  'service writer still invokes reference and history triggers');
select ok((select public_ref ~ '^MDF-[A-Z2-9]{8}$' from public.orders
  where id='ac100000-0000-4000-8000-000000000040'), 'service trigger reference generated');
select is((select count(*) from public.order_status_history
  where order_id='ac100000-0000-4000-8000-000000000040'), 1::bigint,
  'service status-history trigger still works');
reset role;
select * from finish();
rollback;
