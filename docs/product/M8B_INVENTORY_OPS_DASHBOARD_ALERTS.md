# M8B — Inventory Operations, Duplicate Customer Guard & Dashboard Alerts

Status: implemented on `feature/M8B-inventory-ops-dashboard-alerts` (not
merged). Builds on M8A (main `eed845b`). Mock stays the zero-env default; no
legal/payment/production change — `legal_effective` stays false.

Migrations added (local; apply to hosted staging with `supabase db push` only):

| File | Purpose |
| --- | --- |
| `20260723100000_manual_inventory_adjustments.sql` | Ledger generalization (nullable `order_id`, capped `note`) + `adjust_inventory_stock` RPC |
| `20260723110000_link_order_to_customer.sql` | `link_order_to_customer` RPC (guest order → existing store) |

## A — Inventory movement history (`/admin/inventory/movements`)

Every stock change already landed on the append-only
`order_inventory_movements` ledger (M7H/M7I); M8B gives owner/admin a view:

- New page linked from `/admin/inventory` ("سجل حركة المخزون"): date, product
  (name + SKU), signed delta (green in / red out), localized reason, related
  order's internal number (or a "Manual" badge for order-less rows), note.
- Filters: free-text search (product/SKU/order/public ref/note), reason
  select (only reasons present in the data), in/out direction chips.
- Reads run under the existing RLS read policy (**owner/admin**; a sales_rep
  gets zero rows — probed). Latest 500 rows (newest first). Mock mode has no
  ledger → the empty state ("لا توجد حركات مخزون بعد").
- Known machine reasons (incl. the legacy M7H `order_delivered`) map to
  ar/he/en labels; unknown reasons render raw. `created_by` is stored but not
  displayed (auth user ids aren't resolvable to names app-side — limitation).

## B — Manual stock adjustment (owner/admin)

New RPC **`adjust_inventory_stock(p_tenant_id, p_product_id, p_delta,
p_reason, p_note)`** (SECURITY DEFINER, `search_path=''`):

- `authorize_tenant(['owner','admin'])`; product must belong to the tenant.
- Signed integer delta (±100000 cap, non-zero); reason from a fixed allowlist
  (`manual_stock_count`, `manual_damaged_goods`, `manual_returned_goods`,
  `manual_supplier_delivery`, `manual_correction`, `manual_other`); optional
  note ≤ 500 chars (also a DB CHECK).
- Inventory row locked `FOR UPDATE`; a product with NO inventory row gets one
  created at 0 (first stock count = start of tracking) — probed.
- **Negative result blocked** (`MDF32`, "لا يمكن أن يصبح المخزون أقل من صفر");
  ledger row written with `order_id NULL`, the reason, note and `created_by`;
  returns the new quantity.
- Grants: authenticated + service_role only (anon revoked — probed
  "permission denied"). sales_rep and cross-tenant owner both blocked by
  `authorize_tenant` (probed).

UI: an "تعديل المخزون" button per inventory row (owner/admin in supabase
mode only — hidden in mock and for sales_rep) expands an inline form: signed
delta, required reason select, optional note, current → new quantity preview
(negative preview highlighted), success/error messages. Ledger schema change
does NOT disturb order reconciliation — net-reserved sums are keyed by
`order_id`, and manual rows have none (regression-probed: reserve → edit →
cancel all correct post-migration).

## C — Duplicate customer guard

Guest-order promotion, signup approval and the manual create form can all
mint a store that already exists. M8B adds a tenant-scoped duplicate check
(`findCustomerDuplicates` — normalized phone match = strong, normalized name
match = soft; phone digits are compared with the Israeli `+972`/`00972`
prefix folded to `0`; runs on the caller's own RLS-scoped customer list, so
no cross-tenant data can ever appear):

- **Create customer from guest order** — when a match exists the action
  refuses and returns the matches; the order card shows "يوجد محل بنفس رقم
  الهاتف أو الاسم" with each match and two paths:
  - **ربط الطلب بمحل موجود** → new RPC `link_order_to_customer` (owner/admin,
    same-tenant order + customer, only unlinked guest orders, FOR UPDATE;
    guest snapshot preserved; double-link blocked — probed).
  - **إنشاء محل جديد رغم التشابه** → re-submits with `confirmDuplicate: true`.
- **Signup approval** — same guard in `approveSignupRequestAction`; the
  signup manager shows the matches (with a link to each existing store) and
  an "الموافقة رغم التشابه" confirm. Reject stays available.
- **Manual create form** — same guard in `createCustomerAction` (create mode
  only; edit is exempt); warning banner + "الإنشاء رغم التشابه".

The confirm flag is only honored as literal `true`; the default path always
re-checks. Actions re-validate everything and the RPCs remain the real gate.

## D — Dashboard alert cards

An operational alerts row under the at-a-glance counts, each linking where
the work happens, with a calm "all clear" line at zero:

- **طلبات زبائن جدد** — guest showcase orders in status `new` with no linked
  customer → `/admin/orders`.
- **طلبات تسجيل محلات** — pending signup requests (supabase owner/admin
  only; the card is hidden otherwise) → `/admin/customers/signup`.
- **منتجات منخفضة المخزون** — per-row `low_stock_threshold` honored (M8A) →
  `/admin/inventory`.

All computed from data the dashboard already loads (plus one signup-request
list for owner/admin) — no new heavy queries. Mock mode works (0 signups,
demo counts).

## E — Customers list search

`/admin/customers` table extracted into a client component with a search box
matching **name / contact / phone / city (all 3 locales) / address**, the
address shown under the city column, and a "لا يوجد محلات مطابقة" empty
state. Deferred: has-link/no-link filters (needs per-customer link fetches).

## i18n

All new surfaces added to ar/he/en in lockstep (typed dictionary enforces
completeness): movements view (columns, 10 reason labels, direction chips,
empty state), adjustment form (labels, preview, errors incl. the exact
Arabic strings from the spec), duplicate warnings (three surfaces), dashboard
alerts, customers search.

## Security boundaries (unchanged / reaffirmed)

- No RLS/policy change; the ledger read policy stays owner/admin.
- New RPCs: SECURITY DEFINER + `search_path=''` + `authorize_tenant`
  owner/admin; anon revoked on both; no direct table writes anywhere.
- Duplicate detection is RLS-scoped (never cross-tenant); no tokens involved.
- No new envs, no service_role exposure, no legal/payment change.

## Verification (local)

`npm run lint` / `npx tsc --noEmit` / `npm run build` (route guard: "11
critical routes exist and none are SSG") / `npm audit --omit=dev` all green.
`supabase db reset` applies both migrations; `db lint` no schema errors;
`db advisors` no issues; types regenerated. Probes: adjustment role matrix
(owner ✓ / sales_rep ✗ / anon ✗ / cross-tenant ✗), negative blocked, bad
reason blocked, untracked product starts tracking, ledger RLS (rep reads 0),
link-order (works / double-link ✗ / rep ✗), and M7H/M7I regressions (reserve,
edit reconcile, cancel restore, private-shop order, guest order) all pass on
the migrated ledger. Adversarial multi-agent review ran before commit.

## Hosted staging steps (operator — confirm STAGING first; never reset/config-push)

1. `supabase db push` to Frankfurt (`xcfjxgdfjvsqkhuiczu`) — applies
   `20260723100000_manual_inventory_adjustments`,
   `20260723110000_link_order_to_customer`.
2. No new env vars. Redeploy Vercel with **build cache OFF**; the build must
   end with the route-guard OK line.

## Manual smoke checklist (staging)

- `/admin/inventory` (owner/admin): "سجل حركة المخزون" opens the history;
  confirm an order → a reserve movement appears; cancel → a release appears.
- Adjust stock +5 with a reason + note → success + new quantity; movement
  row shows "Manual"; try a delta below zero → clear error; sales_rep sees
  neither the button nor any ledger rows.
- Guest order from a showcase link whose phone matches an existing store →
  promote shows the duplicate warning; "link to existing" attaches the order
  (snapshot kept); a second promote/link attempt fails cleanly.
- Signup request with an existing store's phone → approve shows the warning;
  approve-anyway creates the store.
- Manual create with a duplicate phone → warning + create-anyway.
- Dashboard shows the three alert cards with correct counts and links.
- Customers list search by name/phone/city filters correctly; nonsense query
  shows "لا يوجد محلات مطابقة".

## Known limitations / next

- Movement history shows the latest 500 rows; no pagination/date-range yet.
- `created_by` not displayed (no app-side auth-user name resolution).
- Duplicate guard warns on exact normalized matches only (no fuzzy matching).
- Signup approval offers approve-anyway/reject but not "link request to an
  existing store" (a request is not an order — nothing to link).
- Dashboard guest-order alert links to the full orders list (no guest-only
  filter on that page yet).
- Recommended next (M8C): movements pagination + date range, orders-list
  guest filter, customer active/inactive status, CSV exports, low-stock
  email/notification hooks.
