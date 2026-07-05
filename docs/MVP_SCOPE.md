# MVP Scope — M0 Design Foundation

## What this phase IS

A complete, polished, trilingual **mock UI** and design system that the
backend agent can wire to real data without redesigning anything.

Included (all mock):

1. Public/customer/sales **catalog** with search, category and manufacturer
   filters, sticky cart bar.
2. **Cart** and **order request** (checkout) flow with order-success screen.
3. **Admin dashboard** with SaaS-style metrics.
4. **Product management** screens (list + new-product form).
5. **Orders management** (list, detail, visual status pipeline).
6. **Inventory overview** (stock by package, low-stock, optional expiry).
7. **Customer/shop list** with "start order" deep link.
8. **Document templates**: הזמנה / Order Request / طلبية · תעודת משלוח /
   Delivery Note / شهادة توصيل · טיוטת חשבונית מס / Tax Invoice DRAFT.
9. Design docs and rules for the future backend agent (this folder).

## What this phase is NOT

| Explicitly out of scope | Where it's designed for later |
|---|---|
| Real Supabase / database | FUTURE_BACKEND_HANDOFF.md |
| Real authentication / login | FUTURE_BACKEND_HANDOFF.md |
| Payments | not designed yet — future milestone |
| **Legal tax invoice issuance** | DOCUMENTS_AND_INVOICES_GUIDE.md |
| Real secrets / env vars | none exist in the repo |
| Complex permissions / roles | types are role-ready, no enforcement |
| Multi-tenant support | `Supplier` type exists; single demo tenant |

## Mock-only behaviors (by design)

- **Cart** persists in `localStorage` (`madaf.cart.v1`) — client-only.
- **Checkout** clears the cart and shows a generated demo order number;
  nothing is sent anywhere.
- **Order status changes** in admin are local component state — they reset
  on reload (the UI says so).
- **New product form** validates and shows a success banner — nothing is
  stored (the UI says so).
- **Documents** derive deterministically from mock orders:
  every order → Order Request; preparing/delivered → Delivery Note;
  delivered → Invoice Draft.
- All data lives in `src/lib/mock/*` as typed TS modules.

## Quality bar accepted for M0

- `npm run build` and `npm run lint` pass clean.
- All routes prerender for ar/he/en (198 static pages).
- RTL verified: `<html dir>` correct per locale; logical CSS properties
  only (no left/right utilities).
- Manual test checklist lives in [README](../README.md#manual-test-checklist).

## Known limitations (documented, intentional)

- Language switcher drops query params (e.g. `?customer=` on catalog).
- `not-found` page is static trilingual (no locale context available there).
- Cart notes field is visual only (not carried into checkout state).
- No dark mode — light-only tokens in this phase.
- Product images are generated gradient placeholders.
