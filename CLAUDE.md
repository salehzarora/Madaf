# CLAUDE.md — Madaf / מדף

@AGENTS.md

B2B supplier catalog & ordering platform (Israel/local market, trilingual
ar/he/en with RTL). **Current phase: M4D access-control enforcement — on top
of M4C multi-tenant switching (membership-verified `madaf_tenant` cookie;
`authorize_tenant` verifies the NAMED tenant; team/link RPCs take an explicit
`p_tenant_id`). M4D ENFORCES sales_rep customer scoping: a rep sees only
assigned customers (`sales_rep_customers` via `can_access_customer` in the
customers RLS policy) and can order ONLY for an assigned customer (gated in
`create_order_request`; no fall-back to all customers). Adds owner transfer
(`promote_tenant_owner`/`demote_tenant_owner`, last-owner-protected) and a
stronger anonymous-token rate limiter (global per-purpose counter; valid
tokens never blocked; raw token never stored). owner/admin manage rep
assignments + owner transfer on `/admin/team`. Built on M4B team & access
hardening, on top of M4A auth (supplier sign-in at `/login`, `/admin` needs a session +
tenant membership, cookie-bound authenticated clients under RLS, write
RPCs gated by `authorize_tenant`, customers order with NO login via
tokenized `/shop/<token>` links). M4B adds tenant TEAM management: owner
(and admin, for invites) manage members at `/admin/team` via tokenized
invitations (`/invite/<token>`, hash-only, email-verified accept) and
membership RPCs with last-owner protection + no self-promotion. Direct
`tenant_users` writes are now LOCKED (RPC-only), like orders/catalog.
Roles: owner (everything incl. role changes/removal), admin (catalog +
orders + status + links + invite/revoke), sales_rep (orders only). Anon
has zero direct table access. Mock stays the zero-config default (no auth,
open demo admin). All reads/writes go through `src/lib/data/`; UI code
must NOT import `src/lib/mock`. Documents/invoices are M5/M6; edge/IP rate
limiting is infra work.** Full context in `docs/`; auth in
`docs/AUTH_AND_ACCESS_MODEL.md`; backend setup in `supabase/README.md`.

## Commands

```bash
npm run dev     # dev server (Turbopack) → http://localhost:3000
npm run build   # production build — must stay green
npm run lint    # eslint — must stay clean
npm run start   # serve the production build
```

## Read before touching code

1. `docs/MVP_SCOPE.md` — what is mock-only and why (don't "fix" mock
   behaviors that are labeled as demo).
2. `docs/DESIGN_SYSTEM.md` — tokens & components. Use semantic tokens
   (`bg-surface`, `text-ink`, `border-line`, `brand-*`) — never raw hex.
3. `docs/I18N_RTL_GUIDE.md` — **logical CSS properties only**
   (`ms-/me-/ps-/pe-/start-/end-/text-start`), directional icons get
   `rtl:-scale-x-100`, numbers/phones/SKUs wrapped in `dir="ltr"`.
4. `docs/DOCUMENTS_AND_INVOICES_GUIDE.md` — legal wording rules. Invoice
   surfaces are DRAFTS; never remove watermarks/notices or present a
   document as a legally issued tax invoice.
5. `docs/FUTURE_BACKEND_HANDOFF.md` — before adding any backend.
6. `docs/AUTH_AND_ACCESS_MODEL.md` — auth, roles, RLS, tenant derivation
   and the tokenized shop-link model (M4A). Read before touching anything
   under `src/lib/auth/`, `src/lib/actions/{auth,tenant,customer-links,
   shop}.ts`, the auth RPCs, or the admin/login/onboarding/shop routes.

## Hard rules for this repo

- Every UI string goes through `src/i18n/dictionaries/{ar,he,en}.ts`,
  typed by `src/i18n/types.ts` — adding a key forces all 3 languages.
- Formatting only via `src/lib/format.ts` (ILS currency, Intl per locale;
  Arabic pins Western digits).
- Domain types in `src/lib/types.ts` are the backend contract — change
  them deliberately and update `docs/FUTURE_BACKEND_HANDOFF.md`.
- No secrets in the repo, no hosted/production Supabase (local stack
  only — `supabase/README.md`), no payments in this phase.
- Auth (supabase mode): never trust a client-submitted `tenant_id`,
  price, `role`, or total. Users may belong to MANY tenants (M4C); the
  selected tenant is a membership-verified cookie, and `authorize_tenant`
  accepts a tenant_id ONLY if it's one of the caller's memberships — every
  tenant-scoped RPC takes an explicit `p_tenant_id`. Don't loosen RLS,
  re-enable direct table writes (incl. `tenant_users`/`tenant_invitations`/
  `sales_rep_customers` — RPC-only), add broad anon/public read policies,
  ship the service-role key to the browser, or let a stale cookie select a
  non-member tenant. Store only `token_hash` for shop links, team invites,
  and the rate-limiter fingerprint (never the raw token). A `sales_rep` may
  see/order only for ASSIGNED customers (`can_access_customer`) — never
  fall back to all customers, and never trust a client customer_id.
  Membership / owner-transfer RPCs must preserve last-owner protection,
  block self-promotion, and grant the owner role ONLY via
  `promote_tenant_owner` (owner-only) — never by invite. See
  `docs/AUTH_AND_ACCESS_MODEL.md`.
- Data access goes through `src/lib/data/` (mode boundary; mock is the
  default and must keep working with zero env vars). Schema changes =
  new migration + `supabase db reset` + regenerate
  `src/lib/supabase/database.types.ts` (generated file — never hand-edit).
- Routes live under `src/app/[locale]/`; the root layout is inside
  `[locale]` (Next 16); locale redirect lives in `src/proxy.ts` (not
  middleware.ts — renamed in Next 16).
- Storefront pages go in the `(shop)` route group; admin under `admin/`.

## Git

Work on `design/*` or feature branches. Never push without being asked.
