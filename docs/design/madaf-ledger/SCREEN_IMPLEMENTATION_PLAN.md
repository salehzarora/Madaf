# Madaf Ledger — Screen Implementation Plan

Work top to bottom; each phase should leave `npm run lint` + `npm run build` green
and all routes rendering.

## Phase 0 — Tokens & fonts
`src/app/globals.css` @theme rewrite (DESIGN_TOKENS.md) + IBM Plex Mono in
`src/app/[locale]/layout.tsx`. The whole app shifts at once; smoke `/he`, `/ar`, `/en`,
`/he/admin` for anything unreadable before proceeding.

## Phase 1 — Primitives
`ui/button` · `ui/badge` (dot + dashed props) · `ui/chip` · `ui/input` (mono variant) ·
`ui/card` (strip header) · new `ui/shelf-rule`. Then `availability-badge` /
`order-status-badge` / `empty-state` / `metric-card` inherit automatically — verify visually.

## Phase 2 — Shells
- `admin-shell.tsx`: dark sidebar + amber active marker + orders count badge; warm top bar with session chip; mobile bottom tab bar (COMPONENT_GUIDE §admin-shell).
- `app-shell.tsx`: warm storefront header, ink cart button with amber count, split footer.
- `order-pad.tsx`, `quantity-stepper.tsx`, `locale-switcher.tsx`, `customer-picker.tsx`.

## Phase 3 — Catalog (customer flagship) → per `PASS2_DASHBOARD_CATALOG_SPEC.md` §3
`catalog-view.tsx` (command bar, category tabs, manufacturer tiles, sticky filter zone,
compact sales-visit band beside the title), `product-card.tsx` v2 (price bar),
`product-image.tsx` + `category-style.ts` (neutral placeholders + dots).
Below-xl bottom cart bar: band-dark with amber "view cart" button, rounded top corners on mobile.

## Phase 4 — Dashboard → per `PASS2_DASHBOARD_CATALOG_SPEC.md` §2
`src/app/[locale]/admin/page.tsx` recomposed: header quick actions → KPI row →
trend + status donut → top products / top shops / low stock → recent activity table.
New components: `kpi-card`, `trend-chart`, `status-donut` (+ widget markup in the page).
All aggregates computed from existing `listOrders()` / `listInventory()` data — no new endpoints.

## Phase 5 — Orders
- Orders list: status chips with square dots + mono counts; table with `bg-surface-warm` head band (11px caps `tracking-[0.08em]` headers), mono order-number links, shop cell with city sub-line, `hover:bg-brand-50/60` rows, bold tabular totals.
- Order detail: top-bar back link + mono number + ticket badge; full-width pipeline card (`order-status-control` restyle); items as table (name + package/sku sub-line, mono qty tile, totals row on `bg-surface-warm`); notes card with `border-inline-start-[3px] border-accent ps-3` quote bar; documents card — order/delivery rows `border-line bg-surface-warm`, invoiceDraft `border-dashed border-warning/45 bg-accent-wash`, mono doc numbers, brand download button, regenerate/preview outline+ghost. **Legal banner text stays.**

## Phase 6 — Products
Header + primary add button; search + mono results count; category chips;
table thumbs = 40px neutral placeholder with category-dot corner pip
(`absolute -bottom-[3px] -inset-inline-end-[3px] size-2.5 rounded-[3px] border-2 border-surface`),
mono SKU sub-line, ticket availability badges, sm-outline edit action (supabase mode).

## Phase 7 — Documents & document view
Index: dashed-amber legal banner (`accent-wash` / `accent-deep`); type badges
(order=info, delivery=brand, invoiceDraft=dashed warning); mono doc/order numbers.
`document-view.tsx` per COMPONENT_GUIDE (watermark box, ShelfRule, party bars, meta table
with `padding-inline-start`, flex name+SKU). PDF renderer (`src/lib/pdf/`) is OUT of scope.

## Phase 8 — Team & auth
Team: band invite panel with amber submit; members/invites strip-header cards, avatar
tiles (owner = band bg + amber initial), role tickets, "you" chip; rep assignments as
removable chips + dashed assign chip-button. Login/reset/onboarding/invite-accept:
band background with shelf lines + `#F7F4EC` card pattern.

## Phase 9 — Remaining pages by pattern (no dedicated mocks — follow the system)
Inventory (mono slot chips + count tiles like the dashboard low-stock rows, expiry in
dashed amber), customers (type tickets, "start order" primary sm), manufacturers,
cart/checkout/order-success, `/shop/<token>` pages, product form, not-found.
Reuse phase 1–3 components; do not invent new patterns.

## Explicitly NOT changed
Routes · data layer (`src/lib/data/`) · actions/auth logic · RLS/RPC · i18n existing keys ·
mock behaviors labeled as demo · legal wording/watermarks · VAT estimate logic ·
server PDF rendering · `src/lib/format.ts` behavior (all display formatting still goes through it).
