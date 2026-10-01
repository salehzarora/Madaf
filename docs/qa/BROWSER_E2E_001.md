# BROWSER-E2E-001 — Real Chromium regression journeys

Six browser scenarios exercise the existing application against a disposable
local Supabase database and a standard production Next.js build. Application,
authorization, order, inventory and document code is unchanged.

## Run locally

Use a clean checkout without `.env` files (the tracked `.env.example` is allowed),
Node 22.22 or newer in the supported Node 22 line, Docker running, and Supabase
CLI 2.107.0 on PATH. The existing application tests require Node's experimental
module-mock support. Playwright is pinned to 1.63.0 in the lockfile.

```sh
npm ci
npx playwright install chromium
npm run test:e2e-safety
npm run test:e2e
```

On Linux, install browser system dependencies with
`npx playwright install --with-deps chromium`. Initial Docker/browser downloads
depend on network and cache availability. Do not run this beside another E2E
run in the same checkout. Ports 3108, 58320–58322 and 58324 must be free.

Use `npm run test:e2e`, rather than directly launching Playwright against a
borrowed server. One Chromium worker runs with zero retries, no skips and
bounded startup/test timeouts. The command returns failure for missing tools,
failed setup, failed journeys or failed cleanup.

## Destination guards and fixture lifecycle

- Each run creates `.e2e/<random-id>` with an ownership marker and a unique
  `madaf-browser-e2e-<random-id>` Docker project. The owner's normal stack is
  neither reset nor reused.
- Guards reject inherited Production/Preview/provider settings, backend keys,
  dotenv files, hosted domains, foreign ownership and incomplete destinations.
  CI's input mock mode is allowed. The setup action's exact non-secret
  `SUPABASE_INTERNAL_IMAGE_REGISTRY=ghcr.io` setting is also allowed.
- The owned app is `http://127.0.0.1:3108`; API/Auth/Storage are on 58321 and
  PostgreSQL is on 58322. All destinations and the database container's project
  label are checked before fixture writes. API health checks reject redirects.
- Current repository migrations are copied unchanged to that owned project.
  The normal demo seed is disabled. No `--linked`, hosted connection or new
  migration is used.
- Node setup creates two synthetic tenants, confirmed local Auth owners,
  twelve shops per tenant, one priced product per tenant and inventory of ten.
  Random passwords stay in the ignored run directory. A temporary Node login
  probe validates local email-provider readiness and revokes its own session.
  Browser users then sign in through the real login UI; no probe session,
  fake cookie or service-role key is passed to them.
- The child app uses the existing email-login setting, local Supabase keys,
  disabled push and disabled trusted document storage. Local SMTP is contained
  in the disposable stack; no real email/SMS, payment or legal issuance runs.
- `npm run build` creates a fresh Supabase-configured production build and runs
  existing dynamic-route checks. Environment and build-ID ownership are checked
  again before `next start`. A mock or stale build cannot be reused.
- Node fixture setup writes prerequisites; browser tests use SQL only to read
  authoritative outcomes. Orders and status changes occur through actual UI
  and server actions. PDFs use authenticated protected routes.
- Cleanup runs in `finally`, including ordinary interruption signals, and stops
  only the uniquely owned project with `--no-backup`. Raw diagnostics remain
  ignored for local investigation. A hard process/runner kill cannot guarantee
  cleanup; inspect the ownership marker before manually stopping that exact
  project. Never use `supabase stop --all` for this suite.

## Coverage

| Scenario | Browser action and authoritative assertion |
| --- | --- |
| A — Authentication | Anonymous denial, real login, refresh and logout denial. |
| B — Ordering | Product search, exact shop, quantity three, displayed subtotal, duplicate pointer click, exactly one stored order/claim/audit event and authoritative totals. |
| C — Inventory | New order leaves availability unchanged; confirmation reserves three; cancellation restores three; reload and stored movements/status agree. |
| D — Tenant boundary | Separate B browser creates an order/PDF. A receives the actual denial for B's order, PDF and document preview, without B-specific content. |
| E — Documents | Authorized non-empty PDF bytes/content type, actual Chromium Download file, draft/non-legal preview safeguards and a delivery template without price columns/totals. |
| F — Locale/responsive | Hebrew first launch, AR/HE/EN switching, reload lang/dir, saved root/unprefixed-route preference, mobile picker scrolling/navigation and cart preservation. |

Responsive samples are AR 390×844, HE 768×1024 and EN 1440×900 catalog screens,
plus the EN mobile cart. Document-width assertions check horizontal overflow.
This is not a full locale × route × viewport matrix.

Unexpected page errors, console errors and external browser requests fail tests.
The deliberate tenant-denial case permits only the expected 404 resource error
on its exact denied URLs. There is no broad error suppression. Semantic locators
are used except the existing `.doc-sheet` printable-template boundary.

## CI and artifacts

The browser steps run inside the existing `verify` job, whose required check
name remains **lint · test · build · audit**. Existing unit, timezone,
deployment-safety matrix, mock production-build and dependency-audit gates stay
in place. The E2E runner performs a separate local-Supabase production build;
it does not reuse the earlier mock build. CI needs no hosted secrets.

Only `.e2e/run-summary.json` and `.e2e/browser-summary.json` are uploaded, with
static scenario names, statuses and elapsed times. Authentication state, keys,
cookies, PDFs, raw failure snapshots/logs and complete directories are never
uploaded. Traces, automatic screenshots and video are off. All runtime files
are ignored by Git. Inspect private local failure details carefully: even
synthetic browser snapshots can include passwords or tokenized URLs.

## Acceptance and limits

Verified locally on Windows with Node 22.22.0 and a warm Docker/browser cache:

| Check | Result | Wall time |
| --- | --- | --- |
| Existing application suite | 1,583 PASS | 95.264 s |
| Existing exhaustive timezone matrix | 7 PASS | 122.248 s |
| Fixture destination/ownership guards | 7 PASS | 0.981 s |
| Existing deployment-safety matrix | 10 expected outcomes PASS | 4.131 s |
| Final lint / typecheck | PASS / PASS | 13.669 s / 3.282 s |
| Standard mock Turbopack build + critical routes | PASS, 14 routes | 10.940 s |
| Production dependency audit | PASS, 0 vulnerabilities | 1.569 s |
| Final E2E run 1 — fresh fixtures | 6 PASS, zero retries | 65.582 s |
| Final E2E run 2 — independently fresh fixtures | 6 PASS, zero retries | 64.143 s |

The browser reporter measured 20.977 s and 20.656 s respectively. The remaining
time includes Docker startup, fixtures, each standard Supabase-mode production
build, server startup and scoped cleanup. Both runs removed their owned stacks.
The owner's other local stacks remained running. Diff check passed and
`src/`, migrations, normal seed and `AGENTS.md` remained unchanged.

Development runs initially failed on test infrastructure: a TypeScript origin
comparison, the disposable email-provider setting, exact shop locators, the
document column name and a selected-shop label assertion. These were corrected
in the new test files/configuration. No product fix, retry or skip was used.
Fresh GitHub CI/Linux execution and live protected-workflow enforcement remain
unverified until a separately authorized push/PR.

Local email/password authentication is **not** SMS/OTP-provider acceptance.
Chromium Download is not native Android Share Sheet, physical printing,
WhatsApp delivery or real-phone Safari keyboard verification. No hosted PII,
commercial order, production session or external notification was used.

Read-only review also noted that inactive-product document preview handling is
outside these active-product fixtures; this suite does not claim that case is
covered. No document or authentication behavior was altered for testing.
