// Owned disposable infrastructure only. Auth assertions use actual GoTrue
// password sessions and PostgREST, never privileged SQL impersonation.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import pg from 'pg';
import {assertOwnedDestinations} from './safety.mjs';
import {seedFixtures} from './seed.mjs';

const root=process.cwd(),runRoot=resolve(process.argv[2]);
const marker=JSON.parse(await readFile(resolve(runRoot,'ownership.json'),'utf8'));
const status=JSON.parse(await readFile(resolve(runRoot,'backend.json'),'utf8'));
assertOwnedDestinations(root,runRoot,marker,status);
const results=[];
function check(name,fn){fn();results.push(name);console.log(`PASS ${name}`);}
async function ok(client,fn,args){const r=await client.rpc(fn,args);assert(!r.error,`${fn}: ${r.error?.code}`);return r.data;}
async function denied(name,client,fn,args,code){const r=await client.rpc(fn,args);check(name,()=>{assert(r.error,`${fn}: expected denial`);if(code)assert.equal(r.error.code,code);});}
const client=()=>createClient(status.API_URL,status.ANON_KEY,{auth:{autoRefreshToken:false,persistSession:false}});
const service=createClient(status.API_URL,status.SERVICE_ROLE_KEY,{auth:{autoRefreshToken:false,persistSession:false}});
const db=new pg.Client({connectionString:status.DB_URL,connectionTimeoutMillis:10000,statement_timeout:15000});
await db.connect();
const clients=[];
async function login(f){const c=client();clients.push(c);const r=await c.auth.signInWithPassword({email:f.email,password:f.password});assert(!r.error,'Synthetic sign-in failed');return c;}
async function user(role,tenant){const email=`pricing-${randomUUID()}@example.invalid`,password=`Synthetic!${randomBytes(20).toString('hex')}`;
  const r=await service.auth.admin.createUser({email,password,email_confirm:true});assert(!r.error,'Synthetic prerequisite failed');
  await db.query('insert into public.tenant_users(tenant_id,user_id,role) values($1,$2,$3)',[tenant,r.data.user.id,role]);
  return {client:await login({email,password}),id:r.data.user.id};}
try{
  const f=await seedFixtures(root,runRoot,marker,status,`pricing-${randomBytes(6).toString('hex')}-`),a=f.a,b=f.b;
  const owner=await login(a),other=await login(b),admin=await user('admin',a.tenant),rep=await user('sales_rep',a.tenant),anon=client();
  const ids={p_tenant_id:a.tenant,p_customer_id:a.customer,p_product_id:a.product};
  const resolveArgs={p_tenant_id:a.tenant,p_customer_id:a.customer,p_product_ids:[a.product]};
  const manage=(extra={})=>({...ids,p_action:'set',p_expected_revision:0,p_package_revision:1,p_price:'7.25',...extra});
  const items=[{product_id:a.product,quantity:3}];
  const qargs={p_tenant_id:a.tenant,p_customer_id:a.customer,p_items:items};
  const save=(quote,key=randomUUID())=>({...qargs,p_submission_key:key,...(quote?{p_quote:quote}:{})});
  for(const price of ['0','-1','1e2','NaN','Infinity','','0.001','1.234','10000000',null])
    await denied(`reject override ${price===null?'null':JSON.stringify(price)}`,owner,'manage_customer_product_price',manage({p_price:price}),'22023');
  await denied('anonymous management denied',anon,'manage_customer_product_price',manage());
  await denied('rep management denied',rep.client,'manage_customer_product_price',manage(),'42501');
  await denied('cross-tenant management denied',other,'manage_customer_product_price',manage(),'42501');
  const first=await ok(owner,'manage_customer_product_price',manage());
  check('disabled owner preparation',()=>assert.equal(first.revision,1));
  const inert=await ok(owner,'resolve_customer_prices',resolveArgs);check('disabled effective base',()=>assert.equal(inert.prices[0].price,"10.00"));
  const noop=await ok(admin.client,'manage_customer_product_price',manage({p_expected_revision:1}));check('identical admin save preserves revision',()=>assert.equal(noop.revision,1));
  await denied('CAS prevents first-writer overwrite',owner,'manage_customer_product_price',manage(),'MDF51');
  await denied('unassigned rep resolution denied',rep.client,'resolve_customer_prices',resolveArgs,'42501');
  await ok(owner,'assign_customer_to_rep',{p_tenant_id:a.tenant,p_customer_id:a.customer,p_user_id:rep.id});
  await denied('foreign resolver denied',other,'resolve_customer_prices',resolveArgs,'42501');
  for(const table of ['customer_product_prices','tenant_pricing_state']){
    const r=await owner.from(table).select('*');check(`${table} raw read denied`,()=>assert(r.error));
    const w=await owner.from(table).insert({tenant_id:a.tenant});check(`${table} raw write denied`,()=>assert(w.error));
  }
  await denied('private helper denied',owner,'_pricing_state',{p_tenant:a.tenant});
  await denied('browser cannot activate pricing',owner,'set_tenant_pricing_state',{p_tenant_id:a.tenant,p_mode:'active'});
  await ok(owner,'create_order_request',save(null));
  await ok(service,'set_tenant_pricing_state',{p_tenant_id:a.tenant,p_mode:'active'});
  const effective=await ok(rep.client,'resolve_customer_prices',resolveArgs);
  check('assigned rep effective agreement',()=>assert.equal(effective.prices[0].price,"7.25"));
  check('effective DTO hides agreement internals',()=>assert.deepEqual(Object.keys(effective.prices[0]).sort(),['price','product_id','status','vat']));
  await denied('active quote-less creation denied',owner,'create_order_request',save(null),'MDF55');
  const quote=await ok(owner,'quote_customer_order',qargs);
  check('line-rounded quote',()=>assert.deepEqual(quote.headers,{subtotal:"21.75",vat:"3.92",total:"25.67"}));
  check('quote envelope version',()=>{assert.equal(quote.quote.version,1);assert.match(quote.quote.digest,/^[a-f0-9]{64}$/);});
  await denied('forged quote rejected',owner,'create_order_request',save({version:1,digest:'0'.repeat(64)}),'MDF55');
  await denied('client totals are rejected in quote envelope',owner,'create_order_request',save({...quote.quote,total:'0.01'}),'MDF55');
  const key=randomUUID();const orders=await Promise.all([ok(owner,'create_order_request',save(quote.quote,key)),ok(owner,'create_order_request',save(quote.quote,key))]);
  check('parallel same-key creates once',()=>assert.equal(orders[0][0].order_id,orders[1][0].order_id));
  const order=orders[0][0].order_id;
  const recorded=(await db.query('select * from public.order_items where order_id=$1',[order])).rows[0];
  check('saved price and provenance',()=>{assert.equal(recorded.unit_price_snapshot,'7.25');assert.equal(recorded.pricing_source_snapshot,'customer_agreement');});
  await ok(owner,'manage_customer_product_price',manage({p_expected_revision:1,p_price:'8'}));
  const replay=await ok(owner,'create_order_request',save({mode:'replay_only'},key));
  check('lost-response replay after changed agreement',()=>assert.equal(replay[0].order_id,order));
  const malformedReplay=await ok(owner,'create_order_request',save({version:99,digest:'invalid'},key));
  check('committed replay precedes malformed fresh quote validation',()=>assert.equal(malformedReplay[0].order_id,order));
  await denied('replay-only cannot create',owner,'create_order_request',save({mode:'replay_only'}),'MDF54');
  await denied('changed agreement invalidates quote',owner,'create_order_request',save(quote.quote),'MDF55');
  const product=(await db.query('select * from public.products where id=$1',[a.product])).rows[0];
  const update=async delta=>ok(owner,'update_product',{p_tenant_id:a.tenant,p_product_id:a.product,p_product:{...product,...delta}});
  await update({package_quantity:12});await update({package_quantity:6});
  const stale=await ok(owner,'resolve_customer_prices',resolveArgs);
  check('package A-B-A remains stale',()=>{assert.equal(stale.prices[0].status,'stale_package');assert.equal(stale.prices[0].price,null);});
  await denied('unreviewed package reconfirm rejected',owner,'manage_customer_product_price',manage({p_expected_revision:2,p_action:'reconfirm',p_price:'8'}),'MDF51');
  await ok(owner,'manage_customer_product_price',manage({p_expected_revision:2,p_package_revision:3,p_action:'reconfirm',p_price:'8'}));
  const editArgs={p_tenant_id:a.tenant,p_order_id:order,p_customer_id:a.customer,p_items:[{product_id:a.product,quantity:4}]};
  const editQuote=await ok(owner,'quote_customer_order',editArgs);
  check('retained edit uses saved terms',()=>assert.equal(editQuote.headers.subtotal,"29.00"));
  await ok(owner,'update_order_items',{p_tenant_id:a.tenant,p_order_id:order,p_items:editArgs.p_items,p_quote:editQuote.quote});
  const extra=randomUUID();
  await db.query("insert into public.products(id,tenant_id,name_ar,name_he,name_en,package_unit,package_quantity,base_unit,wholesale_price,vat_rate,is_active) values($1,$2,'تجريبي','בדיקה','Synthetic extra','unit',1,'units',1,.18,true)",[extra,a.tenant]);
  await ok(owner,'manage_customer_product_price',manage({p_product_id:extra,p_price:'0.30'}));
  const mixed={...editArgs,p_items:[...editArgs.p_items,{product_id:extra,quantity:1}]};
  const mixedQuote=await ok(owner,'quote_customer_order',mixed);
  check('retained and new agreement line mixture',()=>assert.deepEqual(mixedQuote.headers,{subtotal:'29.30',vat:'5.27',total:'34.57'}));
  await ok(owner,'update_order_items',{p_tenant_id:a.tenant,p_order_id:order,p_items:mixed.p_items,p_quote:mixedQuote.quote});
  const snapshots=(await db.query('select product_id,unit_price_snapshot,pricing_source_snapshot from public.order_items where order_id=$1',[order])).rows;
  check('mixed save preserves retained price and snapshots new override',()=>{assert.equal(snapshots.find(i=>i.product_id===a.product).unit_price_snapshot,'7.25');assert.equal(snapshots.find(i=>i.product_id===extra).unit_price_snapshot,'0.30');assert(snapshots.every(i=>i.pricing_source_snapshot==='customer_agreement'));});
  const onlyExtra={...editArgs,p_items:[{product_id:extra,quantity:1}]};
  const removal=await ok(owner,'quote_customer_order',onlyExtra);
  await ok(owner,'update_order_items',{p_tenant_id:a.tenant,p_order_id:order,p_items:onlyExtra.p_items,p_quote:removal.quote});
  const readd=await ok(owner,'quote_customer_order',editArgs);
  check('removed then re-added line resolves current agreement',()=>assert.equal(readd.lines[0].unit_price_snapshot,'8.00'));
  await ok(owner,'update_order_items',{p_tenant_id:a.tenant,p_order_id:order,p_items:editArgs.p_items,p_quote:readd.quote});
  await ok(service,'set_tenant_pricing_state',{p_tenant_id:a.tenant,p_mode:'paused'});
  await denied('paused blocks creation',owner,'create_order_request',save(quote.quote),'MDF53');
  await denied('paused blocks effective edit',owner,'update_order_items',{p_tenant_id:a.tenant,p_order_id:order,p_items:items,p_quote:editQuote.quote},'MDF53');
  await ok(owner,'update_order_items',{p_tenant_id:a.tenant,p_order_id:order,p_items:editArgs.p_items,p_notes:'Synthetic notes only'});
  await ok(owner,'update_order_items',{p_tenant_id:a.tenant,p_order_id:order,p_items:[{product_id:a.product.toUpperCase(),quantity:4}],p_notes:'Synthetic canonical notes'});
  check('paused committed replay remains available',()=>assert.equal(replay[0].order_id,order));
  const pausedReplay=await ok(owner,'create_order_request',save({mode:'replay_only'},key));check('actual paused replay',()=>assert.equal(pausedReplay[0].order_id,order));
  await ok(service,'set_tenant_pricing_state',{p_tenant_id:a.tenant,p_mode:'active'});
  const rawShop=randomBytes(32).toString('hex'),rawShowcase=randomBytes(32).toString('hex');
  for(const [table,raw,customer] of [['customer_access_links',rawShop,a.customer],['catalog_showcase_links',rawShowcase,null]]){
    const hash=createHash('sha256').update(raw).digest('hex');
    if(customer)await db.query(`insert into public.${table}(tenant_id,customer_id,token_hash) values($1,$2,$3)`,[a.tenant,customer,hash]);
    else await db.query(`insert into public.${table}(tenant_id,token_hash) values($1,$2)`,[a.tenant,hash]);
  }
  for(const [showcase,token] of [[false,rawShop],[true,rawShowcase]]){
    const q=await ok(anon,'quote_token_order',{p_token:token,p_items:items,p_showcase:showcase});
    check(showcase?'showcase remains base':'private shop uses agreement',()=>assert.equal(q.lines[0].unit_price_snapshot,showcase?"10.00":"8.00"));
    const args={p_token:token,p_items:items,p_submission_key:randomUUID(),p_quote:q.quote,...(showcase?{p_store_name:'Synthetic pricing store'}:{})};
    const fn=showcase?'create_order_from_showcase_token':'create_order_request_from_token';
    const channel=showcase?'showcase':'private shop';
    await denied(`${channel} active quote-less creation rejected`,anon,fn,{...args,p_quote:null},'MDF55');
    const created=await ok(anon,fn,args);const again=await ok(anon,fn,{...args,p_quote:{mode:'replay_only'}});
    check(`${showcase?'showcase':'private shop'} committed replay`,()=>assert.equal(created[0].order_number,again[0].order_number));
    const malformed=await ok(anon,fn,{...args,p_quote:{version:99}});
    check(`${channel} committed replay ignores obsolete envelope`,()=>assert.equal(created[0].order_number,malformed[0].order_number));
    await ok(service,'set_tenant_pricing_state',{p_tenant_id:a.tenant,p_mode:'paused'});
    await denied(`${channel} paused quote blocked`,anon,'quote_token_order',{p_token:token,p_items:items,p_showcase:showcase},'MDF53');
    await denied(`${channel} paused fresh creation blocked`,anon,fn,{...args,p_submission_key:randomUUID()},'MDF53');
    const paused=await ok(anon,fn,{...args,p_quote:{mode:'replay_only'}});
    check(`${channel} paused committed replay succeeds`,()=>assert.equal(created[0].order_number,paused[0].order_number));
    await ok(service,'set_tenant_pricing_state',{p_tenant_id:a.tenant,p_mode:'active'});
  }
  await ok(owner,'manage_customer_product_price',manage({p_expected_revision:3,p_package_revision:3,p_action:'remove'}));
  await update({wholesale_price:0});
  const zero=await ok(owner,'quote_customer_order',qargs);check('base zero remains valid',()=>assert.equal(zero.headers.total,"0.00"));
  await denied('active base without agreement still requires quote',owner,'create_order_request',save(null),'MDF55');
  await ok(owner,'create_order_request',save(zero.quote));
  const audit=(await db.query("select metadata from public.audit_events where tenant_id=$1 and entity_type='customer_price'",[a.tenant])).rows;
  check('safe bounded audit metadata',()=>assert(audit.length>0&&audit.every(x=>JSON.stringify(x.metadata)==='{}')));
  // Keep this isolated synthetic tenant ready for actual browser acceptance.
  await update({wholesale_price:10});
  await ok(owner,'manage_customer_product_price',manage({p_expected_revision:4,p_package_revision:3,p_price:'7.25'}));
  await db.query(`insert into public.products(tenant_id,name_ar,name_he,name_en,package_unit,package_quantity,base_unit,wholesale_price,vat_rate,is_active)
    select $1,'منتج تجريبي '||g,'מוצר בדיקה '||g,'Synthetic batch '||g,'unit',1,'units',20,.18,true from generate_series(1,203) g`,[a.tenant]);
  await writeFile(resolve(runRoot,'pricing-fixtures.json'),JSON.stringify({a,b,rawShop,rawShowcase}),{mode:0o600});
} finally {
  for(const c of clients)await c.auth.signOut({scope:'local'});
  await db.end();
  await writeFile(resolve(runRoot,'pricing-summary.json'),JSON.stringify({passed:results.length,checks:results},null,2));
}
