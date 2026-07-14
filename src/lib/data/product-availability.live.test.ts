/**
 * REAL local-Supabase product-availability integration test
 * (PILOT-READINESS-BATCH-B · B2, P2 correction — Shop/orderability outcome).
 *
 * This proves the FULL chain the P2 cares about, over live PostgREST:
 *   1. an inventory-less product reads as availability "inStock" (orderable);
 *   2. a metadata-only edit with p_inventory NULL (tracking OFF) creates NO row
 *      (asserted directly) and it STAYS "inStock" (orderable) — the core B2 fix;
 *   3. an explicit tracking edit with p_inventory {quantity 0} creates a row and
 *      it becomes "outOfStock" (ordering disabled);
 *   4. a threshold-only tracking edit persists the threshold at quantity 0
 *      (→ "outOfStock");
 *   5. the PUBLIC SHOP path end-to-end: the same states seen through the REAL
 *      `get_token_catalog` RPC + the REAL public-shop `deriveAvailability`
 *      (token.ts) that `shop-view.tsx` reads.
 *
 * It drives the REAL production derivations — `supabase-reads.deriveAvailability`
 * (admin / `/product/[id]`) over the REAL `inventory_items` embed, and
 * `token.deriveAvailability` over the REAL `get_token_catalog` output for the
 * anon shop — with no fake reimplementation. The write path is the REAL
 * `update_product` RPC; the shop link is minted with the REAL `create_customer`
 * + `insert_customer_access_link` RPCs and the REAL `hashToken`.
 *
 * It requires the local Supabase stack and reads its URL/keys from
 * `supabase status -o json` at runtime — NEVER hardcoded, never committed. If
 * the stack is unreachable it SKIPS (so mock-mode `npm test` is unaffected). It
 * NEVER contacts hosted Supabase.
 *
 * Runner: `npm run test:product-availability-live` (needs the local stack up).
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";
import { deriveAvailability } from "@/lib/data/supabase-reads";
import {
  deriveAvailability as deriveShopAvailability,
  hashToken,
} from "@/lib/data/token";

type Client = SupabaseClient<Database>;
type LocalConfig = { url: string; anon: string; service: string } | null;

/** Read the LOCAL stack's URL + keys from the CLI (never hardcoded). */
function localConfig(): LocalConfig {
  try {
    const raw = execFileSync("supabase", ["status", "-o", "json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const j = JSON.parse(raw) as Record<string, string>;
    const url = j.API_URL;
    const anon = j.ANON_KEY;
    const service = j.SERVICE_ROLE_KEY;
    if (!url || !anon || !service) return null;
    return { url, anon, service };
  } catch {
    return null;
  }
}

async function reachable(url: string): Promise<boolean> {
  try {
    await fetch(`${url}/rest/v1/`, { method: "HEAD" });
    return true;
  } catch {
    return false;
  }
}

type Cfg = NonNullable<LocalConfig>;

/** Provision a disposable owner + tenant + one category and return an
 * RLS-scoped AUTHENTICATED owner client plus a cleanup. */
async function provision(service: Client, cfg: Cfg) {
  const tenantId = randomUUID();
  const categoryId = randomUUID();
  const email = `avail-live-${randomUUID()}@madaf.test`;
  const password = `Pw-${randomUUID()}`;
  const created = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  assert.ok(!created.error, `createUser: ${created.error?.message ?? ""}`);
  const userId = created.data.user!.id;
  const tIns = await service.from("tenants").insert({
    id: tenantId,
    name_ar: "مخزون",
    name_he: "מלאי",
    name_en: "Avail Live",
  });
  assert.ok(!tIns.error, `tenant insert: ${tIns.error?.message ?? ""}`);
  const mIns = await service
    .from("tenant_users")
    .insert({ tenant_id: tenantId, user_id: userId, role: "owner" });
  assert.ok(!mIns.error, `membership insert: ${mIns.error?.message ?? ""}`);
  const cIns = await service.from("categories").insert({
    id: categoryId,
    tenant_id: tenantId,
    name_ar: "ف",
    name_he: "ק",
    name_en: "Cat",
  });
  assert.ok(!cIns.error, `category insert: ${cIns.error?.message ?? ""}`);
  const owner: Client = createClient<Database>(cfg.url, cfg.anon, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const signIn = await owner.auth.signInWithPassword({ email, password });
  assert.ok(!signIn.error, `signIn: ${signIn.error?.message ?? ""}`);
  const cleanup = async () => {
    await service.from("tenants").delete().eq("id", tenantId);
    try {
      await service.auth.admin.deleteUser(userId);
    } catch {
      /* best-effort */
    }
  };
  return { tenantId, categoryId, owner, cleanup };
}

/** Insert an inventory-LESS product via the service client; return its id. */
async function seedProduct(
  service: Client,
  tenantId: string,
  categoryId: string,
  nameEn: string,
): Promise<string> {
  const id = randomUUID();
  const ins = await service.from("products").insert({
    id,
    tenant_id: tenantId,
    category_id: categoryId,
    name_ar: nameEn,
    name_he: nameEn,
    name_en: nameEn,
    wholesale_price: 5,
  });
  assert.ok(!ins.error, `product insert: ${ins.error?.message ?? ""}`);
  return id;
}

/** Read the product's availability via the REAL production derivation over the
 * REAL inventory_items embed (the same shape mapProduct consumes). */
async function readAvailability(
  owner: Client,
  tenantId: string,
  productId: string,
): Promise<string> {
  const { data, error } = await owner
    .from("products")
    .select("id, inventory_items (quantity_available, low_stock_threshold)")
    .eq("tenant_id", tenantId)
    .eq("id", productId)
    .maybeSingle();
  assert.ok(!error, `read product: ${error?.message ?? ""}`);
  assert.ok(data, "product row present");
  const inv = (data as { inventory_items: unknown }).inventory_items as
    | { quantity_available: number; low_stock_threshold: number }
    | null;
  return deriveAvailability(inv);
}

function productPayload(categoryId: string, nameEn: string) {
  return {
    name_ar: nameEn,
    name_he: nameEn,
    name_en: nameEn,
    category_id: categoryId,
    wholesale_price: 6,
  };
}

test("REAL Supabase: tracking OFF keeps an inventory-less product orderable; tracking ON zero → out-of-stock", async (t) => {
  const cfg = localConfig();
  if (!cfg || !(await reachable(cfg.url))) {
    t.skip("local Supabase stack not reachable — run `supabase start`");
    return;
  }
  const service: Client = createClient<Database>(cfg.url, cfg.service, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { tenantId, categoryId, owner, cleanup } = await provision(service, cfg);

  try {
    const p = await seedProduct(service, tenantId, categoryId, "NoInv");

    // 1. Inventory-less → In-stock (orderable).
    assert.equal(
      await readAvailability(owner, tenantId, p),
      "inStock",
      "an inventory-less product is In-stock (orderable)",
    );

    // 2. Metadata-only edit, tracking OFF (p_inventory omitted → null): the RPC
    //    updates the name but creates NO inventory row → STILL In-stock.
    const edit1 = await owner.rpc("update_product", {
      p_tenant_id: tenantId,
      p_product_id: p,
      p_product: productPayload(categoryId, "NoInvRenamed"),
    });
    assert.ok(!edit1.error, `metadata edit: ${edit1.error?.message ?? ""}`);
    // Assert row-ABSENCE directly (not just the derived state): the metadata
    // edit must have created NO inventory row.
    const rows1 = await owner
      .from("inventory_items")
      .select("id", { count: "exact", head: true })
      .eq("product_id", p);
    assert.ok(!rows1.error, `row count 1: ${rows1.error?.message ?? ""}`);
    assert.equal(rows1.count, 0, "metadata-only edit creates NO inventory row");
    assert.equal(
      await readAvailability(owner, tenantId, p),
      "inStock",
      "a metadata-only edit (tracking OFF) preserves the no-row In-stock state",
    );
    const nameCheck = await owner
      .from("products")
      .select("name_en")
      .eq("id", p)
      .single();
    assert.equal(
      (nameCheck.data as { name_en: string }).name_en,
      "NoInvRenamed",
      "the metadata edit itself DID persist",
    );

    // 3. Explicit tracking ON with quantity 0 → creates a row → Out-of-stock.
    const edit2 = await owner.rpc("update_product", {
      p_tenant_id: tenantId,
      p_product_id: p,
      p_product: productPayload(categoryId, "NoInvRenamed"),
      p_inventory: { quantity_available: 0, low_stock_threshold: 10 },
    });
    assert.ok(!edit2.error, `tracking-on edit: ${edit2.error?.message ?? ""}`);
    const rows2 = await owner
      .from("inventory_items")
      .select("id", { count: "exact", head: true })
      .eq("product_id", p);
    assert.ok(!rows2.error, `row count 2: ${rows2.error?.message ?? ""}`);
    assert.equal(rows2.count, 1, "tracking ON creates exactly one inventory row");
    assert.equal(
      await readAvailability(owner, tenantId, p),
      "outOfStock",
      "tracking ON with quantity 0 makes it Out-of-stock (ordering disabled)",
    );
  } finally {
    await cleanup();
  }
});

test("REAL Supabase: threshold-only tracking persists the threshold at quantity 0; an existing zero is out-of-stock", async (t) => {
  const cfg = localConfig();
  if (!cfg || !(await reachable(cfg.url))) {
    t.skip("local Supabase stack not reachable — run `supabase start`");
    return;
  }
  const service: Client = createClient<Database>(cfg.url, cfg.service, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { tenantId, categoryId, owner, cleanup } = await provision(service, cfg);

  try {
    // Threshold-only intent: quantity 0 + a chosen threshold.
    const p = await seedProduct(service, tenantId, categoryId, "Thresh");
    const edit = await owner.rpc("update_product", {
      p_tenant_id: tenantId,
      p_product_id: p,
      p_product: productPayload(categoryId, "Thresh"),
      p_inventory: { quantity_available: 0, low_stock_threshold: 7 },
    });
    assert.ok(!edit.error, `threshold-only edit: ${edit.error?.message ?? ""}`);
    assert.equal(
      await readAvailability(owner, tenantId, p),
      "outOfStock",
      "threshold-only tracking at quantity 0 is Out-of-stock",
    );
    const row = await owner
      .from("inventory_items")
      .select("quantity_available, low_stock_threshold")
      .eq("product_id", p)
      .single();
    assert.ok(!row.error, `inventory read: ${row.error?.message ?? ""}`);
    assert.equal(
      (row.data as { low_stock_threshold: number }).low_stock_threshold,
      7,
      "the chosen threshold is persisted",
    );
    assert.equal(
      (row.data as { quantity_available: number }).quantity_available,
      0,
      "quantity stays 0",
    );
  } finally {
    await cleanup();
  }
});

test("REAL Supabase PUBLIC SHOP path: an inventory-less product is orderable via get_token_catalog; tracking-on-zero → out-of-stock", async (t) => {
  const cfg = localConfig();
  if (!cfg || !(await reachable(cfg.url))) {
    t.skip("local Supabase stack not reachable — run `supabase start`");
    return;
  }
  const service: Client = createClient<Database>(cfg.url, cfg.service, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { tenantId, categoryId, owner, cleanup } = await provision(service, cfg);

  try {
    const p = await seedProduct(service, tenantId, categoryId, "ShopNoInv");

    // Mint a REAL customer + shop access link (owner RPCs), so get_token_catalog
    // resolves the token exactly as the anon storefront does.
    const cust = await owner.rpc("create_customer", {
      p_tenant_id: tenantId,
      p_name: "Shop Cust",
    });
    assert.ok(!cust.error, `create_customer: ${cust.error?.message ?? ""}`);
    const customerId = cust.data as string;
    // A raw token in the app's shape; the DB stores only its sha256 hash. The
    // app-facing RPC (owner/admin) mints the link exactly as production does.
    const rawToken = `${randomUUID()}${randomUUID()}`.replace(/-/g, "");
    const link = await owner.rpc("replace_customer_access_link", {
      p_tenant_id: tenantId,
      p_customer_id: customerId,
      p_token_hash: hashToken(rawToken),
      p_token_preview: rawToken.slice(0, 6),
    });
    assert.ok(!link.error, `mint link: ${link.error?.message ?? ""}`);

    // The ANON storefront reads the catalog through the REAL get_token_catalog
    // RPC, and availability is the REAL public-shop derivation (token.ts) that
    // shop-view.tsx reads.
    const anon: Client = createClient<Database>(cfg.url, cfg.anon, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const shopAvailability = async (): Promise<string> => {
      const res = await anon.rpc("get_token_catalog", { p_token: rawToken });
      assert.ok(!res.error, `get_token_catalog: ${res.error?.message ?? ""}`);
      const blob = res.data as {
        products: Array<{
          id: string;
          quantity_available: number | null;
          low_stock_threshold: number | null;
        }>;
      } | null;
      assert.ok(blob, "token catalog resolved (link valid)");
      const prod = blob.products.find((x) => x.id === p);
      assert.ok(prod, "the seeded product is present in the shop catalog");
      return deriveShopAvailability(
        prod.quantity_available,
        prod.low_stock_threshold,
      );
    };

    // 1. Inventory-less → the SHOP shows In-stock (orderable).
    assert.equal(
      await shopAvailability(),
      "inStock",
      "shop: an inventory-less product is orderable (In-stock)",
    );

    // 2. Explicit tracking ON with quantity 0 → the SHOP shows Out-of-stock.
    const edit = await owner.rpc("update_product", {
      p_tenant_id: tenantId,
      p_product_id: p,
      p_product: productPayload(categoryId, "ShopNoInv"),
      p_inventory: { quantity_available: 0, low_stock_threshold: 10 },
    });
    assert.ok(!edit.error, `tracking-on edit: ${edit.error?.message ?? ""}`);
    assert.equal(
      await shopAvailability(),
      "outOfStock",
      "shop: tracking-on-zero disables ordering (Out-of-stock)",
    );
  } finally {
    await cleanup();
  }
});
