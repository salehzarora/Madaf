begin;
select no_plan();
set local request.jwt.claims='{"role":"service_role"}';
insert into public.tenants(id,name_ar,name_he,name_en) values
 ('91000000-0000-4000-8000-000000000001','أ','א','Push A'),
 ('91000000-0000-4000-8000-000000000002','ب','ב','Push B');
insert into auth.users(id,email) values
 ('92000000-0000-4000-8000-000000000001','push-owner@test.local'),
 ('92000000-0000-4000-8000-000000000002','push-admin@test.local'),
 ('92000000-0000-4000-8000-000000000003','push-rep@test.local'),
 ('92000000-0000-4000-8000-000000000004','push-other@test.local');
insert into public.tenant_users(tenant_id,user_id,role) values
 ('91000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001','owner'),
 ('91000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000002','admin'),
 ('91000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000003','sales_rep'),
 ('91000000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000004','owner');
insert into auth.sessions(id,user_id,created_at,updated_at) select
 replace(user_id::text,'92000000','93000000')::uuid,user_id,now(),now() from public.tenant_users
 where tenant_id::text like '91000000%';

select ok((select relrowsecurity from pg_class where oid='public.push_devices'::regclass),'device RLS enabled');
select ok(not has_table_privilege('authenticated','public.push_devices','SELECT'),'no authenticated token listing');
select ok(not has_table_privilege('anon','public.push_devices','SELECT'),'no anon token listing');
select ok(not has_table_privilege('authenticated','public.push_devices','INSERT'),'no direct client writes');
select ok(not has_function_privilege('authenticated','public.new_order_push_recipients(uuid,uuid)','EXECUTE'),'recipients service-only');
select ok(not has_function_privilege('anon','public.register_push_device(uuid,uuid,text,text,boolean)','EXECUTE'),'anon cannot register');

set local role authenticated;
set local request.jwt.claims='{"role":"authenticated","sub":"92000000-0000-4000-8000-000000000001","session_id":"93000000-0000-4000-8000-000000000001"}';
select lives_ok($$select public.register_push_device('91000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000001','synthetic_owner_token_0001','ar',true)$$,'owner registers current device');
select lives_ok($$select public.register_push_device('91000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000001','synthetic_owner_token_0001','ar',true)$$,'repeat registration idempotent');
select throws_ok($$select fcm_token from public.push_devices$$,'42501',null,'even registrant cannot list token');
select throws_ok($$select public.register_push_device('91000000-0000-4000-8000-000000000002','94000000-0000-4000-8000-000000000001','synthetic_owner_token_0001','ar',true)$$,'42501',null,'cross tenant spoof rejected');
select throws_ok($$select public.register_push_device('91000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000001','bad token','ar',true)$$,'22023',null,'malformed token rejected safely');
select throws_ok($$select * from public.claim_new_order_push(null,'MDF-TESTPUSH')$$,'42501',null,'client cannot claim sends');
reset role;
select is((select count(*) from public.push_devices),1::bigint,'upsert creates one row');
set local role authenticated;
select lives_ok($$select public.register_push_device('91000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000001','synthetic_owner_token_0002','ar',true)$$,'refresh accepted');
reset role;
select is((select count(*) from public.push_devices),1::bigint,'refresh keeps one row');
select is((select fcm_token from public.push_devices),'synthetic_owner_token_0002','refresh replaced exact token');
set local role authenticated;
set local request.jwt.claims='{"role":"authenticated","sub":"92000000-0000-4000-8000-000000000001","session_id":"93000000-0000-4000-8000-000000000002"}';
select throws_ok($$select public.register_push_device('91000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000001','synthetic_owner_token_0002','ar',true)$$,'42501',null,'another user session cannot authorize');
set local request.jwt.claims='{"role":"authenticated","sub":"92000000-0000-4000-8000-000000000002","session_id":"93000000-0000-4000-8000-000000000002"}';
select public.disable_my_push_device('94000000-0000-4000-8000-000000000001');
select throws_ok($$select public.register_push_device('91000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000001','synthetic_attacker_token_0001','ar',true)$$,'42501',null,'known installation UUID alone cannot replace another user binding');
reset role;
select ok((select enabled from public.push_devices),'cannot disable another user installation');

-- Recipient fixtures: active admin + sales rep in A; active owner in B.
insert into public.push_devices(tenant_id,user_id,session_id,installation_id,platform,fcm_token,locale)
 select tenant_id,user_id,replace(user_id::text,'92000000','93000000')::uuid,
 replace(user_id::text,'92000000','94000000')::uuid,'android','synthetic_fixture_'||user_id::text,'he'
 from public.tenant_users where user_id in ('92000000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000003','92000000-0000-4000-8000-000000000004');
insert into public.orders(id,tenant_id,order_number,public_ref) values
 ('95000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000001','MDF-9001','MDF-TESTPUSH');
set local request.jwt.claims='{"role":"service_role"}';
select is((select count(*) from public.claim_new_order_push('95000000-0000-4000-8000-000000000001',null)),1::bigint,'committed new order claimed once');
select is((select count(*) from public.claim_new_order_push(null,'MDF-TESTPUSH')),0::bigint,'public-ref replay cannot duplicate ID claim');
select is((select count(*) from public.new_order_push_recipients('95000000-0000-4000-8000-000000000001')),2::bigint,'only same-tenant owner/admin recipients');
update auth.sessions set not_after=now()-interval '1 minute' where id='93000000-0000-4000-8000-000000000002';
select is((select count(*) from public.new_order_push_recipients('95000000-0000-4000-8000-000000000001')),1::bigint,'expired session excluded');
update auth.sessions set not_after=null where id='93000000-0000-4000-8000-000000000002';
update auth.users set banned_until=now()+interval '1 hour' where id='92000000-0000-4000-8000-000000000002';
select is((select count(*) from public.new_order_push_recipients('95000000-0000-4000-8000-000000000001')),1::bigint,'banned user excluded');
update auth.users set banned_until=null where id='92000000-0000-4000-8000-000000000002';
-- A role removal after claim must affect the send-time recipient query.
update public.tenant_users set role='sales_rep' where user_id='92000000-0000-4000-8000-000000000002';
select is((select count(*) from public.new_order_push_recipients('95000000-0000-4000-8000-000000000001')),1::bigint,'demoted admin excluded');
select public.disable_invalid_push_token((select id from public.push_devices where installation_id='94000000-0000-4000-8000-000000000001'),'synthetic_owner_token_0001');
select ok((select enabled from public.push_devices where installation_id='94000000-0000-4000-8000-000000000001'),'old-token failure does not disable refreshed token');
select public.disable_invalid_push_token((select id from public.push_devices where installation_id='94000000-0000-4000-8000-000000000001'),'synthetic_owner_token_0002');
select is((select count(*) from public.new_order_push_recipients('95000000-0000-4000-8000-000000000001')),0::bigint,'exact invalid token disabled');

set local role authenticated;
set local request.jwt.claims='{"role":"authenticated","sub":"92000000-0000-4000-8000-000000000001","session_id":"93000000-0000-4000-8000-000000000001"}';
select public.register_push_device('91000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000001','synthetic_owner_token_0003','ar',true);
select public.disable_my_push_device('94000000-0000-4000-8000-000000000001');
reset role;
select ok(not (select enabled from public.push_devices where installation_id='94000000-0000-4000-8000-000000000001'),'logout disables own installation');
select is((select fcm_token from public.push_devices where installation_id='94000000-0000-4000-8000-000000000001'),'synthetic_owner_token_0003','unregister does not delete Firebase token');
delete from auth.sessions where id='93000000-0000-4000-8000-000000000001';
select is((select count(*) from public.push_devices where installation_id='94000000-0000-4000-8000-000000000001'),0::bigint,'revoked session cascades device association');
set local role authenticated;
select throws_ok($$select public.register_push_device('91000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000001','synthetic_owner_token_0003','ar',true)$$,'42501',null,'late registration after logout rejected despite JWT');
reset role;
select * from finish();
rollback;
