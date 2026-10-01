import { test, expect, type Page } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { getDictionary } from '../../src/i18n/dictionaries';
import { formatCurrency } from '../../src/lib/format';
import { assertOwnedDestinations, destinations } from './safety.mjs';

const runRoot=process.env.MADAF_E2E_RUN_ROOT!;
const marker=JSON.parse(readFileSync(resolve(runRoot,'ownership.json'),'utf8'));
const backend=JSON.parse(readFileSync(resolve(runRoot,'backend.json'),'utf8'));
assertOwnedDestinations(process.cwd(),runRoot,marker,backend);
const fixture=JSON.parse(readFileSync(resolve(runRoot,'pricing-fixtures.json'),'utf8'));
const db=new pg.Client({connectionString:backend.DB_URL,connectionTimeoutMillis:10000,statement_timeout:10000});
test.beforeAll(async()=>{await db.connect();});test.afterAll(async()=>{await db.end();});
const errors=new WeakMap<Page,string[]>();
test.beforeEach(async({page})=>{
  const issues:string[]=[];errors.set(page,issues);
  page.on('pageerror',()=>issues.push('pageerror'));
  await page.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(!['http:','https:'].includes(url.protocol)||url.origin===destinations.app||url.origin===destinations.api)await route.continue();
    else{issues.push('external request');await route.abort();}
  });
});
test.afterEach(async({page})=>{expect(errors.get(page)).toEqual([]);});
async function login(page:Page){
  await page.goto('/en/login?next=%2Fen%2Fcatalog');
  await page.getByLabel('Email',{exact:true}).fill(fixture.a.email);
  await page.getByLabel('Password',{exact:true}).fill(fixture.a.password);
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(page).toHaveURL(/\/en\/catalog$/);
}
async function capture(page:Page,name:string){
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:resolve(runRoot,`${name}.png`)});
}
for(const locale of ['ar','he','en'] as const)test(`Pricing ${locale}: 205 products, consistent surfaces and responsive agreement panel`,async({page})=>{
  test.setTimeout(100000);await login(page);const dict=getDictionary(locale);
  for(const [width,height] of [[390,844],[768,1024],[1440,900]]){
    await page.setViewportSize({width,height});
    await page.goto(`/${locale}/catalog?customer=${fixture.a.customer}`);
    const card=page.locator('.catalog-product').filter({has:page.getByRole('heading',{name:fixture.a.productName,exact:true})});
    await expect(card.locator('.catalog-package-price')).toHaveText(formatCurrency(7.25,locale));
    await expect(page.locator('.catalog-product')).toHaveCount(205);
    await expect(card.locator('.catalog-product-prices')).toContainText(formatCurrency(7.25/6,locale));
    await page.locator('select').filter({has:page.locator('option[value="priceAsc"]')}).selectOption('priceAsc');
    await expect(page.locator('.catalog-product').nth(1).getByRole('heading')).toHaveText(fixture.a.productName);
    if(width===390)await card.getByRole('button',{name:dict.catalog.addToCart,exact:true}).click();
    await expect(card.getByLabel(dict.catalog.lineTotal,{exact:true})).toHaveText(formatCurrency(7.25,locale));
    await capture(page,`pricing-${locale}-${width}-catalog`);
    await page.goto(`/${locale}/product/${fixture.a.product}`);
    await expect(page.locator('main').getByText(formatCurrency(7.25,locale),{exact:true}).first()).toBeVisible();
    await capture(page,`pricing-${locale}-${width}-detail`);
    await page.goto(`/${locale}/cart`);
    await expect(page.getByText(formatCurrency(7.25,locale),{exact:true}).first()).toBeVisible();
    await capture(page,`pricing-${locale}-${width}-cart`);
    await page.goto(`/${locale}/checkout`);
    await expect(page.getByRole('button',{name:dict.checkout.sendOrder,exact:true})).toBeEnabled();
    await expect(page.getByText(formatCurrency(7.25,locale),{exact:true}).first()).toBeVisible();
    await capture(page,`pricing-${locale}-${width}-checkout`);
    await page.goto(`/${locale}/admin/customers/${fixture.a.customer}`);
    const search=page.getByRole('textbox',{name:dict.pricing.search,exact:true});await search.fill(fixture.a.productName);
    await expect(page.getByRole('textbox',{name:`${dict.pricing.special}: ${fixture.a.productName}`,exact:true})).toHaveValue('7.25');
    await capture(page,`pricing-${locale}-${width}-management`);
  }
});
test('Pricing create, edit and fresh private documents use recorded agreed amounts',async({page})=>{
  await login(page);await page.goto(`/en/catalog?customer=${fixture.a.customer}`);
  const card=page.locator('.catalog-product').filter({has:page.getByRole('heading',{name:fixture.a.productName,exact:true})});
  await expect(card.locator('.catalog-package-price')).toHaveText(formatCurrency(7.25,'en'));
  await card.getByRole('button',{name:'Add',exact:true}).click();
  const increase=card.getByRole('button',{name:`Increase quantity: ${fixture.a.productName}`,exact:true});
  await increase.click();await increase.click();
  await page.goto('/en/checkout');const notes=`Synthetic pricing ${randomUUID()}`;
  await page.getByLabel('Notes',{exact:true}).fill(notes);
  await page.getByRole('button',{name:'Send order request',exact:true}).click();
  await expect(page).toHaveURL(/\/en\/order-success\?/);
  const rows=await db.query('select * from public.orders where tenant_id=$1 and notes=$2',[fixture.a.tenant,notes]);expect(rows.rowCount).toBe(1);
  const order=rows.rows[0];expect(Number(order.subtotal)).toBe(21.75);expect(Number(order.vat_total)).toBe(3.92);
  const item=(await db.query('select * from public.order_items where order_id=$1',[order.id])).rows[0];expect(item.pricing_source_snapshot).toBe('customer_agreement');expect(item.unit_price_snapshot).toBe('7.25');
  await page.goto(`/en/admin/orders/${order.id}`);await page.getByRole('button',{name:'Edit order',exact:true}).click();
  const editLine=page.locator('li').filter({has:page.getByText(fixture.a.productName,{exact:true})}).filter({has:page.getByRole('button',{name:'+',exact:true})});
  await editLine.getByRole('button',{name:'+',exact:true}).click();await page.getByRole('button',{name:'Save changes',exact:true}).click();
  await expect.poll(async()=>Number((await db.query('select subtotal from public.orders where id=$1',[order.id])).rows[0].subtotal)).toBe(29);
  const path=`/en/admin/orders/${order.id}/documents/order`;
  const pdf=await page.request.get(`${path}?mode=download&lang=en`,{maxRedirects:0});expect(pdf.status()).toBe(200);expect(pdf.headers()['cache-control']).toContain('no-store');
  const bytes=await pdf.body();expect(bytes.subarray(0,5).toString()).toBe('%PDF-');writeFileSync(resolve(runRoot,'pricing-recorded-order.pdf'),bytes);
  await page.goto(`${path}/print`);await page.getByRole('button',{name:'English',exact:true}).click();
  const sheet=page.locator('.doc-sheet');await expect(sheet).toContainText(formatCurrency(29,'en'));await expect(sheet).toContainText(formatCurrency(5.22,'en'));await expect(sheet).toContainText(formatCurrency(34.22,'en'));
});
test('Pricing private shop overrides and showcase base remain separate',async({page})=>{
  await page.goto(`/en/shop/${fixture.rawShop}`);
  const shop=page.locator('.private-shop-product-copy').filter({has:page.getByRole('heading',{name:fixture.a.productName,exact:true})});
  await expect(shop.locator('.private-shop-product-price')).toContainText(formatCurrency(7.25,'en'));
  await page.goto(`/en/showcase/${fixture.rawShowcase}`);
  const guest=page.locator('.public-store-product-copy').filter({has:page.getByRole('heading',{name:fixture.a.productName,exact:true})});
  await expect(guest.locator('.public-store-product-price')).toContainText(formatCurrency(10,'en'));
});

test('Pricing owner management saves and removes through the guarded application path',async({page})=>{
  await login(page);
  async function panel(){
    await page.goto(`/en/admin/customers/${fixture.a.customer}`);
    await page.getByRole('textbox',{name:'Search products',exact:true}).fill(fixture.a.productName);
    return page.getByRole('textbox',{name:`Special price: ${fixture.a.productName}`,exact:true});
  }
  const input=await panel();await expect(input).toHaveValue('7.25');await input.fill('8.50');
  await page.getByRole('button',{name:'Save',exact:true}).click();
  await expect.poll(async()=>(await db.query('select package_price from public.customer_product_prices where tenant_id=$1 and customer_id=$2 and product_id=$3',[fixture.a.tenant,fixture.a.customer,fixture.a.product])).rows[0].package_price).toBe('8.50');
  await page.goto(`/en/catalog?customer=${fixture.a.customer}`);
  const price=page.locator('.catalog-product').filter({has:page.getByRole('heading',{name:fixture.a.productName,exact:true})}).locator('.catalog-package-price');
  await expect(price).toHaveText(formatCurrency(8.50,'en'));
  await panel();await page.getByRole('button',{name:'Remove agreement',exact:true}).click();
  await expect(page.getByText('Agreement removed',{exact:true})).toBeVisible();
  await page.goto(`/en/catalog?customer=${fixture.a.customer}`);await expect(price).toHaveText(formatCurrency(10,'en'));
});
