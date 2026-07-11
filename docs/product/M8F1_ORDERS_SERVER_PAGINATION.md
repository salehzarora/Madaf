# M8F.1 — Orders server-side search & pagination

Replaces the admin Orders page's load-everything-then-filter-in-the-browser
model with real **server-side** search, filtering, deterministic sorting,
pagination, an exact filtered count, and **URL-controlled** state. The page now
fetches ONLY the rows for the current page. **No migration.**

## Previous limitation

- `src/app/[locale]/admin/orders/page.tsx` called `listOrders()` → `sbListOrders()`
  which selected **every** order for the tenant (no `range`, no `count`, no
  filter) and handed the full array to the client `OrdersTable`.
- `OrdersTable` filtered the whole collection in a `useMemo` (status/source/date/
  search), resolved shop names from the full client-hydrated customer list
  (`useShopData().customerById`), and the CSV export iterated the same in-memory
  set. Search/date filters lived only in React state (not the URL), so views were
  not shareable and back/forward did not restore them.
- This does not scale: a busy tenant ships its entire order history (and customer
  list) to the browser on every visit.

## New server-side contract

Data layer (`src/lib/data`, mode boundary preserved — reads never bypass it):

- `searchOrders(query: OrdersQuery): Promise<OrdersListResult>` — current-page
  rows + exact filtered `total` + normalized `page`/`pageSize`/`totalPages`.
- `listOrdersForExport(query, cap): Promise<OrderListRow[]>` — ALL rows matching
  the SAME filters, up to `cap` (pagination ignored) — for the CSV.

Supabase (`sbSearchOrders`/`sbListOrdersForExport`, server-only, under RLS):

- One PostgREST query with `{ count: "exact" }` → current-page rows AND the exact
  total in a single round-trip. The count is computed by the DB alongside the
  `range()` — it does **not** fetch full row data.
- LEAN select: `customers (name, phone)` (LEFT embed — keeps guest/null-customer
  orders), `order_items (count)` (aggregate embed — the item array is never
  shipped), and the stored ex-VAT `subtotal`. No N+1, no full-customer load.
- Deterministic order: `created_at DESC, id DESC` (unique `id` tiebreaker →
  offset paging is skip-/dup-free even when orders share a `created_at`).
- Out-of-range page normalizes to the LAST page (no redirect, no loop):
  supabase runs an exact **head count FIRST**, clamps the page to `totalPages`,
  then range-fetches — so a stale/shared/hand-edited `?page=` never triggers a
  PostgREST 416; mock clamps the same way.
- A present-but-non-UUID `?customer=` matches no order (uuid column) and returns
  zero rows rather than a DB cast error. Date filter bounds are treated as **UTC
  calendar dates**; the quick presets (today / last-7 / month) are computed in
  UTC so preset and filter never disagree by a timezone offset.

Mock (`data/orders.ts`) reproduces the same filter/sort/paginate/count contract
over the demo array so zero-config dev keeps working.

### Search fields

`q` matches (case-insensitive) the order's OWN fields and the buyer identity
**recorded on the order**:

- `order_number` (internal, admin-only surface)
- `public_ref` (customer-facing reference)
- `customer_snapshot ->> name`  (buyer name at order time)
- `customer_snapshot ->> phone` (buyer phone at order time)

`customer_snapshot` is populated for EVERY order at creation — for a linked
customer by `_order_create_core` (name+phone), for a guest by the showcase RPC.
So the search is **complete** (no order is missed) in a single RLS-native query
with **no join, no capped customer-id pre-scan, and no migration**. Semantics:
it searches the buyer name/phone **as recorded on the order** (point-in-time),
which equals the live customer for un-renamed stores; a store renamed *after*
ordering is found by its name at order time. The internal `order_number` stays
admin-only — customer surfaces/documents continue to show `public_ref` only
(unchanged).

### Supported filters (URL params — existing names preserved)

| Param | Meaning |
|---|---|
| `q` | free-text search (above) |
| `status` | comma-separated `OrderStatus` group (e.g. `confirmed,preparing`) |
| `source` | facet: `all` \| `sales_visit` \| `shop_link` \| `guest` |
| `guest` | legacy alias: `guest=true` ⇒ source facet `guest` (dashboard card) |
| `customer` | scope to one customer id |
| `from`, `to` | inclusive calendar-date range (`YYYY-MM-DD`) on `created_at` |
| `page` | 1-based page |
| `pageSize` | optional; bounded 1–100 |

Source facet → DB predicates (mirrors the client `sourceOf`): `guest` =
`source='remote_customer' AND customer_id IS NULL`; `shop_link` =
`source='remote_customer' AND customer_id IS NOT NULL`; `sales_visit` =
`source <> 'remote_customer'`.

### Pagination

- Default page size **50** (repo convention); hard max **100**; export cap
  **5000**. Invalid `page`/`pageSize` are normalized (page ≥ 1 and clamped;
  pageSize bounded). No request is ever unbounded.
- Exact filtered `total`; `totalPages = max(1, ceil(total / pageSize))`.

### URL state

`src/lib/orders-query.ts` is the ONE shared parser/serializer used by the page
(SSR), the filter/pagination links, and the export — so they agree exactly:

- `parseOrdersQuery(searchParams)` → a normalized `OrdersQuery` (never throws).
- `ordersQueryToParams(query, patch)` → `URLSearchParams` (omits defaults).
- `withFilterChange(query, patch)` → applies the change **and resets to page 1**.

The URL is the single source of truth: the client table navigates
(`router.push`) on every filter/page change; there is no client-only filter
state that can drift. Back/forward and shared links restore the exact view.

### Dashboard / deep-link compatibility

All existing producers keep working (params unchanged): the dashboard cards
(`?status=new`, `?status=confirmed,preparing`, `?guest=true&status=new`) and the
plain “View orders” links. The customer detail page's “view all orders” link now
carries `?customer=<id>` (previously unfiltered) to support customer-scoped
filtering. Unknown-but-valid existing params are honoured; junk is ignored.

### Export

`exportOrdersAction` (owner/admin, role-gated server-side — RLS also scopes rows;
a `sales_rep` gains nothing) re-parses the SAME filters with the shared parser,
ignores `page`/`pageSize`, and returns ALL matching rows up to the cap (fetches
cap+1 to detect + flag truncation). The client builds the localized CSV via the
unchanged `toCsv`/`downloadCsv` helpers — formula-injection defense, localized
headers, and the UTF-8 BOM are intact. It exports the full filtered set, never
just the visible page.

### RLS / sales_rep preservation

Reads run on the cookie-bound authenticated client; the orders SELECT policy
(`can_access_order`) already scopes rows: owner/admin see all (incl. guest/
null-customer orders); a `sales_rep` sees only assigned-customer orders and never
guest orders. The paginated select + count both respect this automatically (RLS
counts only visible rows). `tenant_id` is derived server-side (never client
input) as belt-and-braces; no client-submitted tenant/role/customer is trusted;
no RLS/`service_role`/storage/legal/payment boundary changed.

## Test coverage

`src/lib/orders-query.test.ts` (23 tests, `npm run test:orders-search`; also part
of `npm test` + CI) — exercises the PRODUCTION functions:

default parsing · invalid page/page-size normalization · search trimming/cap ·
status group parse+dedupe · source + legacy `guest=true` parse · customer-id
validation · date-range parse · filter-change resets page · pagination URLs
preserve filters · dashboard deep-link params · URL round-trip (locale-
independent) · `orderSourceFacet` classification · `totalPagesFor` math ·
mock: no-filter page 1 + exact total · pagination returns only the requested
page (no overlap) · deterministic sort · out-of-range page → last page ·
combined search+status · export ignores pagination but keeps filters + cap ·
no tenant/role in the query state · list rows expose both order_number +
public_ref.

sales_rep RLS scoping and the live PostgREST round-trip (jsonb `->>` search,
`order_items(count)` aggregate embed, `count:exact`) are validated against the
local DB and by the manual staging smoke below.

## Migration

**None.** M8F.1 adds no migration, RPC, view, generated column, or index. All
existing orders indexes (`orders_tenant_created_at_idx (tenant_id, created_at
DESC)`, `orders_tenant_status_idx`, `orders_tenant_customer_idx`) already support
the default sort + filters. Deferred index recommendation (NOT created here): if
free-text search over large tenants becomes hot, a trigram (`pg_trgm`) GIN index
on `order_number` / `public_ref` / `customer_snapshot->>'name'` would speed the
`ILIKE` — measure first.

## Deployment & smoke checklist

No migration and no hosted command for this phase (mock/local dev + build are
zero-env). On the next staging deploy, manually smoke (all three locales, RTL):

1. Search by public ref, by internal order number, by customer name, by phone,
   by guest snapshot name.
2. Status / source (incl. guest) / customer / date-from / date-to filters, and
   combined filters — confirm the count + rows are correct.
3. Dashboard deep links (`?status=new`, `?status=confirmed,preparing`,
   `?guest=true&status=new`) and the customer detail “view all orders” link
   (`?customer=…`) land on the correct filtered list, page 1.
4. Paginate next/prev; use browser back/forward; share a filtered+paged URL.
5. Export while filtered — confirm the CSV holds ALL filtered rows (not just the
   page) up to the 5000 cap, with the cap warning past it.
6. As a `sales_rep`, confirm only assigned-customer orders appear (no guest
   orders) and the export button is hidden.
