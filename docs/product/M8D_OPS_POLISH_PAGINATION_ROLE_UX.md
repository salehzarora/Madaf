# M8D — Server-side Ops Polish, Localized Exports & Role UX

Status: implemented on `feature/M8D-ops-polish-pagination-role-ux` (not
merged). Builds on M8C (main `4e96383`). **No migrations — pure app-layer.**
Mock stays the zero-env default; no legal/payment/production change —
`legal_effective` stays false.

## A — Server-side inventory movement filtering + pagination

The movement history (`/admin/inventory/movements`) previously filtered
loaded rows client-side. Now the **filters run in the DB query** (RLS
owner/admin), so the client never holds more than one page of real data:

- New `sbSearchInventoryMovements(query, offset, limit)` (RLS-native
  PostgREST) + `searchInventoryMovements` boundary + `searchMovementsAction`
  (validated: offset bound, reason allowlist, product-id cap/filter).
- Filters pushed server-side: **date range** (today / 7d / month / custom),
  **reason** (fixed allowlist), **direction** (in `>0` / out `<0` / manual
  `order_id IS NULL`), **product search** — the term is resolved to product
  ids client-side against the loaded catalog and passed as `.in()`; a search
  matching nothing yields `[]` → **zero rows** (verified end-to-end, not
  "all rows").
- **Deterministic order** `created_at desc, id desc` (the id tiebreaker
  handles same-`now()` reserve rows from one transaction) → offset paging is
  skip-/dup-free. "Load more" fetches the next 50-row page with the SAME
  filters and appends (id-deduped). The initial page is SSR'd (unfiltered,
  50 rows); the client re-queries page 0 on any filter change (search
  debounced 300ms).
- **Export** covers the current loaded (server-filtered) rows.
- RLS unchanged: owner/admin read; a sales_rep gets **0 rows** (probed);
  anon has no grant. Mock has no ledger → empty state.

Ledger semantics unchanged — manual rows keep `order_id NULL` and never
enter order reconciliation.

## B — Orders deep links + filter chips

- `/admin/orders` reads query params: `?status=confirmed,preparing`
  (comma-separated **status GROUP** — status chips are now **multi-select**,
  empty = all), `?source=<facet>`, `?guest=true` (alias for the guest
  source facet). Invalid values are ignored.
- A **clear-filters** button appears whenever any filter is active
  (status/source/date/search).

## C — Dashboard deep links (count ↔ destination now match)

- **New orders needing confirmation** → `?status=new` (count = status new).
- **Orders in preparation** → `?status=confirmed,preparing` (count =
  confirmed+preparing — now the deep-link and count agree, fixing the M8C
  mismatch).
- **New-store guest orders** → `?guest=true` (count = new + no customer +
  `snapshot.guest`; the source facet uses the same definition).
- Pending signup requests / low-stock cards → their pages (low-stock with
  `?low=1`).

## D — Localized CSV export headers

Orders, products and movements exports now emit **locale-specific column
headers** (ar/he/en) via new `dict.*.csv` blocks — e.g. "رقم الطلب الداخلي",
"اسم المنتج", "التغيير". File names stay `madaf-orders/products/inventory-
movements-YYYY-MM-DD.csv`. The M8C formula-injection defense is unchanged
(static header strings are safe; data cells beginning `= + - @` are still
neutralized; `+972…` phones stay text), BOM preserved, empty-export button
still disabled with a tooltip.

## E — sales_rep role UX gating (UI-only; backend unchanged)

The backend RPCs remain the source of truth (owner/admin gates untouched).
M8D only stops showing a sales_rep actions that would fail:

- **Order detail**: the status pipeline is **read-only** (no clickable
  transitions, no cancel — shows "لا تملك صلاحية تنفيذ هذا الإجراء"); the
  item editor and guest-promote card are hidden (`live && canManage`).
- **Products**: a sales_rep sees a **read-only list** — no Add button, no
  edit/activate actions column (the active/inactive view filter stays).
- **Manufacturers**: no Add / edit actions for a sales_rep.
- Already-gated in M8B/M8C (unchanged): manual stock adjustment, CSV export,
  private-link management, signup approval, customer deactivation.

`canManage = !isSupabase || role === owner|admin` (mock demo = full access)
is computed per admin page and passed to the components. **No RLS or RPC
grant was weakened.**

## F — Low-stock polish

- The dashboard low-stock card and sidebar link to `/admin/inventory?low=1`,
  which preselects the low-stock filter.
- **Inactive products are excluded** from the low-stock count (dashboard)
  AND the low-stock filter (inventory list), so the count matches the list.
- Per-product `low_stock_threshold` is honored (M8A `isLowStock`); the
  inventory low-stock filter has its own empty state ("لا توجد منتجات
  منخفضة المخزون"). Products export already includes the low-stock column.

## i18n

ar/he/en in lockstep (typed): `common.noPermission`; `orders.clearFilters` +
`orders.csv` (10 headers); `products.csv` (9 headers); `inventory.lowEmpty` +
`inventory.movements.csv` (8 headers).

## Security boundaries (unchanged / reaffirmed)

- No migrations; no RLS/policy/grant change; movement reads stay RLS
  owner/admin (sales_rep 0 rows probed; anon denied).
- Role gating is UI-only — every gated action's RPC still enforces
  owner/admin server-side.
- CSV exports are client-side over already-rendered RLS-scoped rows;
  owner/admin page-gated; formula-injection defense intact; no secrets or
  token hashes; admin export may include the internal order number
  (customer surfaces stay publicRef-only).

## Verification (local)

`npm run lint` / `npx tsc --noEmit` / `npm run build` (route guard: "11
critical routes exist and none are SSG") / `npm audit --omit=dev` all green.
`supabase db reset` + `db lint` + `db advisors` clean (no schema change).
Probes: movement reason/direction/manual/product/date filters return correct
counts; sales_rep RLS = 0 movements, anon denied; deterministic tiebreaker
confirmed; empty product-id filter returns 0 rows (not all). Adversarial
multi-agent review ran before commit.

## Hosted staging steps (operator — confirm STAGING first; never reset/config-push)

**No migration to push.** Redeploy Vercel with **build cache OFF**; the
build must end with the route-guard OK line. (The two M8C migrations
`20260724100000`/`20260724110000` remain the outstanding hosted DB step from
the M8C merge if not yet pushed.)

## Manual smoke checklist (staging)

- Movements: apply date/reason/direction/manual filters (server-side); type a
  product name → only that product's rows; a non-matching term → empty; load
  more appends older rows with no dupes; export respects filters.
- Orders: dashboard "in preparation" card opens `?status=confirmed,preparing`
  with both chips lit and the count matching; guest card opens `?guest=true`;
  clear-filters resets.
- Low-stock: dashboard card opens `/admin/inventory?low=1` filtered; count
  matches the list; a deactivated low-stock product is excluded from both.
- Role: sign in as a sales_rep — order status is read-only with the
  no-permission note; no product/manufacturer add/edit; movements page empty;
  no export button. Owner/admin unchanged.
- CSV: headers are in the current locale; a store named `=1+1` exports as
  literal text; a `+972…` phone stays text.

## Known limitations / next

- Movement export covers the currently-loaded (server-filtered) rows; a
  "load more" widens the window. A true full-filtered server export (stream
  all matching rows) is deferred.
- Movement product search resolves the term to ids from the loaded catalog
  (fine at demo scale); a very large catalog could exceed the 1000-id `.in()`
  cap (silently capped — documented).
- Recommended next (M8E): full server-side filtered export, customer-list
  server pagination, manufacturer logo upload, per-tenant default VAT on the
  product form, document HTML-preview snapshot fidelity.
