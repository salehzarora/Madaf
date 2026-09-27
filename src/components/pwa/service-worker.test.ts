import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { JSDOM } from "jsdom";
import ts from "typescript";
import { NextRequest } from "next/server";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import nextConfig from "../../../next.config";
import { config as proxyConfig, proxy } from "@/proxy";
import { securityHeaders } from "@/lib/config/security-headers";

const root = new URL("../../../", import.meta.url);
const origin = "https://madaf.test";
const cacheName = "madaf-offline-v1";
const shell = readFileSync(new URL("public/offline.html", root), "utf8");
type Fetch = (input: Request | string, init?: RequestInit) => Promise<Response>;

function worker(storage: { beforePut?: () => Promise<void>; beforeOpen?: () => Promise<void>; beforeDelete?: () => Promise<void> } = {}) {
  const handlers = new Map<string, (event: unknown) => void>();
  const stores = new Map<string, Map<string, Response>>();
  const writes: string[] = [];
  const reads: string[] = [];
  const fetched: { input: Request | string; init?: RequestInit }[] = [];
  let skipped = 0;
  let claimed = 0;
  let network: Fetch = async () => new Response(shell, { headers: { "Content-Type": "text/html" } });
  runInNewContext(readFileSync(new URL("public/sw.js", root), "utf8"), {
    URL, Response,
    self: {
      location: { origin },
      addEventListener: (type: string, handler: (event: unknown) => void) => handlers.set(type, handler),
      skipWaiting: async () => { skipped++; },
      clients: { claim: async () => { claimed++; } },
    },
    fetch: (input: Request | string, init?: RequestInit) => { fetched.push({ input, init }); return network(input, init); },
    caches: {
      keys: async () => [...stores.keys()],
      delete: async (name: string) => { await storage.beforeDelete?.(); return stores.delete(name); },
      open: async (name: string) => {
        await storage.beforeOpen?.();
        if (!stores.has(name)) stores.set(name, new Map());
        return {
          put: async (key: string, response: Response) => { await storage.beforePut?.(); writes.push(key); stores.get(name)!.set(key, response.clone()); },
          match: async (key: string) => { reads.push(key); return stores.get(name)!.get(key)?.clone(); },
        };
      },
    },
  });
  function dispatch(type: string, request?: Request) {
    const waiting: Promise<unknown>[] = [];
    let response: Promise<Response> | undefined;
    handlers.get(type)!({
      request,
      waitUntil: (promise: Promise<unknown>) => waiting.push(promise),
      respondWith: (promise: Promise<Response>) => { response = promise; },
    });
    return { done: Promise.all(waiting), response };
  }
  return { stores, writes, reads, fetched, dispatch, setNetwork: (value: Fetch) => { network = value; }, lifecycle: () => ({ skipped, claimed }) };
}

function request(path: string, init: RequestInit = {}, navigation = true) {
  const value = new Request(new URL(path, origin), init);
  if (navigation) Object.defineProperty(value, "mode", { value: "navigate" });
  return value;
}

test("install precaches only the unauthenticated static shell and activates only after it is stored", async () => {
  const w = worker();
  await w.dispatch("install").done;
  assert.deepEqual(w.writes, ["/offline.html"]);
  assert.deepEqual([...w.stores.keys()], [cacheName]);
  assert.deepEqual([...w.stores.get(cacheName)!.keys()], ["/offline.html"]);
  assert.equal(w.fetched[0].input, "/offline.html");
  assert.equal(w.fetched[0].init?.cache, "no-store");
  assert.equal(w.fetched[0].init?.credentials, "omit");
  assert.equal(w.fetched[0].init?.redirect, "error");
  assert.equal(await w.stores.get(cacheName)!.get("/offline.html")!.text(), shell);
  assert.deepEqual(w.lifecycle(), { skipped: 1, claimed: 0 });
});

for (const failure of ["connection", "http"] as const) {
  test(`failed shell installation (${failure}) never writes a response or skips waiting`, async () => {
    const w = worker();
    w.setNetwork(async () => { if (failure === "connection") throw new TypeError("Offline"); return new Response("Not found", { status: 404 }); });
    await assert.rejects(w.dispatch("install").done);
    assert.equal(w.writes.length, 0);
    assert.equal(w.stores.size, 0);
    assert.equal(w.lifecycle().skipped, 0);
  });
}

test("activation deletes only obsolete MADAF offline caches, then claims clients", async () => {
  const w = worker();
  for (const name of [cacheName, "madaf-offline-v0", "madaf-other", "unrelated-cache"]) w.stores.set(name, new Map());
  await w.dispatch("activate").done;
  assert.deepEqual([...w.stores.keys()], [cacheName, "madaf-other", "unrelated-cache"]);
  assert.equal(w.lifecycle().claimed, 1);
});

for (const operation of ["beforeOpen", "beforePut"] as const) {
  test(`storage failure during ${operation} prevents worker takeover`, async () => {
    const w = worker({ [operation]: async () => { throw new Error("Storage denied"); } });
    await assert.rejects(w.dispatch("install").done, /Storage denied/);
    assert.deepEqual(w.writes, []);
    assert.equal(w.lifecycle().skipped, 0);
  });
}

test("lifecycle waits for the shell write before skipWaiting and cleanup before claim", async () => {
  let completeWrite!: () => void;
  let completeDelete!: () => void;
  const w = worker({
    beforePut: () => new Promise<void>(resolve => { completeWrite = resolve; }),
    beforeDelete: () => new Promise<void>(resolve => { completeDelete = resolve; }),
  });
  const install = w.dispatch("install").done;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(w.lifecycle().skipped, 0);
  completeWrite();
  await install;
  assert.equal(w.lifecycle().skipped, 1);
  w.stores.set("madaf-offline-v0", new Map());
  const activate = w.dispatch("activate").done;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(w.lifecycle().claimed, 0);
  completeDelete();
  await activate;
  assert.equal(w.lifecycle().claimed, 1);
});

for (const status of [200, 302, 401, 404, 500]) {
  test(`document HTTP ${status} passes through untouched with no offline read or cache write`, async () => {
    const w = worker();
    const response = new Response("live response", { status, headers: { "Set-Cookie": "synthetic=session; HttpOnly" } });
    w.setNetwork(async () => response);
    const navigation = request("/he/admin");
    assert.equal(await w.dispatch("fetch", navigation).response, response);
    assert.equal(w.fetched[0].input, navigation, "preserve the original request, including credentials");
    assert.equal(w.fetched[0].init?.cache, "no-store");
    assert.equal(response.headers.get("Set-Cookie"), "synthetic=session; HttpOnly");
    assert.deepEqual(w.writes, []);
    assert.deepEqual(w.reads, []);
    assert.equal(w.stores.size, 0);
  });
}

test("only rejected document fetch uses the shell; reconnect immediately returns the live response", async () => {
  const w = worker();
  await w.dispatch("install").done;
  w.setNetwork(async () => { throw new TypeError("Offline"); });
  assert.equal(await (await w.dispatch("fetch", request("/ar/catalog?search=new")).response)!.text(), shell);
  assert.deepEqual(w.reads, ["/offline.html"]);
  const live = new Response("fresh tenant response");
  w.setNetwork(async () => live);
  assert.equal(await w.dispatch("fetch", request("/ar/catalog?search=new")).response, live);
  assert.deepEqual(w.writes, ["/offline.html"], "never save either navigation URL/response");
});

test("evicted shell fails closed with a network error, never another cached response", async () => {
  const w = worker();
  w.stores.set("unrelated-cache", new Map([["/offline.html", new Response("unrelated response")]]));
  w.setNetwork(async () => { throw new TypeError("Offline"); });
  const response = await w.dispatch("fetch", request("/en/product/synthetic")).response;
  assert.equal(response?.type, "error");
  assert.equal(w.writes.length, 0);
});

const ignored = [
  request("/api/health"), request("/api"),
  request("/api/orders", {}, false),
  request("/he/catalog?_rsc=abc", { headers: { RSC: "1" } }, false),
  request("/he/admin", { headers: { "Next-Router-Prefetch": "1" } }, false),
  request("/_next/static/app.js", {}, false),
  request("/_next/image?url=photo", {}, false),
  request("https://project.supabase.co/storage/v1/object/sign/photo?token=synthetic", {}, false),
  request("https://project.supabase.co/auth/v1/user", {}, false),
  request("https://external.test/page"),
  ...["POST", "PUT", "PATCH", "DELETE"].map((method) => request("/he/admin", { method, headers: { "Next-Action": "synthetic" }, body: "synthetic" })),
];
test("API, RSC, prefetch, signed media, Supabase and mutations pass through without respondWith/fetch/cache", async () => {
  const w = worker();
  for (const value of ignored) {
    assert.equal(w.dispatch("fetch", value).response, undefined, `${value.method} ${new URL(value.url).pathname}`);
  }
  assert.equal(w.fetched.length, 0);
  assert.equal(w.stores.size, 0);
  assert.equal(w.writes.length, 0);
});

test("offline document is self-contained, trilingual, and retries the current document without scripts", () => {
  const dom = new JSDOM(shell, { url: `${origin}/ar/catalog` });
  const doc = dom.window.document;
  assert.equal(doc.querySelectorAll("script,link,img,iframe,form,video,audio").length, 0);
  assert.deepEqual([...doc.querySelectorAll("section")].map(node => [node.lang, node.dir]), [["ar", "rtl"], ["he", "rtl"], ["en", "ltr"]]);
  assert.equal(doc.querySelector("a")!.href, `${origin}/ar/catalog`);
  assert.doesNotMatch(doc.querySelector("style")!.textContent!, /url\(|@import/i);
  dom.window.close();
});

test("production registration is root scoped, cache-bypassing and gracefully handles unsupported/dev/failure", async () => {
  const source = readFileSync(new URL("src/components/pwa/service-worker-register.tsx", root), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  for (const environment of ["development", "test", "production"]) {
    for (const supported of [false, true]) {
      const effects: (() => void)[] = [];
      const calls: { path: string; options: RegistrationOptions }[] = [];
      const exports = {} as { ServiceWorkerRegister: () => null };
      runInNewContext(compiled, {
        exports, process: { env: { NODE_ENV: environment } },
        require: (name: string) => { assert.equal(name, "react"); return { useEffect: (effect: () => void) => effects.push(effect) }; },
        navigator: supported ? { serviceWorker: { register: (path: string, options: RegistrationOptions) => { calls.push({ path, options }); return Promise.reject(new Error("Disabled storage")); } } } : {},
      });
      assert.equal(exports.ServiceWorkerRegister(), null);
      effects.forEach(effect => effect());
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(calls.length, supported && environment === "production" ? 1 : 0);
      if (calls.length) {
        assert.equal(calls[0].path, "/sw.js");
        assert.equal(calls[0].options.scope, "/");
        assert.equal(calls[0].options.updateViaCache, "none");
      }
    }
  }
});

test("worker delivery adds only its narrow no-store header and preserves global security headers", async () => {
  const rules = await nextConfig.headers!();
  assert.deepEqual(rules.find(rule => rule.source === "/:path*")?.headers, securityHeaders());
  assert.deepEqual(rules.find(rule => rule.source === "/sw.js")?.headers, [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }]);
  assert.equal(rules.length, 2);
});

test("static PWA files bypass the unchanged proxy; locale app routes still match and bare root redirects to Hebrew", async () => {
  for (const url of ["/sw.js", "/offline.html", "/manifest.webmanifest", "/icons/madaf-192.png"]) {
    assert.equal(unstable_doesMiddlewareMatch({ config: proxyConfig, url }), false, url);
  }
  for (const url of ["/", "/ar/catalog", "/he/admin", "/en/login"]) {
    assert.equal(unstable_doesMiddlewareMatch({ config: proxyConfig, url }), true, url);
  }
  const response = await proxy(new NextRequest(`${origin}/`));
  assert.equal(response.status, 307);
  assert.equal(response.headers.get("location"), `${origin}/he`);
});
