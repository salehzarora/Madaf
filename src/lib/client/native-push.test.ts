import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import { startNativePushSync, PUSH_LOGOUT_EVENT, PUSH_RESUME_EVENT } from "./native-push";

const settle = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
function fixture() {
  const dom = new JSDOM("<body></body>", { url: "https://madaf.test/ar", pretendToBeVisual: true });
  const win = dom.window as unknown as Parameters<typeof startNativePushSync>[0];
  const state = { token: "synthetic_private_native_token_0001", scope: "session-one", authenticated: true,
    fail: false, hold: false, requests: [] as RequestInit[], nativeCalls: [] as string[], signals: [] as AbortSignal[] };
  let interval: (() => void) | undefined;
  win.setInterval = ((fn: () => void) => { interval = fn; return 1; }) as typeof win.setInterval;
  win.clearInterval = () => { interval = undefined; };
  win.fetch = async (_input, init) => {
    state.requests.push(init!);
    if (state.hold) return new Promise((_resolve, reject) => {
      const signal = init!.signal!; state.signals.push(signal);
      signal.addEventListener("abort", () => reject(new Error("aborted")));
    });
    if (state.fail) return Response.json({}, { status: 503 });
    if (!state.authenticated) return Response.json({}, { status: 401 });
    return Response.json(init?.method === "POST" ? { ok: true } : { scope: state.scope });
  };
  win.MadafNative = { postMessage(raw) {
    const { id, type } = JSON.parse(raw); state.nativeCalls.push(type);
    const result = type === "getCapabilities" ? { platform: "android", push: { configured: true } }
      : { status: "registered", token: state.token };
    win.MadafNative!.onmessage?.({ data: JSON.stringify({ id, type, result }) });
  } };
  return { dom, win, state, poll: async () => { interval?.(); await settle(); }, posts: () => state.requests.filter(r => r.method === "POST") };
}
test("ordinary browser does no network, bridge, timers or persistence", async () => {
  const f = fixture(); delete f.win.MadafNative;
  const stop = startNativePushSync(f.win, "ar"); await settle(); await f.poll();
  assert.equal(f.state.requests.length, 0); assert.equal(f.win.localStorage.length, 0);
  stop(); f.dom.window.close();
});
test("native registration deduplicates; token/session/tenant changes rebind same installation", async () => {
  const f = fixture(); const stop = startNativePushSync(f.win, "ar"); await settle();
  assert.equal(f.posts().length, 1);
  const first = JSON.parse(String(f.posts()[0].body));
  assert.equal(first.locale, "ar"); assert.equal(first.platform, "android");
  assert.deepEqual(f.state.nativeCalls, ["getCapabilities", "getPushRegistration"]);
  await f.poll(); assert.equal(f.posts().length, 1);
  f.state.token += "_refreshed"; await f.poll(); assert.equal(f.posts().length, 2);
  f.state.scope = "session-two-other-tenant"; await f.poll(); assert.equal(f.posts().length, 3);
  for (const post of f.posts()) {
    assert.equal(JSON.parse(String(post.body)).installationId, first.installationId);
    assert.equal(post.credentials, "same-origin"); assert.equal(post.cache, "no-store");
  }
  assert.equal(f.win.localStorage.length, 1);
  assert.equal(f.win.localStorage.getItem("madaf.native.installation.v1"), first.installationId);
  assert.equal(f.win.document.cookie, ""); assert.equal(f.win.document.body.textContent, "");
  stop(); f.dom.window.close();
});
test("unauthenticated native app never requests token or registers", async () => {
  const f = fixture(); f.state.authenticated = false;
  const stop = startNativePushSync(f.win, "he"); await settle();
  assert.equal(f.posts().length, 0); assert.equal(f.state.nativeCalls.length, 0);
  f.state.authenticated = true; await f.poll(); assert.equal(f.posts().length, 1);
  stop(); f.dom.window.close();
});
test("locale remount he → ar → en resyncs the same installation and token", async () => {
  const f = fixture();
  for (const locale of ["he", "ar", "en"] as const) {
    const stop = startNativePushSync(f.win, locale);
    await settle(); await f.poll(); stop();
  }
  const bodies = f.posts().map(post => JSON.parse(String(post.body)));
  assert.deepEqual(bodies.map(body => body.locale), ["he", "ar", "en"]);
  assert.equal(new Set(bodies.map(body => body.installationId)).size, 1);
  assert.equal(new Set(bodies.map(body => body.token)).size, 1);
  assert.equal(f.win.localStorage.length, 1);
  f.dom.window.close();
});
test("transient failure backs off, then retries safely", async t => {
  const f = fixture(); f.state.fail = true;
  let now = 100000; t.mock.method(Date, "now", () => now);
  const stop = startNativePushSync(f.win, "he"); await settle();
  assert.equal(f.state.requests.length, 1);
  f.state.fail = false; await f.poll(); assert.equal(f.state.requests.length, 1);
  now += 30000; await f.poll(); assert.equal(f.posts().length, 1);
  stop(); f.dom.window.close();
});
test("logout cancels in-flight registration and pauses until resumed; cleanup restores bridge", async () => {
  const f = fixture(); f.state.hold = true;
  const previous = () => {}; f.win.MadafNative!.onmessage = previous;
  const stop = startNativePushSync(f.win, "en"); await settle();
  f.win.dispatchEvent(new f.dom.window.Event(PUSH_LOGOUT_EVENT)); await settle();
  assert.equal(f.state.signals[0].aborted, true); await f.poll(); assert.equal(f.posts().length, 0);
  f.state.hold = false;
  f.win.dispatchEvent(new f.dom.window.Event(PUSH_RESUME_EVENT)); await settle();
  assert.equal(f.posts().length, 1);
  stop(); assert.equal(f.win.MadafNative!.onmessage, previous);
  const count = f.state.requests.length; await f.poll(); assert.equal(f.state.requests.length, count);
  f.dom.window.close();
});
