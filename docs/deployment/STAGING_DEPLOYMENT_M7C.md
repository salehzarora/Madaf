# Staging Deployment Guide (M7C)

> **Scope & safety.** This guide prepares a **staging** deployment of Madaf on
> Vercel + a **hosted Supabase staging project**. It is **documentation +
> config only** — it deploys nothing automatically and commits **no secrets**.
> Legal invoicing stays OFF (`legal_effective` hard-false), payments stay
> absent, and the dev fake-OTP path is disabled in staging. Do **not** treat
> staging as production and do **not** put real customer data in it.
>
> Operational procedures (monitoring, failure modes, rollback, demo data) live
> in [RUNBOOK_STAGING.md](RUNBOOK_STAGING.md).

Related: [../AUTH_AND_ACCESS_MODEL.md](../AUTH_AND_ACCESS_MODEL.md) ·
[../FUTURE_BACKEND_HANDOFF.md](../FUTURE_BACKEND_HANDOFF.md) ·
[../PRODUCT_READINESS_AUDIT_M7A.md](../PRODUCT_READINESS_AUDIT_M7A.md) ·
[../legal-invoicing/PRODUCTION_ACTIVATION_REVIEW_CHECKLIST.md](../legal-invoicing/PRODUCTION_ACTIVATION_REVIEW_CHECKLIST.md)

---

## 1. Required services

| Service | Purpose | Notes |
| --- | --- | --- |
| **GitHub repo** | source + CI (`.github/workflows/ci.yml`) | CI runs lint/build/audit on **Node 22**, no secrets |
| **Vercel project** | hosts the Next.js app | build = `next build`; framework auto-detected |
| **Supabase staging project** | hosted Postgres + Auth + Storage | SEPARATE project from any future production |
| **SMS provider** (Twilio/MessageBird/Vonage/…) **or Send SMS Hook** | phone-OTP delivery | credentials live in the **Supabase dashboard/secrets**, never in the repo/Vercel client env |
| **Error reporting / monitoring** | crash + uptime visibility | placeholder — see RUNBOOK §Monitoring |
| **Domain or Vercel URL** | app origin for auth redirects | a `*.vercel.app` URL is fine for staging |

Madaf uses the **local Supabase stack only** in dev. Staging is the **first
hosted** environment; there is still **no production project** in this phase.

---

## 2. Required environment variables (Vercel project settings)

Set these in the Vercel project (Production/Preview as appropriate). **Only the
three `NEXT_PUBLIC_*` values below are client-exposed; everything else is
server-only.**

| Variable | Example / value | Scope | Notes |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_MADAF_DATA_MODE` | `supabase` | client | anything but `supabase` = mock |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<ref>.supabase.co` | client | the **hosted staging** URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `<staging anon/publishable key>` | client | anon key only (RLS-scoped) |
| `SUPABASE_SERVICE_ROLE_KEY` | `<staging service-role key>` | **server** | bypasses RLS — server-only, never `NEXT_PUBLIC` |
| `NEXT_PUBLIC_APP_URL` | `https://madaf-staging.vercel.app` | client | app origin (for links/redirect sanity) |
| `MADAF_AUTH_PRIMARY_METHOD` | `phone` | server | phone OTP is primary |
| `MADAF_EMAIL_AUTH_ENABLED` | `false` (or `true` if email invites needed) | server | server-enforced email/password policy (M7B.1) |
| `MADAF_DEV_PHONE_OTP_ENABLED` | **unset / `false`** | server | the fake-OTP path — must be OFF in staging |
| `MADAF_TRUSTED_DOCUMENT_STORAGE` | `enabled` | server | to store PDFs on hosted Supabase |
| `MADAF_TRUSTED_DOCUMENT_STORAGE_PROJECT_REF` | `<ref>` | server | **required whenever storage is `enabled`** — pins storage to the staging project |
| `MADAF_LEGAL_INVOICING_ENABLED` | **unset / `false`** | server | legal stays OFF |
| `MADAF_TAX_PROVIDER_MODE` | **unset / `disabled`** | server | never `production` |
| `MADAF_LEGAL_NUMBERING_ENABLED` | **unset / `false`** | server | legal numbering OFF |

Everything with a default OFF value can simply be left unset. The optional
server-only linter `assessDeploymentSafety()`
(`src/lib/config/deployment-safety.ts`) flags the dangerous combinations below.

### 3. Forbidden environment variables (never set these)

- ❌ `NEXT_PUBLIC_SERVICE_ROLE` / any `NEXT_PUBLIC_*` containing a service-role
  key, secret, `AUTH_TOKEN`, private key, or `SMS`/`TWILIO` credential.
- ❌ `NEXT_PUBLIC_DEV_PHONE_OTP_CODE` (or any `NEXT_PUBLIC` OTP code).
- ❌ SMS provider secrets in the **Vercel/client** env — they belong in the
  **Supabase dashboard/secrets** only.
- ❌ `MADAF_TAX_PROVIDER_MODE=production` or any legal production provider
  secret (there is no certified integration; it is clamped to `disabled`).
- ❌ Any payment/processor secret — there is no payment phase.
- ❌ `MADAF_DEV_PHONE_OTP_ENABLED=true` in staging/production.

---

## 4. Supabase staging setup checklist

- [ ] **Create a staging project** (separate from any production). Record the
      project ref and the API URL (`https://<ref>.supabase.co`).
- [ ] **Push migrations safely** — from a machine with the repo + CLI:
      `supabase link --project-ref <ref>` then `supabase db push` (applies
      `supabase/migrations/*` in order). Do **not** `db reset` a hosted project.
- [ ] **Verify all migrations applied** — `supabase migration list` shows the
      full set through `20260714120000_sandbox_archival_signing.sql`.
- [ ] **Run advisors/lint against staging** — `supabase db lint` and check the
      dashboard **Advisors** tab (Security + Performance) → no critical findings.
- [ ] **Create the private storage buckets** — `documents` and `product-images`,
      both **private** (`public = false`). (Local `config.toml` defines them; on
      hosted, create them via dashboard/SQL to match.)
- [ ] **Verify storage policies** — the `documents` bucket has **no**
      authenticated policies (service-role-only writes, M5B.1); `product-images`
      keeps its scoped policies. Confirm no public bucket policy exists.
- [ ] **Configure Auth Site URL** = the staging origin (e.g.
      `https://madaf-staging.vercel.app`).
- [ ] **Configure Auth Redirect URLs** = the staging origin (+ any preview
      origins you use). Mismatches cause silent auth failures.
- [ ] **Enable the Phone provider** (Auth → Providers → Phone).
- [ ] **Configure the SMS provider (or Send SMS Hook)** with credentials **in
      the Supabase dashboard/secrets only** — never in the repo or Vercel client
      env. The repo's local dummy Twilio config (`supabase/config.toml`) is
      **local-only** and is NOT a staging provider.
- [ ] **Review Auth rate limits** (SMS sent/hour, OTP verifications, sign-in/
      sign-up per 5 min) and the provider's own spend caps.
- [ ] **Verify a real phone login** end-to-end with a real staging phone number
      (see §7 / RUNBOOK smoke).
- [ ] **Confirm no dev fake OTP** — `MADAF_DEV_PHONE_OTP_ENABLED` is unset; the
      fake path is hard-off in production builds and on non-local URLs regardless.
- [ ] **Bootstrap/first owner** — do NOT run `supabase/bootstrap-auth.sql`
      (demo email users) against staging; create the first owner via phone OTP
      (§6).

---

## 5. Vercel setup checklist

- [ ] **Connect the GitHub repo** to a new Vercel project.
- [ ] **Framework**: Next.js (auto-detected). **Build command**: `next build`
      (default). **Install**: `npm ci`. **Output**: default (`.next`).
- [ ] **Set environment variables** (§2) for Production and Preview. Keep
      server-only vars unchecked for "expose to browser".
- [ ] **Configure the domain / preview URLs**; keep them in sync with Supabase
      Auth Site/Redirect URLs (§4).
- [ ] **Trigger a build** and confirm it succeeds (216 static pages + the
      dynamic auth/admin/shop routes).
- [ ] **Route smoke** — `/he`, `/ar`, `/en`, `/he/login` (phone OTP form),
      `/he/admin` (redirects to login when logged out).
- [ ] **Server actions** — phone OTP send/verify, tenant create, order create
      succeed (they run server-side; no token reaches the browser).
- [ ] **Phone OTP login** — sign in with a real staging number and land on the
      admin dashboard.
- [ ] **Admin dashboard after login** — KPIs, lists, and the tenant switcher
      render for the signed-in member.

---

## 6. First tenant setup checklist (staging)

- [ ] **Create the first owner account via phone OTP** at `/he/login` (a real
      staging phone number; no email/password needed).
- [ ] **Create the tenant** at `/onboarding` (tri-lingual supplier names) — the
      creator becomes `owner`.
- [ ] **Add catalog** — manufacturers, categories, products, inventory via
      `/admin`.
- [ ] **Create a private shop link** for a test customer (`/admin/customers` →
      links). Copy the token (shown once).
- [ ] **Place a test order** through `/shop/<token>` (no login).
- [ ] **Generate draft documents** from the order detail (order request /
      delivery note / **invoice DRAFT**).
- [ ] **Verify document downloads** — short-lived signed URLs stream the PDFs;
      invoice drafts carry the DRAFT watermark + "not a tax invoice" notice.
- [ ] **Verify tax/legal stays inactive** — `/admin/settings/tax` shows the
      inert status; nothing is issued; `legal_effective` remains false (§Legal).

---

## 7. Phone OTP staging readiness (Scope E)

- Hosted Supabase must have the **Phone provider enabled** and an **SMS provider
  (or Send SMS Hook)** configured **in the dashboard/secrets**.
- The repo's `supabase/config.toml` Twilio block is a **local-only dummy** (no
  real send); it does not apply to a hosted project.
- `MADAF_DEV_PHONE_OTP_ENABLED` must be **false/unset** in staging (also hard-off
  in production builds / non-local URLs by construction — M7B/M7B.1).
- **Email/password policy** (M7B.1): decide `MADAF_EMAIL_AUTH_ENABLED`. In
  phone-primary staging it defaults **off** (server-enforced: `signInAction`/
  `signUpAction` reject, not just hidden). Set it `true` only if you rely on the
  email-based team-invite flow (a phone-only account can't accept an email
  invite yet — see AUTH_AND_ACCESS_MODEL §2b).
- **Auth redirect / site URLs** must match the deployed origin.
- **Rate limits** reviewed (Supabase `[auth.rate_limit]` equivalents + provider
  caps).
- **Real-phone smoke**: send OTP → receive SMS → verify → land on admin; wrong
  code rejected. (See RUNBOOK.)

---

## 8. Storage / document readiness (Scope F)

- **Private `documents` bucket is required** (`public = false`). PDFs are served
  via **short-lived signed URLs** (documents: **60s** TTL,
  `src/lib/data/document-storage.ts`).
- **Stored PDFs use the trusted server-only path** — uploads/reads run through
  `src/lib/data/trusted-document-storage.ts` with the service-role key, **after**
  the route authorizes the request (RLS order read + `create_order_document` +
  `set_document_storage`).
- **No direct authenticated upload** — the `documents` bucket has no
  authenticated storage policies (M5B.1); only the service role writes.
- **Exact-path validation** — `set_document_storage` requires the object path to
  equal the DB-derived `<tenant>/documents/<order>/<type>/<id>_<locale>.pdf`
  (rejects mismatched tenant/order/type/id/locale, traversal, non-.pdf, blank).
- **Hosted opt-in** — set `MADAF_TRUSTED_DOCUMENT_STORAGE=enabled`. When
  enabled, `MADAF_TRUSTED_DOCUMENT_STORAGE_PROJECT_REF=<ref>` is **always
  required** (the safety linter errors if it is missing/blank) — it pins the
  service-role storage client so it can never target an arbitrary project. If
  unset/misconfigured, the route **falls back to streaming** the freshly-
  rendered PDF (no storage) — safe, never errors.
- **Staging smoke** — place a test order, generate each draft document, confirm
  the signed-URL download works and the DRAFT/"not a tax invoice" markings show.

---

## 9. Legal stack boundary in staging (Scope G)

**All M6 legal flags stay OFF in staging. Nothing legal is issued.**

- [ ] `MADAF_LEGAL_INVOICING_ENABLED` unset/false.
- [ ] `MADAF_TAX_PROVIDER_MODE` unset/`disabled` (never `production` — it is
      clamped to `disabled` regardless).
- [ ] `MADAF_LEGAL_NUMBERING_ENABLED` unset/false; the DB kill switch
      `legal_numbering_settings.enabled` stays `false` (service-role-only).
- [ ] `legal_effective` remains **hard-false** — 4 CHECK constraints make a
      legally-effective row structurally impossible; do not alter them.
- [ ] No legal issuing UI/route/action is exposed; the sandbox
      provider/orchestration/archival modules stay dormant.
- [ ] No payment package, no legal PDF route.
- [ ] The
      [PRODUCTION_ACTIVATION_REVIEW_CHECKLIST](../legal-invoicing/PRODUCTION_ACTIVATION_REVIEW_CHECKLIST.md)
      **must** be executed and signed by qualified tax + legal reviewers before
      any legal-effective work — staging does not change this.

---

## 10. Optional: run the deployment safety linter

`src/lib/config/deployment-safety.ts` exports `assessDeploymentSafety(env,
{ treatAsDeploy })` — a **pure, non-throwing** check that returns `{ ok,
errors, warnings }`. It keeps the **`NEXT_PUBLIC` surface tight**: only a small
allowlist (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`NEXT_PUBLIC_MADAF_DATA_MODE`, `NEXT_PUBLIC_APP_URL`/`NEXT_PUBLIC_SITE_URL`) is
expected — any other `NEXT_PUBLIC_*` whose name looks secret (broad markers:
`SERVICE_ROLE`/`SECRET`/`TOKEN`/`OTP`/`CODE`/`SMS`/`PRIVATE`/`PASSWORD`/`API_KEY`/
`ACCESS_KEY`/`BEARER`/`JWT`/`TWILIO`/`VONAGE`/`MESSAGEBIRD`/`TEXTLOCAL`/…) is an
**error**, and any other unknown `NEXT_PUBLIC_*` is a **warning**. It also flags
an enabled legal flag, a non-`disabled`/`sandbox` provider mode, an enabled dev
fake-OTP path in a deploy, a local Supabase URL in a deploy,
`MADAF_TRUSTED_DOCUMENT_STORAGE=enabled` **without a project ref** (always
required), and missing Supabase/app-URL config. It is **not** run at build time
(so the zero-env mock build never breaks); call it from an ops health check or a
one-off script. Example (local):

```bash
NODE_OPTIONS='--conditions=react-server' npx tsx -e "import('./src/lib/config/deployment-safety.ts').then(m=>console.log(m.assessDeploymentSafety(process.env,{treatAsDeploy:true})))"
```
