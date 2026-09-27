import assert from "node:assert/strict";
import { mock, test } from "node:test";
mock.module("server-only", { namedExports: {} });
const tenant = "33333333-3333-4333-8333-333333333333";
const id = "cbc00000-0000-4000-8000-000000000001";
let activeTenant = tenant;
let rows: { id: string; image_url: string | null }[] = [];
const calls: unknown[][] = [];
const query = {
  select: (...args: unknown[]) => { calls.push(["select", ...args]); return query; },
  eq: (...args: unknown[]) => { calls.push(["eq", ...args]); return query; },
  in: (...args: unknown[]) => { calls.push(["in", ...args]); return query; },
  limit: async (...args: unknown[]) => { calls.push(["limit", ...args]); return { data: rows, error: null }; },
};
const client = { from: (...args: unknown[]) => { calls.push(["from", ...args]); return query; }, storage: { from: () => ({ createSignedUrls: async (paths: string[]) => { calls.push(["sign", paths]); return { data: paths.map((_, i) => ({ signedUrl: i ? undefined : "https://example.invalid/signed-image" })) }; } }) } };
mock.module("@/lib/auth/session", { namedExports: { NO_TENANT: "none", getDataContext: async () => ({ client, tenantId: activeTenant }), getSessionContext: async () => ({}), getTenantTimeZone: async () => "UTC" } });
const { sbGetDashboardThumbnails } = await import("./supabase-reads");
test("signed image enrichment uses one bounded tenant query and no raw path DTO", async () => {
  calls.length = 0; rows = [{ id, image_url: `${tenant}/products/photo.png` }];
  const result = await sbGetDashboardThumbnails([id, id, "invalid"]);
  assert.deepEqual(result, { [id]: { imageUrl: "https://example.invalid/signed-image" } });
  assert.ok(calls.some(c => c[0] === "eq" && c[1] === "tenant_id" && c[2] === tenant));
  assert.deepEqual(calls.find(c => c[0] === "in"), ["in", "id", [id]]);
  assert.deepEqual(calls.find(c => c[0] === "select"), ["select", "id,image_url"]);
  assert.equal(calls.filter(c => c[0] === "sign").length, 1);
});
test("external URL passes through; cross-tenant and missing paths fall back", async () => {
  calls.length = 0; rows = [{ id, image_url: "another-tenant/products/private.png" }];
  assert.deepEqual(await sbGetDashboardThumbnails([id]), { [id]: { imageUrl: undefined } });
  assert.equal(calls.filter(c => c[0] === "sign").length, 0);
  rows = [{ id, image_url: "https://example.invalid/product.png" }];
  assert.equal((await sbGetDashboardThumbnails([id]))[id].imageUrl, rows[0].image_url);
});
test("a missing signed URL falls back without returning its raw storage path", async () => {
  const second = 'cbc00000-0000-4000-8000-000000000002';
  calls.length = 0;
  rows = [{ id, image_url: `${tenant}/products/valid.png` }, { id: second, image_url: `${tenant}/products/unavailable.png` }];
  const result = await sbGetDashboardThumbnails([id, second]);
  assert.deepEqual(result[second], { imageUrl: undefined });
  assert.equal(calls.filter(c => c[0] === 'sign').length, 1);
  assert.equal(JSON.stringify(result).includes('/products/'), false);
});
test("tenantless and empty inputs never query or sign", async () => {
  calls.length = 0; activeTenant = "none";
  assert.deepEqual(await sbGetDashboardThumbnails([id]), {}); assert.deepEqual(await sbGetDashboardThumbnails([]), {});
  assert.equal(calls.length, 0); activeTenant = tenant;
});
