# M8C — Operations Polish, CSV Exports & Customer Lifecycle

Status: implemented on `feature/M8C-operations-exports-customer-lifecycle`
(not merged). Builds on M8B (main `e8354a1`). Mock stays the zero-env
default; no legal/payment/production change — `legal_effective` stays false.

Migration added (local; apply to hosted staging with `supabase db push` only):

| File | Purpose |
| --- | --- |
| `20260724100000_customer_active_lifecycle.sql` | `customers.is_active` + `set_customer_active` RPC + inactive-store link blocking |
| `20260724110000_inactive_store_hardening.sql` | review follow-up: block inactive-store orders on ALL channels (MDF34) + don't rate-limit a valid inactive-store link |

## A — Orders list filters + CSV export

`/admin/orders` is now a real ops screen:

- **Filters:** status chips (unchanged) + **source** facets (زيارة مبيعات /
  رابط محل خاص / زبون جديد(عرض)) + **date range** (اليوم / آخر 7 أيام / هذا
  الشهر / فترة مخصصة with from/to date inputs) + search extended to
  **phone** (store record or guest snapshot).
- **Deep links:** `?status=<status>` preselects the status filter — the
  dashboard's "needs confirmation"/"in preparation" cards land here filtered.
- **CSV export (تصدير CSV):** owner/admin only (page-gated; mock demo open).
  Exports exactly the CURRENT filtered rows: internal order number,
  public_ref, date, status, store name, guest flag, source, subtotal
  (ex-VAT, honestly labeled `subtotal_excl_vat`), item count, phone.
  Admin-only file ⇒ the internal number is allowed; customer surfaces stay
  publicRef-only. UTF-8 BOM so Excel renders Arabic/Hebrew. Empty result →
  disabled button with "لا توجد نتائج للتصدير".
- Source semantics: an order counts as **guest** while unlinked
  (`customer_snapshot.guest` + no customer); once linked to a store it
  counts under its `remote_customer` source (shop link).

## B — Products CSV export

Export button on `/admin/products` (owner/admin; mock open) over the CURRENT
filtered rows: name, SKU, barcode, category, manufacturer, price (ex-VAT),
active/inactive, stock packages + low-stock flag (per-row threshold) for
tracked products — untracked export empty stock cells. No import in M8C.

## C — Inventory movements: date filter, load-more, export

- **Date range** filter (same presets as orders) + **manual** added to the
  direction chips (order-less rows).
- **Load more (تحميل المزيد):** the page serves the newest 500; the button
  fetches older 500-row pages through an RLS-scoped server action
  (id-deduped against offset drift). The truncation note now appears only
  while older rows actually exist.
- **CSV export** of the current filtered (loaded) rows: date, product, SKU,
  delta, reason, note, related order number + public_ref. (`created_by`
  stays DB-only — no app-side auth-name resolution; documented limitation.)

## D — Customer/store lifecycle: active / inactive

**DB:** `customers.is_active boolean not null default true` (existing rows
unaffected) + `set_customer_active(p_tenant_id, p_customer_id, p_active)`
(owner/admin via `authorize_tenant`; probed: sales_rep + cross-tenant
denied). **No hard delete anywhere.**

**Enforcement (server-side, single choke point):** `_resolve_token` now
rejects links whose customer is inactive (`P0005`) — both `get_token_catalog`
and `create_order_request_from_token` resolve through it, so an inactive
store's private link can neither browse nor order (probed). Reactivation
restores the SAME link instantly. `insert_customer_access_link` refuses new
links for inactive stores (`MDF33`, probed) — and the create action checks
BEFORE the revoke-all step so a failed regenerate can't strand the store
linkless. Showcase guest ordering is untouched (no customer attached).

**UX:**
- `/shop/<token>` of a deactivated store shows its own message — "هذا
  الدكان غير مفعّل حالياً … تواصل مع المورّد" — distinct from the
  invalid-link screen (service-client check, fail-open to the generic
  screen; the RPC boundary blocks regardless).
- Customer detail: Inactive badge + deactivate (with one confirm explaining
  the link consequence) / reactivate button (owner/admin, supabase mode).
- Links manager: inactive store → create form replaced by "لا يمكن إنشاء
  رابط لدكان غير مفعّل", regenerate hidden (revoke stays available).
- Customer picker: active stores first; inactive marked + disabled.
- Customers list: Inactive badge + active/inactive filter.
- Duplicate warnings (M8B): matches now show an Inactive badge.

**Full enforcement (review follow-up):** `_order_create_core` — the single
insert every order path shares — now blocks a new order for an inactive
customer on ANY channel (`MDF34`), so the "no new orders for a deactivated
store" rule holds for the admin/sales-visit path too, not just tokens. Guest
orders (no customer) are unaffected; existing orders are untouched. The
picker still disables inactive stores client-side as the friendly first line.
The `_resolve_token` P0005 raise is also handled without recording a token
failure, so a legit buyer of a briefly-deactivated store is never
rate-limited past reactivation (verified: 25 views → 0 recorded failures).

## E — Dashboard operational polish

- Alerts row extended: **طلبات جديدة تحتاج تأكيد** (→ `/admin/orders?status=new`),
  **طلبات قيد التحضير** (confirmed+preparing count → the orders list; the
  count spans two statuses so it links unfiltered), plus the
  M8B cards (guest orders, signup requests, low stock) — each with count
  badge and all-clear line.
- At-a-glance strip gains **مبيعات اليوم** (today's ex-VAT order value);
  **مبيعات هذا الشهر** remains the month-revenue KPI.
- All computed from data the dashboard already loads; mock mode works.

## i18n

ar/he/en in lockstep (typed): `common.exportCsv/exportEmpty`, order
source/date-filter labels, movements load-more + reworded truncation note,
dashboard needs-confirmation/preparing cards + today's-sales metric,
customers `lifecycle` block (activate/deactivate/confirm/error/filter),
links `inactiveError`, shop `inactiveTitle/inactiveBody`.

## Security boundaries (unchanged / reaffirmed)

- Lifecycle enforcement is server-side in SECURITY DEFINER RPCs; no RLS/
  policy changes; no anon grants added; `set_customer_active` anon-revoked.
- CSV exports are client-side files over rows the admin already sees
  (tenant-scoped by RLS at render); owner/admin page-gating for the buttons;
  no new data paths, no secrets, no tokens involved.
- `isShopLinkInactive` uses the server-only service client, reads only
  is_active by token_hash, fail-open to the generic invalid screen.

## Verification (local)

`npm run lint` / `npx tsc --noEmit` / `npm run build` (route guard: "11
critical routes exist and none are SSG") / `npm audit --omit=dev` all green.
`supabase db reset` applies the migration; `db lint` no schema errors;
`db advisors` no issues; types regenerated. Lifecycle probe matrix: active
order ✓ → deactivate ✓ → catalog null ✓ + order denied ✓ → new link MDF33 ✓
→ sales_rep ✗ / cross-tenant ✗ → reactivate → order ✓, history kept ✓.
Adversarial multi-agent review ran before commit; its confirmed findings
(CSV formula injection, the P0005 rate-limiter interaction, the admin-order
gap, movement pagination tie-break, load-more failure state, dashboard card
link) are all fixed and re-probed.

## Hosted staging steps (operator — confirm STAGING first; never reset/config-push)

1. `supabase db push` to Frankfurt (`xcfjxgdfjvsqkhuiczu`) — applies
   `20260724100000_customer_active_lifecycle` +
   `20260724110000_inactive_store_hardening`.
2. No new env vars. Redeploy Vercel with **build cache OFF**; the build must
   end with the route-guard OK line.

## Manual smoke checklist (staging)

- Orders: filter by status/source/date; search a phone; export CSV and open
  in Excel (Arabic renders); dashboard "needs confirmation" card lands
  pre-filtered.
- Products: export CSV; stock + low-stock columns correct for a tracked
  product; empty for untracked.
- Movements: date presets filter; "manual" chip shows only manual rows;
  load-more appends older pages; export respects filters.
- Lifecycle: deactivate a store → its `/shop/<token>` shows the inactive
  message and ordering fails; links manager blocks new/regenerated links;
  picker shows it disabled; reactivate → same link orders again; history
  intact throughout.
- Duplicates: an inactive duplicate shows its badge in the warning.
- Dashboard: today's sales value matches today's orders.

## Known limitations / next

- Admin-side ordering for an inactive store is picker-disabled only (see D).
- CSV string cells are formula-injection-neutralized (leading =,+,-,@ get a
  `'` prefix) since guest text reaches the admin's spreadsheet; generated
  numeric cells stay numeric.
- Movements date filter applies to LOADED rows (load more to widen the
  window); no server-side date query yet.
- Dashboard "in preparation" links to `?status=confirmed` (single-status
  deep link) while counting confirmed+preparing.
- Recommended next (M8D): server-side movement date queries + real
  pagination, orders guest-only filter param, manufacturer logo upload,
  sales_rep UI gating for product-edit surfaces, CSV column localization.
