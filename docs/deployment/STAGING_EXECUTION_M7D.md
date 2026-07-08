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
| Execution started | 2026-07-08 (session) |
| Deploying commit | `611e0c1` (main HEAD at branch cut) — record the exact deployed SHA here |
| Branch | `infra/M7D-execute-staging-deploy` (docs only) |
| Operator | _(fill in)_ |
| Overall status | **PREPARED — awaiting operator provisioning** |

**Current session did NOT provision any hosted service.** Staging Supabase and
Vercel are **not set up yet**; every hosted step below is **PENDING (operator
action required)**. No live smoke test was run — results are recorded, not
fabricated.

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
| Project ref | _(fill in — e.g. `abcd…`; NOT a key)_ |
| Project URL | _(fill in — `https://<ref>.supabase.co`)_ |
| Region | _(fill in)_ |
| Is this the STAGING (not production) project? | ☐ confirmed |

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

**Status: PENDING.**

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
| Vercel project name | _(fill in)_ |
| Staging URL | _(fill in — e.g. `https://madaf-staging.vercel.app`)_ |
| Node version | 22 |

**Status: PENDING.**

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
- [ ] `MADAF_EMAIL_AUTH_ENABLED = false` (set `true` **only** if staging must
      accept email team invites — a knowing choice; see §8).
- [ ] `MADAF_DEV_PHONE_OTP_ENABLED = false` (must be off in staging).
- [ ] `MADAF_LEGAL_INVOICING_ENABLED = false`.
- [ ] `MADAF_LEGAL_NUMBERING_ENABLED = false`.
- [ ] `MADAF_TAX_PROVIDER_MODE = disabled` (never `production`).
- [ ] `SUPABASE_SERVICE_ROLE_KEY` — **only** if trusted document storage is on;
      server-only, from the Supabase dashboard.
- [ ] `MADAF_TRUSTED_DOCUMENT_STORAGE = enabled` — only if storage configured.
- [ ] `MADAF_TRUSTED_DOCUMENT_STORAGE_PROJECT_REF = <staging ref>` — **required
      whenever storage is enabled** (M7C.1).

**FORBIDDEN — must never be set anywhere:**

- ❌ `NEXT_PUBLIC_SERVICE_ROLE` / any `NEXT_PUBLIC_*` service-role or key.
- ❌ `NEXT_PUBLIC_DEV_PHONE_OTP_CODE` / any `NEXT_PUBLIC` OTP code/token.
- ❌ `NEXT_PUBLIC_SMS_TOKEN` / any `NEXT_PUBLIC` SMS/provider secret.
- ❌ real SMS credentials in the repo (Twilio/Vonage/MessageBird/TextLocal).
- ❌ `MADAF_LEGAL_INVOICING_ENABLED=true`, `MADAF_LEGAL_NUMBERING_ENABLED=true`,
      `MADAF_TAX_PROVIDER_MODE=production`.
- ❌ any payment/legal-provider secret (no such phase exists yet).

**Status: PENDING.**

---

## 6. Storage / documents setup (Phase 6)

**Operator actions:**

- [ ] Confirm the **private** `documents` bucket exists (public = false). The
      `documents` and `product-images` buckets are private by design.
- [ ] Confirm **no authenticated storage policy** on `documents` (M5B.1 dropped
      them) — direct authenticated upload must be blocked; only the service role
      writes, after the route authorizes.
- [ ] Set `MADAF_TRUSTED_DOCUMENT_STORAGE=enabled` +
      `..._PROJECT_REF=<staging ref>` + `SUPABASE_SERVICE_ROLE_KEY` (server-only)
      to enable stored PDFs; otherwise the route safely streams (no storage).
- [ ] Smoke: generate a draft document PDF, download via signed URL (60s TTL),
      confirm expiry behavior. **No legal PDF / no legal issuing.**

**Status: PENDING** (needs live staging).

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
| `ok` | _(fill in)_ |
| errors | _(names only)_ |
| warnings | _(names only)_ |

**Status: PENDING.**

---

## 8. Auth + Phone OTP setup (Phase 5)

**Operator actions (Supabase dashboard):**

- [ ] Auth **Site URL** = the staging app URL.
- [ ] Auth **Redirect URLs** = staging app URL + any auth callback/login paths.
- [ ] **Phone provider enabled**; SMS provider (Twilio/etc.) configured in the
      **dashboard/secrets only**.
- [ ] Review Auth **rate limits** (`sms_sent`, `token_verifications`,
      `sign_in_sign_ups`) + provider spend caps.
- [ ] Test with **one real staging phone number**.

**Confirm (staging invariants):**

- [ ] The local dummy Twilio + `[auth.sms.test_otp]` config is **local-only** —
      it does not govern the hosted project.
- [ ] `MADAF_DEV_PHONE_OTP_ENABLED = false` — the dev fake-OTP path does **not**
      work in staging (also hard-off for prod builds + non-local URLs).
- [ ] Email fallback policy is intentional: `MADAF_EMAIL_AUTH_ENABLED=false`
      unless staging needs email invites (then set `true` knowingly — phone-only
      accounts still can't accept email invites; M7B limitation).

**Status: PENDING.**

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

**Status: PENDING.**

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
| 1 | Hosted Supabase + Vercel not provisioned yet (this session) | P1 | open — operator |
| 2 | Local `supabase db` checks not re-run (Docker Desktop offline); schema unchanged since M7C (verified clean) | P3 | open — re-run when Docker up |
| 3 | Error reporting / uptime / SMS-delivery monitoring not configured | P1/P2 | open — operator choice |
| 4 | Real-phone OTP smoke needs a live staging number | P1 | open — operator |
| 5 | Email invites need `MADAF_EMAIL_AUTH_ENABLED=true` (phone-only accounts can't accept email invites — M7B limitation) | P2 | decision — operator |

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

**NOT DEPLOYED — PREPARED.** Local code baseline is green (Node 22, lint, build
216/216, audit 0). The hosted staging environment is **not yet provisioned**;
all Phase 2–8 hosted steps and the full smoke checklist are **PENDING operator
action**. No secrets are committed; the legal/payment boundary is unchanged
(`legal_effective` hard-false, all M6 flags off). Proceed by executing §3–§9
against a **staging** Supabase + Vercel project and updating this log in place.
