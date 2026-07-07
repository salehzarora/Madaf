# Auth & Access Model (M4A · M4A.1 · M4B · M4C · M4D · M4D.1 · M4D.2 · M6B · M6E · M6F · M6G · M7B)

> **M7B — phone-OTP sign-in (primary method).** Supplier/admin sign-in is now
> **phone-number OTP** (`signInWithOtp({ phone })` → `verifyOtp({ phone, token,
> type: "sms" })`), with email+password retained as a **secondary dev/local
> fallback** (hidden in production unless email is primary). **This changed NO
> tenant/RLS/security boundary:** Supabase Auth still issues a session bound to
> an `auth.users` id, and membership/roles/RLS resolve from `tenant_users`
> exactly as before — phone vs email only changes how the `auth.users` row is
> created. New server actions `sendPhoneOtpAction`/`verifyPhoneOtpAction` (in
> `src/lib/actions/auth.ts`) set the httpOnly session cookies; the OTP is
> verified server-side and no token/code reaches client JS.
>
> **Hosted phone OTP requires an SMS provider** configured in the Supabase
> dashboard (or a Send SMS Hook) — **no provider secret is ever committed**
> (`MADAF_AUTH_PRIMARY_METHOD` is the only app flag; Twilio/etc. creds live in
> Supabase secrets). **Local Supabase testing** uses `supabase/config.toml`
> `[auth.sms.test_otp]` (fake number→code, no SMS, but a REAL local session —
> RLS intact). A separate **fail-closed DEV fake-OTP path**
> (`src/lib/auth/dev-otp.ts`, `MADAF_DEV_PHONE_OTP_*`) exists for **mock mode
> only**: disabled by default, HARD-off when `NODE_ENV=production` or against a
> non-local Supabase URL, allow-listed numbers + a server-only code — it invents
> **no** session and grants **no** tenant access (mock admin is already open), so
> it is **never** a production bypass. **Red lines (unchanged):** no
> `NEXT_PUBLIC` service-role key, no `NEXT_PUBLIC` OTP code, no provider creds in
> the repo/client bundle, no OTP/phone logging, no session invented outside
> Supabase Auth in production. **Invite acceptance still verifies the invited
> EMAIL** (M4B) — a phone-only account cannot accept an email invite yet; see the
> M7B limitation note below.
>
> **M6G (documentation-only review gate)** changed no permissions, RPCs, RLS,
> grants, or runtime behavior. It added
> [docs/legal-invoicing/PRODUCTION_ACTIVATION_REVIEW_CHECKLIST.md](legal-invoicing/PRODUCTION_ACTIVATION_REVIEW_CHECKLIST.md),
> which is REQUIRED before any future legal-effective work. M6B–M6F remain
> sandbox / non-legal / default-safe; the legal tables stay RPC/service-role-only
> for writes; no grants were widened. **Red lines (never allow):** a `NEXT_PUBLIC`
> service-role key, provider credentials in a client bundle, direct authenticated
> writes to the legal tables, and legal issuing from tokenized-customer routes.

> **M6F (sandbox archival/signing) access posture.** The
> `sandbox_archive_and_sign_legal_document` RPC is SECURITY DEFINER,
> `search_path=''`, **owner/admin-only** (`authorize_tenant`; sales_rep/anon/
> non-member/cross-tenant → 42501/denied), **fail-closed** behind the M6C DB kill
> switch (`MDF70`), and validates the target is an M6E sandbox / non-legal
> document (`MDF75`). It is the ONLY write path for the archival/signing rows;
> `archival_records` stays **owner/admin READ-only**, `signing_records` stays
> **service-role-only** (signature material never reaches a client) — direct
> authenticated INSERT/UPDATE/DELETE denied, and both are **write-once**
> (immutability trigger). It persists NO caller JSON (canonical payload + SHA-256
> generated in SQL; idempotency key hashed). HARD CHECKs keep `legal_effective =
> false` and force sandbox-placeholder signatures. No grants widened; no tokenized
> customer path touches any of this.

> **M6E (sandbox legal orchestration) access posture.** The
> `sandbox_issue_legal_document` RPC is SECURITY DEFINER, `search_path=''`,
> **owner/admin-only** (`authorize_tenant`; sales_rep/anon/non-member/cross-tenant
> → 42501/denied), and **fail-closed** behind the M6C service-role-only DB kill
> switch (`MDF70`) + sandbox-only provider mode (`MDF72`). It is the ONLY write
> path for the new sandbox markers — `legal_documents` / `tax_authority_requests`
> / `tax_authority_responses` remain **RPC/service-role-only for writes** (direct
> authenticated INSERT/UPDATE denied); `legal_documents` reads stay owner/admin
> only. HARD CHECK constraints keep `legal_effective = false` and limit
> `provider_mode` to sandbox/null, so no client (or the service role) can store a
> legally-effective or production row in M6E. No grants were widened; no tokenized
> customer path touches any of this. Never trust a client `tenant_id`/status/
> number.
>
> **M6E.1 hardening (the RPC is the security boundary).** Since the RPC is
> EXECUTE-granted to authenticated, a direct owner/admin Data-API call must not be
> able to bypass the app helper — so the RPC itself now enforces **tenant tax
> readiness** (`tenant_tax_settings.legal_invoicing_ready=true`, else `MDF73`),
> **calls the M6C numbering draw internally** (DB kill switch off fails the whole
> call; a **duplicate idempotency key fails BEFORE any draw**, so it never
> increments), and persists **NO caller-supplied JSON** (payloads are
> SQL-generated + sandbox-marked; the idempotency key is hashed, never stored
> raw). The old JSON-accepting overload was dropped. The app
> `sandboxOrchestrationReadiness()` is UX only, not the security boundary.

> **M6B (inert legal-invoicing foundation) access posture.** `tenant_tax_settings`
> is deny-by-default RLS: **owner/admin** of the SELECTED tenant read (and write
> via the SECURITY DEFINER `get_tenant_tax_settings` / `upsert_tenant_tax_settings`
> RPCs, gated by `authorize_tenant(owner/admin)`); **sales_rep, anon and
> non-members get nothing**; writes are RPC-only (no direct-write grant/policy);
> cross-tenant access is blocked; no secrets are stored. The **inert legal
> schema** (`legal_documents`/`legal_document_items`/`legal_invoice_sequences`/
> `legal_document_events`/`tax_authority_requests`/`tax_authority_responses`/
> `archival_records`/`signing_records`) is RLS-enabled + grant-locked with **no
> INSERT/UPDATE/DELETE grant or policy for any client** and **no issuing RPC** —
> the four sensitive tables (sequences, provider requests/responses, signing) are
> **service-role-only** (no authenticated grant at all), the other four are
> **owner/admin read-only**. An `issued` legal document is immutable (guard
> trigger). Nothing here is reachable by any issuing flow (none exists). Never
> trust a client tenant_id/number/amount; never loosen these grants.

How Madaf decides **who** may see or change **what**, once real
authentication is switched on. Read `MVP_SCOPE.md` and
`FUTURE_BACKEND_HANDOFF.md` first; this document is the authoritative
picture of the auth/authorization/tenancy layer.

> **Phase:** M4A — real Supabase Auth for supplier users, tenant
> membership + roles, an authenticated (RLS-scoped) data path, and
> private tokenized shop links for customers. **M4A.1** locked the
> `customer_access_links` grants. **M4B** adds tenant **team management**:
> tokenized team invitations, membership RPCs (invite / accept / change
> role / remove) with last-owner protection and no self-promotion, and a
> hard lockdown of direct `tenant_users` writes. **M4C** makes membership
> **multi-tenant**: a user may belong to several tenants and switch between
> them (verified selected-tenant cookie), `authorize_tenant` now verifies
> the *named* tenant against membership, plus a `sales_rep_customers`
> assignment foundation, a minimal anonymous-token rate limiter, and
> signup / password-reset. Still **local Supabase only**, still **no
> payments, no legal invoices, no hosted project**. Mock stays the
> zero-config default.

---

## 1. Two modes, one UI

`NEXT_PUBLIC_MADAF_DATA_MODE` selects the backend and is the ONLY switch:

| | **mock** (default) | **supabase** (local dev) |
|---|---|---|
| Data | `src/lib/mock/*` | seeded local Postgres |
| Auth | none — demo admin is open | real Supabase Auth required |
| `/login`, `/onboarding` | `notFound()` (routes don't exist) | live |
| `/admin/*` | open (demo) | requires session + membership |
| Anonymous catalog | full mock catalog | **empty** (no public catalog) |
| `/shop/<token>` | `notFound()` | live tokenized storefront |

Mock mode is unchanged from M0–M3: no login, the demo admin works, the
storefront shows sample data. Everything below describes **supabase mode**.

---

## 2. Authentication

- **Phone-number OTP is the primary method (M7B; see §2b)**; **email/password**
  is a secondary fallback. Both use `@supabase/ssr` cookie-bound clients. The
  session lives in **httpOnly cookies** — no access token ever reaches
  client JavaScript.
- `src/lib/supabase/server-auth.ts` — `createServerAuthClient()`, the
  server (RSC/Action) client bound to the request cookie jar.
- `src/lib/supabase/client.ts` — `getSupabaseBrowserClient()`, anon-key
  browser client (used only where a client component must talk to auth).
- `src/proxy.ts` — after locale routing, `updateSession()` refreshes the
  Supabase session cookie on every request. It **no-ops in mock mode**
  (skipped unless both `NEXT_PUBLIC_SUPABASE_URL` and
  `NEXT_PUBLIC_SUPABASE_ANON_KEY` are set).
- Sign-in / sign-out are Server Actions (`src/lib/actions/auth.ts`);
  the browser never sees a service-role key (there is none in the client
  bundle) and never sees the session token.

## 2b. Phone OTP sign-in (M7B — primary method)

Phone-number OTP is the **primary** supplier/admin login. Email+password is a
**secondary fallback** kept for the seeded demo users and hidden in production
(unless `MADAF_AUTH_PRIMARY_METHOD=email`). **The tenant/RLS/security model is
unchanged** — a session is still a Supabase-Auth session bound to an
`auth.users` id, and membership/roles/RLS come from `tenant_users`. Phone vs
email only changes how the `auth.users` row is created.

**Flow (two steps, server actions in `src/lib/actions/auth.ts`):**

1. `sendPhoneOtpAction({ phone })` → normalizes to E.164
   (`src/lib/auth/phone.ts`) → `client.auth.signInWithOtp({ phone })`.
2. `verifyPhoneOtpAction({ phone, token })` → `client.auth.verifyOtp({ phone,
   token, type: "sms" })`, which sets the httpOnly session cookies. Existing
   routing then applies: member → `/admin`, session-without-membership →
   `/onboarding`.

UI: `src/components/auth/phone-otp-form.tsx` (2-step, i18n he/ar/en + RTL,
resend cooldown, change-number, clear errors, Ledger style), composed with the
email fallback in `src/components/auth/auth-panel.tsx`. The OTP is verified
**server-side**; no code/token is in the client bundle.

**Config flags (server-only, never `NEXT_PUBLIC`):**

| Flag | Purpose | Default |
| --- | --- | --- |
| `MADAF_AUTH_PRIMARY_METHOD` | `phone` \| `email` — first method shown | `phone` |
| `MADAF_DEV_PHONE_OTP_ENABLED` | enable the mock/dev fake-OTP path | `false` |
| `MADAF_DEV_PHONE_OTP_ALLOWED_NUMBERS` | comma list of fake E.164 numbers | — |
| `MADAF_DEV_PHONE_OTP_CODE` | the fake code (server-only) | — |

### DEV / MOCK fake-OTP path — safe by construction

`src/lib/auth/dev-otp.ts` is a **fail-closed** testing convenience, consulted
**only in mock mode** (`getDataMode() !== "supabase"`). It returns enabled only
when ALL hold: `MADAF_DEV_PHONE_OTP_ENABLED=true` **and** `NODE_ENV !==
production` **and** the Supabase URL (if any) is local **and** a code is set
**and** ≥1 number is allow-listed. Even when it "succeeds" it invents **no**
session and grants **no** tenant access — mock admin is already open and has no
DB/RLS — so it can never be a production bypass. In **Supabase** mode the app
**always** uses real `signInWithOtp`/`verifyOtp`; for local Supabase testing,
use `supabase/config.toml` `[auth.sms.test_otp]` (fake number→code, no SMS, but
a REAL local session, RLS intact).

### Hosted production/staging setup checklist

- [ ] Enable the **Phone** provider in the Supabase dashboard (Auth → Providers).
- [ ] Configure an **SMS provider** (Twilio/MessageBird/Vonage/etc.) **or** a
      **Send SMS Hook** in the dashboard. **Never commit provider secrets** —
      they live in Supabase secrets, not this repo.
- [ ] Set `MADAF_AUTH_PRIMARY_METHOD=phone` (email fallback then hidden in prod).
- [ ] Leave `MADAF_DEV_PHONE_OTP_ENABLED` unset/false (it is inert in prod anyway).
- [ ] Configure **auth redirect / site URLs** for the staging/production domain.
- [ ] Review **rate limits** (`auth.rate_limit.sms_sent`, `token_verifications`,
      `sign_in_sign_ups`) and provider spend caps before launch.
- [ ] Confirm no `NEXT_PUBLIC` OTP/service-role/provider values ship to the client.

### Invite / email compatibility (M7B limitation)

Team invites (M4B) are **email-based** and the accept RPC verifies the invited
**email** against the caller's account. A **phone-only** account has no email
and therefore **cannot accept an email invite yet**. M7B deliberately makes
**no schema migration** here. Minimal safe behavior for now: invited teammates
sign in with the **email** the invite was issued to (email fallback stays
available in dev; enable it in prod via `MADAF_AUTH_PRIMARY_METHOD=email` for an
invite-heavy deployment, or add phone-invite support in a follow-up). Owner/
admin onboarding and tenant creation are **not** email-coupled (they key on the
`auth.users` id) and work unchanged for phone users. Follow-up: phone-based
invites (match on phone, or let a user add an email) — a separate, reviewed change.

### Rate limiting & abuse

OTP send/verify are subject to Supabase's per-IP auth rate limits (config in
`[auth.rate_limit]`) plus the provider's own limits. The app adds a client-side
**resend cooldown** (UX only). Network/edge IP rate limiting remains infra work
(see the M7A audit). Never log phone numbers or OTP codes (the actions log a
generic failure string only).

### Rollback / fallback

Phone OTP is additive. To fall back to email-first, set
`MADAF_AUTH_PRIMARY_METHOD=email` (email form shown first; phone remains
available via the toggle). The email/password actions and reset-password flow
are **retained**, so a full revert is a config change, not a code change.

## 3. Session & tenant context

`src/lib/auth/session.ts` is the single source of truth for the
authenticated path. `getSessionContext()` (wrapped in React `cache` for
per-request dedupe) returns `{ client, userId, email, memberships,
membership }`:

- `client` — the cookie-bound Supabase client (RLS applies).
- `memberships` — **every** tenant the user belongs to
  (`{ tenantId, role, name }`), from `list_memberships()` — feeds the
  switcher.
- `membership` — the **currently-selected** membership: the one named by
  the `madaf_tenant` cookie **if it is one of the user's real
  memberships**, else the first (deterministic) membership, else `null`.

Derived helpers:

- `getDataContext()` → `{ client, tenantId }`. `tenantId` is the selected
  membership tenant, or the `NO_TENANT` sentinel
  (`00000000-…-000000000000`) for anonymous / not-yet-onboarded callers.
- `getCurrentUser()`, `getCurrentMembership()`.

**Multi-tenant (M4C):** a user may belong to several tenants. The selected
tenant lives in an httpOnly cookie set only by `selectTenantAction` **after
verifying membership**, and `getSessionContext` re-verifies it every
request — a tampered/stale cookie just falls back to the first membership
and can never select a tenant the user isn't in. `tenant_users` keeps
`unique(tenant_id, user_id)` (no duplicate in one tenant); the M4A single
`unique(user_id)` constraint was dropped.

## 4. Authorization: `authorize_tenant`

Every tenant-owned write RPC begins with:

```sql
p_tenant_id := public.authorize_tenant(p_tenant_id, array['owner','admin']::public.tenant_role[]);
```

`authorize_tenant(p_tenant_id, p_roles[])` (M4C, multi-tenant):

1. **service_role** → returns `p_tenant_id` unchanged (bootstrap/seed only).
2. **authenticated** → `p_tenant_id` is **required** and is **verified**
   against the caller's memberships: the caller must have a `tenant_users`
   row for *that* tenant with a role in `p_roles`, else **`42501`**. There
   is no derive-the-single-tenant fallback anymore.
3. Anyone else → `42501`.

The **client-submitted `tenant_id` is never trusted** — it is accepted
ONLY when it matches one of the caller's own memberships (with an allowed
role). The tenant-scoped team/link RPCs (`create_tenant_invite`,
`list_tenant_members`, `insert_customer_access_link`, …) take an explicit
`p_tenant_id` (the app's verified selected tenant) and pass it straight in;
the catalog/order RPCs already did. This one checkpoint makes cross-tenant
writes impossible for a user who belongs to several tenants, regardless of
what the UI sends.

### Role matrix (M4A + M4B)

| Capability | owner | admin | sales_rep |
|---|:---:|:---:|:---:|
| Read catalog / orders (own tenant) | ✓ | ✓ | ✓ |
| Read customers | ✓ (all) | ✓ (all) | assigned only |
| Read orders / items / status / documents | ✓ (all) | ✓ (all) | assigned-customer orders only |
| Create / update products, inventory, manufacturers | ✓ | ✓ | — |
| Create order requests | ✓ (any customer) | ✓ (any customer) | assigned customer only |
| Change order status | ✓ | ✓ | — |
| Create / revoke customer links | ✓ | ✓ | — |
| View team roster · manage sales_rep assignments | ✓ | ✓ | — |
| Invite / revoke team invitations (admin, sales_rep) | ✓ | ✓ | — |
| Change a member's role · remove a member | ✓ | — | — |
| Promote to owner · demote an owner | ✓ | — | — |
| Create a tenant (onboarding) | membership-less user only | | |

Team rules the RPCs enforce: no self-role-change; **last-owner protection**
(a tenant can never drop to zero owners); admin can invite/revoke but cannot
change roles, remove members, or transfer ownership. Owner transfer goes
through `promote_tenant_owner` / `demote_tenant_owner` (owner-only,
last-owner-protected; self-demotion allowed only while another owner
remains) — no one else can grant the owner role, and there are still no
owner invites.

**sales_rep customer scoping (ENFORCED):** a `sales_rep` sees ONLY the
customers assigned to them (`sales_rep_customers`) and can create orders ONLY
for an assigned customer — enforced at the DB level via
`can_access_customer(tenant, customer)` in the `customers` SELECT policy and
in `create_order_request` (a rep order with no/unassigned customer →
`42501`; no fall-back to "all customers").

**sales_rep order-read scoping (ENFORCED in M4D.1):** reads of `orders`,
`order_items`, `order_status_history` and `documents` are scoped by
`can_access_order(tenant, order)` — owner/admin read all tenant rows; a
`sales_rep` reads only rows tied to an order whose customer is assigned to
them (a null-customer walk-in order is owner/admin only). So a rep can no
longer list unassigned-customer orders or read their names via an order /
document `customer_snapshot`. owner/admin still see and order for every
customer in the tenant. Assignments are managed by owner/admin
(`assign_customer_to_rep` / `unassign_customer_from_rep`); the tokenized shop
flow (SECURITY DEFINER, `source='remote_customer'`) and order creation are
unaffected — those RPCs run past RLS and validate scope themselves.

**sales_rep private-link scoping (ENFORCED in M4D.2):** `customer_access_links`
kept the M4A member-wide `is_tenant_member` SELECT policy, so a `sales_rep`
could still read a link's `customer_id` / `label` / `token_preview` / expiry /
revoked / last-used / created-by (only `token_hash` was already column-hidden).
The SELECT policy is now `has_tenant_role(tenant_id, ['owner','admin'])`, so a
`sales_rep` reads **no** link rows at all — not even for a customer assigned to
them — since private links are an owner/admin concern and the link-management
UI (`/admin/customers/[id]`) is already owner/admin only. Column grant, write
locks, and the anon token RPCs are unchanged (§8).

## 5. Reads — RLS, and the anon short-circuit

Authenticated reads run through the cookie client under RLS: a member
sees only their tenant's rows (`src/lib/data/supabase-reads.ts`, still
filtering `tenant_id` explicitly as belt-and-braces).

`anon` holds **no table grants and no read policies** — the catalog is
never globally public. A raw anon `SELECT` therefore raises
`permission denied` (a 500), not an empty set. So the read layer
**short-circuits every read to empty when `tenantId === NO_TENANT`**,
before touching the DB. That is what lets an anonymous visitor load
`/login` or `/shop/<token>` (both wrapped by the root layout, which reads
catalog data) without crashing, while still exposing zero supplier data.

## 6. Writes — authenticated RPCs only

The app's data path no longer uses the service role. Reads use the
authenticated client; writes call the **same validated RPCs** as M3A/M3B,
re-declared in M4A to gate on `authorize_tenant` and granted `EXECUTE` to
`authenticated`:

`create_product`, `update_product`, `set_product_active`,
`upsert_inventory_item`, `create_manufacturer`, `update_manufacturer`
(owner/admin), `create_order_request` (owner/admin/sales_rep, rejects
`source='remote_customer'`), `update_order_status` (owner/admin).

Direct table `INSERT/UPDATE/DELETE` on
products/inventory_items/manufacturers/categories/customers/orders/
order_items stay **blocked** at both the policy and grant level (M3A.1 /
M3B.1 are intact — verified by regression probe). **M4B extends this to
`tenant_users`**: the M1.1 direct owner/admin write policies are dropped
and the grants revoked, so membership changes flow ONLY through
`create_tenant_with_owner` (onboarding) and the M4B team RPCs — no member
can self-promote via a raw `UPDATE`. The service-role client remains only
for **local bootstrap/seed**, is unused by the app runtime, and still
refuses non-local and production URLs.

## 7. Onboarding

A signed-in user with **no** membership is redirected to `/onboarding`,
which calls `create_tenant_with_owner(name_ar, name_he, name_en,
default_locale)` — a SECURITY DEFINER RPC that atomically creates the
`tenants` row and the caller's `owner` `tenant_users` row. Callable only
by an authenticated user who is not yet a member of any tenant.
(A user who already belongs to a tenant grows into more tenants by
accepting invites, not through onboarding.) `signUpAction` (M4C) creates a
fresh account, which lands here. Since M4C, `tenant_users` enforces only
`unique (tenant_id, user_id)` — the M4A single-`unique(user_id)` constraint
was dropped to allow multi-tenant membership.

## 8. Private customer links (tokenized shop)

Customers never log in. An owner/admin generates a **private link** per
shop; the customer opens `/[locale]/shop/<token>` and orders with no
account.

**Table `customer_access_links`** stores, per link: `tenant_id`,
`customer_id`, `token_hash` (unique), `token_preview` (last 6 chars, for
the admin list only), `label`, `expires_at`, `revoked_at`,
`last_used_at`, `created_by`, timestamps. RLS: **only owner/admin may read
their tenant's links** (M4D.2 — the SELECT policy is
`has_tenant_role(tenant_id, ['owner','admin'])`; a `sales_rep` sees **no**
link rows, even for a customer assigned to them, since private links are
an owner/admin concern and the link-management UI is already owner/admin
only). On top of that, the **`token_hash` column is not granted to any
member** (the authenticated `SELECT` is column-scoped and omits it — the
UI only ever needs `token_preview`). There are **no direct write grants** —
inserts/revokes go through RPCs.

**The raw token is never stored.** It is generated in the Server Action
(`src/lib/actions/customer-links.ts`, 32 secure random bytes, base64url),
SHA-256 hashed, and only the hash is persisted. The raw token is returned
to the admin **exactly once** (a copy-now banner) and is otherwise
unrecoverable. A token is **opaque** — it encodes neither `tenant_id` nor
`customer_id`; the server resolves those from the hash.

**The anon token RPCs take the RAW token and hash it server-side**
(`_resolve_token` computes SHA-256 in the SECURITY DEFINER function). So
the stored `token_hash` is *not* itself a usable credential: a leaked
row, backup, or DB dump yields only the one-way hash, which cannot be
replayed against the endpoints without a preimage.

Flow:

| Step | RPC | Grants | Notes |
|---|---|---|---|
| Create link | `insert_customer_access_link` | authenticated (owner/admin) | stores hash + preview |
| Revoke link | `revoke_customer_access_link` | authenticated (owner/admin) | sets `revoked_at` |
| Open shop | `get_token_catalog(raw token)` | anon | hashes + validates the token, touches `last_used_at`, returns the tenant-scoped catalog as jsonb |
| Place order | `create_order_request_from_token(raw token, items, notes)` | anon | derives tenant+customer from the token, prices everything server-side, `source='remote_customer'` |

Token validation raises distinct codes — not found (`P0002`), revoked
(`P0003`), expired (`P0004`) — which the app collapses into one neutral
"link no longer valid" screen (no detail leaked). Tokenized orders can
never set their own tenant, customer, prices, or totals.

Anon can call **only** those two token RPCs (both SECURITY DEFINER,
`search_path=''`). Anon still has zero direct table access — including
`products` and `customer_access_links`.

## 8b. Team management & invitations (M4B)

Supplier teams grow through **tokenized invitations**, mirroring the
customer-link model. `tenant_invitations` stores only a `token_hash`
(never column-readable by members), a `token_preview`, the invited email,
the target role (CHECK: `admin`/`sales_rep` only — no owner invites), and
expiry/accepted/revoked timestamps. RLS: owner/admin read their tenant's
invites; **no** direct write grants; anon has nothing; no
`TRUNCATE/REFERENCES/TRIGGER/MAINTAIN` (locked exactly like
`customer_access_links`).

All membership changes go through SECURITY DEFINER RPCs (tenant derived
from membership, never client input):

| RPC | Caller | Enforces |
|---|---|---|
| `create_tenant_invite(email, role, token_hash, preview, expires_at)` | owner/admin | role ∈ {admin, sales_rep}; valid email |
| `revoke_tenant_invite(id)` | owner/admin | only pending (unaccepted) invites |
| `accept_tenant_invite(raw token)` | authenticated | hashes the token server-side; **caller's auth email must equal the invite email**; not revoked/expired/accepted; inserts the membership |
| `update_tenant_member_role(user, role)` | **owner** | role ∈ {admin, sales_rep}; not self; last-owner protection |
| `remove_tenant_member(user)` | **owner** | last-owner protection |
| `list_tenant_members()` | owner/admin | returns the roster **with emails** (authenticated cannot read `auth.users`) |

The raw invite token is generated in the Server Action (32 random bytes,
base64url), shown once, and only its SHA-256 hash is stored — a leaked
hash is not replayable (the RPC hashes the presented raw token). Invite
state errors use the Madaf SQLSTATE class `MDF0x` (catchable by
`WHEN OTHERS`, unlike the built-in `P0004 = assert_failure`); the accept
page maps them to localized messages (wrong-email / already-a-member /
invalid). Accepting an invite while already a member of another tenant is
rejected (`MDF07` — you're already in this tenant). Accepting an invite to
a **different** tenant now succeeds (multi-tenant, M4C). Routes:
`/[locale]/admin/team` (owner/admin) and `/[locale]/invite/<token>`
(login-first; `/login?next=` returns the user to the invite).

## 8c. Multi-tenant switching · rate limiting · auth polish (M4C)

**Tenant switching.** The admin top bar shows the current tenant, and — when
the user belongs to more than one — a switcher (`TenantSwitcher` →
`selectTenantAction`). The action verifies membership, then sets the
httpOnly `madaf_tenant` cookie; `getSessionContext` re-verifies it every
request (see §3). All reads filter by the selected tenant and all write RPCs
re-check membership for it, so a stale/tampered cookie cannot leak another
tenant's data. Team/invite pages, the roster, and permissions are all scoped
to the selected tenant.

**sales_rep customer scoping (foundation).** `sales_rep_customers`
(`tenant_id, user_id, customer_id`) records which shops a rep is assigned
to. Grant-locked like the other M4 tables (anon nothing; owner/admin + the
rep itself get a column SELECT; no direct writes; no dangerous privileges).
Owner/admin manage it via `assign_customer_to_rep` /
`unassign_customer_from_rep` / `list_rep_assignments` (verify the target is
a `sales_rep` of the tenant and the customer belongs to it). **M4C ships the
table + RPCs only** — read/order-path ENFORCEMENT (a rep seeing/ordering for
only assigned customers) is **M4D**, so the current order flow is untouched.

**Anonymous-token rate limiting.** `token_access_attempts` counts FAILED
resolutions per `(purpose, SHA-256 token fingerprint)` in a rolling 15-min
window (limit 20). The **raw token is never stored** (only its fingerprint),
and **no IP is stored**. `get_token_catalog` / `create_order_request_from_
token` deny (return null) once a fingerprint is over the limit; a valid token
never accumulates failures (different fingerprint), so normal shop flow is
never blocked. The counter must persist across a failed call, so those RPCs
**return null instead of raising** on a bad token (a raise would roll the
counter write back). **M4D** adds a **global per-purpose** failure counter
(sentinel fingerprint `*`, limit 100/15 min) that tightens blocking under
aggregate abuse — but it only ever blocks a fingerprint that has *itself*
already failed, so a valid token (which records no failures) is still never
blocked. Invite acceptance is authenticated (attributable), so it is not
rate-limited here. Edge/IP-based limiting (to stop a flood of all-unique
tokens, each of which still gets one attempt) is production infra work.

**Auth polish.** The login form has a **sign-up** mode (`signUpAction`; local
dev auto-confirms, so a new account lands on `/onboarding`). Password reset
lives at `/[locale]/reset-password` and runs **client-side** (the recovery
token arrives in the URL fragment, which only the browser can read): request
a link, or — after following it — set a new password via the browser client.
`?next=` redirects stay same-locale (open-redirect guarded).

## 9. Route guards

- `src/app/[locale]/admin/layout.tsx` — in supabase mode: no session →
  `/login`; session but no membership → `/onboarding`; otherwise renders
  with the member's tenant/role/email in the top bar + logout. Mock mode:
  open demo admin, unchanged.
- `/login`, `/onboarding`, `/reset-password` — `notFound()` in mock mode;
  in supabase mode `/login` bounces an already-resolved user onward (to
  `?next=` or `/admin`, or `/onboarding`) and offers sign-up + a reset link.
- `/shop/<token>` — `notFound()` in mock mode; anonymous token path in
  supabase mode.
- `/admin/team` — `notFound()` in mock mode; owner/admin only in supabase
  mode (`sales_rep` → 404). The Team nav item is hidden unless the session
  role is owner/admin.
- `/invite/<token>` — `notFound()` in mock mode; logged-out visitors get a
  sign-in prompt (`/login?next=…`, restricted to same-locale paths to
  block open redirects), logged-in visitors get the accept action.

## 10. Security invariants (do not weaken)

- Do **not** loosen RLS or re-enable direct table writes.
- Do **not** add broad `anon`/public read policies; the catalog is not
  globally public.
- Do **not** expose the service-role key to the browser, point it at a
  hosted/non-local URL, or use it as the app's runtime data path.
- Do **not** trust a client-submitted `tenant_id`, price, or total —
  `authorize_tenant` accepts a tenant only if it's one of the caller's own
  memberships (M4C); RPCs compute money from live product data.
- Store **only** `token_hash`; return the raw token once, at creation.
- Keep tokens opaque (no tenant/customer encoded); keep them revocable
  and expirable.
- No payments; no legal tax invoices (invoice surfaces stay drafts).

## 11. Local dev — signing in

The demo seed has **no** auth users (auth data isn't part of migrations).
Create the demo users once after a reset:

```bash
supabase db reset                                   # schema + demo data
docker exec -i supabase_db_<project> psql -U postgres -d postgres \
  < supabase/bootstrap-auth.sql                     # 4 demo users + memberships
```

`bootstrap-auth.sql` creates (password `madaf-demo-1234`):

| Email | Role | Tenant |
|---|---|---|
| `owner@madaf.local` | owner | demo |
| `admin@madaf.local` | admin | demo |
| `rep@madaf.local` | sales_rep | demo |
| `other@madaf.local` | owner | a second tenant (isolation testing) |

**M5C:** the bootstrap seeds the `auth.users` token / `*_change` columns as
`''` (not NULL), so GoTrue password sign-in succeeds on the **first** attempt.
(A manually-inserted `auth.users` row with those columns left NULL makes
sign-in fail with a 500 — GoTrue scans them into non-nullable Go strings.)

Then set `NEXT_PUBLIC_MADAF_DATA_MODE=supabase` +
`NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` in
`.env.local`, `npm run dev`, and sign in at `/he/login`. To exercise team
invites end-to-end you need a **second** local auth user whose email you
control (create one in Studio → Authentication, sign in as owner, invite
that email, then open `/he/invite/<token>` while signed in as it).

## 12. Delivered in M4C · M4D · M4D.1 · M4D.2 · M5A

- **M4C — Multi-tenant membership + tenant switcher** (verified `madaf_tenant`
  cookie; `authorize_tenant` verifies the named tenant), the
  `sales_rep_customers` foundation, a per-fingerprint token rate limiter, and
  sign-up + client-side password reset.
- **M4D — sales_rep scoping ENFORCED** (`can_access_customer` in the
  customers policy + `create_order_request`), **owner transfer**
  (`promote_tenant_owner` / `demote_tenant_owner`, last-owner-protected), and
  a **stronger rate limiter** (global per-purpose failure counter that never
  blocks valid tokens). Team page gains sales_rep customer assignment +
  promote/demote controls.
- **M4D.1 — sales_rep ORDER-READ scoping ENFORCED** (`can_access_order` on the
  `orders` / `order_items` / `order_status_history` / `documents` SELECT
  policies) — a rep can no longer read unassigned-customer orders or their
  names via order/document snapshots. sales_rep scoping is now enforced for
  customer reads, order creation, AND order reads.
- **M4D.2 — private-link metadata restricted to owner/admin.** The
  `customer_access_links` SELECT policy moved from the M4A member-wide
  `is_tenant_member` to `has_tenant_role(tenant_id, ['owner','admin'])`, so a
  `sales_rep` reads **no** link rows (even for a customer assigned to them) —
  closing the last member-wide read of private-link + customer metadata
  (`customer_id` / `label` / `token_preview` / expiry / revoked / last-used /
  created-by). `token_hash` stays column-hidden (M4A.1), writes stay
  RPC-only, and the anon SECURITY DEFINER token RPCs bypass RLS, so the
  tokenized shop flow and owner/admin link management are unaffected.
- **M5A — order-document generation (owner/admin/sales_rep, order-scoped).**
  Documents (order request / delivery note / invoice **draft**) are recorded
  ONLY through the SECURITY DEFINER `create_order_document(p_tenant_id,
  p_order_id, p_document_type, p_document_locale, p_legal_notice)` RPC —
  documents stay table-level read-only (no direct INSERT/UPDATE/DELETE). The
  RPC runs `authorize_tenant([owner,admin,sales_rep])` then
  `can_access_order`, so owner/admin generate for any tenant order, a
  `sales_rep` only for an assigned-customer order, and a walk-in/null-customer
  order is owner/admin only (`MDF20` otherwise); a non-member is rejected
  (`42501`); anon has no EXECUTE. The download route
  (`/[locale]/admin/orders/[id]/documents/[type]`) first reads the order
  through the authenticated RLS client (`can_access_order` → a rep/non-member
  sees nothing → 404), then records the row + streams the PDF. invoice_draft
  is a DRAFT PREVIEW only: status forced `draft` (the
  `documents_invoice_draft_never_generated` CHECK blocks `generated` even for
  the service role), a non-blank `legal_notice` is guaranteed, and the number
  is an internal `DOC-####-x` (never a legal tax sequence). No storage bucket,
  no signing, no provider integration (M5B/M6).

## 13. Deferred to M5 / infra

- **Edge / IP-based rate limiting** (the DB limiter caps repeat offenders and
  aggregate abuse but gives each unique bad token one attempt; a flood of
  all-unique tokens needs IP/edge limiting), plus `usage_count`, and
  rate-limiting the (authenticated, attributable) invite-accept endpoint.
- **Email-verification / production email** — local dev has
  `enable_confirmations = false`; hosted deployments must configure SMTP and
  the reset/confirm redirect URLs.
- **"Create additional tenant" from an existing account** (onboarding is
  membership-less only today).
- **Owner invites by email** (M4D keeps owner grants to promote/demote only —
  no owner invitations).
- **Legal-invoicing roles & RLS (M6, designed not built).** A future
  legal-tax-invoice family will add tenant-scoped, RPC-only, **immutable-once-
  issued** tables and possibly an **`accountant`** role (finance-only; issue +
  credit, no catalog/team powers); `sales_rep` would at most *read* legal docs
  for assigned-customer orders (like `can_access_order`), never issue. No
  cross-tenant `platform_admin` is introduced. All of this is **design only**
  and gated behind default-OFF feature flags — see
  [LEGAL_INVOICING_ARCHITECTURE.md](LEGAL_INVOICING_ARCHITECTURE.md). Nothing
  is implemented; the app issues drafts only.
