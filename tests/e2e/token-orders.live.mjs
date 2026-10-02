// Real data-layer clients against the runner-owned disposable stack. Only the
// Next request-cookie adapter is supplied here; Auth and RPCs are not mocked.
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import pg from 'pg';
import { assertOwnedDestinations } from './safety.mjs';

const runRoot = resolve(process.argv[2]);
const marker = JSON.parse(await readFile(resolve(runRoot, 'ownership.json'), 'utf8'));
const backend = JSON.parse(await readFile(resolve(runRoot, 'backend.json'), 'utf8'));
assertOwnedDestinations(process.cwd(), runRoot, marker, backend);
const { a, b } = JSON.parse(await readFile(resolve(runRoot, 'fixtures.json'), 'utf8'));
Object.assign(process.env, { NEXT_PUBLIC_MADAF_DATA_MODE: 'supabase',
  NEXT_PUBLIC_SUPABASE_URL: backend.API_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: backend.ANON_KEY,
  MADAF_NATIVE_PUSH_ENABLED: 'false' });
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
const jar = new Map(); // Genuine local GoTrue session, memory only, never output.
mock.module('server-only', { namedExports: {} });
mock.module('next/headers', { namedExports: { cookies: async () => ({
  getAll: () => [...jar].map(([name, value]) => ({ name, value })),
  get: name => jar.has(name) ? { name, value: jar.get(name) } : undefined,
  set: (name, value) => jar.set(name, value),
}) } });
const { createServerAuthClient } = await import('../../src/lib/supabase/server-auth.ts');
const { submitTokenOrder } = await import('../../src/lib/data/token.ts');
const { submitShowcaseGuestOrder } = await import('../../src/lib/data/catalog-showcase.ts');
const { quoteOrder } = await import('../../src/lib/data/pricing.ts');
const { sbCreateOrderRequest } = await import('../../src/lib/data/supabase-writes.ts');
const { PricingError } = await import('../../src/lib/pricing.ts');
const submit = input => submitTokenOrder(input.token, input.items, input.submissionKey, input.notes, input.quote);
const db = new pg.Client({ connectionString: backend.DB_URL, connectionTimeoutMillis: 10000, statement_timeout: 15000 });
const checks = [];
const fetchOriginal = globalThis.fetch;
let anonymousWrites = 0;
const statelessFetch = (url, init) => {
  const address = new URL(typeof url === 'string' || url instanceof URL ? url : url.url);
  assert(address.origin === backend.API_URL, 'Live data request escaped owned local API');
  if (['/rest/v1/rpc/create_order_request_from_token', '/rest/v1/rpc/create_order_from_showcase_token'].includes(address.pathname)) {
    assert(new Headers(init?.headers).get('authorization') === `Bearer ${backend.ANON_KEY}`, 'Token write must use only the public anon key');
    anonymousWrites++;
  }
  return fetchOriginal(url, init);
};
function check(name, fn) { fn(); checks.push(name); console.log(`PASS ${name}`); }
async function signIn(f) {
  jar.clear();
  const client = await createServerAuthClient();
  const response = await client.auth.signInWithPassword({ email: f.email, password: f.password });
  assert(!response.error, 'Local synthetic Owner sign-in failed');
  const verified = await (await createServerAuthClient()).auth.getUser();
  assert(verified.data.user?.id === f.user, 'Cookie-bound client did not retain genuine Owner');
  return client;
}
await db.connect();
try {
  const product = randomUUID(), customer = randomUUID();
  const productName = 'Synthetic token carton';
  await db.query("insert into public.products(id,tenant_id,name_ar,name_he,name_en,package_unit,package_quantity,base_unit,unit_size,wholesale_price,vat_rate,is_active) values($1,$2,$3,$3,$3,'carton',12,'bottles','750 ml',54,.18,true)", [product, a.tenant, productName]);
  await db.query('insert into public.inventory_items(tenant_id,product_id,quantity_available,low_stock_threshold) values($1,$2,100,1)', [a.tenant, product]);
  await db.query("insert into public.customers(id,tenant_id,name,customer_type,is_active) values($1,$2,'Synthetic token shop','grocery',true)", [customer, a.tenant]);
  await db.query("insert into public.customer_product_prices(tenant_id,customer_id,product_id,package_price,package_contract_revision,package_unit,package_quantity,base_unit,unit_size) values($1,$2,$3,7.25,1,'carton',12,'bottles','750 ml')", [a.tenant, customer, product]);
  const rawShop = randomBytes(32).toString('hex'), rawShowcase = randomBytes(32).toString('hex');
  const hash = raw => createHash('sha256').update(raw).digest('hex');
  await db.query('insert into public.customer_access_links(tenant_id,customer_id,token_hash) values($1,$2,$3)', [a.tenant, customer, hash(rawShop)]);
  await db.query('insert into public.catalog_showcase_links(tenant_id,token_hash) values($1,$2)', [a.tenant, hash(rawShowcase)]);
  const fixture = { ...a, product, productName, customer, rawShop, rawShowcase };
  await writeFile(resolve(runRoot, 'token-fixtures.json'), JSON.stringify(fixture), { mode: 0o600 });
  const state = (await db.query('select mode,epoch from public.tenant_pricing_state where tenant_id=$1', [a.tenant])).rows[0];
  check('token fixture pricing disabled epoch 1', () => { assert.equal(state.mode, 'disabled'); assert.equal(Number(state.epoch), 1); });
  const items = [{ productId: product, quantity: 1 }];
  async function verify(ref, notes, showcase = false) {
    const rows = (await db.query('select * from public.orders where tenant_id=$1 and notes=$2', [a.tenant, notes])).rows;
    assert.equal(rows.length, 1); const order = rows[0];
    assert.equal(order.public_ref, ref); assert.equal(order.customer_id, showcase ? null : customer);
    assert.equal(order.source, 'remote_customer'); assert.equal(Number(order.subtotal), 54);
    assert.equal(Number(order.vat_total), 9.72); assert.equal(Number(order.total), 63.72);
    const lines = (await db.query('select * from public.order_items where order_id=$1', [order.id])).rows;
    assert.equal(lines.length, 1); assert.equal(lines[0].product_id, product);
    assert.equal(lines[0].pricing_source_snapshot, 'base'); assert.equal(Number(lines[0].unit_price_snapshot), 54);
    const claims = (await db.query('select * from public.order_submission_claims where order_id=$1', [order.id])).rows;
    assert.equal(claims.length, 1); assert.equal(claims[0].channel, showcase ? 'showcase' : 'shop_token');
    const audit = (await db.query("select * from public.audit_events where entity_id=$1 and event_type='order.created'", [order.id])).rows;
    assert.equal(audit.length, 1); assert.equal(audit[0].actor_user_id, null);
    assert.equal(audit[0].metadata.initiator_kind, showcase ? 'showcase_guest' : 'customer_link');
    if (showcase) { assert.equal(order.customer_snapshot.name, 'Synthetic guest'); assert.equal(order.customer_snapshot.guest, true); }
  }
  const owner = await signIn(a);
  const quote = await quoteOrder({ token: rawShop, showcase: false }, items);
  check('Owner cookie quote uses disabled base terms', () => { assert.equal(quote.mode, 'disabled'); assert.equal(Number(quote.lines[0].unit_price_snapshot), 54); });
  // The exact pre-fix cookie-bound RPC fails at the unchanged audit guard.
  const oldNotes = `Synthetic old actor ${randomUUID()}`, oldKey = randomUUID();
  // The authenticated baseline intentionally precedes the stateless-write spy.
  const old = await owner.rpc('create_order_request_from_token', { p_token: rawShop, p_items: [{ product_id: product, quantity: 1 }], p_notes: oldNotes, p_submission_key: oldKey, p_quote: quote.quote });
  check('pre-fix authenticated token RPC reproduces audit guard SQLSTATE 22023', () => {
    assert.equal(old.error?.code, '22023');
    assert.equal(old.error?.message, '_log_order_audit_event: customer_link events cannot carry an authenticated actor');
  });
  check('pre-fix transaction rolled back', () => assert.equal(old.data, null));
  assert.equal((await db.query('select id from public.orders where notes=$1', [oldNotes])).rowCount, 0);
  assert.equal((await db.query('select order_id from public.order_submission_claims where submission_key=$1', [oldKey])).rowCount, 0);
  globalThis.fetch = statelessFetch;
  const notes = `Synthetic token Owner ${randomUUID()}`, key = randomUUID();
  const input = { token: rawShop, items, notes, submissionKey: key, quote: quote.quote };
  const [created, duplicate] = await Promise.all([submit(input), submit(input)]);
  check('actual Owner-context data path and double submit succeed', () => { assert(created); assert.equal(duplicate, created); });
  await verify(created, notes); check('private scope claim base snapshots and NULL customer-link actor', () => {});
  const replay = await submit({ ...input, quote: { mode: 'replay_only' } });
  check('lost-response replay returns original public reference', () => assert.equal(replay, created));
  await assert.rejects(submit({ ...input, items: [{ productId: product, quantity: 2 }] }), /submission key reused/);
  check('changed payload same key preserves MDF40 conflict', () => {});
  await verify(created, notes);
  await assert.rejects(submit({ ...input, submissionKey: randomUUID(), quote: { version: 1, digest: '0'.repeat(64) } }), PricingError);
  check('mismatched quote rejected', () => {});
  // A genuine Owner from a different tenant must not contaminate token scope.
  await signIn(b);
  const otherNotes = `Synthetic other Owner ${randomUUID()}`;
  const otherQuote = await quoteOrder({ token: rawShop, showcase: false }, items);
  const otherRef = await submit({ ...input, notes: otherNotes, submissionKey: randomUUID(), quote: otherQuote.quote });
  await verify(otherRef, otherNotes); check('other-tenant ambient Owner cannot redirect token scope', () => {});
  jar.clear();
  const anonNotes = `Synthetic token anon ${randomUUID()}`;
  const anonQuote = await quoteOrder({ token: rawShop, showcase: false }, items);
  const anonRef = await submit({ ...input, notes: anonNotes, submissionKey: randomUUID(), quote: anonQuote.quote });
  await verify(anonRef, anonNotes); check('anonymous private control', () => {});
  for (const authenticated of [true, false]) {
    if (authenticated) await signIn(a); else jar.clear();
    const q = await quoteOrder({ token: rawShowcase, showcase: true }, items);
    const n = `Synthetic showcase ${randomUUID()}`;
    const ref = await submitShowcaseGuestOrder(rawShowcase, items, { name: 'Synthetic guest' }, randomUUID(), n, q.quote);
    assert(ref); await verify(ref, n, true);
    check(authenticated ? 'actual Owner-context Showcase quote and submission' : 'anonymous Showcase control', () => {});
  }
  await signIn(a);
  for (const lifecycle of ['revoked', 'expired', 'inactive']) {
    const c = randomUUID(), raw = randomBytes(32).toString('hex');
    await db.query("insert into public.customers(id,tenant_id,name,customer_type,is_active) values($1,$2,'Synthetic lifecycle','grocery',true)", [c, a.tenant]);
    await db.query('insert into public.customer_access_links(tenant_id,customer_id,token_hash) values($1,$2,$3)', [a.tenant, c, hash(raw)]);
    const q = await quoteOrder({ token: raw, showcase: false }, items);
    if (lifecycle === 'inactive') await db.query('update public.customers set is_active=false where id=$1', [c]);
    else await db.query(`update public.customer_access_links set ${lifecycle === 'revoked' ? 'revoked_at' : 'expires_at'}=now()-interval '1 minute' where customer_id=$1`, [c]);
    const n = `Synthetic lifecycle ${randomUUID()}`, k = randomUUID();
    assert.equal(await submit({ token: raw, items, notes: n, submissionKey: k, quote: q.quote }), null);
    assert.equal((await db.query('select id from public.orders where notes=$1', [n])).rowCount, 0);
    assert.equal((await db.query('select order_id from public.order_submission_claims where submission_key=$1', [k])).rowCount, 0);
    check(`${lifecycle} token denied with no persistent order or claim`, () => {});
  }
  for (const lifecycle of ['revoked', 'expired']) {
    const raw = randomBytes(32).toString('hex');
    await db.query('insert into public.catalog_showcase_links(tenant_id,token_hash) values($1,$2)', [a.tenant, hash(raw)]);
    const q = await quoteOrder({ token: raw, showcase: true }, items);
    await db.query(`update public.catalog_showcase_links set ${lifecycle === 'revoked' ? 'revoked_at' : 'expires_at'}=now()-interval '1 minute' where token_hash=$1`, [hash(raw)]);
    const n = `Synthetic showcase lifecycle ${randomUUID()}`, k = randomUUID();
    assert.equal(await submitShowcaseGuestOrder(raw, items, { name: 'Synthetic denied guest' }, k, n, q.quote), null);
    assert.equal((await db.query('select id from public.orders where notes=$1', [n])).rowCount, 0);
    assert.equal((await db.query('select order_id from public.order_submission_claims where submission_key=$1', [k])).rowCount, 0);
    check(`${lifecycle} Showcase denied without order or claim`, () => {});
  }
  const authenticated = await sbCreateOrderRequest({ customerId: customer, items, notes: 'Synthetic authenticated control', source: 'admin', submissionKey: randomUUID() });
  const audit = (await db.query("select actor_user_id,metadata from public.audit_events where entity_id=$1 and event_type='order.created'", [authenticated.orderId])).rows[0];
  check('normal authenticated data path retains genuine Owner actor', () => { assert.equal(audit.actor_user_id, a.user); assert.equal(audit.metadata.initiator_kind, 'authenticated_user'); });
  const finalState = (await db.query('select mode,epoch from public.tenant_pricing_state where tenant_id=$1', [a.tenant])).rows[0];
  check('token acceptance did not activate or change pricing epoch', () => assert.deepEqual(finalState, state));
  check('every token data write used only public anon authentication', () => assert(anonymousWrites >= 14));
} finally {
  globalThis.fetch = fetchOriginal;
  jar.clear(); await db.end();
  await writeFile(resolve(runRoot, 'token-live-summary.json'), JSON.stringify({ passed: checks.length, checks }, null, 2));
}
