import assert from "node:assert/strict";
import { test, mock } from "node:test";
let cleanupFails = false;
let logoutFails = false;
const calls: string[] = [];
mock.module("next/cache", { namedExports: { revalidatePath: () => calls.push("revalidate") } });
mock.module("@/lib/data", { namedExports: { getDataMode: () => "supabase" } });
mock.module("@/lib/data/push-devices", { namedExports: { disableCurrentPushAssociation: async () => {
  calls.push("disable"); if (cleanupFails) throw new Error("private database details");
} } });
mock.module("@/lib/supabase/server-auth", { namedExports: { createServerAuthClient: async () => ({ auth: {
  signOut: async () => { calls.push("signout"); return { error: logoutFails ? { message: "private auth details" } : null }; },
} }) } });
const warnings: unknown[][] = [];
mock.method(console, "warn", (...args: unknown[]) => warnings.push(args));
const { signOutAction } = await import("@/lib/actions/auth");
test("logout disables current device before session revocation", async () => {
  calls.length = 0; assert.deepEqual(await signOutAction("he"), { ok: true });
  assert.deepEqual(calls, ["disable", "signout", "revalidate"]);
});
test("cleanup failure cannot prevent logout or expose database internals", async () => {
  calls.length = 0; cleanupFails = true;
  assert.deepEqual(await signOutAction("ar"), { ok: true });
  assert.deepEqual(calls, ["disable", "signout", "revalidate"]);
  assert.equal(JSON.stringify(warnings).includes("private database details"), false); cleanupFails = false;
});
test("failed Supabase signOut is not reported as successful logout", async () => {
  calls.length = 0; logoutFails = true;
  assert.deepEqual(await signOutAction("en"), { ok: false });
  assert.deepEqual(calls, ["disable", "signout"]); logoutFails = false;
});
