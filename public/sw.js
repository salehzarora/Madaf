/* MADAF is online-only for business data. This worker owns one static fallback. */
const OFFLINE_CACHE = "madaf-offline-v1";
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    // Never precache an authenticated response or a redirect to another page.
    const response = await fetch(OFFLINE_URL, {
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
    });
    if (!response.ok) throw new Error("Offline shell unavailable");
    const cache = await caches.open(OFFLINE_CACHE);
    await cache.put(OFFLINE_URL, response);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith("madaf-offline-") && name !== OFFLINE_CACHE) {
        await caches.delete(name);
      }
    }
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || request.mode !== "navigate") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname === "/api" || url.pathname.startsWith("/api/")) return;

  event.respondWith((async () => {
    try {
      // Do not read/write an HTTP-cached document or persist its response here.
      // RSC, prefetch, APIs, images and mutations never enter this handler.
      return await fetch(request, { cache: "no-store" });
    } catch {
      const cache = await caches.open(OFFLINE_CACHE);
      const fallback = await cache.match(OFFLINE_URL);
      // Storage can be evicted by the browser. Never substitute business data.
      return fallback ?? Response.error();
    }
  })());
});
