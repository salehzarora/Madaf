/**
 * PILOT-OPS-AUDIT-008-FIX2 — persistent token-order submission-key helper.
 *
 * Proves the sessionStorage-backed key: stable per (channel, token) across calls
 * and "module recreation" (a fresh read), distinct per token and per channel,
 * token-safe (the raw token never appears in the storage key or value), value is
 * ONLY {version, uuid}, and FAILS CLOSED (no key) when storage is missing or its
 * read/write/verify throws — so the caller can refuse to submit.
 *
 * Runner: `npm run test:order-submission-key`.
 */
// FIRST: DOM globals (window.sessionStorage) must exist before the helper loads.
import { dom } from "@/test-support/jsdom-env";

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  clearTokenSubmissionKey,
  getOrCreateTokenSubmissionKey,
  retainTokenSubmissionKey,
  rotateTokenSubmissionKey,
} from "@/lib/client/order-submission-key";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN_A = "shoptoken-fixture-aaaaaaaaaaaaaaaa";
const TOKEN_B = "shoptoken-fixture-bbbbbbbbbbbbbbbb";

const ss = () => dom.window.sessionStorage;
const realDescriptor = Object.getOwnPropertyDescriptor(dom.window, "sessionStorage");
function restoreSession() {
  if (realDescriptor) Object.defineProperty(dom.window, "sessionStorage", realDescriptor);
}
function stubSession(value: unknown) {
  Object.defineProperty(dom.window, "sessionStorage", { value, configurable: true });
}

afterEach(() => {
  restoreSession();
  ss().clear();
});

async function key(channel: "shop_token" | "showcase", token: string): Promise<string> {
  const r = await getOrCreateTokenSubmissionKey(channel, token);
  assert.ok(r.ok, "expected a key");
  return r.key;
}

test("same channel + same token returns the SAME UUID across calls (and a fresh read)", async () => {
  const k1 = await key("shop_token", TOKEN_A);
  assert.match(k1, UUID);
  const k2 = await key("shop_token", TOKEN_A);
  assert.equal(k2, k1, "a second call reuses the persisted key");
  // "Module recreation" = a brand-new getOrCreate with no in-memory state; the
  // key lives in sessionStorage, so it is still the same.
  const k3 = await key("shop_token", TOKEN_A);
  assert.equal(k3, k1);
});

test("a different token, and a different channel, get DIFFERENT keys", async () => {
  const a = await key("shop_token", TOKEN_A);
  const b = await key("shop_token", TOKEN_B);
  assert.notEqual(a, b, "different token → different key");
  const showcaseA = await key("showcase", TOKEN_A);
  assert.notEqual(showcaseA, a, "shop_token and showcase are separate namespaces");
});

test("a malformed stored value is replaced by a fresh valid key", async () => {
  const good = await key("shop_token", TOKEN_A);
  // Corrupt the stored record directly.
  const storageKey = ss().key(0)!;
  ss().setItem(storageKey, "not-json");
  const replaced = await key("shop_token", TOKEN_A);
  assert.match(replaced, UUID);
  assert.notEqual(replaced, good, "the malformed record was replaced");
});

test("clear removes the key; rotate produces a different key", async () => {
  const k1 = await key("shop_token", TOKEN_A);
  await clearTokenSubmissionKey("shop_token", TOKEN_A);
  assert.equal(await retainTokenSubmissionKey("shop_token", TOKEN_A), null, "cleared");
  const k2 = await key("shop_token", TOKEN_A);
  assert.notEqual(k2, k1, "after clear a fresh key is generated");
  const rotated = await rotateTokenSubmissionKey("shop_token", TOKEN_A);
  assert.ok(rotated.ok && rotated.key !== k2, "rotate yields a new key");
});

test("the raw token never appears in the storage KEY or VALUE; value is only {v,k}", async () => {
  await key("shop_token", TOKEN_A);
  const storageKey = ss().key(0)!;
  const value = ss().getItem(storageKey)!;
  assert.ok(!storageKey.includes(TOKEN_A), "raw token absent from the storage key");
  assert.ok(!value.includes(TOKEN_A), "raw token absent from the stored value");
  assert.deepEqual(
    Object.keys(JSON.parse(value)).sort(),
    ["k", "v"],
    "value holds only a version marker + the submission uuid (no cart/PII/payload)",
  );
});

test("an unknown channel fails closed (never a volatile key)", async () => {
  // @ts-expect-error — exercising the runtime channel guard
  const r = await getOrCreateTokenSubmissionKey("email", TOKEN_A);
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.reason, "channel");
});

test("missing sessionStorage fails closed (no key)", async () => {
  stubSession(undefined);
  const r = await getOrCreateTokenSubmissionKey("shop_token", TOKEN_A);
  assert.equal(r.ok, false, "no key when storage is absent");
  assert.equal(r.ok === false && r.reason, "storage");
});

test("a sessionStorage read exception fails closed", async () => {
  stubSession({
    setItem() {},
    getItem() {
      throw new Error("read blocked");
    },
    removeItem() {},
  });
  const r = await getOrCreateTokenSubmissionKey("shop_token", TOKEN_A);
  assert.equal(r.ok, false);
});

test("a sessionStorage write exception fails closed", async () => {
  stubSession({
    setItem() {
      throw new Error("QuotaExceededError");
    },
    getItem() {
      return null;
    },
    removeItem() {},
  });
  const r = await getOrCreateTokenSubmissionKey("shop_token", TOKEN_A);
  assert.equal(r.ok, false);
});

test("a write that does not persist (read-back fails) fails closed — no unverified key", async () => {
  // Probe passes, but the real key write is not readable back → must not return ok.
  let probeVal: string | null = null;
  stubSession({
    setItem(k: string, v: string) {
      if (k.endsWith("__probe__")) probeVal = v;
      // silently drop non-probe writes (simulates a write that does not persist)
    },
    getItem(k: string) {
      return k.endsWith("__probe__") ? probeVal : null;
    },
    removeItem() {
      probeVal = null;
    },
  });
  const r = await getOrCreateTokenSubmissionKey("shop_token", TOKEN_A);
  assert.equal(r.ok, false, "an unverifiable write yields no key (caller must not submit)");
});
