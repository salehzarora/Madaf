# M8F.3 — Customer Statistics Aggregate RPC

Status: implemented on `feature/m8f3-customer-stats-aggregate` (off `main` @
`60ccdbd`). **Additive migration; NOT merged, NOT deployed, NOT applied to
hosted staging.**

## Previous limitation

The admin Customers page computed its per-store stats by loading the **entire**
orders collection into the app:

```ts
const [firstPage, orders] = await Promise.all([searchCustomers(query, 0, 50), listOrders()]);
const stats = {}; for (const order of orders) { …count/lastOrder… }
```

`listOrders()` returns every tenant order; the page then iterated all of them in
memory to build `{ count, lastOrder }` per customer. It did **not** do N+1
per-customer queries, but it **scanned the full Orders collection** on every
Customers-page render (and the Customer **detail** page did the same for its
recent-orders list). The full order rows never reached the browser (stats are
computed server-side and only the `{count, lastOrder}` map is passed), but the
whole collection was loaded into app memory. The code even carried the note "A
future aggregate RPC could avoid loading the full orders list" — this is it.

## Final statistics contract

The Customers list shows exactly **two** per-store metrics (verified in
`customers-table.tsx`: `colOrders` → `stat.count`, `colLastOrder` →
`stat.lastOrder`). Both are **preserved exactly**; nothing was added.

| Metric | Meaning |
|---|---|
| **order_count** (`count`) | Number of orders **linked** to the store (`orders.customer_id = customers.id`). Guest orders (`customer_id IS NULL`) are never joined, so never counted. **All statuses count** — the old code incremented for every linked order regardless of status, so a `cancelled` order counts too. |
| **last_order_at** (`lastOrder`) | The most recent `orders.created_at` across those linked orders (**all statuses**); `NULL`/absent when the store has no orders. |

- **Status inclusion:** `new`, `confirmed`, `preparing`, `delivered`,
  **`cancelled`** — every status. **Status exclusion:** none. There is no
  `voided`/`draft` status in the schema. This preserves the current behavior
  (all-statuses); it is a defensible "total orders ever placed" count, not
  provably incorrect, so no semantic correction was made.
- **Guest behavior:** guest/orphan orders (`customer_id IS NULL`) are excluded —
  linkage is by the stable relational id **only**, never by name/phone/snapshot
  (pgTAP proves a guest order whose snapshot name equals a store's name is not
  attributed to it).
- **Inactive Customer behavior:** retains its full historical stats (no
  `is_active` filter on customers or orders).
- **Renamed Customer behavior:** unaffected — a rename changes the name, not the
  id, and stats key on the id.
- **Last-order behavior:** `max(created_at)` across all statuses; correct with
  tied dates.
- **Money representation:** **N/A — no monetary metric exists** in the Customers
  stats contract, so none is added (no `numeric`/float aggregation, no
  Order-item/Product join, no re-pricing).
- **Zero-state:** an authorized store with no orders returns an explicit row —
  `order_count = 0`, `last_order_at = NULL` — so the UI never falls back to N+1.

## Database design

- **Migration:** `supabase/migrations/20260729100000_m8f3_customer_stats_aggregate_rpc.sql`
  (next free version; `20260728100000` is M8F.2).
- **RPC:** `public.get_customer_stats_for_ids(p_tenant_id uuid, p_customer_ids uuid[])`
- **Return columns:** `customer_id uuid, order_count bigint, last_order_at timestamptz`
  — one row per **authorized, visible** requested customer (incl. zero-order).
  No unrelated customer fields.
- **Maximum customer ids:** **100** (the admin page-size max). The app passes
  one page (≤ 50).
- **Empty input:** returns zero rows. **Duplicate input:** deduped
  (`array_agg(distinct …)`, NULLs stripped). **Oversized input:** **rejected**
  (`raise exception … errcode 22023`) — never silently truncated.
- **Security mode:** `SECURITY INVOKER` (not DEFINER). **Stability:** `STABLE`.
  **Search path:** `set search_path = ''` (fully schema-qualified).
- **Execute grants:** `revoke all … from public, anon`; `grant execute … to
  authenticated` only (no anon/PUBLIC/service_role).
- **Tenant validation:** `p_tenant_id` is **server-derived** (`getReadContext`)
  and applied as an explicit belt-and-braces `c.tenant_id = p_tenant_id` filter;
  it never authorizes by itself.
- **RLS behavior:** the boundary. The base set is the **visible customers**
  relation (`can_access_customer`) restricted to the requested ids — NOT rows
  fabricated from the input UUIDs — LEFT JOINed to **visible orders**
  (`can_access_order`). An inaccessible/cross-tenant/unknown id yields no row.
- **sales_rep behavior:** not broadened — a rep's stats cover only its assigned
  stores (both the customer base and the joined orders are rep-scoped by RLS);
  pgTAP proves a rep gets no row for an unassigned customer.

## Query and performance

- **Authorized base relation:** `public.customers` (RLS `can_access_customer`).
- **Aggregate query:** `customers c LEFT JOIN orders o ON o.tenant_id =
  c.tenant_id AND o.customer_id = c.id WHERE c.tenant_id = $1 AND c.id = ANY($2)
  GROUP BY c.id`, selecting `count(o.id)` + `max(o.created_at)`.
- **Join-multiplication review:** aggregates **directly from `orders`** on the
  FK — **no** `order_items`/`product` join, so counts/totals can't be
  multiplied (pgTAP asserts count == linked order count).
- **Exact-money review:** N/A (no money metric).
- **Current-page bound / N+1:** one aggregate for ≤ 100 ids; no N+1, no
  tenant-wide full-row return, bounded response.
- **Orders full-fetch eliminated:** yes — the Customers list **and** detail page
  no longer call `listOrders()`.
- **Indexes used (measured `EXPLAIN`):** `customers_tenant_id_id_key` (index-only
  scan on the base) + **`orders_tenant_customer_idx (tenant_id, customer_id)`**
  (index scan for the aggregate join). **No new index added** — the existing
  ones suffice.
- **Deferred index recommendation:** none. (If future catalogs make the join
  hot, `orders (tenant_id, customer_id, created_at)` could serve both count and
  `max`, but there is no measured need.)

## Application integration

- **Data-layer function:** `getCustomerStatsForIds(ids): Promise<Record<string,
  CustomerRowStat>>` in `src/lib/data/customers.ts` — dedupe + bound-check
  (throws > 100), keyed by `customer_id`. `CustomerRowStat = { count: number;
  lastOrder?: string }`.
- **Supabase strategy:** `sbGetCustomerStatsForIds` filters non-UUID ids, calls
  the RPC **once** with the bounded array arg (RPC body, not a URL `.in()`
  list), maps rows to the record (`order_count → count` via `Number(...)`,
  `last_order_at → lastOrder`, `null → undefined`).
- **Mock strategy:** aggregates the demo `orders` array with the **same**
  semantics — starts from the requested customers that **exist** (a missing id
  yields no row), seeds each with `{count:0}`, folds in linked orders (guest
  orders have no `customerId`), `lastOrder = max createdAt`.
- **Customers page:** fetches the current page (`searchCustomers`), then one
  `getCustomerStatsForIds(firstPage.map(c => c.id))` — no `listOrders()`.
- **searchCustomersAction:** now also returns `stats` for the page's ids; the
  client `CustomersTable` holds `stats` in state, **replaces** it on a filter
  change (fresh page 0) and **merges** each "load more" page's stats — so every
  loaded row resolves its stats from a bounded per-page call.
- **Customer detail:** its "recent orders" list (top 5) was migrated from the
  full `listOrders()` scan to the **bounded** M8F.1 `searchOrders({ customer,
  pageSize: 5 })` (newest-first, RLS/rep-scoped). It uses order **rows**, not
  the aggregate, so it does not use the stats RPC — but it no longer scans all
  orders.
- **Export:** the Customers page has **no CSV export** — none is added.
- **Client payload:** only the current page of customers + their `{count,
  lastOrder}` — no full orders, no unrelated customer collection.
- **Error handling / locales / RTL:** unchanged — money-free stats render via
  the existing `formatNumber`/`formatDate`; loading/empty/error states, URL
  filters, pagination, ar/he/en and RTL/LTR preserved.

## Activity Log / audit

M8F.3 is **read-only** (a bounded aggregate). **No new mutative action** and
**no new audit event** are introduced. Opening the Customers list, aggregating
stats, searching, filtering, pagination, and viewing a customer are **not**
logged. Existing Customer create/edit/activate/deactivate and Order audit
behavior are unchanged. Because no event is introduced: event category, sensitivity,
and Arabic/Hebrew/English labels are all **N/A**. Nothing falls into "Other".
The stats are tenant-scoped business data, exposed only to authorized roles via
RLS.

## Tests

- **pgTAP** (`supabase/tests/customer_stats.test.sql`, 33 assertions): function
  signature; SECURITY INVOKER; STABLE; empty search_path; PUBLIC/anon/service_role
  cannot execute + authenticated can; empty/dedupe/max-100/oversized-reject;
  zero-order → 0/NULL; one/multi-order counts; exact count; `last_order_at` max
  (incl. tied dates); all-statuses incl. cancelled; inactive retains stats;
  guest not attributed (even with a matching snapshot name); cross-tenant +
  unauthorized-tenant → no rows; **sales_rep not broadened** (assigned only);
  owner sees all; missing id → no row; no join multiplication; output limited to
  requested visible customers. Second/third-tenant + authenticated owner/rep
  fixtures (rolled back).
- **Application** (`src/lib/customer-stats.test.ts`, 17 tests): empty input,
  keyed record, dedupe, max/oversized, zero-order defaults, count/lastOrder
  parity for every mock customer, exact aggregation, all-statuses incl.
  cancelled, guest exclusion, stable-id keying, contract shape, missing id,
  all-zero, plus source guards (Customers page uses the aggregate not
  `listOrders`; action returns per-page stats; detail uses `searchOrders`; RPC
  is read-only, no audit write).
- `package.json` adds `test:customer-stats`; `npm test` runs public-url +
  orders-search + products-search + customer-stats; CI runs `npm test`.

## Migration & boundaries

Additive: one function; **no** existing migration edited, no table/column/policy/
grant change (other than the function's own grant), no storage-policy change, no
`service_role` grant, no Order/Customer/Inventory lifecycle / legal / payment
change. Validated **locally only** (`supabase db reset` clean, `supabase db
lint` clean, `supabase test db` PASS = 92). **No hosted migration applied.**

## Deployment order (when approved)

Apply the additive migration to hosted staging **first** (the app calls the RPC,
so it must exist before the app build deploys), then deploy the app. The
migration is additive/read-only and safe to apply ahead of the app. **No hosted
migration has been applied yet.**

## Manual staging smoke checklist

After deploy (authenticated): the Customers list shows per-store order counts +
last-order dates matching each store's orders; a store with no orders shows `0`
and `—`; "load more" pages show correct stats; filters/search preserved; the
Customer detail page's recent-orders list shows the newest 5; a sales_rep sees
only assigned stores' stats; owner/admin see all; ar/he/en + RTL correct; the
public bundle carries no secret/service-role key and no server-only stats
implementation.

## Known limitations

- **No monetary metric** in the Customers stats contract (none existed; none
  added) — a future "total spend" metric would be a separate phase (and would
  aggregate the stored ex-VAT `orders.subtotal`, not re-priced totals).
- Single-market Asia/Jerusalem date formatting remains a documented M8F.1
  assumption (dates are formatted with the existing utilities; the aggregate
  returns the raw `timestamptz`).
