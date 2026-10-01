-- Synthetic, transaction-rolled-back regression coverage. Never hosted fixtures.
begin;
select no_plan();
insert into auth.users(id) values ('f1000000-0000-4000-8000-000000000001');
insert into public.tenants(id,name_ar,name_he,name_en) values
 ('f1000000-0000-4000-8000-000000000010','اختبار','בדיקה','Financial test'),
 ('f1000000-0000-4000-8000-000000000011','ب','ב','Other tenant');
insert into public.tenant_users(tenant_id,user_id,role) values
 ('f1000000-0000-4000-8000-000000000010','f1000000-0000-4000-8000-000000000001','owner');
insert into public.customers(id,tenant_id,name,customer_type) values
 ('f1000000-0000-4000-8000-000000000020','f1000000-0000-4000-8000-000000000010','Synthetic shop','grocery');
insert into public.manufacturers(id,tenant_id,name_ar,name_he,name_en) values
 ('f1000000-0000-4000-8000-000000000040','f1000000-0000-4000-8000-000000000010','قديم','ישן','Saved manufacturer');
insert into public.products(id,tenant_id,name_ar,name_he,name_en,package_unit,package_quantity,wholesale_price,vat_rate) values
 ('f1000000-0000-4000-8000-000000000031','f1000000-0000-4000-8000-000000000010','قديم','ישן','Saved','carton',6,10,.18),
 ('f1000000-0000-4000-8000-000000000032','f1000000-0000-4000-8000-000000000010','جديد','חדש','New','pack',2,3.03,.05),
 ('f1000000-0000-4000-8000-000000000033','f1000000-0000-4000-8000-000000000010','ص1','קט1','Tiny1','unit',1,.03,.18),
 ('f1000000-0000-4000-8000-000000000034','f1000000-0000-4000-8000-000000000010','ص2','קט2','Tiny2','unit',1,.03,.18);
update public.products set manufacturer_id='f1000000-0000-4000-8000-000000000040'
 where id='f1000000-0000-4000-8000-000000000031';
insert into public.inventory_items(tenant_id,product_id,quantity_available) values
 ('f1000000-0000-4000-8000-000000000010','f1000000-0000-4000-8000-000000000031',50000);
insert into public.customer_access_links(tenant_id,customer_id,token_hash) values
 ('f1000000-0000-4000-8000-000000000010','f1000000-0000-4000-8000-000000000020',encode(sha256(convert_to('financial-private-synthetic-token-01','UTF8')),'hex'));
insert into public.catalog_showcase_links(tenant_id,token_hash) values
 ('f1000000-0000-4000-8000-000000000010',encode(sha256(convert_to('financial-showcase-synthetic-token-01','UTF8')),'hex'));
create temp table financial_before(id uuid, items jsonb, money jsonb, tuple text);
grant all on financial_before to authenticated;
set local role authenticated;
set local request.jwt.claims='{"sub":"f1000000-0000-4000-8000-000000000001","role":"authenticated"}';
select set_config('test.fin.order',(select order_id::text from public.create_order_request(
 'f1000000-0000-4000-8000-000000000010','[{"product_id":"f1000000-0000-4000-8000-000000000031","quantity":1}]',
 'f1000000-0000-4000-8000-000000000020',p_submission_key=>'f1000000-0000-4000-8000-000000000050')),true);
insert into financial_before select o.id,(select jsonb_agg(to_jsonb(i) order by i.id) from public.order_items i where i.order_id=o.id),
 jsonb_build_array(o.subtotal,o.vat_total,o.total),o.ctid::text from public.orders o where o.id=current_setting('test.fin.order')::uuid;
reset role;
update public.products set wholesale_price=40,vat_rate=.10,package_quantity=12,name_en='Changed'
 where id='f1000000-0000-4000-8000-000000000031';
update public.manufacturers set name_en='Changed manufacturer' where id='f1000000-0000-4000-8000-000000000040';
set local role authenticated;
select lives_ok($$select public.update_order_items('f1000000-0000-4000-8000-000000000010',current_setting('test.fin.order')::uuid,'[{"product_id":"f1000000-0000-4000-8000-000000000031","quantity":1}]')$$,'identical edit succeeds after catalog changes');
select is((select jsonb_agg(to_jsonb(i) order by i.id) from public.order_items i where i.order_id=current_setting('test.fin.order')::uuid),(select items from financial_before),'no-op preserves line identity and every snapshot');
select is((select jsonb_build_array(subtotal,vat_total,total) from public.orders where id=current_setting('test.fin.order')::uuid),(select money from financial_before),'no-op preserves recorded money');
select is((select ctid::text from public.orders where id=current_setting('test.fin.order')::uuid),(select tuple from financial_before),'no-op does not UPDATE order');
select is((select count(*) from public.audit_events where entity_id=current_setting('test.fin.order')::uuid and event_type='order.updated'),0::bigint,'no-op creates no edit audit');
select lives_ok($$select public.update_order_items('f1000000-0000-4000-8000-000000000010',current_setting('test.fin.order')::uuid,'[{"product_id":"f1000000-0000-4000-8000-000000000031","quantity":1}]','new synthetic notes')$$,'notes-only succeeds');
select is((select jsonb_agg(to_jsonb(i) order by i.id) from public.order_items i where i.order_id=current_setting('test.fin.order')::uuid),(select items from financial_before),'notes-only preserves exact lines');
select is((select jsonb_build_array(subtotal,vat_total,total) from public.orders where id=current_setting('test.fin.order')::uuid),(select money from financial_before),'notes-only preserves money');
select is((select metadata->'changed_fields' from public.audit_events where entity_id=current_setting('test.fin.order')::uuid and event_type='order.updated'),'["notes"]'::jsonb,'one notes-only safe audit');
reset role;
update public.products set package_quantity=6 where id='f1000000-0000-4000-8000-000000000031';
set local role authenticated;
select lives_ok($$select public.update_order_items('f1000000-0000-4000-8000-000000000010',current_setting('test.fin.order')::uuid,'[{"product_id":"f1000000-0000-4000-8000-000000000031","quantity":2},{"product_id":"f1000000-0000-4000-8000-000000000032","quantity":1}]')$$,'quantity edit and new line succeed');
select is((select unit_price_snapshot from public.order_items where order_id=current_setting('test.fin.order')::uuid and product_id='f1000000-0000-4000-8000-000000000031'),10::numeric,'retained price stays saved');
select is((select vat_rate_snapshot from public.order_items where order_id=current_setting('test.fin.order')::uuid and product_id='f1000000-0000-4000-8000-000000000031'),.18::numeric,'retained VAT stays saved');
select is((select id from public.order_items where order_id=current_setting('test.fin.order')::uuid and product_id='f1000000-0000-4000-8000-000000000031'),((select items from financial_before)->0->>'id')::uuid,'quantity edit preserves retained identity');
select is((select product_name_snapshot->>'en' from public.order_items where order_id=current_setting('test.fin.order')::uuid and product_id='f1000000-0000-4000-8000-000000000031'),'Saved','saved name retained');
select is((select unit_price_snapshot from public.order_items where order_id=current_setting('test.fin.order')::uuid and product_id='f1000000-0000-4000-8000-000000000032'),3.03::numeric,'new line uses current base price');
select is((select vat_rate_snapshot from public.order_items where order_id=current_setting('test.fin.order')::uuid and product_id='f1000000-0000-4000-8000-000000000032'),.05::numeric,'new line uses current VAT');
select is((select vat_total from public.orders where id=current_setting('test.fin.order')::uuid),3.75::numeric,'mixed saved VAT sums rounded lines');
select is((select count(*) from public.audit_events where entity_id=current_setting('test.fin.order')::uuid and event_type='order.updated'),2::bigint,'exactly one event per effective edit');
select lives_ok($$select public.update_order_status('f1000000-0000-4000-8000-000000000010',current_setting('test.fin.order')::uuid,'confirmed')$$,'reserve existing packages');
select throws_ok($$select public.update_order_items('f1000000-0000-4000-8000-000000000010',current_setting('test.fin.order')::uuid,'[{"product_id":"f1000000-0000-4000-8000-000000000031","quantity":9999},{"product_id":"f1000000-0000-4000-8000-000000000031","quantity":9999}]')$$,'22023',null,'aggregate above 9999 rejected before mutation');
select is((select quantity_available from public.inventory_items where product_id='f1000000-0000-4000-8000-000000000031'),49998,'rejected duplicate edit leaves inventory unchanged');
select is((select quantity from public.order_items where order_id=current_setting('test.fin.order')::uuid and product_id='f1000000-0000-4000-8000-000000000031'),2,'rejected duplicate leaves order unchanged');
reset role;
update public.products set package_quantity=12 where id='f1000000-0000-4000-8000-000000000031';
set local role authenticated;
select throws_ok($$select public.update_order_items('f1000000-0000-4000-8000-000000000010',current_setting('test.fin.order')::uuid,'[{"product_id":"f1000000-0000-4000-8000-000000000031","quantity":3},{"product_id":"f1000000-0000-4000-8000-000000000032","quantity":1}]')$$,'22023',null,'package drift rejects reservation change');
select is((select quantity_available from public.inventory_items where product_id='f1000000-0000-4000-8000-000000000031'),49998,'package mismatch rolls back stock');
-- Fractional rounding through each actual effective creation wrapper.
select set_config('test.fin.tiny',(select order_id::text from public.create_order_request('f1000000-0000-4000-8000-000000000010','[{"product_id":"f1000000-0000-4000-8000-000000000033","quantity":1},{"product_id":"f1000000-0000-4000-8000-000000000034","quantity":1}]',p_submission_key=>'f1000000-0000-4000-8000-000000000051')),true);
select is((select total from public.orders where id=current_setting('test.fin.tiny')::uuid),.08::numeric,'authenticated header equals rounded line sum');
select lives_ok($$select public.update_order_items('f1000000-0000-4000-8000-000000000010',current_setting('test.fin.tiny')::uuid,'[{"product_id":"f1000000-0000-4000-8000-000000000033","quantity":2},{"product_id":"f1000000-0000-4000-8000-000000000034","quantity":1}]')$$,'fractional edit succeeds');
select is((select vat_total from public.orders where id=current_setting('test.fin.tiny')::uuid),(select sum(line_vat) from public.order_items where order_id=current_setting('test.fin.tiny')::uuid),'edit header VAT is sum of recorded line VAT');
select is((select total from public.orders where id=current_setting('test.fin.tiny')::uuid),(select sum(line_total) from public.order_items where order_id=current_setting('test.fin.tiny')::uuid),'edit header total is sum of line totals');
reset role;
set local role anon;
set local request.jwt.claims='{"role":"anon"}';
select lives_ok($$select public.create_order_request_from_token('financial-private-synthetic-token-01','[{"product_id":"f1000000-0000-4000-8000-000000000033","quantity":1},{"product_id":"f1000000-0000-4000-8000-000000000034","quantity":1}]',p_submission_key=>'f1000000-0000-4000-8000-000000000052')$$,'private channel creates');
select lives_ok($$select public.create_order_from_showcase_token('financial-showcase-synthetic-token-01','[{"product_id":"f1000000-0000-4000-8000-000000000033","quantity":1},{"product_id":"f1000000-0000-4000-8000-000000000034","quantity":1}]','Synthetic guest',p_submission_key=>'f1000000-0000-4000-8000-000000000053')$$,'showcase channel creates');
reset role;
select is((select total from public.orders where id=(select order_id from public.order_submission_claims where submission_key='f1000000-0000-4000-8000-000000000052')),.08::numeric,'private header equals line sum');
select is((select total from public.orders where id=(select order_id from public.order_submission_claims where submission_key='f1000000-0000-4000-8000-000000000053')),.08::numeric,'showcase header equals line sum');
-- Additional policy boundaries; the first 32 assertions remain the baseline reproduction.
select is((select manufacturer_name_snapshot->>'en' from public.order_items where order_id=current_setting('test.fin.order')::uuid and product_id='f1000000-0000-4000-8000-000000000031'),'Saved manufacturer','retained manufacturer name stays saved');
-- Deliberately inconsistent LEGACY header: no-op/notes must not repair it.
update public.orders set vat_total=.01,total=subtotal+.01 where id=current_setting('test.fin.tiny')::uuid;
select set_config('test.fin.legacy',(select jsonb_build_array(subtotal,vat_total,total)::text from public.orders where id=current_setting('test.fin.tiny')::uuid),true);
select set_config('test.fin.legacy_items',(select jsonb_agg(to_jsonb(i) order by id)::text from public.order_items i where order_id=current_setting('test.fin.tiny')::uuid),true);
set local role authenticated;
set local request.jwt.claims='{"sub":"f1000000-0000-4000-8000-000000000001","role":"authenticated"}';
select lives_ok($$select public.update_order_items('f1000000-0000-4000-8000-000000000010',current_setting('test.fin.tiny')::uuid,'[{"product_id":"f1000000-0000-4000-8000-000000000034","quantity":1},{"product_id":"f1000000-0000-4000-8000-000000000033","quantity":1},{"product_id":"f1000000-0000-4000-8000-000000000033","quantity":1}]')$$,'reordered duplicate inputs normalize to a no-op');
select is((select jsonb_build_array(subtotal,vat_total,total) from public.orders where id=current_setting('test.fin.tiny')::uuid),current_setting('test.fin.legacy')::jsonb,'normalized no-op preserves inconsistent legacy header');
select lives_ok($$select public.update_order_items('f1000000-0000-4000-8000-000000000010',current_setting('test.fin.tiny')::uuid,'[{"product_id":"f1000000-0000-4000-8000-000000000033","quantity":2},{"product_id":"f1000000-0000-4000-8000-000000000034","quantity":1}]','  legacy notes  ')$$,'notes-only save trims notes');
select is((select jsonb_build_array(subtotal,vat_total,total) from public.orders where id=current_setting('test.fin.tiny')::uuid),current_setting('test.fin.legacy')::jsonb,'notes-only preserves inconsistent legacy header');
select is((select jsonb_agg(to_jsonb(i) order by id) from public.order_items i where order_id=current_setting('test.fin.tiny')::uuid),current_setting('test.fin.legacy_items')::jsonb,'legacy notes save leaves lines unchanged');
select is((select notes from public.orders where id=current_setting('test.fin.tiny')::uuid),'legacy notes','notes normalized');
select lives_ok($$select public.update_order_items('f1000000-0000-4000-8000-000000000010',current_setting('test.fin.tiny')::uuid,'[{"product_id":"f1000000-0000-4000-8000-000000000033","quantity":5000},{"product_id":"f1000000-0000-4000-8000-000000000033","quantity":4999},{"product_id":"f1000000-0000-4000-8000-000000000034","quantity":1}]')$$,'aggregated 9999 is accepted without increasing limits');
select is((select quantity from public.order_items where order_id=current_setting('test.fin.tiny')::uuid and product_id='f1000000-0000-4000-8000-000000000033'),9999,'9999 stored as one normalized line');
select is((select subtotal from public.orders where id=current_setting('test.fin.tiny')::uuid),(select sum(line_subtotal) from public.order_items where order_id=current_setting('test.fin.tiny')::uuid),'effective edit header subtotal sums lines');
select is((select total from public.orders where id=current_setting('test.fin.tiny')::uuid),(select sum(line_total) from public.order_items where order_id=current_setting('test.fin.tiny')::uuid),'effective edit replaces legacy inconsistency with line sum');
reset role;
-- Capture all state touched by a rejected edit, including existing document metadata.
insert into public.documents(tenant_id,order_id,document_type,document_number,status) values
 ('f1000000-0000-4000-8000-000000000010',current_setting('test.fin.tiny')::uuid,'order_request','SYNTHETIC-FIN-001','draft');
create temp table financial_atomic as select
 (select jsonb_agg(to_jsonb(o) order by id) from public.orders o where tenant_id='f1000000-0000-4000-8000-000000000010') as orders,
 (select jsonb_agg(to_jsonb(i) order by id) from public.order_items i where tenant_id='f1000000-0000-4000-8000-000000000010') as items,
 (select jsonb_agg(to_jsonb(i) order by id) from public.inventory_items i where tenant_id='f1000000-0000-4000-8000-000000000010') as inventory,
 (select jsonb_agg(to_jsonb(m) order by id) from public.order_inventory_movements m where tenant_id='f1000000-0000-4000-8000-000000000010') as movements,
 (select jsonb_agg(to_jsonb(a) order by id) from public.audit_events a where tenant_id='f1000000-0000-4000-8000-000000000010') as audit,
 (select jsonb_agg(to_jsonb(d) order by id) from public.documents d where tenant_id='f1000000-0000-4000-8000-000000000010') as documents;
grant select on financial_atomic to authenticated;
set local role authenticated;
select throws_ok($$select public.update_order_items('f1000000-0000-4000-8000-000000000010',current_setting('test.fin.tiny')::uuid,'[{"product_id":"f1000000-0000-4000-8000-000000000033","quantity":5000},{"product_id":"f1000000-0000-4000-8000-000000000033","quantity":5000}]','must not save')$$,'22023',null,'aggregated 10000 rejected');
select is((select jsonb_agg(to_jsonb(o) order by id) from public.orders o where tenant_id='f1000000-0000-4000-8000-000000000010'),(select orders from financial_atomic),'rejection leaves whole orders unchanged');
select is((select jsonb_agg(to_jsonb(i) order by id) from public.order_items i where tenant_id='f1000000-0000-4000-8000-000000000010'),(select items from financial_atomic),'rejection leaves all items unchanged');
select is((select jsonb_agg(to_jsonb(i) order by id) from public.inventory_items i where tenant_id='f1000000-0000-4000-8000-000000000010'),(select inventory from financial_atomic),'rejection leaves all inventory unchanged');
select is((select jsonb_agg(to_jsonb(m) order by id) from public.order_inventory_movements m where tenant_id='f1000000-0000-4000-8000-000000000010'),(select movements from financial_atomic),'rejection leaves movement ledger unchanged');
select is((select jsonb_agg(to_jsonb(a) order by id) from public.audit_events a where tenant_id='f1000000-0000-4000-8000-000000000010'),(select audit from financial_atomic),'rejection emits no audit');
select is((select jsonb_agg(to_jsonb(d) order by id) from public.documents d where tenant_id='f1000000-0000-4000-8000-000000000010'),(select documents from financial_atomic),'rejection leaves document metadata unchanged');
-- Remove in a committed call, change catalog, then re-add: this is a NEW line.
select set_config('test.fin.old_line',(select id::text from public.order_items where order_id=current_setting('test.fin.tiny')::uuid and product_id='f1000000-0000-4000-8000-000000000033'),true);
select lives_ok($$select public.update_order_items('f1000000-0000-4000-8000-000000000010',current_setting('test.fin.tiny')::uuid,'[{"product_id":"f1000000-0000-4000-8000-000000000034","quantity":1}]')$$,'committed removal succeeds');
reset role;
update public.products set wholesale_price=.09,vat_rate=.05 where id='f1000000-0000-4000-8000-000000000033';
set local role authenticated;
select lives_ok($$select public.update_order_items('f1000000-0000-4000-8000-000000000010',current_setting('test.fin.tiny')::uuid,'[{"product_id":"f1000000-0000-4000-8000-000000000033","quantity":1},{"product_id":"f1000000-0000-4000-8000-000000000034","quantity":1}]')$$,'later re-add succeeds');
select isnt((select id::text from public.order_items where order_id=current_setting('test.fin.tiny')::uuid and product_id='f1000000-0000-4000-8000-000000000033'),current_setting('test.fin.old_line'),'re-added product has new identity');
select is((select unit_price_snapshot from public.order_items where order_id=current_setting('test.fin.tiny')::uuid and product_id='f1000000-0000-4000-8000-000000000033'),.09::numeric,'re-added line uses current price');
select is((select vat_rate_snapshot from public.order_items where order_id=current_setting('test.fin.tiny')::uuid and product_id='f1000000-0000-4000-8000-000000000033'),.05::numeric,'re-added line uses current VAT');
select throws_ok($$select public.update_order_items('f1000000-0000-4000-8000-000000000010',current_setting('test.fin.order')::uuid,'[{"product_id":"f1000000-0000-4000-8000-000000000032","quantity":1}]')$$,'22023',null,'removing reserved mismatched package rejected');
-- Linking a guest order changes association only, even after catalog repricing.
reset role;
select set_config('test.fin.guest',(select order_id::text from public.order_submission_claims where submission_key='f1000000-0000-4000-8000-000000000053'),true);
select set_config('test.fin.guest_items',(select jsonb_agg(to_jsonb(i) order by id)::text from public.order_items i where order_id=current_setting('test.fin.guest')::uuid),true);
set local role authenticated;
select lives_ok($$select public.link_order_to_customer('f1000000-0000-4000-8000-000000000010',current_setting('test.fin.guest')::uuid,'f1000000-0000-4000-8000-000000000020')$$,'guest links to existing customer');
select is((select jsonb_agg(to_jsonb(i) order by id) from public.order_items i where order_id=current_setting('test.fin.guest')::uuid),current_setting('test.fin.guest_items')::jsonb,'guest linking preserves every saved item');
select is((select total from public.orders where id=current_setting('test.fin.guest')::uuid),.08::numeric,'guest linking preserves original money');
select throws_ok($$select public.update_order_items('f1000000-0000-4000-8000-000000000011',current_setting('test.fin.tiny')::uuid,'[{"product_id":"f1000000-0000-4000-8000-000000000033","quantity":1}]')$$,'42501',null,'cross-tenant editing denied');
reset role;
set local role anon;
select throws_ok($$select public.update_order_items('f1000000-0000-4000-8000-000000000010',current_setting('test.fin.tiny')::uuid,'[{"product_id":"f1000000-0000-4000-8000-000000000033","quantity":1}]')$$,'42501',null,'unauthenticated edit denied by grant');
reset role;
-- Tracking added after confirmation: unchanged line quantity can still create
-- a nonzero ledger delta when another line is edited.
update public.products set package_quantity=6 where id='f1000000-0000-4000-8000-000000000031';
set local role authenticated;
select set_config('test.fin.tracking',(select order_id::text from public.create_order_request('f1000000-0000-4000-8000-000000000010','[{"product_id":"f1000000-0000-4000-8000-000000000031","quantity":1},{"product_id":"f1000000-0000-4000-8000-000000000033","quantity":1}]',p_submission_key=>'f1000000-0000-4000-8000-000000000054')),true);
select lives_ok($$select public.update_order_status('f1000000-0000-4000-8000-000000000010',current_setting('test.fin.tracking')::uuid,'confirmed')$$,'partially tracked order confirmed');
reset role;
insert into public.inventory_items(tenant_id,product_id,quantity_available) values
 ('f1000000-0000-4000-8000-000000000010','f1000000-0000-4000-8000-000000000033',100);
update public.products set package_quantity=2 where id='f1000000-0000-4000-8000-000000000033';
set local role authenticated;
select throws_ok($$select public.update_order_items('f1000000-0000-4000-8000-000000000010',current_setting('test.fin.tracking')::uuid,'[{"product_id":"f1000000-0000-4000-8000-000000000031","quantity":2},{"product_id":"f1000000-0000-4000-8000-000000000033","quantity":1}]')$$,'22023',null,'newly tracked unchanged line rejects mismatched reservation package');
select is((select quantity_available from public.inventory_items where product_id='f1000000-0000-4000-8000-000000000033'),100,'newly tracked mismatch leaves stock unchanged');
select is((select quantity from public.order_items where order_id=current_setting('test.fin.tracking')::uuid and product_id='f1000000-0000-4000-8000-000000000031'),1,'newly tracked mismatch leaves other line unchanged');
reset role;
-- Corrupt/unrepresentable historical lines must fail closed, never be discarded.
update public.order_items set product_id=null
 where order_id=current_setting('test.fin.tracking')::uuid and product_id='f1000000-0000-4000-8000-000000000033';
set local role authenticated;
select throws_ok($$select public.update_order_items('f1000000-0000-4000-8000-000000000010',current_setting('test.fin.tracking')::uuid,'[{"product_id":"f1000000-0000-4000-8000-000000000031","quantity":1}]')$$,'22023',null,'unrepresentable null-product history rejected');
select is((select count(*) from public.order_items where order_id=current_setting('test.fin.tracking')::uuid),2::bigint,'null-product historical row not discarded');
reset role;
update public.order_items set product_id='f1000000-0000-4000-8000-000000000033'
 where order_id=current_setting('test.fin.tracking')::uuid and product_id is null;
insert into public.order_items(tenant_id,order_id,product_id,product_name_snapshot,manufacturer_name_snapshot,package_unit_snapshot,package_quantity_snapshot,quantity,unit_price_snapshot,vat_rate_snapshot,line_subtotal,line_vat,line_total)
 select tenant_id,order_id,product_id,product_name_snapshot,manufacturer_name_snapshot,package_unit_snapshot,package_quantity_snapshot,quantity,unit_price_snapshot,vat_rate_snapshot,line_subtotal,line_vat,line_total
 from public.order_items where order_id=current_setting('test.fin.tracking')::uuid and product_id='f1000000-0000-4000-8000-000000000031';
set local role authenticated;
select throws_ok($$select public.update_order_items('f1000000-0000-4000-8000-000000000010',current_setting('test.fin.tracking')::uuid,'[{"product_id":"f1000000-0000-4000-8000-000000000031","quantity":2},{"product_id":"f1000000-0000-4000-8000-000000000033","quantity":1}]')$$,'22023',null,'ambiguous duplicate historical product lines rejected');
select is((select count(*) from public.order_items where order_id=current_setting('test.fin.tracking')::uuid),3::bigint,'ambiguous historical rows not replaced or discarded');
reset role;
set local role anon;
set local request.jwt.claims='{"role":"anon"}';
select lives_ok($$select public.create_order_request_from_token('financial-private-synthetic-token-01','[{"product_id":"f1000000-0000-4000-8000-000000000033","quantity":1},{"product_id":"f1000000-0000-4000-8000-000000000034","quantity":1}]',p_submission_key=>'f1000000-0000-4000-8000-000000000052')$$,'committed creation retry succeeds after catalog repricing');
reset role;
select is((select total from public.orders where id=(select order_id from public.order_submission_claims where submission_key='f1000000-0000-4000-8000-000000000052')),.08::numeric,'creation replay preserves original committed amounts');
select * from finish();
rollback;
