# CLAUDE.md — Madaf / מדף

@AGENTS.md

B2B supplier catalog & ordering platform (Israel/local market, trilingual
ar/he/en with RTL). **Current phase: M3B catalog writes — all reads AND
writes (checkout, order status, product/manufacturer/inventory CRUD,
product image upload) go through `src/lib/data/` (mock default, zero
config; opt-in local-dev Supabase mode via service-role-only RPCs +
Server Actions in `src/lib/actions/`). ALL writes go through validated
RPCs — the underlying tables are read-only for authenticated clients
(M3A.1 orders, M3B.1 master data); categories/customers stay read-only
until a future RPC. UI code must NOT import `src/lib/mock` — only the
data layer does. Auth is M4; documents/invoices M5/M6.** Full context in
`docs/`; backend setup in `supabase/README.md`.

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

## Hard rules for this repo

- Every UI string goes through `src/i18n/dictionaries/{ar,he,en}.ts`,
  typed by `src/i18n/types.ts` — adding a key forces all 3 languages.
- Formatting only via `src/lib/format.ts` (ILS currency, Intl per locale;
  Arabic pins Western digits).
- Domain types in `src/lib/types.ts` are the backend contract — change
  them deliberately and update `docs/FUTURE_BACKEND_HANDOFF.md`.
- No secrets in the repo, no hosted/production Supabase (local stack
  only — `supabase/README.md`), no payments in this phase.
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
