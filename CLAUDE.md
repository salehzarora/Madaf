# CLAUDE.md — Madaf / מדף

@AGENTS.md

B2B supplier catalog & ordering platform (Israel/local market, trilingual
ar/he/en with RTL). **Current phase: M4B team & access hardening — on top
of M4A auth (supplier sign-in at `/login`, `/admin` needs a session +
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
must NOT import `src/lib/mock`. Documents/invoices are M5/M6; multi-tenant
switching is M4C.** Full context in `docs/`; auth in
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
  price, `role`, or total — the DB derives the tenant via
  `authorize_tenant` and computes money server-side. Don't loosen RLS,
  re-enable direct table writes (incl. `tenant_users` — membership changes
  are RPC-only since M4B), add broad anon/public read policies, or ship the
  service-role key to the browser. Store only `token_hash` for shop links
  AND team invites (never the raw token). Membership RPCs must preserve
  last-owner protection, block self-promotion, and never grant the owner
  role outside onboarding. See `docs/AUTH_AND_ACCESS_MODEL.md`.
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
