// Forced schedules on this runner's disposable DB. Real authenticated RPCs
// perform writes; a local-only trigger barrier exposes their lock boundaries.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import pg from 'pg';
import {createClient} from '@supabase/supabase-js';
import {assertOwnedDestinations} from './safety.mjs';
import {seedFixtures} from './seed.mjs';
const root=process.cwd(),runRoot=resolve(process.argv[2]);
const marker=JSON.parse(await readFile(resolve(runRoot,'ownership.json'),'utf8'));
const status=JSON.parse(await readFile(resolve(runRoot,'backend.json'),'utf8'));
assertOwnedDestinations(root,runRoot,marker,status);
const db=new pg.Client({connectionString:status.DB_URL,statement_timeout:15000});
const barrier=new pg.Client({connectionString:status.DB_URL,statement_timeout:15000});
await db.connect();await barrier.connect();
const options={auth:{autoRefreshToken:false,persistSession:false}};
const owner=createClient(status.API_URL,status.ANON_KEY,options),service=createClient(status.API_URL,status.SERVICE_ROLE_KEY,options);
const results=[];let triggerTable;
const rpc=(c,name,args)=>Promise.resolve(c.rpc(name,args));
async function ok(c,name,args){const r=await rpc(c,name,args);assert(!r.error,`${name}: ${r.error?.code}`);return r.data;}
async function waiting(name,minimum=1){const deadline=Date.now()+6000;while(Date.now()<deadline){
  const r=await db.query("select count(*)::integer n from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid() and wait_event_type='Lock' and position($1 in query)>0",[name]);
  if(r.rows[0].n>=minimum)return;await delay(20);
}throw Error(`Expected owned RPC barrier wait: ${name}`);}
async function install(table,tenant){
  assert(['customer_product_prices','products','orders','order_items','tenant_pricing_state'].includes(table));
  await db.query(`create or replace function public._pricing_test_barrier() returns trigger language plpgsql set search_path='' as $body$ begin
    if new.tenant_id = '${tenant}'::uuid then perform pg_advisory_xact_lock(19971,42); end if; return new; end; $body$`);
  await db.query('revoke all on function public._pricing_test_barrier() from public,anon,authenticated,service_role');
  await db.query(`create trigger pricing_test_barrier ${table==='orders'?'before insert':'after insert or update'} on public.${table} for each row execute function public._pricing_test_barrier()`);
  triggerTable=table;
  await barrier.query('select pg_advisory_lock(19971,42)');
}
async function release(){await barrier.query('select pg_advisory_unlock(19971,42)');}
async function remove(){if(triggerTable){await db.query(`drop trigger pricing_test_barrier on public.${triggerTable}`);triggerTable=undefined;}}
try{
  const {a,b}=await seedFixtures(root,runRoot,marker,status,`locks-${randomBytes(6).toString('hex')}-`);
  assert(!(await owner.auth.signInWithPassword({email:a.email,password:a.password})).error);
  // Activation first rejects an old disabled/quote-less client after its wait.
  await install('tenant_pricing_state',a.tenant);
  const activation=rpc(service,'set_tenant_pricing_state',{p_tenant_id:a.tenant,p_mode:'active'});await waiting('set_tenant_pricing_state');
  const legacy=rpc(owner,'create_order_request',{p_tenant_id:a.tenant,p_customer_id:a.customer,p_items:[{product_id:a.product,quantity:1}],p_submission_key:randomUUID()});await waiting('create_order_request');
  await release();assert(!(await activation).error);assert.equal((await legacy).error?.code,'MDF55');await remove();
  results.push('activation first rejects waiting legacy creation');
  // Disabled save first finishes as reviewed base before activation can commit.
  const other=createClient(status.API_URL,status.ANON_KEY,options);
  assert(!(await other.auth.signInWithPassword({email:b.email,password:b.password})).error);
  try {
    await install('orders',b.tenant);
    const first=rpc(other,'create_order_request',{p_tenant_id:b.tenant,p_customer_id:b.customer,p_items:[{product_id:b.product,quantity:1}],p_submission_key:randomUUID()});await waiting('create_order_request');
    const second=rpc(service,'set_tenant_pricing_state',{p_tenant_id:b.tenant,p_mode:'active'});await waiting('set_tenant_pricing_state');
    await release();assert(!(await first).error);assert(!(await second).error);await remove();
    results.push('disabled save first holds activation until commit');
  } finally { await other.auth.signOut({scope:'local'}); }
  const original=(await db.query('select * from public.products where id=$1',[a.product])).rows[0];
  async function product(){const id=randomUUID();await db.query("insert into public.products(id,tenant_id,name_ar,name_he,name_en,package_unit,package_quantity,base_unit,wholesale_price,vat_rate,is_active) values($1,$2,'اختبار','בדיקה','Lock test','carton',6,'bottles',10,.18,true)",[id,a.tenant]);return id;}
  function agreement(id,revision=0,action='set',packageRevision=1,price='7'){return {p_tenant_id:a.tenant,p_customer_id:a.customer,p_product_id:id,p_expected_revision:revision,p_package_revision:packageRevision,p_action:action,p_price:price};}
  function qargs(id){return {p_tenant_id:a.tenant,p_customer_id:a.customer,p_items:[{product_id:id,quantity:1}]};}
  function saveargs(id,quote){return {...qargs(id),p_quote:quote,p_submission_key:randomUUID()};}
  async function changedProduct(id,changes){return {p_tenant_id:a.tenant,p_product_id:id,p_product:{...original,id,sku:`LOCK-${id}`,manufacturer_id:null,...changes}};}
  for(const operation of ['insert','update','remove','reconfirm']){
    const id=await product();let revision=0,packageRevision=1;
    if(operation!=='insert'){await ok(owner,'manage_customer_product_price',agreement(id));revision=1;}
    const quote=await ok(owner,'quote_customer_order',qargs(id));
    if(operation==='reconfirm'){await ok(owner,'update_product',await changedProduct(id,{package_quantity:8}));packageRevision=2;}
    await install('customer_product_prices',a.tenant);
    const writer=rpc(owner,'manage_customer_product_price',agreement(id,revision,operation==='remove'?'remove':operation==='reconfirm'?'reconfirm':'set',packageRevision,'8'));
    await waiting('manage_customer_product_price');
    const reader=operation==='reconfirm'?rpc(owner,'quote_customer_order',qargs(id)):rpc(owner,'create_order_request',saveargs(id,quote.quote));
    await waiting(operation==='reconfirm'?'quote_customer_order':'create_order_request');
    await release();assert(!(await writer).error);
    const outcome=await reader;
    if(operation==='reconfirm'){assert(!outcome.error);assert.equal(outcome.data.lines[0].unit_price_snapshot,"8.00");}
    else assert.equal(outcome.error?.code,'MDF55');
    await remove();results.push(`agreement ${operation} holds product anchor against quote/save`);
  }
  for(const [name,change] of [['base',{wholesale_price:11}],['VAT',{vat_rate:0.1}],['package',{package_quantity:8}]]){
    const id=await product(),q=await ok(owner,'quote_customer_order',qargs(id));
    await install('products',a.tenant);
    const writer=rpc(owner,'update_product',await changedProduct(id,change));await waiting('update_product');
    const save=rpc(owner,'create_order_request',saveargs(id,q.quote));await waiting('create_order_request');
    await release();assert(!(await writer).error);assert.equal((await save).error?.code,'MDF55');
    await remove();results.push(`product ${name} mutation invalidates waiting save`);
  }
  // Save owns its shared product anchor before insertion. Agreement insertion
  // must wait even though the agreement row does not exist.
  {
    const id=await product(),q=await ok(owner,'quote_customer_order',qargs(id));
    await install('orders',a.tenant);
    const save=rpc(owner,'create_order_request',saveargs(id,q.quote));await waiting('create_order_request');
    const writer=rpc(owner,'manage_customer_product_price',agreement(id));await waiting('manage_customer_product_price');
    await release();const saved=await save;assert(!saved.error);assert(!(await writer).error);
    const rows=await db.query('select unit_price_snapshot from public.order_items where order_id=$1',[saved.data[0].order_id]);
    assert.equal(rows.rows[0].unit_price_snapshot,'10.00');
    await remove();results.push('save first persists reviewed base; absent agreement insert waits');
  }
  {
    const id=await product(),q=await ok(owner,'quote_customer_order',qargs(id));
    const [order]=await ok(owner,'create_order_request',saveargs(id,q.quote));
    const args={...qargs(id),p_order_id:order.order_id,p_items:[{product_id:id,quantity:2}]};
    const quoted=await ok(owner,'quote_customer_order',args);
    await install('order_items',a.tenant);
    const edit=rpc(owner,'update_order_items',{p_tenant_id:a.tenant,p_order_id:order.order_id,p_items:args.p_items,p_quote:quoted.quote});await waiting('update_order_items');
    const waitingQuote=rpc(owner,'quote_customer_order',args);await waiting('quote_customer_order');
    const pause=rpc(service,'set_tenant_pricing_state',{p_tenant_id:a.tenant,p_mode:'paused'});await waiting('set_tenant_pricing_state');
    await release();assert(!(await edit).error);assert(!(await waitingQuote).error);assert(!(await pause).error);await remove();
    results.push('edit, quote and pause finish without state/order lock cycle');
    await ok(service,'set_tenant_pricing_state',{p_tenant_id:a.tenant,p_mode:'active'});
  }
  {
    const id=await product(),q=await ok(owner,'quote_customer_order',qargs(id));
    await install('tenant_pricing_state',a.tenant);
    const pause=rpc(service,'set_tenant_pricing_state',{p_tenant_id:a.tenant,p_mode:'paused'});await waiting('set_tenant_pricing_state');
    const save=rpc(owner,'create_order_request',saveargs(id,q.quote));await waiting('create_order_request');
    await release();assert(!(await pause).error);assert.equal((await save).error?.code,'MDF53');
    await remove();results.push('pause first denies waiting save');
    await ok(service,'set_tenant_pricing_state',{p_tenant_id:a.tenant,p_mode:'active'});
    const fresh=await ok(owner,'quote_customer_order',qargs(id));
    await install('orders',a.tenant);
    const saveFirst=rpc(owner,'create_order_request',saveargs(id,fresh.quote));await waiting('create_order_request');
    const pauseSecond=rpc(service,'set_tenant_pricing_state',{p_tenant_id:a.tenant,p_mode:'paused'});await waiting('set_tenant_pricing_state');
    await release();assert(!(await saveFirst).error);assert(!(await pauseSecond).error);
    await remove();results.push('save first holds state until commit; pause waits');
  }
  // Hold the winning creation before insertion; a duplicate must wait for its
  // claim to commit, then recheck scope. Prove BOTH RPCs are waiting.
  await ok(service,'set_tenant_pricing_state',{p_tenant_id:a.tenant,p_mode:'active'});
  const email=`pricing-replay-${randomUUID()}@example.invalid`,password=`Synthetic!${randomBytes(20).toString('hex')}`;
  const createdUser=await service.auth.admin.createUser({email,password,email_confirm:true});assert(!createdUser.error);
  const repId=createdUser.data.user.id;
  await db.query("insert into public.tenant_users(tenant_id,user_id,role) values($1,$2,'sales_rep')",[a.tenant,repId]);
  await ok(owner,'assign_customer_to_rep',{p_tenant_id:a.tenant,p_customer_id:a.customer,p_user_id:repId});
  const rep=createClient(status.API_URL,status.ANON_KEY,options);
  assert(!(await rep.auth.signInWithPassword({email,password})).error);
  try {
    const id=await product(),q=await ok(rep,'quote_customer_order',qargs(id)),args=saveargs(id,q.quote);
    await install('orders',a.tenant);
    const leader=rpc(rep,'create_order_request',args);await waiting('create_order_request');
    const replay=rpc(rep,'create_order_request',{...args,p_quote:{mode:'replay_only'}});await waiting('create_order_request',2);
    await ok(owner,'unassign_customer_from_rep',{p_tenant_id:a.tenant,p_customer_id:a.customer,p_user_id:repId});
    await release();assert(!(await leader).error);assert.equal((await replay).error?.code,'42501');await remove();
    assert.equal((await db.query('select count(*)::integer n from public.order_submission_claims where tenant_id=$1 and submission_key=$2',[a.tenant,args.p_submission_key])).rows[0].n,1);
    results.push('waiting committed replay rechecks current rep assignment');
  } finally {await release();await remove();await rep.auth.signOut({scope:'local'});}
  for(const showcase of [false,true]){
    const token=randomBytes(32).toString('hex'),hash=createHash('sha256').update(token).digest('hex');
    const link=showcase
      ? await db.query('insert into public.catalog_showcase_links(tenant_id,token_hash) values($1,$2) returning id',[a.tenant,hash])
      : await db.query('insert into public.customer_access_links(tenant_id,customer_id,token_hash) values($1,$2,$3) returning id',[a.tenant,a.customer,hash]);
    const anon=createClient(status.API_URL,status.ANON_KEY,options),items=[{product_id:a.product,quantity:1}];
    const q=await ok(anon,'quote_token_order',{p_token:token,p_items:items,p_showcase:showcase});
    const fn=showcase?'create_order_from_showcase_token':'create_order_request_from_token';
    const args={p_token:token,p_items:items,p_submission_key:randomUUID(),p_quote:q.quote,...(showcase?{p_store_name:'Synthetic replay'}:{})};
    await install('orders',a.tenant);
    const leader=rpc(anon,fn,args);await waiting(fn);
    const replay=rpc(anon,fn,{...args,p_quote:{mode:'replay_only'}});await waiting(fn,2);
    await ok(owner,showcase?'revoke_catalog_showcase_link':'revoke_customer_access_link',{p_tenant_id:a.tenant,p_link_id:link.rows[0].id});
    await release();assert(!(await leader).error);const denied=await replay;assert(!denied.error);assert.equal(denied.data[0].order_number,null);await remove();
    results.push(`${showcase?'showcase':'private shop'} waiting committed replay rechecks revoked link`);
  }
  console.log(`Forced pricing interleavings PASS — ${results.length}`);
}finally{
  await barrier.query('rollback');await release();await remove();await db.query('drop function if exists public._pricing_test_barrier()');
  await owner.auth.signOut({scope:'local'});await db.end();await barrier.end();
  await writeFile(resolve(runRoot,'pricing-concurrency-summary.json'),JSON.stringify({passed:results.length,checks:results},null,2));
}
