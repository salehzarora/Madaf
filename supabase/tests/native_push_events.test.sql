begin;
select no_plan();
create function pg_temp.uid(label text) returns uuid language sql immutable as $$select md5('push-v12-'||label)::uuid$$;
set local request.jwt.claims='{"role":"service_role"}';
insert into public.tenants(id,name_ar,name_he,name_en) values
 (pg_temp.uid('A'),'أ','א','A'),(pg_temp.uid('B'),'ب','ב','B');
create temp table people(label text,tenant text,role public.tenant_role);
insert into people values ('owner','A','owner'),('admin','A','admin'),('rep','A','sales_rep'),('Bowner','B','owner'),
 ('off','A','admin'),('expired','A','admin'),('revoked','A','admin'),('banned','A','admin'),('disabled','A','admin'),
 ('demoted','A','sales_rep'),('anonymous','A','admin'),('multi','A','admin');
insert into auth.users(id,email,is_anonymous,banned_until)
 select pg_temp.uid(label),label||'@push.invalid',label='anonymous',case when label='banned' then now()+interval '1 hour' end from people;
insert into public.tenant_users(tenant_id,user_id,role) select pg_temp.uid(tenant),pg_temp.uid(label),role from people;
insert into public.tenant_users(tenant_id,user_id,role) values(pg_temp.uid('B'),pg_temp.uid('multi'),'admin');
insert into auth.sessions(id,user_id,created_at,updated_at,not_after)
 select pg_temp.uid(label||'-session'),pg_temp.uid(label),now(),now(),case when label='expired' then now()-interval '1 second' end from people;
insert into public.push_devices(id,tenant_id,user_id,session_id,installation_id,platform,fcm_token,locale,enabled)
 select pg_temp.uid(label||'-device'),pg_temp.uid(case when label='multi' then 'B' else tenant end),pg_temp.uid(label),
 pg_temp.uid(label||'-session'),pg_temp.uid(label||'-installation'),'android','synthetic_v12_token_'||label,'he',label<>'disabled' from people;
delete from auth.sessions where id=pg_temp.uid('revoked-session');
insert into public.push_devices(id,tenant_id,user_id,session_id,installation_id,platform,fcm_token,locale)
 values(pg_temp.uid('owner2-device'),pg_temp.uid('A'),pg_temp.uid('owner'),pg_temp.uid('owner-session'),pg_temp.uid('owner2-installation'),'android','synthetic_v12_second_owner','ar');
insert into public.push_notification_preferences(tenant_id,user_id,new_order,signup_request,low_stock,order_status)
 values(pg_temp.uid('A'),pg_temp.uid('off'),false,false,false,false);

select ok((select relrowsecurity from pg_class where oid=('public.'||name)::regclass),name||' RLS')
 from unnest(array['push_notification_preferences','push_event_dispatches','push_low_stock_state','push_low_stock_crossings']) name;
select ok(not has_table_privilege(role,'public.'||name,'SELECT,INSERT,UPDATE,DELETE'),role||' cannot access '||name)
 from unnest(array['anon','authenticated']) role cross join unnest(array['push_notification_preferences','push_event_dispatches','push_low_stock_state','push_low_stock_crossings']) name;
select ok(not has_function_privilege(role,fn,'EXECUTE'),role||' cannot execute '||fn)
 from unnest(array['anon','authenticated']) role cross join unnest(array[
 'public.push_event_recipients(uuid,text,uuid,uuid)','public.claim_signup_request_push(uuid)',
 'public.claim_order_status_push(uuid,public.order_status,public.order_status)',
 'public.claim_low_stock_push(uuid,uuid)','public.push_inventory_products_for_order(uuid)']) fn;

-- All event types use the identical eligibility boundary. Status is off by default.
select is((select count(*) from public.push_event_recipients(pg_temp.uid('A'),'order_status')),0::bigint,'status defaults OFF');
select results_eq(format($q$select device_id from public.push_event_recipients(pg_temp.uid('A'),%L) order by device_id$q$,event),
 $$select pg_temp.uid(label||'-device') from unnest(array['owner','owner2','admin']) label order by 1$$,
 event||' A: EXACT owner devices+admin; off/rep/B/expired/revoked/banned/disabled/demoted/anonymous/multi excluded')
 from unnest(array['new_order','signup_request','low_stock']) event;
insert into public.push_notification_preferences(tenant_id,user_id,order_status)
 select pg_temp.uid(tenant),pg_temp.uid(label),true from people where label<>'off';
update public.push_notification_preferences set order_status=true where user_id=pg_temp.uid('multi');
insert into public.push_notification_preferences(tenant_id,user_id,order_status) values(pg_temp.uid('B'),pg_temp.uid('multi'),true);
select results_eq(format($q$select device_id from public.push_event_recipients(pg_temp.uid('A'),%L) order by device_id$q$,event),
 $$select pg_temp.uid(label||'-device') from unnest(array['owner','owner2','admin']) label order by 1$$,'A exact identities: '||event)
 from unnest(array['new_order','signup_request','low_stock','order_status']) event;
select results_eq(format($q$select device_id from public.push_event_recipients(pg_temp.uid('B'),%L) order by device_id$q$,event),
 $$select pg_temp.uid(label||'-device') from unnest(array['Bowner','multi']) label order by 1$$,'B excludes ALL A devices: '||event)
 from unnest(array['new_order','signup_request','low_stock','order_status']) event;
select results_eq($$select device_id from public.push_event_recipients(pg_temp.uid('A'),'order_status',pg_temp.uid('owner'))$$,
 $$select pg_temp.uid('admin-device')$$,'actor excluded across all their devices');
select throws_ok($$select * from public.push_event_recipients(pg_temp.uid('A'),'invented')$$,'22023',null,'event allowlist');

delete from public.push_notification_preferences where user_id=pg_temp.uid('owner');
select set_config('request.jwt.claims',json_build_object('role','authenticated','sub',pg_temp.uid('owner'),'session_id',pg_temp.uid('owner-session'))::text,true);
set local role authenticated;
select results_eq($$select * from public.get_my_push_preferences(pg_temp.uid('A'))$$,$$select true,true,true,false$$,'missing row defaults');
select lives_ok($$select public.save_my_push_preferences(pg_temp.uid('A'),false,true,true,false)$$,'own save');
select lives_ok($$select public.save_my_push_preferences(pg_temp.uid('A'),false,true,true,false)$$,'repeated save');
select results_eq($$select * from public.get_my_push_preferences(pg_temp.uid('A'))$$,$$select false,true,true,false$$,'own read');
select throws_ok($$select public.save_my_push_preferences(pg_temp.uid('B'),true,true,true,true)$$,'42501',null,'cross tenant spoof denied');
select throws_ok($$select public.save_my_push_preferences(pg_temp.uid('A'),null,true,true,true)$$,'22023',null,'null boolean denied');
reset role;
select is((select count(*) from public.push_notification_preferences where user_id=pg_temp.uid('owner')),1::bigint,'save upserts same row');
select ok(not exists(select 1 from pg_proc where proname='save_my_push_preferences' and 'p_user_id'=any(proargnames)),'no user ID input to spoof');
set local request.jwt.claims='{"role":"service_role"}';
select results_eq($$select device_id from public.push_event_recipients(pg_temp.uid('A'),'new_order')$$,$$select pg_temp.uid('admin-device')$$,'OFF applies to BOTH owner devices');
update public.push_notification_preferences set new_order=true where user_id=pg_temp.uid('owner');
select is((select count(*) from public.push_event_recipients(pg_temp.uid('A'),'new_order')),3::bigint,'ON restores both devices');
-- Existing new-order delivery also goes through preference enforcement.
insert into public.orders(id,tenant_id,order_number,public_ref) values(pg_temp.uid('new-order'),pg_temp.uid('A'),'MDF-1035','MDF-V12NEW');
select is((select count(*) from public.claim_new_order_push(pg_temp.uid('new-order'))),1::bigint,'new-order original claim intact');
update public.push_notification_preferences set new_order=false where user_id=pg_temp.uid('owner');
select results_eq($$select device_id from public.new_order_push_recipients(pg_temp.uid('new-order'))$$,
 $$select pg_temp.uid('admin-device')$$,'original new-order recipient RPC enforces preference OFF');
update public.push_notification_preferences set new_order=true where user_id=pg_temp.uid('owner');
select is((select count(*) from public.new_order_push_recipients(pg_temp.uid('new-order'))),3::bigint,'original new-order RPC restores both devices ON');

-- Live DB session ownership is mandatory, regardless of still-valid JWT claims.
select set_config('request.jwt.claims',json_build_object('role','authenticated','sub',pg_temp.uid('owner'),'session_id',pg_temp.uid('admin-session'))::text,true);
set local role authenticated;
select throws_ok($$select * from public.get_my_push_preferences(pg_temp.uid('A'))$$,'42501',null,'another user session denied');
reset role;
select set_config('request.jwt.claims',json_build_object('role','authenticated','sub',pg_temp.uid('revoked'),'session_id',pg_temp.uid('revoked-session'))::text,true);
set local role authenticated;
select throws_ok($$select * from public.get_my_push_preferences(pg_temp.uid('A'))$$,'42501',null,'revoked session denied');
reset role;
set local request.jwt.claims='{"role":"service_role"}';

-- Exact signup insertion UUID; legacy boolean + visitor failure contract retained.
insert into public.customer_signup_links(id,tenant_id,token_hash) values(pg_temp.uid('link'),pg_temp.uid('A'),encode(sha256(convert_to('synthetic-v12-signup-link','UTF8')),'hex'));
create temp table request_id as select public.submit_customer_signup_request_v2('synthetic-v12-signup-link','Synthetic Store',p_phone=>'555-test',p_notes=>'private notes') id;
select ok((select id is not null from request_id),'V2 returns inserted identity');
select results_eq($$select tenant_id,store_name from public.claim_signup_request_push((select id from request_id))$$,
 $$select pg_temp.uid('A'),'Synthetic Store'::text$$,'signup claim projects exact tenant and name only');
select is((select count(*) from public.claim_signup_request_push((select id from request_id))),0::bigint,'signup replay no claim');
select is(public.submit_customer_signup_request_v2('invalid','Store'),null::uuid,'invalid signup creates no ID');
select throws_ok($$select public.submit_customer_signup_request_v2('synthetic-v12-signup-link','')$$,'22023',null,'blank signup rejected');
select is(public.submit_customer_signup_request('synthetic-v12-signup-link','Legacy'),true,'legacy boolean succeeds');
select is(public.submit_customer_signup_request('invalid','Legacy'),null::boolean,'legacy failure stays null');

-- Status uses immutable history, not the order's later current status.
insert into public.orders(id,tenant_id,order_number,public_ref) values(pg_temp.uid('order'),pg_temp.uid('A'),'MDF-1036','MDF-V12SYNTHETIC');
select is((select count(*) from public.claim_order_status_push(pg_temp.uid('order'),'new','confirmed')),0::bigint,'uncommitted transition no claim');
select set_config('request.jwt.claims',json_build_object('role','authenticated','sub',pg_temp.uid('owner'),'session_id',pg_temp.uid('owner-session'))::text,true);
select * from public.update_order_status(pg_temp.uid('A'),pg_temp.uid('order'),'confirmed');
select * from public.update_order_status(pg_temp.uid('A'),pg_temp.uid('order'),'preparing');
set local request.jwt.claims='{"role":"service_role"}';
select results_eq($$select tenant_id,actor_id,order_number,new_status from public.claim_order_status_push(pg_temp.uid('order'),'new','confirmed')$$,
 $$select pg_temp.uid('A'),pg_temp.uid('owner'),'MDF-1036'::text,'confirmed'::public.order_status$$,'exact earlier history supplies actor/tenant/status');
select is((select count(*) from public.claim_order_status_push(pg_temp.uid('order'),'new','confirmed')),0::bigint,'status duplicate no claim');
select is((select count(*) from public.claim_order_status_push(pg_temp.uid('order'),'preparing','preparing')),0::bigint,'no-op no claim');

insert into public.products(id,tenant_id,name_ar,name_he,name_en,wholesale_price) values
 (pg_temp.uid('product'),pg_temp.uid('A'),'منتج','מוצר','Product',10);
insert into public.inventory_items(tenant_id,product_id,quantity_available,low_stock_threshold) values(pg_temp.uid('A'),pg_temp.uid('product'),20,5);
select is((select count(*) from public.claim_low_stock_push(pg_temp.uid('A'),pg_temp.uid('product'))),0::bigint,'initial high baseline no alert');
update public.inventory_items set quantity_available=4 where product_id=pg_temp.uid('product');
update public.inventory_items set quantity_available=3 where product_id=pg_temp.uid('product');
select results_eq($$select generation,quantity from public.claim_low_stock_push(pg_temp.uid('A'),pg_temp.uid('product'))$$,$$select 1::bigint,3$$,'high-low-lower: one crossing, CURRENT quantity');
select is((select count(*) from public.claim_low_stock_push(pg_temp.uid('A'),pg_temp.uid('product'))),0::bigint,'claim replay empty');
update public.inventory_items set quantity_available=8 where product_id=pg_temp.uid('product');
select ok(not (select is_low from public.push_low_stock_state where product_id=pg_temp.uid('product')),'recovery resets state');
update public.inventory_items set quantity_available=5 where product_id=pg_temp.uid('product');
update public.inventory_items set quantity_available=9 where product_id=pg_temp.uid('product');
update public.inventory_items set quantity_available=4 where product_id=pg_temp.uid('product');
select results_eq($$select generation,quantity from public.claim_low_stock_push(pg_temp.uid('A'),pg_temp.uid('product'))$$,$$select 2::bigint,4 union all select 3::bigint,4$$,'delayed callbacks preserve BOTH committed recrossings');
update public.inventory_items set quantity_available=8 where product_id=pg_temp.uid('product');
update public.inventory_items set low_stock_threshold=8 where product_id=pg_temp.uid('product');
select results_eq($$select generation,quantity from public.claim_low_stock_push(pg_temp.uid('A'),pg_temp.uid('product'))$$,$$select 4::bigint,8$$,'threshold-only equality crossing');
update public.inventory_items set low_stock_threshold=2 where product_id=pg_temp.uid('product');
update public.inventory_items set quantity_available=1 where product_id=pg_temp.uid('product');
update public.inventory_items set quantity_available=20 where product_id=pg_temp.uid('product');
select is((select count(*) from public.claim_low_stock_push(pg_temp.uid('A'),pg_temp.uid('product'))),0::bigint,'recovered pending event suppressed');
select ok(not exists(select 1 from public.push_low_stock_crossings where product_id=pg_temp.uid('product') and claimed_at is null),'recovered event consumed');
savepoint rollback_crossing;
update public.inventory_items set quantity_available=0 where product_id=pg_temp.uid('product');
rollback to savepoint rollback_crossing;
select is((select count(*) from public.claim_low_stock_push(pg_temp.uid('A'),pg_temp.uid('product'))),0::bigint,'rolled-back crossing cannot notify');
select is((select count(*) from public.claim_low_stock_push(pg_temp.uid('B'),pg_temp.uid('product'))),0::bigint,'cross-tenant product claim empty');

-- Removed products are still returned from authoritative reservation history.
insert into public.order_inventory_movements(tenant_id,order_id,product_id,quantity_delta,reason)
 values(pg_temp.uid('A'),pg_temp.uid('order'),pg_temp.uid('product'),1,'order_released');
select results_eq($$select * from public.push_inventory_products_for_order(pg_temp.uid('order'))$$,
 $$select pg_temp.uid('A'),pg_temp.uid('product')$$,'removed product derived from ledger, no current line required');
insert into public.products(id,tenant_id,name_ar,name_he,name_en,wholesale_price) values
 (pg_temp.uid('initial-low'),pg_temp.uid('A'),'Low','Low','Low',1);
insert into public.inventory_items(tenant_id,product_id,quantity_available,low_stock_threshold)
 values(pg_temp.uid('A'),pg_temp.uid('initial-low'),0,5);
select is((select count(*) from public.claim_low_stock_push(pg_temp.uid('A'),pg_temp.uid('initial-low'))),0::bigint,'new low row establishes baseline without false crossing');

-- Fail-open bookkeeping never rolls back an otherwise valid stock mutation.
create function pg_temp.break_push() returns trigger language plpgsql as $$begin raise exception 'synthetic push failure'; end$$;
create trigger test_break_push before insert on public.push_low_stock_crossings for each row execute function pg_temp.break_push();
select lives_ok($$update public.inventory_items set quantity_available=0 where product_id=pg_temp.uid('product')$$,'notification bookkeeping failure isolated');
select is((select quantity_available from public.inventory_items where product_id=pg_temp.uid('product')),0,'stock committed despite push capture failure');
drop trigger test_break_push on public.push_low_stock_crossings;
select * from finish();
rollback;
