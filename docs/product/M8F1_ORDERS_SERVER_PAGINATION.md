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
  zero rows rather than a DB cast error.

Mock (`data/orders.ts`) reproduces the same filter/sort/paginate/count contract
over the demo array so zero-config dev keeps working.

### Search fields

`q` matches (case-insensitive) the order's OWN fields and the buyer identity
**recorded on the order**:

- `order_number` (internal, admin-only surface)
- `public_ref` (customer-facing reference)
- `customer_snapshot ->> name`  (buyer name at order time)
- `customer_snapshot ->> phone` (buyer phone at order time)

**Snapshot-population guarantee (verified from migrations).** `customer_snapshot`
has been written with `name` + `phone` for EVERY known-customer order since the
FIRST order-create path — the original M3A RPC (`20260705130000_order_write_rpcs`,
lines 126-138) sets it, and every later redefinition of `_order_create_core`
keeps doing so; guests get it from the showcase guest-order RPC
(`20260721110000`). There is **no historical window** where a known-customer
order was created without a snapshot, so **no order is silently unsearchable by
buyer name/phone**. (`customers.name` is `NOT NULL`, so the snapshot name is
always present; phone may be null if the store has no phone.)

So the search is **complete** in a single RLS-native query with **no join, no
customer-id pre-scan (capped or otherwise), no full-order fetch, and no
migration** — every order is findable by `order_number`, `public_ref`, or the
buyer name/phone recorded on it, for both known-customer and guest orders.

**Contract: point-in-time.** Search matches the buyer name/phone **as recorded
on the order** (the snapshot at creation), which equals the live customer for
un-renamed stores. A store renamed (or with a changed phone) *after* ordering is
found by its **name at order time**, not the brand-new name. This is a
deliberate, complete, server-side contract. (The previous client-side search
additionally matched the *current* customer row via a full client-side customer
list; that required loading every customer + every order into the browser — the
scaling problem M8F.1 removes. Current-name search would need either an unbounded
customer-id `.in()` — a URL-length hazard — or a DB search column/RPC, i.e. a
migration, which is out of scope; it is **not** required for completeness since
every order is already searchable by its recorded buyer.) The internal
`order_number` stays admin-only — customer surfaces/documents show `public_ref`
only (unchanged).

### Supported filters (URL params — existing names preserved)

| Param | Meaning |
|---|---|
| `q` | free-text search (above) |
| `status` | comma-separated `OrderStatus` group (e.g. `confirmed,preparing`) |
| `source` | facet: `all` \| `sales_visit` \| `shop_link` \| `guest` |
| `guest` | legacy alias: `guest=true` ⇒ source facet `guest` (dashboard card) |
| `customer` | scope to one customer id |
| `from`, `to` | inclusive market-timezone calendar-date range (`YYYY-MM-DD`) on `created_at` |
| `page` | 1-based page |
| `pageSize` | optional; bounded 1–100 |

Source facet → DB predicates (mirrors the client `sourceOf`): `guest` =
`source='remote_customer' AND customer_id IS NULL`; `shop_link` =
`source='remote_customer' AND customer_id IS NOT NULL`; `sales_visit` =
`source <> 'remote_customer'`.

### Date-filter timezone contract

There is **no per-tenant/business timezone** in the schema or settings, and the
app serves a single market (Israel — see `CLAUDE.md`). Date filters are therefore
interpreted as **calendar days in the market timezone (`Asia/Jerusalem`)**, not
UTC: `from=2026-07-05` means the whole of July 5 *in the market* (its lower bound
is `2026-07-04T21:00Z` in summer / `22:00Z` in winter — DST-aware via `Intl`),
and `to` is inclusive of its whole day (exclusive upper = the next day's market
start). This matches how an Israel-market admin reads the dates and avoids UTC
clipping the first ~3 local hours of a day (which would exclude early-morning
orders the admin sees dated that day). The list, the export, the mock, and the
quick presets (today / last-7 / month, computed via `marketToday()`) all use the
**identical** bounds, so there is no client/server drift; URL values stay stable
`YYYY-MM-DD` and are locale-independent. **Limitation:** the market timezone is a
hard-coded single-market assumption; a non-Israel admin's date *display*
(`formatDate`, browser-local) could differ from the filter near midnight. A
per-tenant timezone is future work (M8F.2+) — no migration/setting added here.

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

**Race-free composition.** While a navigation is pending, the table holds an
**optimistic** copy of the intended query (`useOptimistic`) and composes every
change against it (via `toggleStatusFilter` / `withFilterChange`) — never against
the stale server prop. So two quick filter toggles both land (the second is not
computed off pre-toggle state), a filter change during a pending page navigation
still resets to page 1 and preserves unrelated filters, and the search + date
inputs are uncontrolled forms that read the DOM. The optimistic state resets to
the server query when navigation settles (and on back/forward), keeping the URL
authoritative.

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

`src/lib/orders-query.test.ts` (38 tests, `npm run test:orders-search`; also part
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

**Correction pass:** race composition — two rapid status toggles both retained,
toggle-off, status+source together, filter-during-pending-page resets page 1 +
keeps filters, search/date don't drop status/source, clearing one keeps others ·
search semantics — `orderMatchesSearch` for known + guest by name/phone,
renamed-customer point-in-time (recorded matches, current doesn't), no-snapshot,
mock known-customer-by-name via the synthesized snapshot · date bounds —
`marketDayStartUtcIso` DST-aware (summer +3 / winter +2), `nextCalendarDay`
month/leap/year boundaries, just-after-market-midnight inclusion (no UTC
clipping), from/to inclusivity, and list/export date parity.

sales_rep RLS scoping and the live PostgREST round-trip (jsonb `->>` search,
`order_items(count)` aggregate embed, `count:exact`, market-tz date bounds) are
validated against the local DB and by the manual staging smoke below.

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
