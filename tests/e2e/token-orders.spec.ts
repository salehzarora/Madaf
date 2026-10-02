import { test, expect, type Page } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import pg from 'pg';
import { assertOwnedDestinations, destinations } from './safety.mjs';

const runRoot = process.env.MADAF_E2E_RUN_ROOT!;
const marker = JSON.parse(readFileSync(resolve(runRoot, 'ownership.json'), 'utf8'));
const backend = JSON.parse(readFileSync(resolve(runRoot, 'backend.json'), 'utf8'));
assertOwnedDestinations(process.cwd(), runRoot, marker, backend);
type Fixture = { tenant: string; user: string; email: string; password: string; customer: string;
  product: string; productName: string; rawShop: string; rawShowcase: string };
let fixture: Fixture;
const db = new pg.Client({ connectionString: backend.DB_URL, connectionTimeoutMillis: 10000, statement_timeout: 10000 });
test.beforeAll(async () => {
  // The live helper imports the real data layer; cookies hold only a genuine
  // disposable Auth session. Its public output contains assertion names only.
  // This single-process helper inherits the browser runner's owned process tree.
  try {
    const result = await promisify(execFile)(process.execPath, ['--import', 'tsx', '--experimental-test-module-mocks',
      resolve('tests/e2e/token-orders.live.mjs'), runRoot], {
      cwd: process.cwd(), env: process.env, timeout: 30000, windowsHide: true,
    });
    writeFileSync(resolve(runRoot, 'token-live.log'), result.stdout + result.stderr, { mode: 0o600 });
  } catch (error) {
    const output = error as { stdout?: string; stderr?: string };
    writeFileSync(resolve(runRoot, 'token-live.log'), (output.stdout ?? '') + (output.stderr ?? ''), { mode: 0o600 });
    throw new Error('Token data acceptance failed; inspect the ignored token-live.log');
  }
  fixture = JSON.parse(readFileSync(resolve(runRoot, 'token-fixtures.json'), 'utf8'));
  await db.connect();
});
test.afterAll(async () => { await db.end(); });
test.beforeEach(async ({ page }) => {
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (!['http:', 'https:'].includes(url.protocol) || url.origin === destinations.app || url.origin === destinations.api) await route.continue();
    else await route.abort();
  });
});
async function login(page: Page) {
  await page.goto('/en/login?next=%2Fen%2Fcatalog');
  await page.getByLabel('Email', { exact: true }).fill(fixture.email);
  await page.getByLabel('Password', { exact: true }).fill(fixture.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/en\/catalog$/);
}
async function prepare(page: Page, notes: string, showcase = false) {
  await page.goto(`/en/${showcase ? 'showcase' : 'shop'}/${showcase ? fixture.rawShowcase : fixture.rawShop}`);
  const card = page.locator(showcase ? '.public-store-product' : '.private-shop-product')
    .filter({ has: page.getByRole('heading', { name: fixture.productName, exact: true }) });
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Add', exact: true }).click();
  if (showcase) {
    await page.getByRole('button', { name: 'Review order', exact: true }).click();
    await page.getByLabel('Store name', { exact: true }).fill('Synthetic browser guest');
    await page.locator('#sc-notes').fill(notes);
  } else {
    await page.getByRole('textbox', { name: 'Delivery instructions, missing items, special requests…', exact: true }).fill(notes);
  }
  const submit = page.getByRole('button', { name: showcase ? 'Send order request' : 'Send order', exact: true });
  await expect(submit).toBeEnabled();
  return submit;
}
async function verify(notes: string, showcase = false) {
  const rows = (await db.query('select * from public.orders where tenant_id=$1 and notes=$2', [fixture.tenant, notes])).rows;
  expect(rows).toHaveLength(1); const order = rows[0];
  expect(order.customer_id).toBe(showcase ? null : fixture.customer);
  expect(order.source).toBe('remote_customer'); expect(Number(order.subtotal)).toBe(54);
  expect(Number(order.vat_total)).toBe(9.72); expect(Number(order.total)).toBe(63.72);
  const claims = (await db.query('select channel from public.order_submission_claims where order_id=$1', [order.id])).rows;
  expect(claims).toEqual([{ channel: showcase ? 'showcase' : 'shop_token' }]);
  const audit = (await db.query("select actor_user_id,metadata from public.audit_events where entity_id=$1 and event_type='order.created'", [order.id])).rows;
  expect(audit).toHaveLength(1); expect(audit[0].actor_user_id).toBeNull();
  expect(audit[0].metadata.initiator_kind).toBe(showcase ? 'showcase_guest' : 'customer_link');
  if (showcase) expect(order.customer_snapshot.name).toBe('Synthetic browser guest');
  const line = (await db.query('select pricing_source_snapshot,unit_price_snapshot from public.order_items where order_id=$1', [order.id])).rows;
  expect(line).toEqual([{ pricing_source_snapshot: 'base', unit_price_snapshot: '54.00' }]);
  return order.public_ref;
}
for (const showcase of [false, true]) for (const owner of [true, false]) {
  test(`Token ${showcase ? 'Showcase' : 'private shop'} ${owner ? 'Owner session' : 'anonymous'} commits once with anonymous audit actor`, async ({ page }) => {
    if (owner) await login(page);
    const notes = `Synthetic browser token ${randomUUID()}`;
    const submit = await prepare(page, notes, showcase);
    await submit.click();
    await expect(page.getByRole('heading', { name: showcase ? 'Order request sent' : 'Order sent!', exact: true })).toBeVisible();
    await verify(notes, showcase);
    if (owner) { // Fix never deletes cookies or logs the supplier out.
      await page.goto('/en/admin');
      await expect(page).toHaveURL(/\/en\/admin$/);
    }
  });
}
test('Token private shop retries a genuinely lost action response without duplicates', async ({ page }) => {
  await login(page);
  const notes = `Synthetic lost token response ${randomUUID()}`;
  const submit = await prepare(page, notes);
  let dropped = false;
  let confirmDrop!: () => void;
  let failDrop!: (error: Error) => void;
  const droppedResponse = new Promise<void>((done, fail) => { confirmDrop = done; failDrop = fail; });
  await page.route('**/en/shop/**', async route => {
    const request = route.request();
    if (!dropped && request.method() === 'POST' && request.headers()['next-action'] && request.postData()?.includes(notes)) {
      dropped = true;
      try {
        const response = await route.fetch(); // Actual server action commits first.
        expect(response.ok()).toBe(true);
        await route.abort();
        confirmDrop();
      } catch {
        failDrop(new Error('Could not stage the owned local action-response loss'));
      }
    } else await route.continue();
  });
  await submit.click();
  await droppedResponse;
  await expect(page.locator('.private-shop-error[role="alert"]')).toBeVisible();
  expect(dropped).toBe(true);
  const original = await verify(notes);
  await submit.click();
  await expect(page.getByRole('heading', { name: 'Order sent!', exact: true })).toBeVisible();
  expect(await verify(notes)).toBe(original);
});
