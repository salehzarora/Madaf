# MADAF Web PWA and Android handoff

## Web PWA architecture

MADAF remains a network-first website. Native browser installation uses
`src/app/manifest.ts` (`/manifest.webmanifest`): stable `id: "/"`, start URL `/`,
scope `/`, standalone display, MADAF identity and the existing 192px/512px,
maskable and Apple icons. The existing proxy redirects `/` to `/he`; AR/HE/EN
routing and authentication stay authoritative. No locale-memory layer is added.

`ServiceWorkerRegister` is a renderless client leaf mounted once inside the
server-rendered locale root. In production, supported browsers register
`/sw.js` with scope `/` and `updateViaCache: "none"`. Unsupported browsers or
registration/storage failures retain ordinary online operation. Registration
does not request notifications, subscribe to push, or display install prompts.

`/sw.js` has a narrow `Cache-Control: no-cache, no-store, must-revalidate` rule.
Existing security headers/CSP remain unchanged; a root worker needs no
`Service-Worker-Allowed` override. Dotted public assets already bypass the
existing locale/session proxy.

## Offline and cache policy

The worker owns **`madaf-offline-v1`**, containing exactly **`/offline.html`**.
The offline page includes its own CSS, inline Madaf shelf mark and AR/HE/EN copy.
It needs no Next runtime, font download, image, script, API or session.
Its directly embedded multilingual copy is the explicitly approved exception
for this standalone asset; ordinary application UI still uses typed dictionaries.

- Install fetches this one file with `cache: "no-store"`, `credentials: "omit"`
  and `redirect: "error"`. A failed fetch/non-success response prevents install.
- Only same-origin **GET document navigations**, excluding `/api` and `/api/*`,
  enter the fetch handler. They fetch the original request with `cache: "no-store"`.
  Successful responses, HTTP errors and authentication redirects retain their
  normal semantics. No navigation response is written into Cache Storage.
- Only a rejected network fetch reads the offline shell from its own cache.
  Retry reloads the current document. On reconnect the next navigation fetches
  live content immediately, without waiting for cache expiry.
- Non-navigation requests pass through normally: Next RSC/prefetch requests,
  scripts, images, APIs and actions are not handled by this worker.
- Existing rendered UI and Next's ordinary in-memory client router state may
  remain visible offline. A prefetched client transition need not contact the
  network. The offline guarantee applies to **failed document navigations**;
  Next's existing RSC failure handling may escalate a failed Link transition to
  such a navigation. No Next offline/retry experiment is enabled.
- If the browser evicts/denies the cached shell, the worker returns a network
  error; it never substitutes cached business content. First-ever offline visits
  cannot have a previously installed fallback.

The worker calls `skipWaiting()` only after storing the shell and `clients.claim()`
after activation cleanup. It does not force a page reload. This immediate update
is intentional because it owns no versioned application bundles or business data.
Activation deletes only obsolete names beginning `madaf-offline-`, retaining the
current version and every unrelated cache. Bump the cache version in `sw.js` when
changing the offline shell so browsers install the new asset atomically with a
changed worker. Do not extend this cache to application content.

## Security guarantees

The service worker never caches tenant/customer/product/order/inventory/dashboard
data, admin/catalog/product/login HTML, authentication responses, API responses,
Supabase requests or signed image URLs. It never intercepts non-GET mutations,
Server Actions, or stores a write queue. There is no offline synchronization,
background mutation replay, stale-while-revalidate, offline database, Workbox,
Serwist, next-pwa, or new dependency.

These are **worker Cache Storage guarantees**, not a claim that existing browser
HTTP caches, Next router memory or the application's established cart persistence
have been removed. Auth, cookies, session refresh, RLS and authorization remain
unchanged. An offline page provides no tenant access or business actions.

## Verification and local development

`npm test` includes behavioral execution of the actual worker in an isolated
event/cache harness, production registration, offline document independence,
header composition and the unchanged proxy matcher/locale redirect. Manifest
tests retain identity/icon/locale coverage and guard against third-party PWA
libraries or Android associations beyond the explicitly approved debug identity.

Use a production build for runtime QA. Development does not register a worker,
but an already-installed worker persists across server restarts. Use an isolated
browser profile/origin for production testing, or unregister only this worker
and its `madaf-offline-*` caches before reusing that origin for development.
Never clear unrelated application/browser caches indiscriminately.

Release checks include manifest discovery and valid PNG sizes, worker activation
and control, `/sw.js` headers, online navigation, failed offline navigation and
immediate reconnect. Inspect Cache Storage after browsing: only the origin's
`/offline.html` belongs in `madaf-offline-v1`. Physical OS chrome, keyboard,
installation and authenticated hosted flows require the device checklist below;
browser emulation is not proof of those device behaviors.

### PWA-RUNTIME-COMPLETE-002 local evidence (2026-09-27)

The branch started at `3ab96a00baa9a684d161cbd9408f7cb984a27ff5`, after its
[post-merge CI run](https://github.com/salehzarora/Madaf/actions/runs/36336728532)
completed successfully. Runtime QA used the Webpack production build in mock
mode, served through a loopback HTTPS endpoint (`https://localhost:3443`). Chrome
trusted only that test certificate through its pinned public-key exception;
system trust and hosted configuration were not changed.

| Locale | 390×844 | 768×1024 | 1440×900 |
| --- | --- | --- | --- |
| Arabic (RTL) | Browser-mode PASS | Browser-mode PASS | Browser-mode PASS |
| Hebrew (RTL) | Browser-mode PASS | Browser-mode PASS | Browser-mode PASS |
| English (LTR) | Browser-mode PASS | Browser-mode PASS | Browser-mode PASS |

Each combination covered landing, catalog, product detail and mock Admin pages:
correct direction/metadata, active worker control and no document horizontal
overflow. Login retained the existing mock-mode not-found behavior; this does
not verify authenticated hosted sessions. Mobile interaction checks covered
catalog → product → browser Back, cart review open/close, shop selection preserving
the cart, and Admin drawer → Products → Back. At a reduced 390×500 browser
viewport, the picker retained a visible search field, eight result rows and a
377px internally scrollable results region. This is not a native keyboard test.
Existing `100dvh`, safe-area padding and `visualViewport` geometry remain intact.

The production browser verified:

- Manifest discovery and parsing: zero manifest/installability errors reported
  by Chrome's inspection API. Identity, stable ID and standalone display parsed.
- All four icons returned HTTP 200 and decoded at 192×192, 512×512, maskable
  512×512 and Apple 180×180. Launch `/` returned live `/he` content.
- One activated root-scoped worker controlled the page with `updateViaCache`
  set to `none`; the worker response had the required no-store header.
- Stopping the isolated HTTPS endpoint, then opening the previously unvisited
  `/ar/admin/customers?qa=connection-unavailable`, displayed the self-contained
  trilingual fallback. Restoring the endpoint and pressing Retry immediately
  returned the live customers route. No application HTML/data was cached.
- Cache Storage contained exactly `madaf-offline-v1`, with the sole key
  `https://localhost:3443/offline.html`, after browsing and reconnection.

**Installed standalone mode remains unverified.** The available headless browser
reported `display-mode: standalone` as false; attempted media emulation did not
change that, and its native PWA installation API was unavailable. A separate
full-Chrome profile launch was rejected by automatic approval review with
"blocked by policy" and no additional reason. The denied launch was not retried.
`beforeinstallprompt` was not observed in automation. The responsive matrix above
must not be treated as installed-mode or physical-device certification.

Local verification passed: diff check, lint, typecheck, **1,441 tests** (including
19 new runtime tests), Webpack production build, 13 critical dynamic-route checks,
and production dependency audit (zero vulnerabilities). The standard Turbopack
build encountered the known managed-worktree restriction: linked `node_modules`
resolves outside its project root. No dependency or bundler configuration was
changed to work around it. The AGENTS.md managed/custom rules remained unchanged.

## Android handoff

- The internal debug Trusted Web Activity (TWA) wrapper exists in a **separate
  local Android repository**. Its APK remains unchanged by this web association.
- APK/AAB creation, signing and distribution belong to that Android repository.
- Native browser installation is sufficient for this web phase. No custom
  installation banner/button has been added.
- Passing local PWA checks is not release approval. The Pilot runbook and its
  hosted/auth/real-customer gates remain authoritative.

### Debug Digital Asset Links — physical-device QA only

Control Room explicitly authorized `public/.well-known/assetlinks.json` for the
existing **development-only** package `app.madaf.android.dev`. It contains one
`delegate_permission/common.handle_all_urls` relation and the actual **debug-only**
signing certificate SHA-256:

```text
D4:27:EC:08:C2:EC:6E:6D:B4:DB:BF:3E:DF:8E:69:F5:C0:C7:40:7D:4A:1A:CC:B7:CC:28:32:72:0D:D3:40:41
```

This association exists only for internal physical-device TWA testing. It is
**not a release certificate or public Android release approval**. The association
**MUST be reviewed and replaced as appropriate before public Android release**;
the public package and actual release/Play signing certificate require separate
Control Room approval. Never infer or invent a release fingerprint. No release
keystore, AAB or Android repository publication is part of this web change.

The static file uses the existing public-asset delivery and bypasses the existing
locale/session proxy without changing its matcher. It adds no auth, RLS,
Supabase, business logic, security-header or service-worker changes. Tests pin
the complete statement, rejecting extra packages, fingerprints and relations.

Before merging its separate PR, verify the preview serves the exact JSON at
`/.well-known/assetlinks.json` with HTTP 200, `application/json`, and no redirect
or login requirement, following the [Android association hosting requirements](https://developer.android.com/training/app-links/configure-assetlinks).
Keep this PR unmerged until Control Room review. A preview proves file delivery;
it does not establish trust for the APK's production launch origin. After a
separately approved merge, verify the same response at
`https://madaf-drab.vercel.app/.well-known/assetlinks.json` before physical-device
TWA verification. Do not treat browser emulation or a successful JSON fetch as
proof that Android has verified the association.

## Real-device checklist — pending owner/Control Room verification

Use a separately approved HTTPS preview/release and synthetic rehearsal data.

- [ ] Android Chrome offers installation; record device/OS/browser versions.
- [ ] Launch from the installed icon; verify MADAF identity and standalone mode.
- [ ] Login and logout work; session persists through close/reopen as intended.
- [ ] Catalog, product detail, cart and Admin navigation remain usable.
- [ ] Android Back, in-app navigation and external links behave reasonably.
- [ ] Picker search stays visible and scrollable with the native keyboard open.
- [ ] Modals, safe areas, rotation and short visible viewports remain usable.
- [ ] Product image upload works without changing upload/security constraints.
- [ ] Downloads/PDFs open or download correctly and allow returning to the app.
- [ ] AR/HE RTL and EN LTR work at phone/tablet sizes without horizontal overflow.
- [ ] Install online; disconnect; hard-navigate to an unvisited route; see MADAF
      offline content, with no cached tenant data in Cache Storage.
- [ ] Reconnect and Retry; the live route returns immediately; no write replays.
- [ ] Confirm only `madaf-offline-v1` → `/offline.html` is owned by this worker.
- [ ] Verify worker update takes effect without losing cart/auth state.

For iOS, separately verify Add to Home Screen, native keyboard/safe areas and
standalone session/download behavior. Do not infer this from Android-size QA.
