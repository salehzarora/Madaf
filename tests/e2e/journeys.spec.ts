import { test, expect, type Page } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import { resolve } from 'node:path';
import pg from 'pg';
import { assertOwnedDestinations, destinations } from './safety.mjs';

type Tenant = { tenant: string; tenantName: string; user: string; email: string; password: string; customer: string; customerName: string; product: string; productName: string; shops: { id: string; name: string }[]; financial?: { order: string; document: string; number: string; storedPath: string; checksum: string } };
const runRoot = process.env.MADAF_E2E_RUN_ROOT!;
const fixtures: { a: Tenant; b: Tenant } = JSON.parse(readFileSync(resolve(runRoot, 'fixtures.json'), 'utf8'));
const marker = JSON.parse(readFileSync(resolve(runRoot, 'ownership.json'), 'utf8'));
const backend = JSON.parse(readFileSync(resolve(runRoot, 'backend.json'), 'utf8'));
assertOwnedDestinations(process.cwd(), runRoot, marker, backend);
const db = new pg.Client({ connectionString: backend.DB_URL, connectionTimeoutMillis: 10_000, statement_timeout: 10_000 });
const money = (value: number) => new Intl.NumberFormat('en-IL', { style: 'currency', currency: 'ILS', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value);

test.beforeAll(async () => { await db.connect(); });
test.afterAll(async () => { await db.end(); });

// Unexpected errors and off-stack network destinations fail the journey.
const problems = new WeakMap<Page, string[]>();
const expectedDenials = new WeakMap<Page, Set<string>>();
async function guardPage(page: Page) {
  const errors: string[] = [];
  problems.set(page, errors);
  page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
  page.on('console', message => {
    if (message.type() !== 'error') return;
    if (expectedDenials.get(page)?.has(message.location().url) && /^Failed to load resource:.*404/.test(message.text())) return;
    errors.push(`console: ${message.text()}`);
  });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (!['http:', 'https:'].includes(url.protocol) || url.origin === destinations.app || url.origin === destinations.api) await route.continue();
    else { errors.push('Unexpected external network destination'); await route.abort(); }
  });
}
test.beforeEach(async ({ page }) => { await guardPage(page); });
test.afterEach(async ({ page }) => { expect(problems.get(page), 'No unexpected browser errors or external requests').toEqual([]); });

async function login(page: Page, tenant = fixtures.a, next = '/en/catalog') {
  await page.goto(`/en/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel('Email', { exact: true }).fill(tenant.email);
  await page.getByLabel('Password', { exact: true }).fill(tenant.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(new URL(next, destinations.app).href);
}

function productCard(page: Page, tenant = fixtures.a) {
  return page.getByRole('article').filter({ has: page.getByRole('heading', { name: tenant.productName, exact: true }) });
}

async function chooseShop(page: Page, tenant = fixtures.a, name = tenant.customerName) {
  await page.getByRole('button', { name: /^(Select shop|Change:)/ }).click();
  const picker = page.getByRole('dialog', { name: 'Select shop', exact: true });
  await expect(picker).toBeVisible();
  await picker.getByRole('searchbox').fill(name);
  await picker.getByRole('listitem').filter({ has: page.getByText(name, { exact: true }) }).getByRole('button').click();
  await expect(picker).not.toBeVisible();
  await expect(page.getByRole('button', { name: `Change: ${name}`, exact: true })).toBeVisible();
}

async function createOrder(page: Page, tenant = fixtures.a, duplicateClick = false) {
  await login(page, tenant);
  await page.getByRole('searchbox', { name: 'Search', exact: true }).fill(tenant.productName);
  const card = productCard(page, tenant);
  await expect(card).toHaveCount(1);
  await card.getByRole('button', { name: 'Add', exact: true }).click();
  await card.getByRole('button', { name: `Increase quantity: ${tenant.productName}`, exact: true }).click();
  await card.getByRole('button', { name: `Increase quantity: ${tenant.productName}`, exact: true }).click();
  await expect(card.getByLabel('Line total', { exact: true })).toHaveText(money(30));
  await chooseShop(page, tenant);
  await page.getByRole('link', { name: 'View cart', exact: true }).click();
  await expect(page).toHaveURL(/\/en\/cart$/);
  await expect(page.getByText(money(30), { exact: true }).first()).toBeVisible();
  await page.getByRole('link', { name: 'Continue to order request', exact: true }).click();
  const notes = `E2E-${randomUUID()}`;
  await page.getByLabel('Notes', { exact: true }).fill(notes);
  const submit = page.getByRole('button', { name: 'Send order request', exact: true });
  if (duplicateClick) {
    // Two real pointer clicks on the existing submit control in the same turn.
    // The application's existing pending/ref guard owns duplicate suppression.
    const box = await submit.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2, { clickCount: 2 });
  } else await submit.click();
  await expect(page.getByRole('heading', { name: 'Order request sent!', exact: true })).toBeVisible();
  const rows = await db.query('select * from public.orders where tenant_id=$1 and notes=$2', [tenant.tenant, notes]);
  expect(rows.rowCount).toBe(1);
  const order = rows.rows[0];
  await expect(page).toHaveURL(new RegExp(`/en/order-success\\?n=${order.public_ref}$`));
  return order;
}

async function noOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth)).toBeLessThanOrEqual(0);
}

test('A Authentication: denial, real login, refresh and logout', async ({ page }) => {
  await page.goto('/en/admin/orders');
  await expect(page).toHaveURL(/\/en\/login/);
  await login(page, fixtures.a, '/en/admin');
  await expect(page.getByText(fixtures.a.email, { exact: true }).first()).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL(/\/en\/admin$/);
  await expect(page.getByText(fixtures.a.email, { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/\/en\/login$/);
  await page.goto('/en/admin/orders');
  await expect(page).toHaveURL(/\/en\/login/);
});

test('B Ordering: customer, quantity, totals and duplicate-click guard', async ({ page }) => {
  const order = await createOrder(page, fixtures.a, true);
  expect(order.customer_id).toBe(fixtures.a.customer);
  expect(order.status).toBe('new');
  expect(order.source).toBe('sales_visit');
  expect(Number(order.subtotal)).toBe(30);
  expect(Number(order.vat_total)).toBe(5.4);
  expect(Number(order.total)).toBe(35.4);
  const items = await db.query('select * from public.order_items where tenant_id=$1 and order_id=$2', [fixtures.a.tenant, order.id]);
  expect(items.rowCount).toBe(1);
  expect(items.rows[0].product_id).toBe(fixtures.a.product);
  expect(Number(items.rows[0].quantity)).toBe(3);
  expect(Number(items.rows[0].unit_price_snapshot)).toBe(10);
  const claims = await db.query('select channel from public.order_submission_claims where tenant_id=$1 and order_id=$2', [fixtures.a.tenant, order.id]);
  expect(claims.rows).toEqual([{ channel: 'authenticated' }]);
  const events = await db.query("select count(*)::int n from public.audit_events where tenant_id=$1 and entity_id=$2 and event_type='order.created'", [fixtures.a.tenant, order.id]);
  expect(events.rows[0].n).toBe(1);
});

test('C Inventory: new order, confirmation reservation and cancellation restoration', async ({ page }) => {
  const stock = async () => Number((await db.query('select quantity_available from public.inventory_items where tenant_id=$1 and product_id=$2', [fixtures.a.tenant, fixtures.a.product])).rows[0].quantity_available);
  const before = await stock();
  const order = await createOrder(page);
  expect(await stock()).toBe(before);
  await page.goto(`/en/admin/orders/${order.id}`);
  await page.getByRole('button', { name: /Confirmed$/ }).click();
  await expect.poll(stock).toBe(before - 3);
  await page.reload();
  await page.getByRole('button', { name: 'Cancelled', exact: true }).click();
  await expect.poll(stock).toBe(before);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Cancelled', exact: true })).toBeDisabled();
  const stored = await db.query('select status from public.orders where tenant_id=$1 and id=$2', [fixtures.a.tenant, order.id]);
  expect(stored.rows[0].status).toBe('cancelled');
  const movements = await db.query('select reason, quantity_delta from public.order_inventory_movements where tenant_id=$1 and order_id=$2 order by created_at,id', [fixtures.a.tenant, order.id]);
  expect(movements.rows.map(row => [row.reason, Number(row.quantity_delta)])).toEqual([['order_reserved', -3], ['order_reservation_released', 3]]);
});

test('D Tenant isolation: another tenant order, existing PDF and preview are denied', async ({ page, browser }) => {
  const bContext = await browser.newContext({ baseURL: destinations.app, viewport: { width: 1440, height: 900 } });
  let bOrder: Awaited<ReturnType<typeof createOrder>>;
  let documentId: string;
  try {
    const bPage = await bContext.newPage();
    await guardPage(bPage);
    bOrder = await createOrder(bPage, fixtures.b);
    const pdf = await bContext.request.get(`/en/admin/orders/${bOrder.id}/documents/order?mode=share&lang=en`);
    expect(pdf.status()).toBe(200);
    expect((await pdf.body()).subarray(0, 5).toString()).toBe('%PDF-');
    documentId = (await db.query('select id from public.documents where tenant_id=$1 and order_id=$2', [fixtures.b.tenant, bOrder.id])).rows[0].id;
    expect(problems.get(bPage)).toEqual([]);
  } finally { await bContext.close(); }
  await login(page);
  const deniedPdf = await page.request.get(`/en/admin/orders/${bOrder.id}/documents/order?mode=share`);
  expect(deniedPdf.status()).toBe(404);
  expect(await deniedPdf.body()).toHaveLength(0);
  // Next's streamed notFound may be HTTP 200; denial UI is authoritative.
  for (const path of [`/en/admin/orders/${bOrder.id}`, `/en/admin/documents/${documentId}`]) {
    expectedDenials.set(page, new Set([new URL(path, destinations.app).href]));
    await page.goto(path);
    await expect(page.getByText('Page not found', { exact: true })).toBeVisible();
    await expect(page.getByText(fixtures.b.customerName, { exact: true })).toHaveCount(0);
    await expect(page.getByText(fixtures.b.productName, { exact: true })).toHaveCount(0);
    await expect(page.getByText(bOrder.public_ref, { exact: true })).toHaveCount(0);
  }
});

test('E Documents: authorized PDF, browser download and non-legal templates', async ({ page }) => {
  const order = await createOrder(page);
  await page.goto(`/en/admin/orders/${order.id}`);
  const route = `/en/admin/orders/${order.id}/documents/order`;
  const response = await page.request.get(`${route}?mode=share&lang=en`);
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('application/pdf');
  expect(response.headers()['cache-control']).toContain('no-store');
  const bytes = await response.body();
  expect(bytes.length).toBeGreaterThan(1000);
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
  const downloaded = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download', exact: true }).and(page.locator(`a[href="${route}"]`)).click();
  const download = await downloaded;
  expect(await download.failure()).toBeNull();
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  expect(readFileSync(downloadPath!).subarray(0, 5).toString()).toBe('%PDF-');
  for (const type of ['invoiceDraft', 'delivery']) {
    const pdf = await page.request.get(`/en/admin/orders/${order.id}/documents/${type}?mode=share&lang=en`);
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()['content-type']).toContain('application/pdf');
    expect((await pdf.body()).subarray(0, 5).toString()).toBe('%PDF-');
    const sqlType = type === 'invoiceDraft' ? 'invoice_draft' : 'delivery_note';
    const doc = (await db.query('select * from public.documents where tenant_id=$1 and order_id=$2 and document_type=$3', [fixtures.a.tenant, order.id, sqlType])).rows[0];
    expect(doc).toBeDefined();
    await page.goto(`/en/admin/documents/${doc.id}`);
    await page.getByRole('button', { name: 'English', exact: true }).click();
    const sheet = page.locator('.doc-sheet'); // existing printable template boundary
    if (type === 'invoiceDraft') {
      expect(doc.status).toBe('draft');
      expect(doc.legal_notice).toBeTruthy();
      await expect(sheet).toContainText('DRAFT');
      await expect(sheet).toContainText('Not a legal tax invoice.');
      await expect(sheet.getByRole('heading', { name: 'Tax Invoice — Draft', exact: true })).toBeVisible();
    } else {
      await expect(sheet.getByRole('heading', { name: 'Delivery Note', exact: true })).toBeVisible();
      await expect(sheet.getByRole('columnheader', { name: 'Qty', exact: true })).toBeVisible();
      await expect(sheet.getByRole('columnheader', { name: /Unit price|Line total/ })).toHaveCount(0);
      await expect(sheet).not.toContainText(money(30));
      await expect(sheet).not.toContainText('Subtotal');
    }
  }
});

test('F Locale and responsive: saved preference, mobile picker/navigation and cart', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/he$/);
  await login(page);
  for (const [locale, width, height, name, dir] of [['ar', 390, 844, 'العربية', 'rtl'], ['he', 768, 1024, 'עברית', 'rtl'], ['en', 1440, 900, 'English', 'ltr']] as const) {
    await page.setViewportSize({ width, height });
    const compact = page.getByRole('button', { name: /^(Language|שפה|اللغة):/ });
    if (await compact.isVisible()) await compact.click();
    await page.getByRole('link', { name, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/${locale}/catalog$`));
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', locale);
    await expect(page.locator('html')).toHaveAttribute('dir', dir);
    await page.goto('/');
    await expect(page).toHaveURL(new RegExp(`/${locale}$`));
    await page.goto('/catalog');
    await expect(page).toHaveURL(new RegExp(`/${locale}/catalog$`));
    await noOverflow(page);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await productCard(page).getByRole('button', { name: 'Add', exact: true }).click();
  await chooseShop(page);
  await page.getByRole('button', { name: `Change: ${fixtures.a.customerName}`, exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Select shop', exact: true });
  await expect(picker.getByRole('button', { name: /^E2E shop A/ })).toHaveCount(12);
  const search = picker.getByRole('searchbox');
  await search.fill('E2E shop A');
  const bounds = await picker.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  const list = picker.getByRole('list');
  await expect.poll(() => list.evaluate(element => element.scrollHeight > element.clientHeight && element.clientHeight > 100)).toBe(true);
  await list.evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect.poll(() => list.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  await picker.getByRole('listitem').filter({ has: page.getByText(fixtures.a.shops[11].name, { exact: true }) }).getByRole('button').click();
  await expect(productCard(page).getByLabel('Line total', { exact: true })).toHaveText(money(10));
  await page.getByRole('button', { name: 'Review cart', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Order summary', exact: true });
  await expect(review).toBeVisible();
  await review.getByRole('link', { name: 'View cart', exact: true }).click();
  await expect(page).toHaveURL(/\/en\/cart$/);
  await page.reload();
  await expect(page.getByRole('button', { name: `Change: ${fixtures.a.shops[11].name}`, exact: true })).toBeVisible();
  await expect(page.getByText(fixtures.a.productName, { exact: true }).first()).toBeVisible();
  const cartLine = page.getByRole('article').filter({ has: page.getByRole('link', { name: fixtures.a.productName, exact: true }) });
  await expect(cartLine.getByText('1', { exact: true })).toBeVisible();
  await expect(cartLine.getByText(money(10), { exact: true })).toBeVisible();
  await noOverflow(page);
});

test('G Financial integrity: saved terms, edit and fresh Download/Share/Print after a stored PDF', async ({ page }) => {
  const fixture = fixtures.a.financial!;
  const orderPath = `/en/admin/orders/${fixture.order}`;
  const pdfPath = `${orderPath}/documents/order`;
  const line = async () => (await db.query('select * from public.order_items where order_id=$1', [fixture.order])).rows[0];
  const header = async () => (await db.query('select * from public.orders where id=$1', [fixture.order])).rows[0];
  const edits = async () => Number((await db.query("select count(*) n from public.audit_events where entity_id=$1 and event_type='order.updated'", [fixture.order])).rows[0].n);
  const original = await line();
  await login(page, fixtures.a, orderPath);
  // Change current catalog terms through the existing product editor.
  await page.goto(`/en/admin/products/${fixtures.a.product}/edit`);
  await page.getByLabel('Wholesale price (₪, excl. VAT)', { exact: true }).fill('40');
  await page.getByLabel('VAT rate', { exact: true }).fill('0.10');
  await page.getByRole('button', { name: 'Save product', exact: true }).click();
  await expect.poll(async () => Number((await db.query('select wholesale_price from public.products where id=$1', [fixtures.a.product])).rows[0].wholesale_price)).toBe(40);
  await page.goto(orderPath);
  await page.getByRole('button', { name: 'Edit order', exact: true }).click();
  await expect(page.getByText('Existing lines keep their saved price, package and VAT. New lines use current catalog values.', { exact: true })).toBeVisible();
  // Scope to the existing editor's list, rather than the page's line table.
  const savedLine = page.getByRole('listitem').filter({ has: page.getByRole('button', { name: 'Remove', exact: true }) });
  await expect(savedLine.getByText(money(10), { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByText('Order updated.', { exact: true })).toBeVisible();
  expect(await line()).toEqual(original);
  expect(await edits()).toBe(0);
  await page.reload();
  await page.getByRole('button', { name: 'Edit order', exact: true }).click();
  await page.locator('textarea').fill('Synthetic financial notes');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect.poll(async () => (await header()).notes).toBe('Synthetic financial notes');
  expect(await line()).toEqual(original);
  expect(Number((await header()).total)).toBe(35.4);
  expect(await edits()).toBe(1);
  await page.reload();
  await page.getByRole('button', { name: 'Edit order', exact: true }).click();
  await savedLine.getByRole('button', { name: '+', exact: true }).click();
  await expect(savedLine.getByText('4', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect.poll(async () => Number((await header()).total)).toBe(47.2);
  const edited = await line();
  expect(edited.id).toBe(original.id);
  expect(Number(edited.unit_price_snapshot)).toBe(10);
  expect(Number(edited.vat_rate_snapshot)).toBe(.18);
  expect(Number(edited.line_subtotal)).toBe(40);
  expect(Number(edited.line_vat)).toBe(7.2);
  expect(await edits()).toBe(2);
  for (const mode of ['download', 'share']) {
    const response = await page.request.get(`${pdfPath}?mode=${mode}&lang=en`, { maxRedirects: 0 });
    expect(response.status()).toBe(200);
    expect(response.headers()['location']).toBeUndefined();
    expect(response.headers()['content-disposition']).toBe(`${mode === 'download' ? 'attachment' : 'inline'}; filename="${fixture.number}.pdf"`);
    expect(response.headers()['cache-control']).toContain('no-store');
    const bytes = await response.body();
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    expect(createHash('sha256').update(bytes).digest('hex')).not.toBe(fixture.checksum);
    // Private local-only evidence; never emitted by the sanitized reporter.
    writeFileSync(resolve(runRoot, `financial-${mode}.pdf`), bytes);
  }
  await page.goto(`${pdfPath}/print`);
  await page.getByRole('button', { name: 'English', exact: true }).click();
  const sheet = page.locator('.doc-sheet');
  await expect(sheet).toContainText(fixture.number);
  await expect(sheet).toContainText(fixtures.a.productName);
  await expect(sheet).toContainText(money(40));
  await expect(sheet).toContainText(money(7.2));
  await expect(sheet).toContainText(money(47.2));
  await expect(sheet).not.toContainText(money(35.4));
  const recorded = (await db.query('select * from public.documents where id=$1', [fixture.document])).rows[0];
  expect(recorded.document_number).toBe(fixture.number);
  expect(recorded.storage_path).toBe(fixture.storedPath);
  expect(recorded.checksum).toBe(fixture.checksum);
});
