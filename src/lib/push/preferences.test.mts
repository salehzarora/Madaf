import assert from "node:assert/strict";
import { test, mock, beforeEach } from "node:test";
import { defaultPushPreferences } from "./preferences";
let role = "owner", userId: string | null = "server-user", tenantId: string | null = "server-tenant", failed = false;
const calls: unknown[] = [];
const client = { rpc: (name: string, args: unknown) => {
  calls.push({ name, args });
  const result = { data: defaultPushPreferences, error: failed ? { message: "private details" } : null };
  return { ...result, single: async () => result };
} };
mock.module("@/lib/auth/session", { namedExports: { getSessionContext: async () => ({ client, userId,
  membership: tenantId ? { tenantId, role } : null }) } });
mock.module("@/lib/data/mode", { namedExports: { getDataMode: () => "supabase" } });
const { getPushPreferences, pushPreferenceScope } = await import("@/lib/data/push-preferences");
const { savePushPreferencesAction } = await import("@/lib/actions/push-preferences");
beforeEach(() => { role = "owner"; userId = "server-user"; tenantId = "server-tenant"; failed = false; calls.length = 0; });
test("read and save derive tenant from current server membership, never browser", async () => {
  assert.deepEqual(await getPushPreferences(), defaultPushPreferences);
  assert.deepEqual(await savePushPreferencesAction(defaultPushPreferences, pushPreferenceScope("server-user", "server-tenant")), { ok: true });
  assert.deepEqual(calls, [
    { name: "get_my_push_preferences", args: { p_tenant_id: "server-tenant" } },
    { name: "save_my_push_preferences", args: { p_tenant_id: "server-tenant", p_new_order: true, p_signup_request: true, p_low_stock: true, p_order_status: false } },
  ]);
  tenantId = "other-current-membership";
  await savePushPreferencesAction(defaultPushPreferences, pushPreferenceScope("server-user", tenantId));
  assert.equal((calls.at(-1) as { args: { p_tenant_id: string } }).args.p_tenant_id, tenantId);
});
test("spoofed payload, missing session/membership and sales rep are rejected", async () => {
  for (const value of [{ ...defaultPushPreferences, tenant_id: "spoof" }, { ...defaultPushPreferences, user_id: "spoof" }, {}]) {
    assert.deepEqual(await savePushPreferencesAction(value, pushPreferenceScope("server-user", "server-tenant")), { ok: false });
  }
  role = "sales_rep"; assert.deepEqual(await savePushPreferencesAction(defaultPushPreferences, pushPreferenceScope("server-user", "server-tenant")), { ok: false });
  role = "admin"; userId = null; assert.deepEqual(await savePushPreferencesAction(defaultPushPreferences, pushPreferenceScope("server-user", "server-tenant")), { ok: false });
  userId = "user"; tenantId = null; assert.deepEqual(await savePushPreferencesAction(defaultPushPreferences, pushPreferenceScope("server-user", "server-tenant")), { ok: false });
  assert.equal(calls.length, 0);
});
test("DB failures expose only neutral result and never replace failed reads with defaults", async () => {
  failed = true; assert.deepEqual(await savePushPreferencesAction(defaultPushPreferences, pushPreferenceScope("server-user", "server-tenant")), { ok: false });
  await assert.rejects(getPushPreferences(), /preferences_unavailable/);
});

test("stale tenant/account scope cannot save into newly selected tenant", async () => {
  const oldScope = pushPreferenceScope("server-user", "server-tenant");
  tenantId = "new-tenant";
  assert.deepEqual(await savePushPreferencesAction(defaultPushPreferences, oldScope), { ok: false });
  tenantId = "server-tenant"; userId = "another-user";
  assert.deepEqual(await savePushPreferencesAction(defaultPushPreferences, oldScope), { ok: false });
  assert.equal(calls.length, 0);
});
