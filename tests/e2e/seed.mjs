import { randomUUID, randomBytes, createHash } from 'node:crypto';
import PDFDocument from 'pdfkit';
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';
import { assertOwnedDestinations } from './safety.mjs';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Privileged prerequisite setup only. User actions use the real UI and session.
export async function seedFixtures(root, runRoot, marker, status) {
  assertOwnedDestinations(root, runRoot, marker, status);
  const auth = createClient(status.API_URL, status.SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const db = new pg.Client({ connectionString: status.DB_URL, connectionTimeoutMillis: 10_000, statement_timeout: 10_000 });
  await db.connect();
  try {
    const fixtures = {};
    for (const key of ['a', 'b']) {
      const tenant = randomUUID(), product = randomUUID(), customer = randomUUID();
      const email = `owner-${key}-${marker.projectId}@example.invalid`;
      const password = `E2e!${randomBytes(18).toString('hex')}`;
      const created = await auth.auth.admin.createUser({ email, password, email_confirm: true });
      if (created.error || !created.data.user) throw new Error('Local synthetic Auth prerequisite creation failed');
      // Validate the fixture provider/config before running UI acceptance.
      // This temporary public-key session is never handed to the browser.
      const probe = createClient(status.API_URL, status.ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
      const signedIn = await probe.auth.signInWithPassword({ email, password });
      if (signedIn.error) throw new Error(`Local fixture email provider failed: ${signedIn.error.code ?? 'unknown'}`);
      const signedOut = await probe.auth.signOut({ scope: 'local' });
      if (signedOut.error) throw new Error('Local fixture probe session cleanup failed');
      const tenantName = `E2E tenant ${key.toUpperCase()}`;
      const productName = `E2E carton ${key.toUpperCase()}`;
      const customerName = `E2E shop ${key.toUpperCase()}`;
      await db.query('insert into public.tenants (id,name_ar,name_he,name_en) values ($1,$2,$2,$2)', [tenant, tenantName]);
      await db.query("insert into public.tenant_users (tenant_id,user_id,role) values ($1,$2,'owner')", [tenant, created.data.user.id]);
      // Several shops make the mobile search/scroll assertions meaningful.
      const shops = [];
      for (let index = 0; index < 12; index++) {
        const id = index === 0 ? customer : randomUUID();
        const name = index === 0 ? customerName : `${customerName} ${index}`;
        await db.query("insert into public.customers (id,tenant_id,name,customer_type,phone,contact_name,city_ar,city_he,city_en,origin,is_active) values ($1,$2,$3,'grocery','0500000001','Synthetic contact','Test city','Test city','Test city','manual',true)", [id, tenant, name]);
        shops.push({ id, name });
      }
      const category = randomUUID();
      await db.query("insert into public.categories(id,tenant_id,name_ar,name_he,name_en) values ($1,$2,'Synthetic category','Synthetic category','Synthetic category')", [category, tenant]);
      await db.query("insert into public.products (id,tenant_id,name_ar,name_he,name_en,sku,package_unit,package_quantity,base_unit,wholesale_price,vat_rate,is_active,category_id) values ($1,$2,$3,$3,$3,$4,'carton',6,'bottles',10,0.18,true,$5)", [product, tenant, productName, `E2E-${key.toUpperCase()}`, category]);
      await db.query('insert into public.inventory_items (tenant_id,product_id,quantity_available,low_stock_threshold) values ($1,$2,10,1)', [tenant, product]);
      fixtures[key] = { tenant, tenantName, user: created.data.user.id, email, password, customer, customerName, product, productName, shops };
      if (key === 'a') {
        // Previous stored PDF prerequisite, only in this owned disposable stack.
        // The journey performs catalog/order edits through authenticated UI.
        await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: created.data.user.id, role: 'authenticated' })]);
        const order = (await db.query("select order_id from public.create_order_request($1,$2::jsonb,$3,p_submission_key=>$4)",
          [tenant, JSON.stringify([{ product_id: product, quantity: 3 }]), customer, randomUUID()])).rows[0].order_id;
        const document = (await db.query("select * from public.create_order_document($1,$2,'order_request','en')", [tenant, order])).rows[0];
        const storedPath = `${tenant}/documents/${order}/order_request/${document.id}_en.pdf`;
        const pdf = new PDFDocument();
        const chunks = [];
        const bytes = new Promise((done, fail) => {
          pdf.on('data', chunk => chunks.push(chunk));
          pdf.on('end', () => done(Buffer.concat(chunks)));
          pdf.on('error', fail);
        });
        pdf.text('Synthetic previous order: quantity 3, subtotal 30, VAT 5.40, total 35.40');
        pdf.end();
        const oldBytes = await bytes;
        const uploaded = await auth.storage.from('documents').upload(storedPath, oldBytes, { contentType: 'application/pdf' });
        if (uploaded.error) throw new Error('Owned synthetic previous PDF prerequisite failed');
        const checksum = createHash('sha256').update(oldBytes).digest('hex');
        await db.query('select public.set_document_storage($1,$2,$3,$4,$5)', [tenant, document.id, storedPath, oldBytes.length, checksum]);
        fixtures[key].financial = { order, document: document.id, number: document.document_number, storedPath, checksum };
        await db.query("select set_config('request.jwt.claims','{}',false)");
      }
    }
    return fixtures;
  } finally {
    await db.end();
  }
}

// Run unchanged prerequisites in the runner's bounded, cancellable owned child.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const runRoot = resolve(process.argv[2]);
  const marker = JSON.parse(await readFile(resolve(runRoot, 'ownership.json'), 'utf8'));
  const status = JSON.parse(await readFile(resolve(runRoot, 'backend.json'), 'utf8'));
  const fixtures = await seedFixtures(process.cwd(), runRoot, marker, status);
  await writeFile(resolve(runRoot, 'fixtures.json'), JSON.stringify(fixtures), { mode: 0o600 });
}
