# Staging Deployment Execution Log — M7D

> **SECRETS RULE (read first).** This file is committed to git. **Never** write a
> secret value here — no database password, service-role key, SMS/provider
> token, Vercel token, or Supabase access token. Only **non-secret** values are
> allowed: project **ref**, project/app **URLs**, the **public** anon key, and
> env-var **names**. If in doubt, write the name, not the value.

This is the live execution tracker for the supervised staging deploy. It is
driven by the human operator following
[STAGING_DEPLOYMENT_M7C.md](STAGING_DEPLOYMENT_M7C.md) (the how-to) and
[RUNBOOK_STAGING.md](RUNBOOK_STAGING.md) (ops/rollback). Statuses below start
**PENDING** and are updated as each step is completed.

---

## 1. Run metadata

| Field | Value |
| --- | --- |
| Execution started | 2026-07-08 (M7D prep); provisioning 2026-07-08 (M7D.1) |
| Deploying commit | `0a6f190` (main; Merge M7D.1 Vercel build fix) — **deployed & green on Vercel** |
| Branch | `infra/M7D1-operator-staging-provisioning` (docs only) |
| Operator | _(supervised session)_ |
| Overall status | **STAGING LIVE (auth-URL + smoke pending).** Supabase created + migrated; Vercel deployed green; app serves; email-login smoke pending |

**Provisioning underway (M7D.1).** Staging **Supabase project created + all 25
migrations applied** (§3), **Vercel deployed green** on `0a6f190` at
`https://madaf-drab.vercel.app` (§4), env set (§5), safety linter **ok** (§7),
and the **live login page renders** (phone-primary + email fallback visible).
**Phone OTP is BLOCKED (no SMS provider)** — smoke runs via the email fallback.
Remaining: auth Site/redirect URLs (§8) + the authenticated smoke (§9). Results
recorded as they happen, never fabricated.

---

## 2. Local preflight (this session)

| Check | Result |
| --- | --- |
| `node --version` | ✅ **v22.14.0** (≥22 required) |
| `npm --version` | ✅ 10.9.2 |
| `git status` | ✅ clean (on branch, `running-containers.txt` untracked/ignored) |
| `npm run lint` | ✅ clean |
| `npm run build` | ✅ **216/216** static pages |
| `npm audit --omit=dev --audit-level=moderate` | ✅ **0 vulnerabilities** |
| `supabase db reset --local` | ⚠️ **not re-run — Docker Desktop was offline this session.** No migration was added in M7D; the schema is unchanged since the M7C merge, whose finalization verified `db reset`/`lint`/`advisors` clean. Re-run locally once Docker is up. |
| `supabase db lint --local` | ⚠️ same (Docker offline) — known-clean at M7C. |
| `supabase db advisors --local` | ⚠️ same (Docker offline) — known-clean at M7C. |
| Security greps | ✅ no committed secrets, no hosted `supabase.co` URL, no Vercel/Supabase token, no legal/payment enablement (only doc prohibitions + the safety linter's own detector strings). |
| Legal stack | ✅ OFF — `legal_effective` hard-false, all M6 flags default-off (no change in M7D). |

---

## 3. Staging Supabase project (Phase 2)

**Operator actions (dashboard):**

- [ ] Create a **new** Supabase project **for staging** (separate from any
      production project). **Confirm out loud: "this is the STAGING project."**
- [ ] Set a strong DB password — store it in a password manager, **never** here.
- [ ] Record **non-secret** identifiers below.
- [ ] Auth Site URL + Redirect URLs — set **after** the Vercel URL exists (§5).
- [ ] Phone provider + SMS provider — configure in the **dashboard/secrets only**
      (§5). Never in the repo.
- [ ] Create the **private** `documents` storage bucket (§6).

| Field | Value (non-secret only) |
| --- | --- |
| Project name | `madaf-staging` |
| Project ref | `bmqoajddxjmusaaflwma` ✅ verified (20 chars; corrected from an earlier copy slip) |
| Project URL | `https://bmqoajddxjmusaaflwma.supabase.co` |
| Region | `ap-southeast-1` (Singapore) — note: far from Israel; latency consideration for a future production region |
| Is this the STAGING (not production) project? | ✅ **confirmed** (operator: "staging only, do not use as production") |

**Migration deploy (hosted) — SAFE pattern, no reset:**

> ⛔ **NEVER** run `supabase db reset` on hosted — it wipes data.

- [ ] `supabase link --project-ref <staging-ref>` (operator confirms the ref is
      staging first).
- [ ] Print the confirmation gate: **"Confirm this is the STAGING project, not
      production"** before any hosted DB command.
- [ ] Review pending migrations: `supabase migration list` (linked).
- [ ] Deploy migrations: `supabase db push` (applies the 25 migrations; does
      **not** reset). Requires a DB connection/access the operator holds — not
      committed.
- [ ] Verify applied: `supabase migration list` shows all local migrations as
      applied remotely.
- [ ] Where the CLI/dashboard supports it, run advisors on the hosted project
      (dashboard → Advisors) and confirm **no errors**.
- [ ] Run `bootstrap-auth.sql`? **NO** — it seeds local demo email users; do not
      run it against staging (see §11 demo-data rule).

**Status: MIGRATIONS APPLIED** (`madaf-staging`, ref `bmqoajddxjmusaaflwma`,
`ap-southeast-1`, staging-confirmed twice). `supabase migration list` shows all
**25** migrations (`20260705100000` … `20260714120000`) applied **remotely**,
Local==Remote; `supabase db push` reported **no pending** migrations. **No
`config push`** (local dummy Twilio/`test_otp` never pushed), **no hosted `db
reset`**, no secrets pasted. **Advisors (dashboard): clean ✅** — no security/performance issues.

---

## 4. Vercel project (Phase 3)

**Operator actions (dashboard):**

- [ ] Import the GitHub repo into a **new Vercel project** (staging).
- [ ] Framework: **Next.js** (auto-detected). Build: `npm run build` (default).
- [ ] Node.js version: **22** (matches CI + `README`; the `@supabase` packages
      require `node >=22`).
- [ ] Set env vars in the **Vercel dashboard only** (names in §6). No secrets in
      the repo.
- [ ] Deploy staging; capture the preview/staging URL below.

| Field | Value (non-secret) |
| --- | --- |
| Vercel project name | `madaf` |
| Staging URL | `https://madaf-drab.vercel.app` |
| Node version | 22 (set in Project Settings) |
| Team | `salehzarora's projects` (`team_yynO6ARGc6VsRrAB69hOTTZy`) |

**Env-var method:** the connected **Vercel MCP has no env-var read/write tool**
(observability + deploy only), and this MCP token cannot resolve the `madaf`
project (`list_projects` shows only `resto-flow`; `madaf` → 404). So env vars
are set in the **Vercel dashboard** (Project → Settings → Environment Variables),
applied to **Production + Preview** of the staging project — this also keeps
secrets out of terminal history. Public trio already set by operator; 8
server-only non-secret flags + `SUPABASE_SERVICE_ROLE_KEY` (dashboard-entered,
never printed) to add.

**Deploy result (operator-reported + verified):** Redeploy from `main` @
`0a6f190` **succeeded**; env vars **set** (public trio + 8 server-only flags +
service-role); **trusted document storage enabled**; **no forbidden vars**. The
build cleared the M7D.1 `generateStaticParams` fix. **Verified independently:**
`https://madaf-drab.vercel.app/he/login` serves the real Madaf login page
(phone-primary + email fallback visible) — not a Vercel wall / 404.

**Status: DEPLOYED GREEN ✅** (`0a6f190`, `https://madaf-drab.vercel.app`).

---

## 5. Env variables checklist — NAMES ONLY (Phase 3 policy)

> Set values in the **Vercel dashboard** (and SMS secrets in the **Supabase
> dashboard**). **Do not** write any value in this file. The M7C safety linter
> (`assessDeploymentSafety`) encodes this policy — see §7.

**Allowed PUBLIC (`NEXT_PUBLIC_*`) — the only ones exposed to the browser:**

- [ ] `NEXT_PUBLIC_SUPABASE_URL` — the staging project URL.
- [ ] `NEXT_PUBLIC_SUPABASE_ANON_KEY` — the **public** anon key (safe to expose).
- [ ] `NEXT_PUBLIC_MADAF_DATA_MODE = supabase`.
- [ ] `NEXT_PUBLIC_APP_URL` (or `NEXT_PUBLIC_SITE_URL`) — the staging URL, if used.

**Server-only (never `NEXT_PUBLIC`):**

- [ ] `MADAF_AUTH_PRIMARY_METHOD = phone`.
- [ ] `MADAF_EMAIL_AUTH_ENABLED = true` — **M7D.1 knowing choice**: no SMS
      provider yet, so email/password is enabled in staging to unblock the smoke
      tests. Revert to `false` (or remove) once an SMS provider is live and phone
      OTP is verified.
- [ ] `MADAF_DEV_PHONE_OTP_ENABLED = false` (must be off in staging).
- [ ] `MADAF_LEGAL_INVOICING_ENABLED = false`.
- [ ] `MADAF_LEGAL_NUMBERING_ENABLED = false`.
- [ ] `MADAF_TAX_PROVIDER_MODE = disabled` (never `production`).
- [ ] `SUPABASE_SERVICE_ROLE_KEY` — **only** if trusted document storage is on;
      server-only, from the Supabase dashboard.
- [ ] `MADAF_TRUSTED_DOCUMENT_STORAGE = enabled` — only if storage configured.
- [ ] `MADAF_TRUSTED_DOCUMENT_STORAGE_PROJECT_REF = bmqoajddxjmusaaflwma`
      — **required whenever storage is enabled** (M7C.1).

**FORBIDDEN — must never be set anywhere:**

- ❌ `NEXT_PUBLIC_SERVICE_ROLE` / any `NEXT_PUBLIC_*` service-role or key.
- ❌ `NEXT_PUBLIC_DEV_PHONE_OTP_CODE` / any `NEXT_PUBLIC` OTP code/token.
- ❌ `NEXT_PUBLIC_SMS_TOKEN` / any `NEXT_PUBLIC` SMS/provider secret.
- ❌ real SMS credentials in the repo (Twilio/Vonage/MessageBird/TextLocal).
- ❌ `MADAF_LEGAL_INVOICING_ENABLED=true`, `MADAF_LEGAL_NUMBERING_ENABLED=true`,
      `MADAF_TAX_PROVIDER_MODE=production`.
- ❌ any payment/legal-provider secret (no such phase exists yet).

**Status: SET ✅** (operator: public trio + 8 server-only flags + service-role
set; trusted storage enabled; **no forbidden vars**). Cross-checked by the
safety linter — see §7.

---

## 6. Storage / documents setup (Phase 6)

**Operator actions:**

- [x] `documents` + `product-images` buckets are **created by migration**
      (`20260710100000` / `20260705120000`), so with all 25 migrations applied
      they **exist on staging**; `documents` is created `public = false`
      (private, PDF-only, 10 MiB). Operator visual dashboard confirmation:
      _pending_.
- [x] **No authenticated storage policy** on `documents` (M5B.1 dropped them) —
      direct authenticated upload blocked; only the service role writes after
      the route authorizes. (Applied by migration.)
- [ ] Set `MADAF_TRUSTED_DOCUMENT_STORAGE=enabled` +
      `..._PROJECT_REF=bmqoajddxjmusaaflwma` + `SUPABASE_SERVICE_ROLE_KEY`
      (server-only) in **Vercel** to enable stored PDFs; otherwise the route
      safely streams (no storage).
- [ ] Smoke: generate a draft document PDF, download via signed URL (60s TTL).
      **No legal PDF / no legal issuing.** — PENDING (gated on admin login).

**Status: BUCKETS PRESENT (migration-applied; `documents` private).** Trusted-
storage env + PDF smoke PENDING (in Vercel + login).

---

## 7. Deployment-safety check (Phase 4)

The M7C safety linter is `src/lib/config/deployment-safety.ts` →
`assessDeploymentSafety(env, { treatAsDeploy })` (pure, non-throwing,
server-only, not run at build). It reports `{ ok, errors, warnings }` — run it
against the staging env **names/flags** and report **pass/fail + issue names
only** (never values).

**Manual usage (local, against a sanitized name-only env — do NOT paste secret
values):**

```bash
NODE_OPTIONS='--conditions=react-server' npx tsx -e "import('./src/lib/config/deployment-safety.ts').then(m=>{const r=m.assessDeploymentSafety({NEXT_PUBLIC_SUPABASE_URL:'https://<ref>.supabase.co',NEXT_PUBLIC_SUPABASE_ANON_KEY:'x',NEXT_PUBLIC_MADAF_DATA_MODE:'supabase',NEXT_PUBLIC_APP_URL:'https://<staging>',MADAF_AUTH_PRIMARY_METHOD:'phone',MADAF_TAX_PROVIDER_MODE:'disabled'},{treatAsDeploy:true});console.log('ok:',r.ok);console.log('errors:',r.errors);console.log('warnings:',r.warnings)})"
```

- [ ] Run against the intended staging config; **expected: `ok: true`**, no
      errors. Paste only `ok` + issue names below.

| Field | Result |
| --- | --- |
| `ok` | **true** ✅ |
| errors | none (`[]`) |
| warnings | none (`[]`) |

Run against the intended staging config (name-only, `treatAsDeploy: true`):
public trio + `NEXT_PUBLIC_APP_URL`, `MADAF_AUTH_PRIMARY_METHOD=phone`,
`MADAF_EMAIL_AUTH_ENABLED=true`, `MADAF_DEV_PHONE_OTP_ENABLED=false`, all legal
flags off, `MADAF_TAX_PROVIDER_MODE=disabled`, `MADAF_TRUSTED_DOCUMENT_STORAGE=
enabled` + project ref. No secret values used.

**Status: PASS ✅.**

---

## 8. Auth + Phone OTP setup (Phase 5)

**Operator actions (Supabase dashboard):**

- [x] Auth **Site URL** = `https://madaf-drab.vercel.app` (set).
- [x] Auth **Redirect URLs** set to the staging app URL (wildcard). Also added
      `NEXT_PUBLIC_APP_URL` + `NEXT_PUBLIC_SITE_URL` in Vercel and **redeployed
      successfully**.
- [ ] **Phone provider enabled**; SMS provider — **BLOCKED (no provider yet).**
- [ ] Review Auth **rate limits** — N/A until an SMS provider exists.
- [ ] Test with **one real staging phone number** — BLOCKED (no SMS provider).

**Confirm (staging invariants):**

- [x] The local dummy Twilio + `[auth.sms.test_otp]` config is **local-only** —
      **no `config push` was run**, so it does not govern the hosted project.
- [x] `MADAF_DEV_PHONE_OTP_ENABLED = false` in staging (operator confirmed) —
      the dev fake-OTP path does **not** work in staging.
- [x] No SMS secrets added to the repo.

**Reported (M7D.1):**

- **SMS provider: NONE yet → phone-OTP login is BLOCKED on staging.** Hosted
  Supabase sends real SMS and does not use the local `test_otp`; without a
  provider, no OTP is delivered, so `Phone provider` cannot be meaningfully
  enabled/used yet.
- Phone provider enabled: **no** (blocked on missing SMS provider).
- Rate limits / real-phone test: N/A until a provider exists.

**⚠️ Consequence: with phone-primary + no SMS provider +
`MADAF_EMAIL_AUTH_ENABLED=false` + `MADAF_DEV_PHONE_OTP_ENABLED=false`, there is
NO way to sign in to staging admin — so ALL authenticated smoke tests (§9) are
blocked.** Two ways to unblock (operator choice, see §12):
  1. Configure a real SMS provider (e.g. Twilio trial) → real phone OTP.
  2. Temporarily set **`MADAF_EMAIL_AUTH_ENABLED=true`** in Vercel (a documented
     knowing choice) → sign in via email/password to run the full smoke;
     phone-OTP itself stays BLOCKED until a provider is added.

**Status: BLOCKED (no SMS provider).** Phone OTP untestable this session.

---

## 9. First tenant + full smoke checklist (Phase 7) — PENDING, operator-run

> No live staging URL this session → **all boxes unchecked; run against staging
> and record pass/fail. Do not fabricate.**

**Auth**

- [ ] Open staging URL → phone-OTP login with a real test phone → succeeds.
- [ ] A session with **no membership** routes to **onboarding**.
- [ ] Create the first tenant/owner via onboarding → **admin dashboard** opens.

**Admin**

- [ ] Create category · manufacturer · product · inventory · customer.
- [ ] Create a **private shop link**.

**Storefront**

- [ ] Open the private link in a clean/incognito browser → browse → add to cart
      → submit order → success page.
- [ ] Admin sees the new order.

**Documents**

- [ ] Generate order request / delivery note / invoice **draft** → download.
- [ ] Invoice draft still shows **DRAFT** + "not a tax invoice"; **no** legal
      invoice generated.

**Roles / access**

- [ ] owner/admin access works.
- [ ] sales_rep scoping (if easy to create): sees only assigned customers.
- [ ] anon cannot reach `/admin`; non-member sees no tenant data.
- [ ] a private token only reaches the shop flow, nothing else.

**Legal (must remain OFF)**

- [ ] tax-settings page is the inert/safe config surface only.
- [ ] `legal_effective` stays false; no production provider mode; no payment.

**Smoke findings (M7D.1, email-fallback path):**

- ✅ Email login works · onboarding / account creation works · admin pages load
  · hosted Supabase mode active.
- ⛔→✅ **Product creation was BLOCKED** — a freshly-onboarded tenant had **zero
  categories** (category dropdown empty), and `create_product` requires a
  category that belongs to the tenant (`validate_product_payload`). Root cause:
  categories are per-tenant and were only ever seeded via `seed.sql` (for the
  demo tenant); a tenant created through onboarding got none, and hosted staging
  received migrations via `db push` (not `seed.sql`). **FIXED (code):** migration
  `20260715100000_seed_default_categories_on_tenant.sql` makes
  `create_tenant_with_owner` seed the standard 6 categories for the new tenant
  (mirrors `seed.sql`; no signature/types change; RLS untouched). Verified
  locally: onboarding now creates owner + 6 categories.
  **Operator action:** `supabase db push` the migration to staging, then
  **onboard a FRESH tenant** (existing pre-fix tenant is not backfilled) — a new
  email user → onboarding → 6 categories → product creation works.
- ⏳ **Nav feels slow (~1s/page) in hosted mode** — see §14 (P2 perf; primarily
  region latency, not an app bug).
- Remaining smoke (shop order → PDF → access/legal) re-run after a fresh
  category-having tenant exists.

**Status: PARTIAL — login/onboarding/admin OK; product creation fixed (needs
staging db push + fresh tenant); order/PDF/access/legal smoke pending.**

---

## 10. Monitoring / runbook (Phase 8)

Per [RUNBOOK_STAGING.md](RUNBOOK_STAGING.md). Choose or defer:

- [ ] Error reporting provider — _(chosen / **deferred → open P1**)_.
- [ ] Uptime monitor — _(chosen / **deferred → open P2**)_.
- [ ] SMS delivery monitoring (provider dashboard) — _(deferred → open P2)_.
- [ ] Supabase logs (Auth / Postgres / Storage) — where to check documented.
- [ ] Vercel logs (build + runtime) — where to check documented.

**Status: PENDING (defaults to deferred → tracked as open items in §12).**

---

## 11. Demo data & safety

- **No real customer data in staging.**
- **Do NOT** run `supabase/bootstrap-auth.sql` against staging (it seeds
  local demo **email** users; staging is phone-primary and must not carry demo
  credentials).
- Create the demo tenant via **phone-OTP onboarding**; seed catalog through
  `/admin`. No destructive hosted seed script.

---

## 12. Issues / open items

| # | Item | Severity | Status |
| --- | --- | --- | --- |
| 1 | **No SMS provider** → phone-OTP login BLOCKED (using email fallback for smoke) | P1 | open — operator |
| 2 | Product creation blocked (no categories on a fresh tenant) | P1 | **FIXED (code)** — migration `20260715…`; needs staging `db push` + fresh tenant |
| 3 | Hosted nav ~1s/page — see §14b perf audit | P2 | open — mostly region latency |
| 4 | Error reporting / uptime / SMS-delivery monitoring not configured | P1/P2 | open — operator choice |
| 5 | Real-phone OTP smoke needs a provider + live number | P1 | open — operator |
| 6 | Email invites need `MADAF_EMAIL_AUTH_ENABLED=true` (M7B limitation) | P2 | decision — operator |
| 7 | Category **editing/CRUD** not available (only auto-seeded starter set) | P2 | follow-up feature |
| 8 | Staging DB region is `ap-southeast-1` (Singapore) — far from Israel | P2 | consider `eu-central-1` for prod |

---

## 13. Rollback notes

Per [RUNBOOK_STAGING.md](RUNBOOK_STAGING.md) incident/rollback: disable the
Vercel deployment (or revert to a previous deployment), revoke/rotate the
staging env vars, rotate the Supabase keys if any leaked, disable the SMS
provider, restore a DB backup (hosted — never `db reset`), revoke tenant access
links, and record the incident. Staging is disposable — prefer redeploy over
in-place fixes.

---

## 14. Final staging verdict

**STAGING LIVE (email-fallback smoke in progress).** Supabase created + all 25
migrations applied (advisors clean); Vercel deployed green on `0a6f190` at
`https://madaf-drab.vercel.app` (login page verified serving); env set + safety
linter `ok`. Email login + onboarding + admin verified. **Product-creation
blocker fixed** (category-seeding migration — needs staging `db push` + a fresh
tenant). Phone OTP remains BLOCKED (no SMS provider). Remaining: order → PDF →
access/legal smoke on a fresh category-having tenant. No secrets committed;
legal/payment boundary unchanged (`legal_effective` hard-false, all M6 flags
off).

---

## 14b. Performance audit — hosted navigation ~1s/page (P2)

**Finding: primarily expected hosted latency, not an app bug.** Audit:

- **Region mismatch (main lever).** The staging DB is `ap-southeast-1`
  (Singapore); if the operator is in Israel, each Supabase round-trip is
  ~150–250ms RTT. **Recommendation:** for prod (and ideally a re-created
  staging), use a region near users, e.g. `eu-central-1` (Frankfurt) — this
  alone roughly halves per-request latency.
- **Dynamic SSR is inherent, not wasteful.** Admin pages use `cookies()` (auth)
  → server-rendered per request. Per navigation: **one** `getUser` + **one**
  `list_memberships` (both from `getSessionContext`, which is React
  `cache`-deduped per request — not repeated), then the page's data queries.
- **Data queries are already parallelized** — e.g. the dashboard runs
  `listOrders/listCustomers/listInventory/listProducts` in a single
  `Promise.all` (no waterfall). So app-side query shape is already reasonable.
- **Vercel cold starts** add latency on the first hit after idle (serverless
  spin-up) — independent of the app.
- **No `loading.tsx`** anywhere → navigations show no skeleton/spinner, so the
  latency *feels* worse than it is. **Optional safe win (P2):** add a lightweight
  `loading.tsx` (e.g. at the admin layout) for perceived speed. Not bundled with
  this fix to keep it focused.

**Verdict:** no blocking app performance bug. Biggest real improvement is the
**DB region**; secondary is optional loading skeletons. Tracked as P2 (§12 #3/#8)
— do not over-optimize.

---

## 14c. Latency remediation (M7D.2 + M7D.3)

- **M7D.2 — DB moved to Frankfurt (operator-done).** New staging project
  `madaf-staging-frankfurt` in **`eu-central-1`** replaces the Singapore one;
  migrations applied via `db push` (never reset), Vercel repointed at it. This
  cut the DB round-trip distance.
- **M7D.3 — pin Vercel Functions to Frankfurt (code).** Admin pages are
  dynamic/authenticated SSR, so if Vercel **Functions** still run far from the
  Frankfurt DB, each navigation still pays cross-region latency. Added
  **`vercel.json`** `{ "regions": ["fra1"] }` — the project-wide default
  function region (Vercel docs: *Configure Project Default Function Region*),
  keeping the **Node** runtime (Edge not used; PDF route stays `nodejs`). No app
  code / mock-build impact (`vercel.json` is read only by Vercel at deploy).
- **M7D.3 — perceived responsiveness.** Added `src/app/[locale]/admin/loading.tsx`
  — a lightweight, RTL-safe, no-data skeleton shown in the content area while an
  admin page renders (AdminShell/sidebar persists via the layout).
- **Smoke result: PENDING** a Vercel redeploy from `main` after this merges —
  record the subjective per-navigation feel (before Singapore ~1–2s → after
  Frankfurt DB + `fra1` functions) and any still-slow pages.

---

## 15. M7E — staging smoke bugfix pass

**Smoke PASS (operator):** email register/login, onboarding, add/edit product,
draft document generation, order → warehouse, navigation speed (post-M7D.3).

**Fixes shipped (branch `fix/M7E-staging-smoke-bugfixes`, not merged):**

- **A/B — product-detail & admin-order-detail error pages (P1). FIXED.** Root
  cause: the domain types use `""` for a missing id (an order with no linked
  customer → `customerId: ""`; `orders.customer_id` is nullable). A `sbGet*("")`
  then ran `.eq("id","")` on a UUID column → Postgres *"invalid input syntax for
  type uuid"* → a thrown error (500/error page) instead of a clean not-found.
  Fix: a `isUuid()` guard in every single-row `sb*` getter (`supabase-reads.ts`)
  returns `undefined`/`[]` for a blank/invalid id **without** querying. Confirmed
  at the DB (`''::uuid` errors) and the order-detail page now renders (customer
  falls back to `"—"`/snapshot). No RLS change; anon still short-circuits.
- **E — customer-facing public order reference. IMPLEMENTED.** Migration
  `20260716100000_order_public_ref.sql`: adds `orders.public_ref` (random,
  non-sequential `MDF-XXXXXXXX`, unambiguous alphabet), a `BEFORE INSERT` trigger
  that assigns a per-tenant-unique ref to every order, a backfill for existing
  rows, and a unique index. `create_order_request_from_token` now returns
  `public_ref` (same signature) so the **private-shop success screen shows the
  customer the random ref**, never the internal sequential `order_number`. Admin
  keeps `order_number` (sorting/search unaffected) and the order-detail header
  now also shows the customer ref for correlation (`mapOrder.publicRef`, i18n
  `admin.orders.detail.customerRef`). DB-probed: format/uniqueness/not-null on
  backfill + a fresh insert; db lint/advisors clean.
- **C/D — stores/customers + known-store checkout. ASSESSED.** The **token
  checkout already handles a known store correctly** — the private link is tied
  to a customer, `ShopView` shows `catalog.customer.name` and submits via the
  token (the DB derives the customer; the shopper never re-enters store
  identity). So D is essentially already met for the customer flow. The broader
  **C** UX-clarity ask (relabeling customers → "stores/customers", making the
  "Add store" action + private-link creation more obvious) is a wider i18n/UI
  change deferred to a focused follow-up to keep this pass on the P1 crashes +
  order ref. (Open item.)
- **F — image upload from device. SPLIT → M7F.** URL-only today. Device upload
  needs an upload UI + a tenant-safe storage path (the `product-images` bucket is
  private; uploads must go through a trusted server action, never a client
  service-role). Sized as its own phase per the task's split allowance.

**Boundary:** no RLS weakened, no service-role in client, no legal/payment
change (`legal_effective` hard-false, M6 flags off, drafts stay non-legal). New
migration only touches order numbering (additive column + trigger + one RPC
return value); no hosted `db reset`/`config push`.

---

## 16. M7E.1 — staging errors after M7E deploy (root cause = hosted state)

Operator reported product-detail (`/he/product/<valid-uuid>`) and admin-order-
detail (`/he/admin/orders/<valid-uuid>`) still throw a server error, and the
shop success still shows the **sequential** `MDF-1004`.

**Reproduction (local, supabase mode, real session):** hit all four pages with
a logged-in owner — product detail, admin order detail (valid customer **and**
NULL customer), and `/he/catalog` — **all returned HTTP 200, no error.** The
current M7E code renders correctly, including null-customer orders (customer →
`"—"`). The crash **does not reproduce with the current code**.

**Root cause = hosted state, not code:**
1. **The M7E migration is NOT applied to Frankfurt.** The success screen showing
   the sequential `MDF-1004` proves `create_order_request_from_token` is still
   the pre-M7E version → `20260716100000_order_public_ref` was never `db push`ed
   to `xcfjxgdfjvsqkhuiczu`.
2. **The Vercel deployment is very likely stale (pre-M7E guard).** A pre-M7E
   build has the *unguarded* getters, so a **null-customer order** → `getCustomer("")`
   → `.eq("id","")` on a uuid column → Postgres error → the exact server-error
   page; a null-category product → `getCategory("")` likewise. The M7E `isUuid`
   guard (already on `main`) fixes both, so a **current** deploy renders/notFounds
   cleanly — matching the local 200s.

**Operator actions to resolve (no code needed for the crashes):**
- `supabase db push` to Frankfurt (confirm STAGING first; never reset/config push)
  → applies `20260716100000` → customer then sees `MDF-XXXXXXXX`.
- **Redeploy Vercel from `main` with build cache OFF** → serves the M7E guard.
- Re-test the two URLs; if either still errors, capture the real error from
  **Vercel → madaf → Deployments → (the 9e4e7ca deploy) → Runtime Logs / the
  failing Function** (reproduce the URL, copy the message + `Digest`).

**M7E.1 code (defensive hardening, low-risk):** `productName` now falls back to
`""` if `translations.en` is missing; admin order detail drops a non-null
assertion on the item category (`ProductImage` tolerates an undefined category).
These make edge-case data render gracefully regardless of the above.

**`/he/catalog` without a token = EXPECTED, not a bug.** The catalog is
RLS-gated — an anonymous visitor gets zero tenant rows by design (the catalog is
never globally public); `CatalogView` already shows an `EmptyState`. Customers
order through their private `/shop/<token>` link, which is tied to their store.
No code change.

## 17. M7F — demo polish & missing core features

Full detail in `docs/product/M7F_DEMO_POLISH.md`. Summary of what affects
staging:

- **New migration** `20260717100000_customer_write_rpcs.sql` — adds
  `create_customer` / `update_customer` (owner/admin, RPC-only). Unblocks
  creating a store/customer from the app (previously seed-only), which the
  tokenized shop-link demo depends on for a fresh tenant.
- **Product image upload** now works on the create form (was edit-only); no
  storage/bucket change (reuses the private `product-images` bucket via a
  tenant-scoped staging path). No service_role.
- **`/catalog` without a token** now shows a clear private-link message
  instead of an empty grid (supabase mode only; mock stays the public demo).

**Operator steps (hosted — confirm STAGING first; never reset/config-push):**
1. `supabase db push` to Frankfurt (`xcfjxgdfjvsqkhuiczu`) — applies
   `20260717100000` **and** the still-pending `20260716100000` (M7E public
   ref). The latter is what makes the customer success screen show
   `MDF-XXXXXXXX` instead of the internal `MDF-N`.
2. Redeploy Vercel from the merged branch with **build cache OFF**; confirm
   the three detail routes still render `ƒ`.

No RLS weakened, no service_role in client, no legal/payment change,
`legal_effective` stays false.

### 17a. M7F.4 — uploaded product images in the private shop

Uploaded (private-bucket) product images now render on `/shop/<token>` via
short-lived (30 min) **signed** URLs. After the token is validated,
`signTokenProductImages` resolves the token's tenant server-side (trusted
service-role client, by `token_hash`) and signs **only** `<tenant_id>/products/`
objects; external URLs pass through; failures fall back to placeholders.

- **No migration, no storage-policy change, no new bucket, no new env var.**
- Reuses the existing trusted client (`getTrustedDocumentStorageClient`), so on
  staging it works with the **same** `MADAF_TRUSTED_DOCUMENT_STORAGE=enabled` +
  `..._PROJECT_REF` config the document PDFs already use. If unset, shops show
  placeholders for uploaded images (external URLs still render) — no crash.
- No service_role reaches the client; no cross-tenant image access (strict
  `<tenant_id>/products/` prefix on an authoritative tenant id).

**Operator:** no new steps beyond §17. If uploaded shop images should appear on
staging, ensure the trusted-storage env vars are set (already required for
document PDFs). No DB push needed for M7F.4.

## 18. M7G — customer order privacy + new-store signup

Full detail in `docs/product/M7G_CUSTOMER_ORDER_PRIVACY_STORE_SIGNUP.md`.

- **Customer order privacy (A):** customers now see ONLY the public ref
  (`MDF-XXXXXXXX`), never the internal sequential `order_number`. Fixed the
  draft-document order-ref (preview + PDF), the regular-checkout success page,
  and the document NUMBER (now `DOC-<publicRef>-X`). Documents stay non-legal
  drafts.
- **public_ref uniqueness (B):** re-verified sufficient (NOT NULL, unique per
  tenant, retry-on-collision, every path covered) — probed at 400 orders. No
  migration.
- **New-store signup (C):** owner/admin issue a tokenized `/[locale]/join/<token>`
  link; a store submits its details (no login, no catalog); the request lands
  PENDING on `/admin/customers/signup`; approve creates the customer.

**New migrations** (apply with `supabase db push` to Frankfurt
`xcfjxgdfjvsqkhuiczu` — confirm STAGING first; never reset/config-push):
1. `20260718100000_customer_facing_document_number.sql` — doc number from
   `public_ref` + a `(tenant_id, order_id, document_type)` unique.
2. `20260719100000_store_signup_links.sql` — `customer_signup_links` +
   `customer_signup_requests` tables + six RPCs (RLS owner/admin read, RPC-only
   writes, anon submit via token + rate limiter, no anon table access).

Then redeploy Vercel from the merged branch with **build cache OFF**; confirm
the three detail routes still render `ƒ`.

No RLS weakened (new tables are owner/admin-read + RPC-write only), no
service_role in client, no legal/payment change, `legal_effective` stays false.

## 19. M7H — shop link security, buying UX, showcase links, inventory

Full detail in `docs/product/M7H_SHOP_LINK_INVENTORY.md`.

- **A — Link regenerate fix:** a store now keeps exactly ONE live link;
  create/regenerate revoke ALL of the store's active links first, so old copied
  URLs die immediately.
- **B — Shop UX:** `/shop/<token>` gains search/filters, a read-only "Ordering
  for" banner, and a clearer cart.
- **C — Showcase links:** view-only `/showcase/<token>` (no ordering) with a
  "request store access" CTA; admin manages them on `/admin/customers/signup`.
- **D — Shop images:** the signing code was correct — hosted failure is the
  fail-closed trusted client. Set the envs below; added an actionable log.
- **E — Inventory:** delivering an order deducts stock once (ledger-guarded);
  insufficient stock blocks delivery; cancel doesn't deduct.

**New migrations** (apply with `supabase db push` to Frankfurt
`xcfjxgdfjvsqkhuiczu` — confirm STAGING first; never reset/config-push):
1. `20260720100000_revoke_links_for_customer.sql`
2. `20260720110000_deduct_inventory_on_delivery.sql`
3. `20260720120000_catalog_showcase_links.sql`

**Required Vercel envs for shop/showcase images (server-only):**
`MADAF_TRUSTED_DOCUMENT_STORAGE=enabled`,
`MADAF_TRUSTED_DOCUMENT_STORAGE_PROJECT_REF=xcfjxgdfjvsqkhuiczu`,
`SUPABASE_SERVICE_ROLE_KEY=<service_role key>` (never NEXT_PUBLIC). Same envs the
document PDFs already require; if unset, images show placeholders (external URLs
still render).

Then redeploy Vercel with **build cache OFF**; confirm the detail + token routes
(incl. `showcase/[token]`) render `ƒ`.

No RLS weakened, no service_role in client, no legal/payment change,
`legal_effective` stays false.
