-- Structural guards only. Real user/session authorization is exercised by
-- tests/e2e/pricing.live.mjs against the owned GoTrue/PostgREST stack.
begin;
select no_plan();
select has_table('public','customer_product_prices','agreements exist');
select has_table('public','tenant_pricing_state','tenant state exists');
select ok((select relrowsecurity from pg_class where oid='public.customer_product_prices'::regclass),'agreement RLS enabled');
select ok((select relrowsecurity from pg_class where oid='public.tenant_pricing_state'::regclass),'state RLS enabled');
select ok(not has_table_privilege('authenticated','public.customer_product_prices','SELECT,INSERT,UPDATE,DELETE'),'no authenticated raw agreement privileges');
select ok(not has_table_privilege('anon','public.customer_product_prices','SELECT,INSERT,UPDATE,DELETE'),'no anonymous raw agreement privileges');
select ok(not has_table_privilege('authenticated','public.tenant_pricing_state','SELECT,INSERT,UPDATE,DELETE'),'no browser state access');
select ok(not has_function_privilege('authenticated','public.set_tenant_pricing_state(uuid,text)','EXECUTE'),'activation is not browser callable');
select ok(has_function_privilege('service_role','public.set_tenant_pricing_state(uuid,text)','EXECUTE'),'service activation available');
select ok(not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and (p.proname like '\_pricing\_%' escape '\' or p.proname in ('_public_prices','_public_quote','_effective_product_prices','_check_pricing_quote','_log_customer_price'))
  and (has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE'))),'all internal pricing helpers private');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='create_order_request'),1::bigint,'one authenticated creation overload');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='create_order_request_from_token'),1::bigint,'one private creation overload');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='create_order_from_showcase_token'),1::bigint,'one guest creation overload');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='update_order_items'),1::bigint,'one editor overload');
select ok(not exists(select 1 from public.tenants t left join public.tenant_pricing_state s on s.tenant_id=t.id where s.tenant_id is null),'existing tenants provisioned');
insert into public.tenants(id,name_ar,name_he,name_en) values ('f2000000-0000-4000-8000-000000000001','اختبار','בדיקה','Pricing structural fixture');
select is((select mode from public.tenant_pricing_state where tenant_id='f2000000-0000-4000-8000-000000000001'),'disabled','new tenants start disabled');
select is((select epoch from public.tenant_pricing_state where tenant_id='f2000000-0000-4000-8000-000000000001'),1::bigint,'new state starts at epoch 1');
select has_column('public','order_items','pricing_source_snapshot','source recorded');
select has_column('public','order_items','pricing_agreement_revision_snapshot','agreement revision recorded');
select has_column('public','order_items','package_contract_revision_snapshot','package revision recorded');
select has_column('public','order_items','base_unit_snapshot','base unit recorded');
select has_column('public','order_items','unit_size_snapshot','size recorded');
select * from finish();
rollback;
