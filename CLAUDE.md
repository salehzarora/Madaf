# CLAUDE.md — Madaf / מדף

@AGENTS.md

B2B supplier catalog & ordering platform (Israel/local market, trilingual
ar/he/en with RTL). **Current phase: M0 design foundation — mock UI only,
no backend.** Full context in `docs/`.

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
- No secrets, no real Supabase, no payments in this phase.
- Routes live under `src/app/[locale]/`; the root layout is inside
  `[locale]` (Next 16); locale redirect lives in `src/proxy.ts` (not
  middleware.ts — renamed in Next 16).
- Storefront pages go in the `(shop)` route group; admin under `admin/`.

## Git

Work on `design/*` or feature branches. Never push without being asked.
