# Product Readiness & Regression Audit — M7A

> **Status:** AUDIT / DOCUMENTATION ONLY. This phase changed **no** runtime
> code, UI, migrations, RLS, RPCs, dependencies, or env behavior. It adds this
> report (and an optional pointer in the handoff docs). Nothing here enables
> legal invoicing, a hosted backend, payments, or a production deployment.
>
> **Legal boundary (unchanged):** M6B–M6F remain **sandbox-only / non-legal /
> default-disabled**; M6G is **documentation-only**. Madaf issues **no** legal
> tax invoice, requests **no** allocation number (מספר הקצאה), makes **no**
> tax-authority/SHAAM or provider call, produces **no** legal PDF, takes **no**
> payment, and performs **no** real signing/archival. `legal_effective` is
> hard-`false` by DB CHECK constraints. See
> `docs/legal-invoicing/PRODUCTION_ACTIVATION_REVIEW_CHECKLIST.md`.

Audit date: 2026-07-07 · Branch: `audit/M7A-product-readiness-regression` ·
Base: `main` @ `7fb8c5e` (M6G merge).

---

## 1. Executive Summary

Madaf is **functionally complete and security-sound for the demo/sandbox phase
it is in.** The full verification harness is green (lint, 216-page build, `npm
audit` 0 vulns, local DB reset/lint/advisors clean), and every access-control
invariant the platform depends on was re-verified at runtime against the local
database.

- **No P0 blockers** were found. The sandbox legal-invoicing posture, the
  multi-tenant RLS model, and the tokenized-shop model all behave as designed.
- **The gap to production is infrastructure, not code.** The application is
  ready; the *environment* around it is not (no hosted backend, CI, monitoring,
  error reporting, production email, or edge rate limiting). These are the P1
  items and are, by design, out of scope for M7A.
- The M6 legal-invoicing foundation is **inert and multiply fenced**: 3
  server-only default-OFF env flags + a service-role-only DB kill switch
  (default `false`) + owner/admin gating + per-tenant readiness + **4 hard
  `legal_effective = false` CHECK constraints** + dormant server-only modules
  reachable by no route.

**Recommended next phase: M7B — Staging Deployment Readiness** (details in §17).

---

## 2. Current Git / Main State

- Audit branch: `audit/M7A-product-readiness-regression`, cut from `main`.
- `main` HEAD: `7fb8c5e Merge M6G production activation review gate`.
- All expected M6 commits present on `main` (verified via `git log`):

| Commit | Subject |
| --- | --- |
| `7fb8c5e` | Merge M6G production activation review gate |
| `4900a68` | docs: add production activation review gate [M6G] |
| `6e6ab58` | Merge M6F sandbox archival and signing records |
| `afc831f` | feat: add sandbox archival and signing records [M6F] |
| `ea8574a` | Merge M6E sandbox legal orchestration |
| `64dd51f` | fix: harden sandbox orchestration RPC boundary [M6E.1] |
| `44d1cb0` | feat: add sandbox legal document orchestration [M6E] |
| `acaea66` | Merge M6D sandbox legal provider adapter |
| `b4c345d` | feat: add sandbox legal provider adapter [M6D] |
| `80bc8bd` | Merge M6C disabled legal numbering skeleton |
| `e45d5b6` | fix: validate legal numbering inputs [M6C.1] |
| `dc986fc` | feat: add disabled legal numbering skeleton [M6C] |
| `8e10de1` | Merge M6B inert legal invoicing foundation |
| `2e1d503` | feat: add inert legal invoicing settings and schema [M6B] |

- Working tree clean. The untracked `running-containers.txt` (external tooling
  artifact) was left untouched and added to `.git/info/exclude` locally (not the
  repo `.gitignore`).

---

## 3. What Was Audited

| Scope | Area | Method |
| --- | --- | --- |
| B | Product surface (admin + storefront + documents) | Route/source inspection |
| C | Mock mode (zero-env default) | Build with no `.env.local` + mode-boundary review |
| D | Supabase local (migrations, RLS, roles, storage) | `db reset/lint/advisors` + SQL role-simulation probes |
| E | Security / access (6 roles, 23 protected tables) | Grant matrix + RLS + hard-CHECK probes + source greps |
| F | UX / design / RTL / mobile | Source inspection of shared components |
| G | Production readiness | Repo/config inventory (CI, deploy, env, monitoring) |
| H | Legal-invoicing track (M6B–M6G) | Constraint/kill-switch/dormant-module verification |

---

## 4. Build / Lint / Audit / DB Results

| Check | Command | Result |
| --- | --- | --- |
| Lint | `npm run lint` | ✅ Clean (exit 0) |
| Build | `npm run build` | ✅ **216/216** static pages (exit 0), zero `.env.local` (mock mode) |
| Dependency audit | `npm audit --omit=dev --audit-level=moderate` | ✅ **0 vulnerabilities** |
| DB reset | `supabase db reset --local` | ✅ All 25 migrations + seed applied cleanly (exit 0) |
| DB lint | `supabase db lint --local --schema public` | ✅ **No schema errors found** |
| DB advisors | `supabase db advisors --local` | ✅ **No issues found** |

---

## 5. Product Surface Status

25 page routes under `src/app/[locale]/`, split into `admin/` and the `(shop)`
route group, plus auth/onboarding routes. All render in the mock build.

**Admin / supplier** — dashboard (`admin/`), products (list/`new`/`[id]/edit`),
manufacturers, inventory, categories (managed within product/inventory flows),
customers (list + `[id]` detail with private links & rep assignment), orders
(list + `[id]` detail), documents (list + `[id]` + per-order document route),
team (`admin/team`: members, invites, owner transfer, rep assignment), tenant
switcher (top bar), onboarding, login, reset-password, invite acceptance, tax
settings (`admin/settings/tax`). **Status: present and building.**

**Storefront / customer** — tokenized private shop (`shop/[token]`), catalog,
product detail, cart, checkout, order-success under `(shop)`. The tokenized
route **404s in mock mode** (no tokens exist there) and renders a clean,
detail-free dead-end for invalid/revoked/expired tokens. **Status: present and
building.**

**Legal / documents** — invoice **drafts** always render a DRAFT watermark + a
localized *not-a-tax-invoice* notice in both the on-screen `document-view` and
the PDF renderer (`render-document.ts`), which additionally stamps a universal
“generated by Madaf · not a tax invoice” footer. **No** legal-issuing route, UI,
or action exists. **Status: draft-safe.**

---

## 6. Mock Mode Findings

- **Zero-env default holds.** `getDataMode()` returns `"mock"` unless
  `NEXT_PUBLIC_MADAF_DATA_MODE` is exactly `"supabase"`; a missing/misspelled
  value can never reach a database. No `.env.local` is present in the repo, and
  `npm run build` succeeded in exactly that configuration (216 pages).
- **No accidental writes.** Mock reads/writes resolve to the typed TS modules in
  `src/lib/mock/*`; the Supabase branches are behind dynamic imports gated by
  `getDataMode()`, so mock mode never bundles `@supabase/supabase-js` and never
  performs a network/DB write.
- **No legal path in mock.** The tax-settings form is inert in mock (saving
  stores nothing); the orchestration/archival/provider modules are `server-only`
  and imported by no route. There is no legal issuing anywhere, mock or not.
- **Tax settings stays demo-safe.** `admin/settings/tax` imports only the
  read-only `legalInvoicingStatus()` snapshot (booleans for display); it exposes
  no issue/allocation/provider/payment/download control, and carries a
  permanent, unremovable “legal invoicing is not active” warning.

---

## 7. Supabase Local Findings

- **Migrations apply cleanly** — all 25 (through
  `20260714120000_sandbox_archival_signing.sql`) applied on a fresh
  `db reset`; seed loaded; `db lint`/`advisors` clean.
- **Auth bootstrap** (`supabase/bootstrap-auth.sql`) runs successfully and seeds
  the demo tenant `11111111-…-111111111111`, the other tenant
  `5b5b159d-…-59a1954ad3e9`, and the owner/admin/sales_rep + other-tenant-owner
  demo users. (This file is **not** run by `db reset`; it must be applied
  separately after a reset — documented behavior.)
- **RLS active** on all 23 audited tables (`relrowsecurity = true`).
- **Storage buckets `documents` and `product-images` are both PRIVATE**
  (`public = false`). Document objects are reachable only via signed URLs issued
  by the trusted server path.
- **`set_document_storage` exact-path validation intact (M5B.1).** The RPC
  rejects any path that is not the exact DB-derived
  `<tenant>/documents/<order>/<type>/<id>_<locale>.pdf`; the authenticated
  documents-bucket policies were dropped, so authenticated users cannot upload
  or overwrite objects directly — only the fail-closed service-role client can.

---

## 8. Auth / RLS / Security Findings

All probes below were run at runtime against the local DB by assuming the
`anon` / `authenticated` roles and setting JWT claims.

| Role / probe | Expected | Observed |
| --- | --- | --- |
| `anon` → `customers` / `orders` / `legal_documents` | denied | **permission denied** (no grant) ✅ |
| `authenticated` **owner** (member) → customers | tenant rows | **8** ✅ |
| `authenticated` **owner** → orders | tenant rows | **7** ✅ |
| `authenticated` **owner** → legal_documents | 0 (inert) | **0** ✅ |
| `authenticated` **sales_rep** (member, 0 assignments) → customers/orders | **0** (fail-closed, no fall-back) | **0** ✅ |
| `authenticated` **non-member** (random uid) → customers/legal_documents | 0 | **0** ✅ |
| `authenticated` **other-tenant owner** → customers | own tenant only, **not** demo’s 8 | **0** (empty tenant) ✅ |

- **RPC-only writes confirmed.** Zero `INSERT/UPDATE/DELETE` grants to
  `anon`/`authenticated` on any legal table or on `tenant_users` /
  `tenant_invitations` / `sales_rep_customers`. Writes flow exclusively through
  SECURITY DEFINER RPCs.
- **Sensitive legal tables have no direct read at all** —
  `legal_invoice_sequences`, `legal_numbering_settings`,
  `tax_authority_requests`, `tax_authority_responses`, and `signing_records`
  grant `anon`/`authenticated` nothing (service-role-only). Owner/admin get
  SELECT only on the four non-sensitive tables (`legal_documents`, items,
  events, `archival_records`).
- **Sales_rep enforcement is genuine, not incidental.** The rep is a real member
  (`role = sales_rep`) with **0** rows in `sales_rep_customers`, and therefore
  sees **0** customers/orders — demonstrating the M4D fail-closed scoping with no
  fall-back to all customers.
- **No secret/flag leakage to the client.** Source greps found **no**
  `NEXT_PUBLIC_SERVICE_ROLE`, `NEXT_PUBLIC_LEGAL`, `NEXT_PUBLIC_PROVIDER`,
  `NEXT_PUBLIC_NUMBERING`, or `NEXT_PUBLIC_SIGNING`. `SUPABASE_SERVICE_ROLE_KEY`
  appears only in server-only modules and docs, guarded to fail closed on
  non-local URLs and production `NODE_ENV`.
- **No broad anon/authenticated write or read policies** were introduced by the
  M6 migrations; the new tables are deny-by-default with narrowly scoped
  owner/admin SELECT policies.

---

## 9. Storefront / Private-Link Findings

- Tokenized shop resolves through a SECURITY DEFINER RPC (`getTokenCatalog`);
  the token is the only credential and the customer never logs in.
- Invalid / revoked / expired tokens produce a clean dead-end with **no leaked
  detail** (generic “invalid link” copy), and the route **404s entirely in mock
  mode**.
- The anonymous-token rate limiter (M4D: global per-purpose counter, valid
  tokens never blocked, raw token never stored) remains in place at the DB
  layer; **network/edge-level** rate limiting is infra (see §14, P1).
- Customers have **no** path to any legal/sandbox record — those tables grant
  the tokenized/anon surface nothing.

---

## 10. Admin Workflow Findings

- Catalog (products/manufacturers/inventory/categories), orders (list → detail →
  status history), customers (detail → private links → rep assignment), team
  (members/invites/owner transfer/rep assignment), and documents
  (list/detail/download) surfaces are all present and build cleanly.
- Team management preserves the documented invariants (RPC-only `tenant_users`,
  last-owner protection, no self-promotion, owner role only via
  `promote_tenant_owner`) — verified structurally via the no-direct-write grant
  matrix; no regression introduced by M6.
- Tax settings is an inert configuration surface only (§6); it is the correct
  home for future legal controls but exposes none today.

---

## 11. Documents / PDF Findings

- Invoice drafts are **always** watermarked `DRAFT` and carry the localized
  not-a-tax-invoice notice — on screen and in the generated PDF — and cannot be
  presented as a legal document.
- Every generated PDF carries the universal “generated by Madaf · not a tax
  invoice” footer. Internal document numbers are `DOC-####` style, explicitly
  **not** a legal tax sequence.
- Stored PDFs are tamper-resistant: private bucket, service-role-only writes,
  exact-path validation (§7). Document download uses short-lived signed URLs.

---

## 12. Legal-Invoicing Track Status (M6B–M6G)

| Phase | What it added | Live behavior |
| --- | --- | --- |
| M6B | `tenant_tax_settings` + 8 **inert** legal tables + enums | Config only; issues nothing |
| M6C(.1) | Disabled numbering skeleton + `draw_legal_document_number` + input validation | Draws nothing (kill switch off) |
| M6D | Sandbox/null **provider adapter** (server-only, dormant) | No network; returns loud `SANDBOX-…` placeholders |
| M6E(.1) | Sandbox **orchestration** RPC, hardened boundary | Writes only `sandbox=true, legal_effective=false` rows |
| M6F | Sandbox **archival + signing** records, write-once | Placeholder SANDBOX signatures; never legal |
| M6G | Production-activation **review checklist** (docs) | Documentation gate; enables nothing |

**Verified structurally on the local DB:**

- **4 hard CHECK constraints `legal_effective = false`** on `legal_documents`,
  `tax_authority_responses`, `archival_records`, `signing_records` — a
  legally-effective row is structurally impossible.
- **Kill switch** `legal_numbering_settings.enabled` DEFAULT **`false`**
  (service-role-only table).
- **Provider mode fail-closed** — `taxProviderMode()` clamps `production` →
  `disabled`; `legalIssuingActive()` is hard-`false`.
- **Dormant modules** — the provider/orchestration/archival TS modules are
  `import "server-only"` and imported by **no** route/UI/action (only
  `admin/settings/tax` imports the read-only config status).

**Confirmed absent:** real legal issuing, real allocation number, provider/tax-
authority call, legal PDF, payments, real signing/certificate/archive. Real
activation is blocked behind the M6G checklist + qualified tax/legal sign-off.

---

## 13. UX / RTL / Mobile Findings

Inspection was from source + route smoke (no visual regression tooling in this
phase). The Madaf Ledger design system (semantic tokens, logical CSS
properties) is applied consistently in the shared components reviewed.

- Logical CSS properties (`ms-/me-/ps-/pe-/start-/end-`) are the norm; RTL
  (he/ar) and LTR (en) share one layout. Numbers/SKUs are `dir="ltr"`-wrapped
  per the i18n guide.
- Empty/loading/error/invalid states exist for the tokenized shop (clean
  dead-end) and are present across admin lists.
- **Watch item (P2):** a `sales_rep` with zero assignments sees an *empty*
  customers/orders list. This is correct fail-closed behavior, but the
  empty-state copy should clearly say “no customers assigned yet” so it does not
  read as a bug. Recommend an explicit visual QA pass (no code change in M7A).

No visual **P0/P1** issues were identified from code; a dedicated device/RTL
visual QA pass is recommended before customer exposure (folded into §17).

---

## 14. Production Readiness Findings

The repo is deliberately local-only. The following are **prerequisites for
staging/production** and are expected gaps at M7A (not defects):

- **Hosted Supabase**: none configured (local stack only, by policy). Needs a
  project, migration-deploy path, and a service-role-key handling plan.
- **Vercel / hosting**: no `vercel.json` (Next.js default deploy would work);
  build is green and static-heavy (216 pages).
- **CI/CD**: no `.github/workflows` — lint/build/`db lint` run manually today.
- **Monitoring / error reporting**: none wired (`@vercel/analytics` appears only
  transitively in the lockfile, not integrated). No Sentry/uptime/alerting.
- **Email/SMS**: invites/reset rely on the local Inbucket; no production email
  provider or verified sending domain.
- **Edge/IP rate limiting**: app-layer anon-token limiter exists; network-layer
  DoS protection is infra.
- **Auth redirect URLs / domain**: not configured for a hosted origin.
- **Backup/restore, seed/onboarding, support runbook**: not yet documented for a
  real first tenant (`bootstrap-auth.sql` is demo-only).
- **Legal/privacy pages**: no privacy policy / terms / `security.txt`.

`.env.example` is thorough and safe (mock default, local URLs, no real secrets),
which gives staging a clear starting contract.

---

## 15. Open Risks

1. **Environment risk, not code risk.** The largest gap to a real user is the
   absence of a monitored, backed-up, CI-gated hosted environment. Until that
   exists, any “production” use is unsupported.
2. **Legal activation is the highest-consequence future action.** The multiple
   fences make accidental activation implausible, but the M6G checklist +
   qualified sign-off must gate any future flip. Do not weaken any fence.
3. **Demo-only identities.** Bootstrap users/passwords are demo credentials;
   they must never reach a hosted environment.
4. **Tooling drift.** Supabase CLI is v2.107 locally while v2.109 is available —
   keep tooling current to avoid migration/lint surprises.
5. **Manual verification.** With no CI, green-ness depends on running the harness
   by hand each change; a regression could merge unnoticed.

---

## 16. Prioritized Fix List

### P0 — Blocker
- **None.** No blocker to the current sandbox/demo posture was found.

### P1 — Must fix before staging / customer exposure
1. Stand up a **hosted Supabase** project + migration-deploy pipeline (service-
   role key handled server-only, fail-closed).
2. Add **CI** (lint + build + `db lint`/`advisors` on every PR).
3. Wire **error reporting + monitoring + uptime alerting**.
4. Configure a **production email provider** + verified domain for
   invites/reset (replace Inbucket).
5. Configure **auth redirect URLs** and the production **domain**.
6. Add **edge/IP rate limiting** in front of the app (complements the app-layer
   anon-token limiter).

### P2 — Should fix soon
1. Author a **backup/restore + retention runbook** (critical before any future
   legal archival is ever considered).
2. Author a **tenant onboarding + support/admin runbook** (owner transfer,
   member removal, link revocation, first real tenant seed — replacing the demo
   bootstrap).
3. **Sales_rep empty-state QA** — confirm the “no customers assigned” copy reads
   as intentional, not broken (§13).
4. Upgrade the **Supabase CLI** (v2.107 → v2.109) and pin tooling versions.

### P3 — Polish / later
1. Add **privacy policy / terms / `security.txt`** before public customer use.
2. Fix the cosmetic **M6G note ordering** in
   `docs/DOCUMENTS_AND_INVOICES_GUIDE.md` (M6G block precedes M6F — harmless,
   deferred from the M6G merge on purpose).
3. Consider **`force row level security`** on the most sensitive tables as
   belt-and-suspenders (currently off; acceptable because the app never connects
   as a table owner and service-role bypass is intentional).
4. Add a lightweight **device/RTL visual regression** pass before demos.

---

## 17. Recommended Next Phase

**M7B — Staging Deployment Readiness.**

The product surface is complete and the security model verified; the binding
constraint is the absence of a real, monitored, backed-up environment. M7B
should provision hosted Supabase + Vercel, add CI (lint/build/db-lint), wire
monitoring + error reporting + production email, and configure auth redirect
URLs / domain — i.e. clear the §16 **P1** list — **without** enabling any legal
issuing or changing the sandbox posture. A short **Demo Data & Onboarding**
workstream (replace demo bootstrap with a real first-tenant seed + onboarding
runbook, §16 P2) folds naturally into the tail of M7B.

Explicitly **not** next: any M6-style legal activation, which remains gated
behind the M6G checklist and qualified tax/legal sign-off.

---

## 18. Commands Run

```bash
# Git
git fetch origin && git checkout main && git pull --ff-only origin main
git status && git log --oneline -25
git checkout -b audit/M7A-product-readiness-regression

# Verification harness
npm run lint                                     # clean
npm run build                                    # 216/216 pages
npm audit --omit=dev --audit-level=moderate      # 0 vulnerabilities
supabase db reset --local                        # 25 migrations + seed, clean
supabase db lint --local --schema public         # No schema errors found
supabase db advisors --local                     # No issues found
psql < supabase/bootstrap-auth.sql               # seed demo memberships

# Security greps (no matches for the leak patterns)
NEXT_PUBLIC_SERVICE_ROLE | NEXT_PUBLIC_LEGAL | NEXT_PUBLIC_PROVIDER
NEXT_PUBLIC_NUMBERING | NEXT_PUBLIC_SIGNING            # none
legal_effective = true                                # docs only (forbidden state)
issueInvoice | requestAllocation | allocation number  # server-only/dormant + docs
stripe | paypal | payment_intent                      # none (no payment libs)
sentry | datadog | posthog | opentelemetry            # none integrated

# DB security probes (docker exec psql, role simulation)
#   RLS enabled on 23 tables; 0 write grants on locked tables;
#   4 hard legal_effective=false CHECKs; kill switch default false;
#   anon denied; owner=8 customers; rep=0 (fail-closed); cross-tenant isolated.
```

## 19. Files Changed

- **Added:** `docs/PRODUCT_READINESS_AUDIT_M7A.md` (this report).
- **(Optional) updated:** short M7A pointer in `README.md` /
  `docs/FUTURE_BACKEND_HANDOFF.md`.
- **No** code, migration, RLS/RPC, dependency, or env changes.
- `.git/info/exclude` updated locally (not committed) to hide the untracked
  `running-containers.txt`.
