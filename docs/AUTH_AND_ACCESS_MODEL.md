# Auth & Access Model (M4A · M4A.1 · M4B)

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
> hard lockdown of direct `tenant_users` writes. Still **local Supabase
> only**, still **no payments, no legal invoices, no hosted project**.
> Mock stays the zero-config default.

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
per-request dedupe) returns `{ client, userId, email, membership }`:

- `client` — the cookie-bound Supabase client (RLS applies).
- `membership` — the caller's single `{ tenantId, role }` resolved from
  `tenant_users` via the `current_membership()` RPC, or `null`.

Derived helpers:

- `getDataContext()` → `{ client, tenantId }`. `tenantId` is the
  membership tenant, or the `NO_TENANT` sentinel
  (`00000000-…-000000000000`) for anonymous / not-yet-onboarded callers.
- `getCurrentUser()`, `getCurrentMembership()`.

**M4A assumes one membership per user.** Multi-tenant switching is M4B.

## 4. Authorization: `authorize_tenant`

Every tenant-owned write RPC begins with:

```sql
p_tenant_id := public.authorize_tenant(p_tenant_id, array['owner','admin']::public.tenant_role[]);
```

`authorize_tenant(p_tenant_id, p_roles[])`:

1. **service_role** → returns `p_tenant_id` unchanged (bootstrap/seed only).
2. **authenticated** → derives the tenant from the caller's
   `tenant_users` membership. If the client passed a `p_tenant_id` that
   isn't theirs → **`42501`**. If their role isn't in `p_roles` →
   **`42501`**.
3. Anyone else → `42501`.

The **client-submitted `tenant_id` is never trusted** — it is only
accepted if it equals the caller's real membership tenant, and the
server always substitutes the derived value. This is the one checkpoint
that makes cross-tenant writes impossible regardless of what the UI sends.

### Role matrix (M4A + M4B)

| Capability | owner | admin | sales_rep |
|---|:---:|:---:|:---:|
| Read own tenant (catalog, orders, customers…) | ✓ | ✓ | ✓ |
| Create / update products, inventory, manufacturers | ✓ | ✓ | — |
| Create order requests | ✓ | ✓ | ✓ |
| Change order status | ✓ | ✓ | — |
| Create / revoke customer links | ✓ | ✓ | — |
| View team roster (with emails) | ✓ | ✓ | — |
| Invite / revoke team invitations (admin, sales_rep) | ✓ | ✓ | — |
| Change a member's role · remove a member | ✓ | — | — |
| Create a tenant (onboarding) | membership-less user only | | |

Team rules the RPCs enforce: no **owner** invites or promotions (owner is
set only at onboarding); no self-role-change; **last-owner protection** (a
tenant can never drop to zero owners); admin can invite/revoke but cannot
change roles or remove members. `sales_rep` is still **tenant-wide** (sees
and orders for the whole tenant); per-customer/per-rep scoping is deferred
to **M4C**.

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
by an authenticated user who is not yet a member of any tenant. The
single-membership invariant is enforced at the schema level by a
`unique (user_id)` constraint on `tenant_users` (also the race backstop
for the RPC's check-then-insert); M4B, which adds multi-tenant
membership, will drop it deliberately.

## 8. Private customer links (tokenized shop)

Customers never log in. An owner/admin generates a **private link** per
shop; the customer opens `/[locale]/shop/<token>` and orders with no
account.

**Table `customer_access_links`** stores, per link: `tenant_id`,
`customer_id`, `token_hash` (unique), `token_preview` (last 6 chars, for
the admin list only), `label`, `expires_at`, `revoked_at`,
`last_used_at`, `created_by`, timestamps. RLS: members read their
tenant's links, but the **`token_hash` column is not granted to members**
(the member `SELECT` is column-scoped and omits it — the UI only ever
needs `token_preview`). There are **no direct write grants** —
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
rejected (`MDF07`) — multi-tenant membership is M4C. Routes:
`/[locale]/admin/team` (owner/admin) and `/[locale]/invite/<token>`
(login-first; `/login?next=` returns the user to the invite).

## 9. Route guards

- `src/app/[locale]/admin/layout.tsx` — in supabase mode: no session →
  `/login`; session but no membership → `/onboarding`; otherwise renders
  with the member's tenant/role/email in the top bar + logout. Mock mode:
  open demo admin, unchanged.
- `/login`, `/onboarding` — `notFound()` in mock mode; in supabase mode
  they bounce an already-resolved user onward (to `/admin` or
  `/onboarding`).
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
  `authorize_tenant` derives the tenant; RPCs compute money from live
  product data.
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

## 12. Deferred to M4C / later

- **Multi-tenant membership / tenant switching** — M4A/M4B assume one
  membership per user (`unique(user_id)` on `tenant_users`); accepting a
  second invite is rejected until this lands. A tenant selector + a
  membership-verified "current tenant" cookie would replace the constraint.
- **Per-customer / per-rep scoping** for `sales_rep` (a
  `sales_rep_customers` assignment table).
- **Owner transfer** and broader admin member-management (M4B keeps role
  change / removal owner-only, and never grants the owner role via RPC).
- **Signup / password-reset / email-verification** flows (M4B is
  login-first; invited users must already have an auth account).
- **Rate-limiting / abuse controls** and `usage_count` / `last_used_ip`
  on the anonymous token + invite endpoints.
