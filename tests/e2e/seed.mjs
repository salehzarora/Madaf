import { randomUUID, randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';
import { assertOwnedDestinations } from './safety.mjs';

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
      await db.query("insert into public.products (id,tenant_id,name_ar,name_he,name_en,sku,package_unit,package_quantity,base_unit,wholesale_price,vat_rate,is_active) values ($1,$2,$3,$3,$3,$4,'carton',6,'bottles',10,0.18,true)", [product, tenant, productName, `E2E-${key.toUpperCase()}`]);
      await db.query('insert into public.inventory_items (tenant_id,product_id,quantity_available,low_stock_threshold) values ($1,$2,10,1)', [tenant, product]);
      fixtures[key] = { tenant, tenantName, user: created.data.user.id, email, password, customer, customerName, product, productName, shops };
    }
    return fixtures;
  } finally {
    await db.end();
  }
}
