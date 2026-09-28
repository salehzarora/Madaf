import assert from "node:assert/strict";
import { test, mock, beforeEach } from "node:test";

const userId = "92000000-0000-4000-8000-000000000001";
const tenantId = "91000000-0000-4000-8000-000000000001";
const installationId = "94000000-0000-4000-8000-000000000001";
const token = "synthetic_private_fcm_token_0001";
let signedIn = true;
let dbError = false;
const calls: { name: string; args: Record<string, unknown> }[] = [];
const cookieJar = new Map<string, string>();
const client = {
  auth: { getClaims: async () => ({ data: { claims: { session_id: "session-one" } } }) },
  rpc: async (name: string, args: Record<string, unknown>) => {
    calls.push({ name, args });
    return { error: dbError ? { message: `do not expose ${token}` } : null };
  },
};
mock.module("@/lib/auth/session", { namedExports: { getSessionContext: async () => ({
  client, userId: signedIn ? userId : null,
  membership: signedIn ? { tenantId, role: "owner" } : null,
}) } });
mock.module("@/lib/data/mode", { namedExports: { getDataMode: () => "supabase" } });
mock.module("next/headers", { namedExports: { cookies: async () => ({
  get: (name: string) => cookieJar.has(name) ? { value: cookieJar.get(name) } : undefined,
  set: (name: string, value: string) => cookieJar.set(name, value), delete: (name: string) => cookieJar.delete(name),
}) } });
const route = await import("@/app/api/mobile/devices/route");
const { disableCurrentPushAssociation } = await import("@/lib/data/push-devices");
beforeEach(() => { signedIn = true; dbError = false; calls.length = 0; cookieJar.clear(); process.env.MADAF_NATIVE_PUSH_ENABLED = "true"; });
const payload = () => ({ installationId, platform: "android", token, locale: "ar", enabled: true });
const request = (body: unknown, method = "POST", origin = "https://madaf.test") => new Request("https://madaf.test/api/mobile/devices", {
  method, headers: { origin, "Content-Type": "application/json" }, body: JSON.stringify(body),
});
test("unauthorized registration rejected without a mutation", async () => {
  signedIn = false; assert.equal((await route.POST(request(payload()))).status, 401); assert.equal(calls.length, 0);
});
test("tenant and user payload spoofing rejected, including unknown fields", async () => {
  for (const key of ["tenant_id", "user_id", "tenantId", "userId", "role"]) {
    assert.equal((await route.POST(request({ ...payload(), [key]: "attacker" }))).status, 400);
  }
  assert.equal(calls.length, 0);
});
test("registration derives verified tenant, returns no token, and sets installation cookie", async () => {
  const response = await route.POST(request(payload()));
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { ok: true });
  assert.equal(calls[0].args.p_tenant_id, tenantId); assert.equal(calls[0].args.p_fcm_token, token);
  assert.equal("p_user_id" in calls[0].args, false); assert.equal(cookieJar.get("madaf_push_installation"), installationId);
  assert.equal((await route.GET()).headers.get("Cache-Control"), "no-store");
});
test("strict malformed/oversized/cross-origin inputs are rejected", async () => {
  for (const value of [{ ...payload(), platform: "ios" }, { ...payload(), token: "x" },
    { ...payload(), enabled: "true" }, { ...payload(), locale: "xx" }, { ...payload(), token: "x".repeat(9000) }, null]) {
    assert.equal((await route.POST(request(value))).status, 400);
  }
  assert.equal((await route.POST(request(payload(), "POST", "https://evil.test"))).status, 400);
  assert.equal(calls.length, 0);
});
test("disable and refresh use same installation; logout cleanup uses httpOnly association", async () => {
  await route.POST(request({ ...payload(), enabled: false }));
  await route.POST(request({ ...payload(), token: `${token}_refreshed` }));
  assert.equal(calls[0].args.p_enabled, false);
  assert.equal(calls[1].args.p_installation_id, installationId);
  await disableCurrentPushAssociation(client as never);
  assert.deepEqual(calls[2], { name: "disable_my_push_device", args: { p_installation_id: installationId } });
  assert.equal((await route.DELETE(request({ installationId }, "DELETE"))).status, 200);
  assert.equal(cookieJar.size, 0);
});
test("database errors cannot leak token internals; feature defaults off", async () => {
  dbError = true; const response = await route.POST(request(payload()));
  assert.equal(response.status, 503); assert.equal((await response.text()).includes(token), false);
  delete process.env.MADAF_NATIVE_PUSH_ENABLED;
  assert.equal((await route.GET()).status, 503);
});
