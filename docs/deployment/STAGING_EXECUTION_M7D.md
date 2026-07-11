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

> **✅ SOURCE OF TRUTH — staging Supabase project (verified 2026-07-11).**
> Staging project name: **`madaf-staging-frankfurt`**; project ref:
> **`xcfjxgdfgjvsqkhuiczu`** (20 chars). Verified against **both** the Supabase
> CLI link (`supabase/.temp` linked-project metadata) **and** the live Vercel
> staging client configuration (the public `NEXT_PUBLIC_SUPABASE_URL` inlined in
> the deployed bundle → `https://xcfjxgdfgjvsqkhuiczu.supabase.co`). Earlier
> copies of this doc and the M7-era product notes carried two **incorrect**
> staging refs — one unrelated 20-character string, and one 19-character
> transcription typo of the correct ref (missing the `g`). Both were wrong and
> have all been corrected to `xcfjxgdfgjvsqkhuiczu` (2026-07-11). No secrets
> (keys/tokens/passwords) were read or recorded during verification.

| Field | Value (non-secret only) |
| --- | --- |
| Project name | `madaf-staging-frankfurt` |
| Project ref | `xcfjxgdfgjvsqkhuiczu` ✅ verified 2026-07-11 against the Supabase CLI link + the live Vercel client config |
| Project URL | `https://xcfjxgdfgjvsqkhuiczu.supabase.co` |
| Region | Frankfurt (`eu-central-1`) — EU region (name/`vercel.json` `fra1` confirm Frankfurt; an earlier copy that said `ap-southeast-1`/Singapore belonged to the wrong ref and was incorrect) |
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

**Status: MIGRATIONS APPLIED** (`madaf-staging-frankfurt`, ref `xcfjxgdfgjvsqkhuiczu`,
Frankfurt `eu-central-1`, staging-confirmed twice). At the M7D deploy `supabase
migration list` showed the then-current
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
- [ ] `NEXT_PUBLIC_APP_URL` — the canonical PUBLIC staging origin (e.g.
      `https://madaf-drab.vercel.app`). **MANDATORY, not optional (M8E.2):** it is
      the origin used to build every tokenized customer link (shop, showcase,
      store-signup, team-invite). Set it on **BOTH Production AND Preview** —
      each recipient opens an absolute link, and a per-deploy Vercel preview host
      is gated by Deployment Protection and would bounce them to the Vercel login.
      It must be the **stable public alias**, never the per-deploy
      `*-<hash>.vercel.app` / branch host. The value is public (no secret).
      Because `NEXT_PUBLIC_*` is inlined at **build time**, a **redeploy is
      required** after setting/changing it. `NEXT_PUBLIC_SITE_URL` is accepted as
      a fallback **only** when `NEXT_PUBLIC_APP_URL` is absent; if both are set
      they must resolve to the **same** origin (a mismatch is a hard error). The
      deployment-safety linter (§7) ERRORS if it is missing/invalid/loopback/a
      per-deploy host on a hosted Supabase deploy.

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
- [ ] `MADAF_TRUSTED_DOCUMENT_STORAGE_PROJECT_REF = xcfjxgdfgjvsqkhuiczu`
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
      `..._PROJECT_REF=xcfjxgdfgjvsqkhuiczu` + `SUPABASE_SERVICE_ROLE_KEY`
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

**M8E.2 — this assessment is now a REAL BUILD GATE.** `npm run build` runs
`npm run check:deploy-safety` (→ `scripts/check-deployment-safety.ts`) BEFORE
`next build`; a hosted Supabase build with a missing/invalid/conflicting/loopback/
preview-host canonical URL **exits nonzero and fails the build**. Zero-config
local/mock builds stay green. On Vercel the gate reads the auto-provided
`VERCEL_PROJECT_PRODUCTION_URL`, so a `*.vercel.app` canonical (e.g. the staging
alias) is allowed ONLY when it equals that production alias — the manual snippet
below therefore passes `VERCEL_PROJECT_PRODUCTION_URL` to mimic the real deploy.

**Manual usage (local, against a sanitized name-only env — do NOT paste secret
values):**

```bash
# The REAL build gate (same command `npm run build` runs before `next build`),
# fed a sanitized name-only env. Prints safe diagnostics; exits nonzero on any
# blocking issue. VERCEL_PROJECT_PRODUCTION_URL mimics the Vercel-provided value
# so a *.vercel.app canonical is accepted (it must equal the production alias).
VERCEL=1 NEXT_PUBLIC_MADAF_DATA_MODE=supabase \
  NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co NEXT_PUBLIC_SUPABASE_ANON_KEY=x \
  NEXT_PUBLIC_APP_URL=https://madaf-drab.vercel.app \
  VERCEL_PROJECT_PRODUCTION_URL=madaf-drab.vercel.app \
  npm run check:deploy-safety
```

- [ ] Run against the intended staging config; **expected: `ok: true`**, no
      errors. Paste only `ok` + issue names below. (A `*.vercel.app` canonical
      WITHOUT a matching `VERCEL_PROJECT_PRODUCTION_URL` is correctly rejected.)

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
   to `xcfjxgdfgjvsqkhuiczu`.
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
1. `supabase db push` to Frankfurt (`xcfjxgdfgjvsqkhuiczu`) — applies
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
`xcfjxgdfgjvsqkhuiczu` — confirm STAGING first; never reset/config-push):
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
`xcfjxgdfgjvsqkhuiczu` — confirm STAGING first; never reset/config-push):
1. `20260720100000_revoke_links_for_customer.sql`
2. `20260720110000_deduct_inventory_on_delivery.sql`
3. `20260720120000_catalog_showcase_links.sql`

**Required Vercel envs for shop/showcase images (server-only):**
`MADAF_TRUSTED_DOCUMENT_STORAGE=enabled`,
`MADAF_TRUSTED_DOCUMENT_STORAGE_PROJECT_REF=xcfjxgdfgjvsqkhuiczu`,
`SUPABASE_SERVICE_ROLE_KEY=<service_role key>` (never NEXT_PUBLIC). Same envs the
document PDFs already require; if unset, images show placeholders (external URLs
still render).

Then redeploy Vercel with **build cache OFF**; confirm the detail + token routes
(incl. `showcase/[token]`) render `ƒ`.

No RLS weakened, no service_role in client, no legal/payment change,
`legal_effective` stays false.

## 20. M7I — guest showcase ordering, inventory reservation, order editing

Full detail in `docs/product/M7I_GUEST_SHOWCASE_ORDERING_INVENTORY.md`.

- **A — Guest ordering:** `/showcase/<token>` is now ORDERABLE — an unknown
  store browses, adds to cart, and submits an order request with its store
  details (no login). Lands as `customer_id NULL` + `customer_snapshot`
  (`guest=true`), source `remote_customer`. Admin can **Create shop from this
  order** or keep it one-time. New RPCs `create_order_from_showcase_token`
  (anon, rate-limited) and `create_customer_from_order` (owner/admin).
- **B — Shop images (REAL fix, corrects §19-D):** the failure was CODE, not
  config — image signing borrowed the documents-PDF client (fail-closed behind
  `MADAF_TRUSTED_DOCUMENT_STORAGE` + host pin). New dedicated server-only
  service-role image client needs ONLY `SUPABASE_SERVICE_ROLE_KEY`. Verified
  end-to-end locally (`PROBE_PASS`; edit- and create-mode paths both sign,
  cross-tenant excluded).
- **C — Inventory reservation (corrects §19-E):** stock is reserved on
  **confirm/preparing**, not on delivery; insufficient stock blocks the
  transition with a clear error; cancel restores once. Ledger-guarded
  (`order_reserved` / `order_reservation_released`).
- **D — Order editing:** `update_order_items` (owner/admin) edits lines/notes
  with inventory reconciliation when reserved; delivered/cancelled locked.
- **E — Searchable shop picker** (name/contact/phone/city/address).

**New migrations** (apply with `supabase db push` to Frankfurt
`xcfjxgdfgjvsqkhuiczu` — confirm STAGING first; never reset/config-push):
1. `20260721100000_inventory_reservation_lifecycle.sql`
2. `20260721110000_showcase_guest_order.sql`
3. `20260721120000_update_order_items.sql`

**Vercel envs:** no new envs. For shop/showcase images, `SUPABASE_SERVICE_ROLE_KEY`
(server-only) is now the ONLY requirement — `MADAF_TRUSTED_DOCUMENT_STORAGE*`
stays for documents-PDF only and no longer affects images. Redeploy with **build
cache OFF**; confirm token/detail routes render `ƒ`.

No RLS weakened, no service_role in client, no legal/payment change,
`legal_effective` stays false. No hosted db reset, no config push.

## 21. M8A — full product QA, stabilization & route guard

Full detail in `docs/product/M8A_FULL_QA_STABILIZATION.md`.

- **Audit:** multi-agent QA over 10 areas. 0 P0; 2 P1 root causes (both
  fixed here); P2/P3 catalogued (top P2s fixed, rest = M8B backlog).
- **P1a — rate limiter restored:** M7E had silently dropped the M4D
  anonymous-token rate limiter from `create_order_request_from_token` (the
  only anon WRITE endpoint). Restored with the public_ref return intact.
- **P1b — inactive-product crash class:** deactivating a tracked product
  crashed `/admin/inventory` and could 500 `/admin`. All non-null-asserted
  lookups guarded; admin pages use includeInactive lookup maps.
- **P2 batch:** document-number backfill (pre-M7G rows leaked the internal
  sequence; stale stored PDFs cleared), product-edit no longer wipes
  barcode/descriptions, frozen demo clocks removed (month KPI, expiring-soon),
  per-row low-stock threshold honored, invite `?next=` kept through email
  signup, `/join` dead links show an invalid screen at GET time, order-editor
  notes clear properly, regenerate keeps link expiry, mobile admin gains
  locale+logout, token pages are `noindex`, stale "view-only" showcase copy
  fixed in ar/he/en.
- **Guard:** `npm run build` now fails if any critical detail/token route
  becomes SSG (`scripts/check-dynamic-routes.mjs`).

**New migrations** (apply with `supabase db push` to Frankfurt
`xcfjxgdfgjvsqkhuiczu` — confirm STAGING first; never reset/config-push):
1. `20260722100000_restore_shop_order_rate_limit.sql`
2. `20260722110000_backfill_document_numbers.sql` (renumbers pre-M7G docs,
   clears their stale stored PDFs — regenerated on next download)
3. `20260722120000_preserve_descriptions_on_product_update.sql`

**Vercel:** no new envs. Redeploy with **build cache OFF**; the build output
must end with the route-guard OK line.

No RLS weakened, no service_role in client, no legal/payment change,
`legal_effective` stays false. No hosted db reset, no config push.

## 22. M8B — inventory operations, duplicate customer guard, dashboard alerts

Full detail in `docs/product/M8B_INVENTORY_OPS_DASHBOARD_ALERTS.md`.

- **Movement history:** `/admin/inventory/movements` — owner/admin view of
  the append-only stock ledger (search, reason + in/out filters; sales_rep
  gets zero rows via RLS; mock shows the empty state).
- **Manual stock adjustment:** `adjust_inventory_stock` RPC (owner/admin,
  allowlisted reasons, optional note, FOR UPDATE, negative result blocked
  MDF32, ledger row with created_by, first adjustment starts tracking an
  untracked product) + inline per-row form on `/admin/inventory`. Ledger:
  `order_id` now nullable + capped `note` column — order reconciliation
  unaffected (regression-probed).
- **Duplicate customer guard:** tenant-scoped phone/name match warns before
  guest-order promotion, signup approval and manual create; explicit
  confirm-anyway; guest orders can instead be LINKED to the existing store
  via the new `link_order_to_customer` RPC (owner/admin, unlinked orders
  only, snapshot preserved).
- **Dashboard alerts:** pending guest orders / pending signup requests
  (owner/admin) / low-stock cards with links and all-clear states.
- **Customers search:** `/admin/customers` searches name/contact/phone/city
  (3 locales)/address.

**New migrations** (apply with `supabase db push` to Frankfurt
`xcfjxgdfgjvsqkhuiczu` — confirm STAGING first; never reset/config-push):
1. `20260723100000_manual_inventory_adjustments.sql`
2. `20260723110000_link_order_to_customer.sql`

**Vercel:** no new envs. Redeploy with **build cache OFF**; the build must
end with the route-guard OK line.

No RLS/policy change (ledger read stays owner/admin), anon revoked on both
new RPCs, no direct table writes, no service_role in client, no legal/
payment change, `legal_effective` stays false. No hosted db reset, no config
push.

## 23. M8C — operations polish, CSV exports, customer lifecycle

Full detail in `docs/product/M8C_OPERATIONS_EXPORTS_CUSTOMER_LIFECYCLE.md`.

- **Orders:** source + date-range filters, phone search, owner/admin CSV
  export of the filtered rows (internal number allowed — admin-only file);
  `?status=` deep links from the dashboard.
- **Products:** owner/admin CSV export (incl. stock + low-stock columns).
- **Movements:** date-range + manual filters, load-more pagination (500/page,
  RLS-scoped action), CSV export of the filtered loaded rows.
- **Customer lifecycle:** `customers.is_active` + `set_customer_active`
  (owner/admin). `_resolve_token` rejects inactive stores' links (catalog AND
  ordering, P0005); `insert_customer_access_link` refuses new links (MDF33);
  `/shop/<token>` shows a dedicated "store deactivated" message; picker/
  lists/duplicates mark inactive; reactivation restores the same link.
  No hard delete; history preserved. Known gap: admin-side ordering for an
  inactive store is picker-disabled only (documented).
- **Dashboard:** needs-confirmation + in-preparation cards (deep-linked),
  today's sales value metric.

**New migrations** (apply with `supabase db push` to Frankfurt
`xcfjxgdfgjvsqkhuiczu` — confirm STAGING first; never reset/config-push):
1. `20260724100000_customer_active_lifecycle.sql`
2. `20260724110000_inactive_store_hardening.sql` (review follow-up: MDF34
   inactive-order block on all channels + token rate-limiter fix)

**Vercel:** no new envs. Redeploy with **build cache OFF**; the build must
end with the route-guard OK line.

No RLS/policy change, anon revoked on the new RPC, no direct table writes,
no service_role in client, no legal/payment change, `legal_effective` stays
false. No hosted db reset, no config push.

## 24. M8D — server-side ops polish, localized exports, role UX

Full detail in `docs/product/M8D_OPS_POLISH_PAGINATION_ROLE_UX.md`.
**No migrations — pure app-layer.**

- **Movements:** filters (date/reason/direction/manual/product search) now run
  in the DB query (RLS owner/admin), deterministic order + load-more
  pagination; sales_rep 0 rows, anon denied.
- **Orders:** deep-link params (?status=confirmed,preparing multi-status,
  ?source, ?guest=true) + clear-filters; dashboard cards now link with counts
  that MATCH their filtered destination.
- **CSV:** localized headers (ar/he/en) for orders/products/movements;
  formula-injection defense + BOM intact.
- **Role UX:** sales_rep sees read-only order status, no product/manufacturer
  add-edit, no movements export — backend RPC gates UNCHANGED (UI-only).
- **Low-stock:** dashboard/sidebar link to /admin/inventory?low=1; inactive
  products excluded from count AND list.

**Migrations:** none in M8D. Redeploy Vercel with **build cache OFF**; build
must end with the route-guard OK line. (The M8C `20260724*` migrations remain
the outstanding hosted `supabase db push` step if not already applied.)

No RLS/policy/grant change, no service_role in client, no legal/payment
change, `legal_effective` stays false. No hosted db reset, no config push.

## 25. M8E — scale polish, customer pagination, branding, document fidelity

Full detail in `docs/product/M8E_SCALE_POLISH_CUSTOMER_BRANDING_DOCS.md`.
**One additive migration** `20260725100000_tenant_business_profile.sql`.

- **Exports (M8E.1):** filtered exports now cover ALL matching rows up to a cap
  — movements via a server-side paging action (`exportMovementsAction`, cap
  10,000), orders/products via a client cap guard (5,000). A cap warning shows
  when reached. Formula-injection defense + localized headers + BOM intact.
- **Customers (M8E.2):** `/admin/customers` search + facets (active/inactive,
  has/no private link) + pagination run in the DB (RLS tenant-scoped);
  deep-linkable `?q=&status=&link=`. sales_rep/anon see nothing cross-tenant.
- **Manufacturer logo (M8E.3):** upload to the existing private product-images
  bucket under `<tenant>/manufacturers/…` (no new bucket/migration); signed on
  read for admin + anon storefront; owner/admin only; 2 MB / MIME / magic-byte
  validated.
- **Business profile (M8E.4):** new `/admin/settings/business` (owner/admin)
  edits the tenant display identity (name/phone/email/address/legal/company id/
  logo) + a NON-LEGAL display VAT rate. Logo upload under `<tenant>/branding/…`.
- **Document fidelity (M8E.5):** the HTML preview now uses the stored order
  totals (matches the PDF), shows guest snapshots (not "—"), and renders the
  tenant logo. DRAFT watermark + "not a tax invoice" notice unchanged.

**Migrations:** push `20260725100000_tenant_business_profile.sql` with
`supabase db push` (additive — all new columns nullable, safe on existing
rows). Then redeploy Vercel with **build cache OFF**.

No RLS loosened, no table write re-enabled, no anon/public read added, no
service_role in client, no new bucket, no legal/payment change,
`legal_effective` stays false. No hosted db reset, no config push.

## 26. M8E.1 — logo upload hotfix + logo visibility

Full detail in `docs/product/M8E_SCALE_POLISH_CUSTOMER_BRANDING_DOCS.md`
("M8E.1" section). **No migration.**

- Fixes the logo-upload hang (`try/catch/finally` in every upload handler) and
  raises the Server Action body limit to **6MB** in `next.config.ts` (the 1MB
  default was smaller than the 2/5MB image caps, so valid >1MB uploads were
  rejected). Adds a distinct "invalid/corrupt" error + a "current image kept"
  reassurance + client-side pre-validation.
- Surfaces the tenant logo in the admin shell (every page), document preview,
  and shop/showcase headers (server-only own-tenant signing), and the
  manufacturer logo in product cards + filter chips.

**Migrations:** none. Redeploy Vercel with **build cache OFF**; the build must
end with the route-guard OK line. No RLS change, no new bucket, product-images
stays private, no legal/payment change, `legal_effective` stays false. No
hosted db reset, no config push.
