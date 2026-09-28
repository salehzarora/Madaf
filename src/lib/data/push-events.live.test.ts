import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { Client } from "pg";

/** Explicit opt-in, loopback-only disposable DB. Never loads application credentials. */
const url = process.env.MADAF_PUSH_TEST_DATABASE_URL;
test("concurrent low-stock claimers return a committed crossing exactly once", { skip: !url }, async () => {
  const parsed = new URL(url!);
  assert.ok(["localhost", "127.0.0.1"].includes(parsed.hostname), "local test DB required");
  assert.equal(parsed.port, "58622", "dedicated disposable push DB required");
  const setup = new Client({ connectionString: url }), first = new Client({ connectionString: url }), second = new Client({ connectionString: url });
  const tenant = randomUUID(), product = randomUUID();
  await Promise.all([setup.connect(), first.connect(), second.connect()]);
  try {
    await setup.query("insert into public.tenants(id,name_ar,name_he,name_en) values($1,'Synthetic','Synthetic','Synthetic')", [tenant]);
    await setup.query("insert into public.products(id,tenant_id,name_ar,name_he,name_en,wholesale_price) values($1,$2,'Synthetic','Synthetic','Synthetic',1)", [product, tenant]);
    await setup.query("insert into public.inventory_items(tenant_id,product_id,quantity_available,low_stock_threshold) values($1,$2,20,5)", [tenant, product]);
    await setup.query("update public.inventory_items set quantity_available=4 where product_id=$1", [product]);
    for (const client of [first, second]) await client.query("set request.jwt.claims='{" + '"role":"service_role"' + "}'");
    await first.query("begin");
    const claimed = await first.query("select * from public.claim_low_stock_push($1,$2)", [tenant, product]);
    const waiting = second.query("select * from public.claim_low_stock_push($1,$2)", [tenant, product]);
    await first.query("commit");
    const replay = await waiting;
    assert.equal(claimed.rowCount, 1); assert.equal(replay.rowCount, 0);
    assert.equal(claimed.rows[0].quantity, 4);
  } finally {
    await first.query("rollback");
    await setup.query("delete from public.tenants where id=$1", [tenant]);
    await Promise.all([setup.end(), first.end(), second.end()]);
  }
});
