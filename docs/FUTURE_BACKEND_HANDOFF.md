# Future Backend Handoff

For the coding/backend agent that connects Madaf to real infrastructure.
Read PRODUCT_BRIEF.md and MVP_SCOPE.md first. **Do not redesign the UI** —
everything here was built to be wired, not rebuilt.

> **EXECUTION — M7D: supervised staging deploy (DOCS ONLY; not yet deployed).**
> Adds **[docs/deployment/STAGING_EXECUTION_M7D.md](deployment/STAGING_EXECUTION_M7D.md)**
> — the secret-free execution tracker for the supervised staging deploy. As of
> this branch the hosted Supabase + Vercel staging environment is **NOT
> provisioned**; every hosted step + the full smoke checklist is **PENDING
> operator action** (recorded, never fabricated). Local baseline is green
> (Node 22, lint, build 216/216, audit 0; local `supabase db` checks unchanged
> since M7C — Docker was offline this session). No secrets committed; legal/
> payment boundary unchanged (`legal_effective` hard-false, all M6 flags off).
> Execute §3–§9 of that log against a **staging** (never production) project.
> Prior:
> **STAGING — M7C: staging deployment readiness (DOCS + CI + safe config).**
> Adds **[docs/deployment/STAGING_DEPLOYMENT_M7C.md](deployment/STAGING_DEPLOYMENT_M7C.md)**
> (services, Vercel env matrix + forbidden vars, Supabase/Vercel/first-tenant
> checklists, phone-OTP + storage + legal-boundary readiness) and
> **[docs/deployment/RUNBOOK_STAGING.md](deployment/RUNBOOK_STAGING.md)**
> (monitoring, failure-mode triage, rollback/incident, demo-data plan). Adds a
> secret-free **CI** workflow (`.github/workflows/ci.yml`: lint + build + audit
> on PR/main, mock mode, no hosted services) and a **pure, non-throwing**
> server-only misconfig linter (`src/lib/config/deployment-safety.ts`,
> `assessDeploymentSafety()` — never run at build, so the zero-env mock build is
> unaffected). **Deploys nothing, commits no secrets, connects no hosted
> Supabase, changes no runtime/RLS/schema.** Legal stays OFF (`legal_effective`
> hard-false), no payments, dev fake-OTP disabled in staging, SMS provider
> secrets live in the Supabase dashboard only. **M7C.1** fixed three review
> blockers: CI now runs on **Node 22** (the `@supabase` lockfile requires
> `node >=22`); the safety linter's `NEXT_PUBLIC` detection is tightened to a
> small allowlist + broad secret markers (`TOKEN`/`OTP`/`CODE`/`SMS`/`PRIVATE`/
> `JWT`/named SMS providers/…), catching near-misses like
> `NEXT_PUBLIC_API_TOKEN`; and `MADAF_TRUSTED_DOCUMENT_STORAGE=enabled` now
> **always** requires `..._PROJECT_REF` (regardless of a Supabase URL). Prior:
> **STATUS — M7B (+ M7B.1 hardening): phone-OTP sign-in (primary method).**
> Supplier/admin login is now **phone-number OTP** (`signInWithOtp`/`verifyOtp`,
> server actions in `src/lib/actions/auth.ts`), with email+password as a
> secondary fallback. **No tenant/RLS/security boundary changed** — a session is
> still a Supabase-Auth session bound to an `auth.users` id; membership/roles/RLS
> come from `tenant_users` unchanged; **no migration**. **Hosted phone OTP needs
> an SMS provider set in the Supabase dashboard (or a Send SMS Hook) — NO
> provider secret is committed.**
> **M7B.1 fixed two Codex blockers:** (1) local phone OTP now works —
> `supabase/config.toml` enables a **dummy, non-secret** local SMS provider
> (GoTrue disables phone login without one) **plus** `[auth.sms.test_otp]`, so
> the test numbers (`972500000001`/`2` → `123456`) verify with **no network
> call** and yield a REAL local session, RLS intact; a real number just fails to
> send locally. (2) the email/password fallback is now **server-enforced** —
> `signInAction`/`signUpAction` reject (not just hide the UI) unless
> `emailPasswordAuthAllowed()` (email-primary, or `MADAF_EMAIL_AUTH_ENABLED=true`,
> or non-production), the single source shared with UI visibility. A **fail-closed
> DEV fake-OTP path** (`src/lib/auth/dev-otp.ts`, `MADAF_DEV_PHONE_OTP_*`) works
> in **mock mode only**, disabled by default, HARD-off in production / non-local
> URLs, invents no session, grants no tenant access. **Limitation:** email team
> invites still verify the invited email, so a phone-only account can't accept
> one yet (no schema migration — documented follow-up; set
> `MADAF_EMAIL_AUTH_ENABLED=true` in phone-primary prod to keep email invites
> usable). No legal/M6 change; `legal_effective` stays hard-false. See
> [docs/AUTH_AND_ACCESS_MODEL.md](AUTH_AND_ACCESS_MODEL.md) §2b. Prior:
> **AUDIT — M7A: product readiness & regression audit (DOCS ONLY).** See
> **[docs/PRODUCT_READINESS_AUDIT_M7A.md](PRODUCT_READINESS_AUDIT_M7A.md)** —
> full harness green (lint, 216-page build, `npm audit` 0 vulns, local DB
> reset/lint/advisors clean), RLS/role isolation re-verified at runtime, M6
> legal stack confirmed sandbox-only/default-disabled. **No P0 blockers;** the
> gap to production is infrastructure (hosted backend, CI, monitoring, email,
> edge rate limiting — the P1 list). Recommended next: **M7B Staging Deployment
> Readiness**. M7A changed no code/schema/runtime behavior. Prior:
> **STATUS — M6G shipped: production activation review gate (DOCS ONLY).** M6G
> added **[docs/legal-invoicing/PRODUCTION_ACTIVATION_REVIEW_CHECKLIST.md](legal-invoicing/PRODUCTION_ACTIVATION_REVIEW_CHECKLIST.md)**
> and changed **no code, schema, or runtime behavior**. M6B–M6F remain
> sandbox-only / non-legal / default-safe; no real issuing is enabled. That
> checklist is REQUIRED before any future `legal_effective`-capable work —
> production / legal issuing must not be enabled until a qualified Israeli
> accountant / tax advisor + legal counsel review and approve against current
> official sources, and every gate is signed. Prior:
> **STATUS — M6F shipped: SANDBOX archival + signing (non-legal, disabled by
> default).** On top of M6E, M6F added a write-once, NON-LEGAL archival + signing
> layer (`src/lib/legal-invoicing/archival/`, DORMANT — no route/action/UI imports
> it) via `sandbox_archive_and_sign_legal_document`: owner/admin only, fail-closed
> behind the DB kill switch (`MDF70`), validates the target is an M6E sandbox /
> non-legal `legal_documents` row (`MDF75`), accepts NO caller JSON (canonical
> payload + SHA-256 generated in SQL; idempotency key hashed), and is write-once
> (unique per document + `MDF74` + an immutability trigger). Signatures are
> placeholders (`SANDBOX-SIGNATURE-…`); a HARD CHECK keeps `legal_effective=false`
> on `archival_records`/`signing_records` (the latter stays service-role-only). It
> is **NOT** a real archive/signature and is **NOT** tax-compliant — no tax
> invoice, allocation number, provider call, production mode, payment, or legal
> PDF; `legal_number`/`allocation_number`/status untouched. Real archival/signing/
> issuance needs official-source verification + a professional review (M6G) first.
> Prior:
> **STATUS — M6E shipped: SANDBOX-ONLY legal orchestration (disabled by
> default).** On top of M6D, M6E added a server-only, DORMANT orchestration
> (`src/lib/legal-invoicing/orchestration/`) that wires tax settings + numbering
> + sandbox provider into a *simulation* gated by three env flags + the
> service-role-only DB kill switch + owner/admin + tenant `legal_invoicing_ready`
> (`sandboxOrchestrationReadiness()` reports why it is unavailable). Even fully
> enabled it writes ONLY SANDBOX/NON-LEGAL rows via the `sandbox_issue_legal_document`
> RPC: a `draft_internal` `legal_documents` row (`sandbox=true`,
> `legal_effective=false`, `provider_mode=sandbox`; `legal_number`/
> `allocation_number` stay NULL) + a redacted request/response log pair.
> A **HARD CHECK `legal_effective = false`** on `legal_documents` +
> `tax_authority_responses` makes a legally-effective row impossible; production
> provider mode is rejected (`MDF72`); the RPC is owner/admin-only + fail-closed
> (`MDF70`); direct client writes stay blocked. `SandboxProvider.verifyAllocationNumber`
> is hardened to accept only SANDBOX-shaped values. **NOTHING real is issued** (no
> invoice, real allocation number, tax-authority/provider call, payment, PDF,
> `issued`/`provider_approved` status, or tokenized-customer access). Redacted
> sandbox logs are now persisted (RPC-only; no grants widened). **M6F/M6G**
> (archival/signing, then real issuing) require official-source verification + a
> professional tax/accounting/legal review before `legal_effective` may ever be
> true. **M6E.1** hardened the RPC boundary (EXECUTE-granted to authenticated →
> all write gates enforced in SQL): requires `tenant_tax_settings.legal_invoicing_ready=true`
> (`MDF73`), calls the M6C numbering draw INSIDE the RPC (duplicate idempotency
> fails before draw → no increment; DB kill switch off fails the call), and
> persists NO caller JSON (SQL-generated minimal sandbox payloads; idempotency
> key hashed). The old JSON-accepting overload was dropped; app readiness is UX
> only. Prior:
> **STATUS — M6D shipped: SANDBOX/MOCK provider adapter.** On top of M6C, M6D
> added a **server-only** legal-invoice provider abstraction
> (`src/lib/legal-invoicing/provider/`) with a **NullProvider** (disabled →
> `unavailable`) and a **SandboxProvider** (deterministic MOCK from a SHA-256 of
> the idempotency key — no network, no dependency, no credentials). Selected by
> `MADAF_TAX_PROVIDER_MODE` (`disabled`|`sandbox`; **`production` clamped to
> `disabled`**). Every result is `legal: false` with a loud non-legal notice;
> mocks are obvious placeholders. It issues **NOTHING** (no invoice, allocation
> number, real tax-authority/SHAAM call, `legal_number`, `issued`/
> `provider_approved` status, PDF, or payment) and is **DORMANT** (no route/
> action/UI imports it). Redacted, sandbox-marked log records are BUILT
> (`buildProviderLog`/`redactPayload`) but **NOT persisted** — the M6B
> `tax_authority_requests`/`_responses` tables stay service-role-only; a future
> trusted-server writer (M6E) persists them. Idempotency/error model: per-call
> `idempotencyKey`/`providerRequestId`/`providerResponseId`/`status`/`errorCode`/
> `retryable` (no live retry/queue). **M6E** = real sandbox-first, then
> flag-gated production issuing — after a professional tax/accounting/legal
> review + official-source re-verification. Prior:
> **STATUS — M6C shipped: DISABLED legal numbering skeleton.** On top of M6B,
> M6C added ONE gated primitive — `draw_legal_document_number(...)`
> (SECURITY DEFINER, owner/admin, atomic row-locked draw from
> `legal_invoice_sequences`) that returns an **internal, NON-LEGAL preview**
> number (`DRAFT-LEGAL-YYYY-######`). It is **fail-closed behind two default-OFF
> gates**: a service-role-only DB kill switch (`legal_numbering_settings.enabled`,
> default `false`) and the env flag `MADAF_LEGAL_NUMBERING_ENABLED` gating a
> **dormant** helper (`src/lib/data/legal-numbering.ts`) that is wired to nothing.
> M6C issues **NOTHING** (no invoice, allocation number, provider call, payment,
> PDF, `legal_number` on `legal_documents`, or `issued` status) and no UI/route
> draws numbers. **M6C.1** hardened input validation: `p_year` defaults to the
> current UTC year and must be `2000..2100` (`MDF61`); a non-null
> `p_legal_entity_id` is rejected (`MDF62`, no `legal_entities` table yet) — so
> invalid calls raise before any increment and write no sequence row.
> **Numbering rollback/gap policy (skeleton):** committed draws are atomic and
> not reused; disabled/unauthorized/invalid calls do not increment; a
> rolled-back transaction rolls back its increment, so an uncommitted attempted
> number may be drawn again later — acceptable for the disabled preview
> skeleton; **real issuance (M6E+) must define a committed-number/gap policy with
> professional review.** **M6D** = provider sandbox/mock adapter; **M6E** =
> flag-gated issuing; both need a professional tax/accounting/legal review +
> official-source re-verification first. Prior:
> **STATUS — M6B shipped: INERT legal-invoicing foundation.** On top of the M6A
> architecture spike, M6B added — all INERT — per-tenant **tax settings**
> (`tenant_tax_settings` + owner/admin `get`/`upsert` RPCs; `/admin/settings/tax`
> page), a **server-only feature-flag reader** (`src/lib/config/legal-invoicing.ts`;
> the three flags default OFF/`disabled`, fail-closed, never `NEXT_PUBLIC`), and
> an **inert legal schema** (8 tables + 2 enums + an issued-immutability guard,
> RLS + grants locked, **no issuing/numbering RPC, no provider call, no route, no
> bucket**). M6B issues **NOTHING**: no legal tax invoice, no allocation number,
> no provider/tax-authority call, no legal number, no payments; `legal_invoicing_ready`
> and the flags do NOT enable issuing. The `invoice_draft` keeps its DRAFT
> watermark + "not a tax invoice" notice. **Re-verify official Israel Tax
> Authority rules + get a professional review before M6C/M6D/M6E.** Prior status:
> **M6A** added **zero** code / schema / routes / provider deps / numbering /
> payments — a *plan*. Madaf still issues **DRAFTS ONLY**; there is no
> legal tax invoice, no tax-authority/provider integration, and no legal
> numbering. The `invoice_draft` stays a draft (a future legal `tax_invoice`
> will be a separate, feature-flagged family; the draft is never renamed and
> its warnings stay). The full plan — proposed schema, state machine, numbering,
> the three default-OFF feature flags (`MADAF_LEGAL_INVOICING_ENABLED`,
> `MADAF_TAX_PROVIDER_MODE`, `MADAF_LEGAL_NUMBERING_ENABLED`), provider adapter,
> legal-PDF strategy, RLS plan, phased M6B–M6G migration, risk register, and an
> M6B/M6C checklist — is in
> [docs/LEGAL_INVOICING_ARCHITECTURE.md](LEGAL_INVOICING_ARCHITECTURE.md).
> **Requires official-source verification + a tax/accounting/legal review
> before any production use.** Earlier summary follows. **M5C is
> production-readiness
> cleanup before M6** (no features, no payments, no legal invoices). (1)
> Trusted document storage now uses a DEDICATED server-only client
> (`src/lib/data/trusted-document-storage.ts`, separate from the generic demo
> `getServiceContext`) with an explicit config model: LOCAL-ONLY by default
> and fail-closed; production is opt-in via
> `MADAF_TRUSTED_DOCUMENT_STORAGE=enabled` +
> `MADAF_TRUSTED_DOCUMENT_STORAGE_PROJECT_REF=<ref>` (pins the URL to
> `<ref>.supabase.co`) + `SUPABASE_SERVICE_ROLE_KEY`; a misconfigured client
> makes the route safely STREAM the PDF without storing. Never enabled by
> default; never NEXT_PUBLIC; never in the browser. (2) Local auth bootstrap
> fixed: `supabase/bootstrap-auth.sql` now sets the `auth.users` token/`*_change`
> columns to `''` (not NULL), so demo users sign in on the FIRST attempt (the
> prior GoTrue-500 "converting NULL to string" is gone). (3) `npm audit` is
> clean — the transitive PostCSS advisory (nested under Next) was cleared with
> a targeted `overrides: { postcss: ^8.5.10 }` (same-major, no Next downgrade;
> `npm audit fix --force` was NOT used); see `docs/security/AUDIT_NOTES.md`.
> All M4D/M5B security guarantees intact (storage lock, direct-write regression,
> grant audit); mock stays the zero-config default. Earlier summary follows.
> **M5B.1 locks stored-PDF
> uploads to a trusted server path.** Codex flagged that M5B let a normal
> authenticated user (e.g. an assigned sales_rep) DIRECTLY upload/overwrite a
> forged PDF at the deterministic path via the Storage API. Fix: the
> `documents` bucket's `storage.objects` policies were DROPPED, so RLS denies
> every anon/authenticated read/insert/update/delete on it — uploads + signing
> now run ONLY through the server-only, fail-closed SERVICE-ROLE client
> (`getServiceContext`, never in a client bundle), and only AFTER the route
> authorizes the request (RLS order read + `create_order_document` +
> `set_document_storage`). `set_document_storage` now validates the storage
> path EXACTLY against the DB-derived `<tenant>/documents/<order>/<type>/<id>_
> <locale>.pdf` (rejecting any mismatched tenant/order/type/id/locale,
> traversal, non-.pdf, blank). Reuse trusts an object only when `storage_path`
> equals that exact path. product-images policies untouched; bucket still
> private; no public URL; no service-role key in the browser. Legal boundary
> unchanged (drafts only). Earlier summary follows. **M5B stores the generated
> PDFs** in a PRIVATE Supabase Storage `documents` bucket and serves them via
> SHORT-LIVED, access-checked SIGNED URLs. The download route
> (`/[locale]/admin/orders/[id]/documents/[type]?lang=…&regenerate=1`) reads
> the order under RLS, records via `create_order_document`, then uploads +
> signs on the authenticated client — gated a third time by the
> `storage.objects` policies, which re-check `can_access_order` on the path's
> tenant + order segments (path `<tenant>/documents/<order>/<type>/<doc>_<loc>
> .pdf`, no secrets). owner/admin any order, sales_rep only assigned-customer
> orders, walk-in orders owner/admin only, cross-tenant blocked, anon nothing;
> the public object URL is dead. Storage metadata (storage_path / generated_at
> / file_size_bytes / checksum) is added to `documents` and written ONLY by
> the SECURITY DEFINER `set_document_storage` RPC (documents stay read-only).
> A download reuses the stored object unless `?regenerate=1`. Admin order
> detail now lists per-type document history (status/number/date) with
> download + regenerate. RTL PDF polish: a wordSpacing fix restores
> Hebrew/Arabic inter-word spacing (digits stay correct). Still NO legal tax
> invoices, numbering, provider integration, or payments; invoice_draft stays
> `draft`; mock mode streams (no storage). All M4/M5A guarantees intact (grant
> audit + 15-table direct-write regression + storage-policy matrix). Earlier
> summary follows. **M5A added the documents /
> PDF foundation**: server-side PDF generation for the three SAFE document
> types — order request, delivery note, and invoice **DRAFT** — from order
> snapshots, downloadable at `GET /[locale]/admin/orders/[id]/documents/
> [type]?lang=he|ar|en`. A single SECURITY DEFINER RPC `create_order_document`
> records/refreshes the `documents` row (idempotent per order+type;
> authorize_tenant + can_access_order gated — owner/admin any order, sales_rep
> only assigned-customer orders, walk-in orders owner/admin only). Documents
> stay table-level read-only (RPC is the only write path). invoice_draft is
> still a DRAFT PREVIEW only: status forced to `draft` (never `generated`),
> guaranteed non-blank legal_notice, internal `DOC-####-x` number (NOT a legal
> tax sequence), rotated DRAFT watermark + not-a-tax-invoice notice on every
> invoice-draft PDF, and a "generated by Madaf · not a tax invoice" footer on
> all three. Delivery notes show no prices. Engine: pdfkit + a vendored OFL
> Rubik TTF (`src/lib/pdf/`, server-only, Node runtime) — no hosted deps, no
> Chromium; Hebrew/English render cleanly, Arabic best-effort (bidi polish +
> a private Storage bucket for stored/signed PDFs are M5B/M6). No tax-authority
> integration, no payments, no legal numbering. All M4 guarantees intact
> (grant audit + direct-write regression across 15 tables). Earlier summary
> follows. **M4D.2 restricts
> private-link metadata to owner/admin**: `customer_access_links` still
> carried the M4A member-wide `is_tenant_member` SELECT policy, so any
> authenticated member — including a `sales_rep` — could read a link's
> `customer_id` / `label` / `token_preview` / expiry / revoked / last-used /
> created-by (only `token_hash` was already hidden by the M4A.1 column
> grant). The SELECT policy is now
> `has_tenant_role(tenant_id, ['owner','admin'])`, so a `sales_rep` sees
> **no** link rows (even for an assigned customer) — private links are an
> owner/admin concern and the link-management UI was already owner/admin
> only. Column grant, write locks, and the anon SECURITY DEFINER token RPCs
> (which bypass RLS) are unchanged, so the tokenized shop flow and
> owner/admin link management keep working. **M4D.1 enforces sales_rep
> ORDER-READ scoping**: `can_access_order(tenant, order)` re-scopes the
> `orders` / `order_items` / `order_status_history` / `documents` SELECT
> policies so a rep reads only orders tied to an assigned customer (a
> null-customer walk-in order is owner/admin only) — closing the M4D gap
> where a rep could read unassigned-customer names via order/document
> snapshots. owner/admin unchanged; SECURITY DEFINER order/token RPCs
> unaffected. sales_rep scoping is now enforced for customer reads, order
> creation, AND order reads. **M4D enforced access
> control**: sales_rep customer scoping via
> `can_access_customer(tenant, customer)` — owner/admin see/order for all
> tenant customers; a sales_rep sees ONLY assigned customers (customers RLS
> policy) and can `create_order_request` ONLY for an assigned customer (no
> fall-back). Owner transfer is real: `promote_tenant_owner` /
> `demote_tenant_owner` (owner-only, last-owner-protected; self-demote only
> while another owner remains) — the owner role is granted only here, never
> by invite. The anon-token rate limiter gained a global per-purpose counter
> (sentinel fingerprint `*`) that tightens aggregate abuse but never blocks a
> valid token. Team page adds sales_rep customer assignment +
> promote/demote. All M4A–M4C guarantees intact (grant audit + direct-write
> regression). Earlier summary follows. **M4C added multi-tenant
> membership + switching**: the M4A `unique(user_id)` on `tenant_users` is
> dropped (only `unique(tenant_id, user_id)` remains), `authorize_tenant`
> now VERIFIES the caller-named tenant against membership (no single-tenant
> derive), the tenant-scoped team/link RPCs take an explicit `p_tenant_id`,
> and `accept_tenant_invite` lets a user join several tenants. The app
> resolves all memberships via `list_memberships()` and remembers the
> selected one in a membership-verified `madaf_tenant` httpOnly cookie
> (`selectTenantAction`), surfaced by a switcher in the admin top bar. Also:
> `sales_rep_customers` (assignment table + owner/admin RPCs
> `assign/unassign/list_rep_assignments` — grant-locked; ENFORCEMENT is
> M4D), a fingerprint-based `token_access_attempts` rate limiter on the anon
> shop-token endpoints (raw token never stored; the endpoints return null
> instead of raising so the counter persists), and sign-up (`signUpAction`)
> + client-side password reset (`/reset-password`). All M4A/M4B guarantees
> intact (verified by grant audit + direct-write regression). Earlier
> summary follows. **M4B added tenant TEAM management**: tokenized,
> email-verified
> invitations (`tenant_invitations`, hash-only, grant-locked like
> `customer_access_links`) and membership RPCs — `create_tenant_invite`,
> `revoke_tenant_invite`, `accept_tenant_invite`, `update_tenant_member_
> role`, `remove_tenant_member`, `list_tenant_members` — enforcing
> owner/admin gates, roles limited to admin/sales_rep, no self-promotion,
> and last-owner protection. Direct `tenant_users` writes are now LOCKED
> (RPC-only; the M1.1 owner/admin write policies were dropped). UI:
> `/admin/team` (owner/admin) + `/invite/<token>` (login-first). Multi-
> tenant membership stays blocked by `unique(user_id)` — that's M4C.
> Earlier M4A summary follows. **M4A added real Supabase Auth**:
> supplier users sign in (`/login`); the admin requires a session +
> tenant membership (onboarding at `/onboarding` for membership-less
> users); the whole data path moved off the service role onto
> cookie-bound **authenticated** clients under RLS. Every tenant-owned
> write RPC is now gated by `authorize_tenant(tenant, roles[])` — derives
> the tenant from membership, never trusts a client `tenant_id`. Roles:
> owner/admin (catalog + orders + status + links), sales_rep (orders
> only, tenant-wide for now). Customers order with NO login via private
> tokenized links (`/shop/<token>`): only a `token_hash` is stored, the
> raw token is shown once, links are revocable/expirable, and token
> orders are `source='remote_customer'` with server-side totals. Anon has
> zero direct table access (tenantless reads short-circuit to empty).
> Full model: `docs/AUTH_AND_ACCESS_MODEL.md`. The M3B detail below still
> holds — only the access path changed (service role → authenticated):
>
> CATALOG WRITES
> are real in supabase mode: product create/update/activate,
> inventory upsert, manufacturer create/update (+ logo), and product
> image upload to Storage — via tenant-validated RPCs in
> `supabase/migrations/20260705150000_product_crud_rpcs.sql`, reached
> through Server Actions in `src/lib/actions/products.ts`. Every RPC
> validates tenant/parent ownership, numeric ranges, text lengths and
> SKU uniqueness. `Product` gained `imageUrl`/`vatRate`/`isActive` and
> `Manufacturer` gained `logoUrl` (contract change, src/lib/types.ts).
>
> Order WRITES (M3A) are real too: checkout → `create_order_request()`
> and status → `update_order_status()`. Since M3A.1 those RPCs are the
> ONLY order write paths. Since M3B.1 the SAME holds for master data:
> products/inventory_items/manufacturers/categories/customers are
> table-level READ-ONLY for authenticated — product/manufacturer/
> inventory writes go through the M3B RPCs; **customer writes go through
> `create_customer`/`update_customer` (M7F.2, owner/admin, RPC-only)**;
> categories stay read-only until a future validated RPC. The service-role
> context
> refuses non-local Supabase URLs on top of refusing production. Mock
> stays the zero-config default. Earlier M2 status below still applies to
> reads:
> Every UI read now goes through `src/lib/data/` — no page or component
> imports `src/lib/mock` anymore (only the data layer does). Server pages
> await the data functions; client components receive props or the
> `ShopDataProvider` context (`src/lib/shop-data-context.tsx`), so no
> client ever fetches or sees a key. Pure helpers live in
> `src/lib/catalog-helpers.ts`. Supabase branches live in
> `src/lib/data/supabase-reads.ts` / `supabase-writes.ts`, both on the
> shared service context in `src/lib/data/supabase-context.ts`
> (server-only, local-dev service-role client pinned to the demo tenant —
> since replaced by authenticated cookie clients in M4A, so this context is
> now bootstrap/local-only and fails closed). Product CRUD and image upload
> stay mock until M3B. Setup: `supabase/README.md`.
>
> The "Type → table mapping" section below describes what was actually
> BUILT in M1 (it supersedes the original jsonb-translation sketch).

## Ground rules carried over from M0

- No secrets in the repo. Use `.env.local` (gitignored) + typed env access.
- Keep the trilingual dictionary system and the `Dictionary` interface —
  new UI strings must land in all three languages (the build enforces it).
- Keep all invoice-safety wording until legal invoicing is truly integrated
  (DOCUMENTS_AND_INVOICES_GUIDE.md).
- Keep logical-property RTL rules (I18N_RTL_GUIDE.md).

## Suggested stack

- **Supabase** (Postgres + Auth + Storage + RLS) as designed for below.
- Server Actions / Route Handlers for mutations; keep pages RSC-first.

## Type → table mapping (src/lib/types.ts is the contract) — AS BUILT in M1

Trilingual text is explicit `*_ar` / `*_he` / `*_en` columns (not jsonb /
translation tables). Full DDL: `supabase/migrations/`.

| TS type | Table | Notes |
|---|---|---|
| `Supplier` | `tenants` | tenant root; every tenant-owned table has `tenant_id` FK; `name_*`, `address_*`, `legal_name`, `company_id`, nullable tax fields, `order_seq` counter |
| — | `tenant_users` | `(tenant_id, user_id, role)` membership over `auth.users`; roles: `owner` / `admin` / `sales_rep`; RLS helpers build on it |
| `Category` | `categories` | `name_*`, `icon`, `color_hue` (= `Category.hue`), `sort_order` |
| `Manufacturer` | `manufacturers` | `name_*`, `logo_url`, `sort_order` |
| `Product` | `products` | `packageType`→`package_unit`, `unitsPerPackage`→`package_quantity`, plus `base_unit`, `unit_size`, `wholesale_price` (numeric ILS excl. VAT), `vat_rate` (0.18 default), `track_expiry`, `is_active`, `sku`/`barcode` nullable. **M8A: `barcode` is on the domain type (edit form prefills it); `update_product` overwrites a description ONLY when its key is present in the payload (the write layer omits absent keys) — the form has no description inputs, so they survive edits.** **`availability` is DERIVED from inventory, not stored** |
| `ProductTranslation` | *(columns on `products`)* | `name_*` + `description_*` |
| `Customer` | `customers` | shop `name` (proper noun, single column), `city_*` per locale, `customer_type`, `contact_name`, plus optional `address` + `notes` surfaced since M7F.2 (writes via `create_customer`/`update_customer`). **M8C: `is_active` lifecycle flag (`isActive` on the domain type) — `set_customer_active` (owner/admin) toggles it; `_resolve_token` rejects inactive stores' links (P0005) and `insert_customer_access_link` refuses new ones (MDF33); no hard delete** |
| `InventoryItem` | `inventory_items` | `stockPackages`→`quantity_available` (>= 0 CHECK), `location`→`warehouse_location`, `nearestExpiry`→`expiry_date`, per-row `low_stock_threshold` (mock global const = 10). **M7I (supersedes M7H delivery-deduction): `update_order_status` RESERVES `order_items.quantity` on the transition into `confirmed`/`preparing`, once (guarded by the `order_reserved` partial-unique in `order_inventory_movements`); insufficient stock BLOCKS confirm/preparing (`MDF30`); `cancel` restores once (`order_reservation_released`); `delivered` is a no-op** |
| `Order` | `orders` | `number`→`order_number` (internal sequential `MDF-N` via atomic counter — **admin/warehouse only**); `publicRef`→`public_ref` (random `MDF-XXXXXXXX`, NOT NULL, unique per tenant — the ONLY order id shown to customers, M7E/M7G); `status` enum = `OrderStatus`; denormalized `subtotal`/`vat_total`/`total`; `currency` (ILS), `source`. **`customer_id` is NULLABLE; `customer_snapshot` jsonb holds the buyer for M7I GUEST showcase orders (`guest=true`, no customer row) — `create_customer_from_order` (owner/admin) promotes it to a `customers` row** |
| `OrderItem` | `order_items` | price/VAT/name/package **snapshots** (`product_name_snapshot` is jsonb `{ar,he,en}` so documents re-render in any language after product edits) |
| — | `order_status_history` | append-only; written automatically by an `orders` trigger — do not insert from app code |
| `OrderDocument` | `documents` | type enum: `order`→`order_request`, `delivery`→`delivery_note`, `invoiceDraft`→`invoice_draft`; `document_number` derived from the order **public_ref** (M7G, customer-facing); `legal_notice` NOT NULL for invoice drafts (CHECK); `totals_snapshot` jsonb; voided, never deleted |
| `SignupLink`/`SignupRequest` | `customer_signup_links` / `customer_signup_requests` | M7G new-store self-signup: owner/admin issue a `token_hash`-only link; anon submit via `submit_customer_signup_request` (token + rate limiter, per-link pending cap); owner/admin `approve_customer_signup_request` (→ a `customers` row) / `reject`. RLS: owner/admin read only; RPC-only writes; no anon table access |
| `ShowcaseLink` | `catalog_showcase_links` | M7H "browse products" link, **now ORDERABLE (M7I)**: owner/admin issue a `token_hash`-only link (`insert/revoke_catalog_showcase_link`); anon reads the catalog via `get_showcase_catalog` AND submits a GUEST order via `create_order_from_showcase_token` (token + rate limiter; order lands `customer_id NULL` + `customer_snapshot guest=true`, source `remote_customer`, money server-side via private `_order_create_core`). RLS owner/admin read; RPC-only writes; no anon table access |
| — | `order_inventory_movements` | Append-only stock ledger written only by `update_order_status` / `update_order_items` / **`adjust_inventory_stock` (M8B — manual corrections: `order_id` NULLABLE, capped `note`, `manual_*` reason allowlist, negative result blocked MDF32, first adjustment auto-creates the inventory row)**. M7I reasons: `order_reserved` (−, on confirm/preparing), `order_reservation_released` (+, on cancel), `order_edit_adjustment` (±, on edit). Partial-unique indexes guard reserve-once / release-once; net reserved = `-sum(quantity_delta) where reason in ('order_reserved','order_edit_adjustment')` — keyed by order_id, so NULL-order manual rows never pollute reconciliation. Admin history view at `/admin/inventory/movements` (M8B). RLS owner/admin read; RPC-write only |
| — | `audit_events` | append-only generic trail |

Enums created: `order_status`, `order_source`, `document_type`,
`document_status`, `package_unit`, `base_unit`, `customer_type`,
`tenant_role`, `locale_code`. (`availability` is intentionally NOT an
enum/column — derive it.)

## Where mock meets real — exact seams

| Mock seam | File | Replace with |
|---|---|---|
| ✅ Catalog/admin reads (M2) | all pages await `src/lib/data/*`; client components use props / `ShopDataProvider` | done |
| ✅ Cart submit (M3A) | `checkout-view.tsx` → `submitOrderAction` → `create_order_request()` RPC | done — real order + lines + number in supabase mode |
| ✅ Order status control (M3A) | `order-status-control.tsx` live mode → `updateOrderStatusAction` → `update_order_status()` RPC | done — validated transitions, trigger history; **M7I reserves/restores stock + surfaces insufficient-stock** |
| ✅ Guest showcase order (M7I) | `showcase-view.tsx` cart + checkout → `submitShowcaseOrderAction` → `create_order_from_showcase_token()` RPC (anon, token) | done — guest snapshot, server-side money, public ref only |
| ✅ Create shop from guest order (M7I) | `guest-order-card.tsx` → `createCustomerFromOrderAction` → `create_customer_from_order()` RPC (owner/admin) | done — promotes snapshot → `customers`, links order |
| ✅ Order line editing (M7I) | `order-items-editor.tsx` → `updateOrderItemsAction` → `update_order_items()` RPC (owner/admin) | done — re-snapshots, reconciles reserved stock, locks delivered/cancelled |
| ✅ Manual stock adjustment (M8B) | `adjust-stock-form.tsx` → `adjustStockAction` → `adjust_inventory_stock()` RPC (owner/admin) | done — allowlisted reasons, note, negative blocked, ledger row |
| ✅ Link guest order to existing store (M8B) | `guest-order-card.tsx` duplicate panel → `linkOrderToCustomerAction` → `link_order_to_customer()` RPC (owner/admin) | done — unlinked guest orders only, snapshot preserved |
| ✅ Duplicate customer guard (M8B) | promote/approve/create actions → `findCustomerDuplicates` (RLS-scoped, normalized phone/name) → confirm-anyway or link | done — app-layer warning; RPCs remain the gate |
| ✅ Customer lifecycle (M8C) | `customer-lifecycle-toggle.tsx` → `setCustomerActiveAction` → `set_customer_active()` RPC (owner/admin) | done — inactive stores' links dormant via `_resolve_token`; new links blocked |
| ✅ Admin CSV exports (M8C/M8D) | orders/products/movements tables → `src/lib/csv.ts` (client-side, filtered rows, BOM, locale headers M8D) | done — owner/admin page-gated; formula-injection-safe; no new data paths |
| ✅ Server-side movement search (M8D) | `movements-table.tsx` → `searchMovementsAction` → `sbSearchInventoryMovements` (RLS-native PostgREST, date/reason/direction/product filters, deterministic paging) | done — RLS owner/admin; no RPC/migration |
| ✅ Role-gated admin UI (M8D) | admin pages compute `canManage` (owner/admin) → hide status/edit/add actions for sales_rep | done — UI-only; backend RPC gates unchanged |
| ✅ Full-filtered exports (M8E.1) | movements: `exportMovementsAction` pages the RLS-scoped filtered query server-side to a 10k cap; orders/products: client cap (5k) guard | done — cap warning `common.exportCapped`; no new data path |
| ✅ Server-side customer search (M8E.2) | `customers-table.tsx` → `searchCustomersAction` → `sbSearchCustomers` (RLS-native PostgREST, ILIKE across name/contact/phone/address/city, active + has-link facets, deterministic paging) | done — RLS tenant-scoped; no migration. `guest/signup-created` facets deferred (no `customers.source` column) |
| ✅ Manufacturer logo upload (M8E.3) | `manufacturers-manager.tsx` LogoField → `uploadManufacturerLogoAction` → `sbUploadManufacturerLogo` (private product-images bucket, `<tenant>/manufacturers/…`); signed on read via `signManufacturerLogos` (admin) + `signOwnTenantLogoPaths` (anon shop/showcase) | done — no new bucket/migration; owner/admin; 2 MB/MIME/magic-byte; own-tenant paths only |
| ✅ Tenant business profile (M8E.4) | `business-profile-form.tsx` → `saveBusinessProfileAction` → `update_tenant_profile()` RPC (owner/admin) + `uploadTenantLogoAction` (`<tenant>/branding/…`) | done — migration `20260725100000`; NON-LEGAL `display_vat_rate` (estimate only); `Supplier` extended (email/logoUrl/logoStoragePath/displayVatRate) |
| ✅ Document preview fidelity (M8E.5) | `document-view.tsx` uses stored `Order.subtotal/vatTotal/total` (matches the PDF), guest `customerSnapshot` fallback, tenant logo in header | done — no legal change; publicRef + DRAFT watermark + notices intact |
| ✅ Product create/edit (M3B) | `admin/product-form.tsx` → `create/updateProductAction` → `create_product()`/`update_product()` RPCs | done — validated, tenant-safe, incl. inventory |
| ✅ Product images (M3B) | `product-image.tsx` prefers `imageUrl`; upload via `uploadProductImageAction` → Storage `<tenant>/products/<id>/…`, signed on read | done — private bucket, gradient fallback |
| ✅ Manufacturers + logos (M3B) | `admin/manufacturers-manager.tsx` → `create/updateManufacturerAction` → RPCs | done — logo on catalog chips |
| Dev service-role client (reads AND writes) | `src/lib/data/supabase-context.ts` (`getServiceContext()`) | authenticated cookie-bound client + RLS (M4) — delete that module. All writes now go through validated RPCs; M4 grants EXECUTE on those RPCs to authenticated (with in-function role checks) rather than restoring direct table writes |
| Demo "today" | `DEMO_TODAY` in `inventory-table.tsx` | real `new Date()` |
| Metrics | computed in `admin/page.tsx` | SQL aggregates (views) |

Deep link `/catalog?customer=cXX` should become a tokenized share link
(`/order/[token]`) that authenticates the shop.

## Auth model (design intent)

- **Supplier admin**: everything under `/admin`.
- **Sales rep**: catalog + cart + orders they created; shop picker limited
  to their route/territory.
- **Shop owner** (remote link): catalog scoped to the supplier, own orders.
- Anonymous: nothing (today's public demo access goes away).

RLS: all rows scoped by `tenant_id` (as built in M1); shop owners
additionally scoped by `customer_id`.

## Sequencing recommendation (M1…)

1. ✅ M1 — Supabase schema + RLS + storage + seed mirroring
   `src/lib/mock/*` (done — hand-written SQL seed with deterministic
   UUIDs; see `supabase/seed.sql`).
2. ✅ M2 — Read paths (done): all pages read via `src/lib/data/`;
   supabase read branches implemented server-side; mock stays the
   zero-config default; supabase mode is local-dev only (it runs on real
   auth + RLS since M4A).
3. ✅ M3 — Write paths done: M3A orders
   (`create_order_request()`/`update_order_status()`) + M3A.1 lockdown;
   M3B catalog (product/manufacturer/inventory CRUD RPCs + Storage image
   upload). All via Server Actions; mock default untouched.
4. M4 — Auth + roles + tokenized shop links; tighten RLS (sales-rep
   scoping, shop-owner policies, tenant onboarding flow).
5. M5 — Documents: real numbering, PDF generation, archival.
6. M6 — Legal invoicing provider integration (see invoices guide).

## Definition of done for the handoff itself

- `npm run build` still green; all three locales still prerender.
- Mock modules deleted only after every consumer is migrated.
- The docs in this folder updated to reflect reality.
