# Auth & Access Model (M4A · M4A.1 · M4B · M4C · M4D · M4D.1 · M4D.2)

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

- **Email/password**, via `@supabase/ssr` cookie-bound clients. The
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

Then set `NEXT_PUBLIC_MADAF_DATA_MODE=supabase` +
`NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` in
`.env.local`, `npm run dev`, and sign in at `/he/login`. To exercise team
invites end-to-end you need a **second** local auth user whose email you
control (create one in Studio → Authentication, sign in as owner, invite
that email, then open `/he/invite/<token>` while signed in as it).

## 12. Delivered in M4C · M4D · M4D.1 · M4D.2

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
