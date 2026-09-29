import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { defaultPushPreferences } from "./preferences";
let mode = "supabase", userId: string | null = "user", membership: { role: string } | null = { role: "owner" };
mock.module("next/navigation", { namedExports: { notFound: () => { throw new Error("404"); }, redirect: (url: string) => { throw new Error(url); } } });
mock.module("@/lib/auth/session", { namedExports: { getSessionContext: async () => ({ userId, membership }) } });
mock.module("@/lib/data/mode", { namedExports: { getDataMode: () => mode } });
mock.module("@/lib/data/push-preferences", { namedExports: { getPushPreferences: async () => defaultPushPreferences, pushPreferenceScope: () => "scope" } });
mock.module("@/components/admin/notification-settings", { namedExports: { NotificationSettings: () => null } });
const { default: page } = await import("@/app/[locale]/admin/settings/notifications/page");
test("settings page requires user + current owner/admin membership in live mode", async () => {
  for (const role of ["owner", "admin"]) { membership = { role }; await assert.doesNotReject(page({ params: Promise.resolve({ locale: "he" }) })); }
  membership = { role: "sales_rep" }; await assert.rejects(page({ params: Promise.resolve({ locale: "he" }) }), /404/);
  membership = null; await assert.rejects(page({ params: Promise.resolve({ locale: "ar" }) }), /\/ar\/onboarding/);
  userId = null; await assert.rejects(page({ params: Promise.resolve({ locale: "en" }) }), /\/en\/login/);
  await assert.rejects(page({ params: Promise.resolve({ locale: "invalid" }) }), /404/);
});
test("mock settings preview remains available without a live user", async () => {
  mode = "mock"; userId = null; membership = null;
  await assert.doesNotReject(page({ params: Promise.resolve({ locale: "ar" }) }));
});

test("page keys client form by verified account/supplier scope", async () => {
  mode = "supabase"; userId = "user"; membership = { role: "owner" };
  const result = await page({ params: Promise.resolve({ locale: "en" }) });
  assert.equal(result.props.children[1].key, "scope");
  assert.equal(result.props.children[1].props.scope, "scope");
});
