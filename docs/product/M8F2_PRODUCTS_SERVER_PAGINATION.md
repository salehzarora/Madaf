# M8F.2 — Products Server-Side Search & Pagination

Status: implemented on `feature/m8f2-products-server-pagination` (off `main`
@ `c4e9929`). **No migration. No hosted command. No deployment.**

Mirrors the proven M8F.1 Orders contract (`src/lib/orders-query.ts`,
`sbSearchOrders`) and the customers/inventory-movement server-side lists.

## Previous limitation

The admin Products page loaded the **entire catalog** into the browser:

- `app/[locale]/admin/products/page.tsx` called `listProducts({ includeInactive: true })`
  (every product) **and** `listInventory()` (every stock row) and passed both
  to `ProductsTable`.
- `ProductsTable` did all search / category / manufacturer / status filtering
  **client-side** with `useState` + `useMemo` over the full array, with **no
  pagination** and **no URL state** (filters were lost on refresh/share/back).

This does not scale: payload and client work grow linearly with the catalog.

> Note: the root layout (`app/[locale]/layout.tsx`) still hydrates
> `ShopDataProvider` with the full **active** product list for the shopping
> flows (cart, catalog, order pad, pickers). That is a shared, cross-cutting
> concern **outside M8F.2's scope** (M8F.1 left the analogous customers
> hydration in place). M8F.2 fixes the admin Products **list** itself; see
> _Deferred_ below.

## New server-side query contract

The URL is the single source of truth. One shared, pure module —
`src/lib/products-query.ts` — parses/normalizes/serializes it, so the page
(SSR), the filter/pagination links, and the CSV export all agree.

Data-layer entry points (through `src/lib/data`, mock/supabase dispatch):

- `searchProducts(query): ProductsListResult` — current-page rows + exact
  filtered total + normalized page/size/totalPages.
- `listProductsForExport(query, cap): ProductExportRow[]` — the full filtered
  set (up to the cap), pagination ignored, filters preserved.

### URL parameters (all new — the page had no URL state before)

| Param          | Meaning                                             |
|----------------|-----------------------------------------------------|
| `q`            | free-text search (trimmed, ≤120 chars)              |
| `category`     | category id (plausible-id validated)                |
| `manufacturer` | manufacturer id (plausible-id validated)            |
| `status`       | `all` \| `active` \| `inactive` (unknown → `all`)   |
| `page`         | 1-based page (invalid/≤0 → 1; clamped ≤ 1,000,000)  |
| `pageSize`     | rows/page (bounded 1…100)                            |

Defaults are omitted from the serialized URL. Any filter change resets `page`
to 1 (`withProductFilterChange`); pagination links keep all active filters
(`productsQueryToParams(q, { page })`).

## Supported search fields

Free-text `q` matches the product's **own top-level columns** — complete and
safe in a single query with exact count and pagination:

- product name (`name_ar`, `name_he`, `name_en`)
- SKU (`sku`)
- barcode (`barcode`)

Supabase uses one `.or(... ilike ...)` (or-grammar metacharacters sanitized,
mirroring `sbSearchCustomers`); mock mirrors it exactly via
`productMatchesSearch`, so mock and supabase agree and the tests exercise the
production function.

### Why manufacturer/category name are NOT free-text searched

The old client search also substring-matched the **manufacturer name** (it had
the full manufacturer list in memory). Reproducing OR-across-relations
server-side (name OR sku OR manufacturer-name) is **not expressible in one
PostgREST query** without a migration / view / RPC / generated search column —
and a capped id pre-scan or an unbounded `.in()` is explicitly disallowed.

Per the phase rules we did **not** create a migration and did **not** silently
degrade. Instead manufacturer and category are **first-class filters** (the
existing dropdown + chips, now server-side and URL-controlled), which finds
products of a manufacturer/category **more** precisely than a substring match,
and we **added barcode** to free-text search (the old UI lacked it). Net
operator capability increases; the one removed behavior (typing a brand name in
the search box) is replaced by the manufacturer filter and documented here — it
is not silent. This is **not** `BLOCKED ON DATABASE DESIGN`: the phase goal
(stop the full-catalog load; server search/filter/sort/paginate/count) is fully
met on the securely-supported fields.

## Filters

- **category** — `products.category_id = <uuid>` (a non-UUID id returns empty,
  never a DB cast error).
- **manufacturer** — `products.manufacturer_id = <uuid>` (same guard).
- **status** — `all` (no predicate) / `active` (`is_active = true`) /
  `inactive` (`is_active = false`). Mock rows carry no `is_active` ⇒ implicitly
  active (`active` → all, `inactive` → none), matching the old behavior. The
  status control only shows in supabase mode (unchanged).

Category/manufacturer **option lists** and the row **name labels** come from the
bounded reference lists already hydrated once by the layout (`useShopData`) — no
extra per-row query and no full product collection shipped for M8F.2.

## Pagination & count

Count-first, exactly like M8F.1:

1. `count: "exact", head: true` on a `select("id")` — the exact filtered total,
   **no row bodies fetched**.
2. `totalPages = ceil(total / pageSize)` (≥ 1); `page` clamped to `[1, totalPages]`.
3. Range-fetch only the current page: `.range(offset, offset + pageSize - 1)`.

An out-of-range `?page` (stale/shared/hand-edited) **normalizes to the last
page** — never a 500, a PostgREST 416, or a redirect loop. Defaults: page size
**50**, max **100** (`PRODUCTS_PAGE_SIZE` / `PRODUCTS_MAX_PAGE_SIZE`). Mock
mirrors count/clamp/slice identically.

## Deterministic sorting

**`sku` ascending (empty/NULL SKUs last), then `id` ascending** — a unique
tie-breaker so paging is skip-/dup-free. Supabase:
`.order("sku", { ascending: true, nullsFirst: false }).order("id")`; mock:
`compareProductsForList`.

The old list sorted by **category shelf order then SKU**, but shelf order lives
on the `categories` relation and can't be expressed in a single server-side
products query without a denormalized sort column (a migration — out of scope).
We therefore promoted the existing **secondary** key (SKU) to primary. Within a
selected category the order is identical to before (SKU); across categories the
grouping is dropped in favor of a global, deterministic SKU order. Documented
and tested (`compareProductsForList` + a "page is globally sorted" assertion).

## URL state & rapid-filter behavior

Client (`ProductsTable`) uses `useOptimistic(query)` and composes every change
against the **latest intended** query, exactly like `OrdersTable`:

- two quick filter changes both survive;
- a filter change during a pending page navigation resets to page 1 and keeps
  unrelated filters;
- clearing one filter keeps the others;
- the search box is an **uncontrolled** form (`key` + `defaultValue` + `FormData`
  on submit) so a keystroke can't be dropped to a stale prop;
- the settled URL is authoritative → shareable links + correct back/forward.

## Dashboard / deep-link compatibility

Repo-wide, the only links to Products are `/admin/products/new` (create) and the
row `…/products/<id>/edit` (edit) — no filtered products deep links existed, so
none break. The dashboard **low-stock** card links to
`/admin/inventory?low=1` (the **Inventory** page, unchanged) — low-stock is an
inventory feature, not a products filter, and is untouched. Product detail/edit
links still use `product.id` from the current-page rows.

## Images & storage privacy

- The product-images bucket stays **private**. The list signs images **only for
  the current page** (`signProductImages` on the page's rows), server-side, per
  request; no signed URL is persisted.
- The **export** signs **no** images and **strips** `imageUrl` /
  `imageStoragePath` from every export row, so no storage path (and no signed
  URL) reaches the client, and the CSV contains no image column. Fallback
  images (gradient) are unchanged.
- No `service_role` is used; reads run through the authenticated cookie-bound
  client. The browser key remains publishable/anon only.

## Stock / low-stock semantics

Unchanged. The row **availability badge** derives from the embedded
`inventory_items` (quantity vs threshold) at read time — no separate inventory
query (no N+1). The **export** reads stock/low-stock from the same embed. There
is **no products low-stock filter** (there never was — it lives on the Inventory
page, `?low=1`), so none was added. Inventory movements, reservation, order
lifecycle, adjustments and audit are untouched. Server-side low-stock filtering
would need a generated/denormalized column (Postgres can't filter one column
against another in the REST grammar) — a migration, out of scope; **not** faked.

## Export behavior

Products already had a CSV export (owner/admin). Preserved and moved server-side
as `exportProductsAction`:

- owner/admin gated in supabase mode (a sales_rep is refused); mock stays open.
- re-parses the same filters, **drops** `page`/`pageSize`, fetches `cap+1` to
  flag truncation (`PRODUCTS_EXPORT_CAP = 5000`) → exports **all filtered rows**
  up to the cap, not the visible page.
- localized headers (`t.csv.*`), UTF-8 BOM, and CSV formula-injection guard are
  all preserved (`src/lib/csv.ts`, unchanged).
- no signed image URLs / storage paths in the CSV.

## Roles / RLS / tenant isolation

Unchanged and preserved. Reads use `getReadContext` (= `getDataContext`, the
authenticated cookie-bound client) under existing RLS; the tenant is derived
server-side and applied as belt-and-braces `.eq("tenant_id", …)`; a tenantless
caller short-circuits to empty. No client-supplied tenant/role is trusted (the
`ProductsQuery` carries neither). The admin list still shows inactive products
under the products SELECT policy; no role's product visibility is broadened.

## Activity Log / audit

M8F.2 is **read-only** (search / filter / paginate / list / image signing /
export). **No new mutative operational action is introduced**, so **no audit
event** is created for browsing or exporting. The existing product
create/edit/activate/deactivate/inventory actions retain their current behavior
verbatim (`setProductActiveAction` etc. are unchanged). Nothing falls into
"Other".

## Test coverage

`src/lib/products-query.test.ts` — 38 tests via the production functions
(`parseProductsQuery`, `productsQueryToParams`, `withProductFilterChange`,
`productMatchesSearch`, `productMatchesStatus`, `compareProductsForList`,
`searchProducts`, `listProductsForExport`) in mock mode: default/invalid parsing,
page & page-size bounds, search trim, status/category/manufacturer parsing,
unknown-param normalization, page-reset on filter change, pagination preserves
filters, rapid two-filter composition, filter-during-pagination, clear-one-keeps-
others, deep-link compatibility, deterministic sort, no-filter list, combined
filters, page-only slice, count/total-pages, out-of-range clamp, URL round-trip,
search by name/SKU/barcode, category/manufacturer/status semantics, export
parity (drops page, keeps filters, cap), image-path stripped, id present.

`package.json` adds `test:products-search`; `npm test` runs public-url +
orders-search + products-search; CI runs `npm test`.

## Migration & boundaries

No migration; no `.sql`/RLS/storage-policy change; no `service_role` change; no
product/inventory lifecycle, legal, or payment change; no hosted command.

## Deferred (not done in this phase)

- **Slim `ShopData` for admin routes.** The root layout still ships the full
  active product list to every route via `ShopDataProvider` (needed by the shop
  flows). Splitting admin vs shop hydration is a separate phase.
- **Category-shelf-ordered server sort / relation-name search.** Would need a
  denormalized `category_sort_order` and/or a generated `search_text` column on
  `products` (a migration). Deferred index note below.

### Deferred index recommendation (do NOT add now)

For large catalogs the hot query is:

```sql
select ... from products
where tenant_id = $1 [and is_active = ...] [and category_id = ...]
      [and manufacturer_id = ...]
      [and (name_ar ilike $q or name_he ilike $q or name_en ilike $q
            or sku ilike $q or barcode ilike $q)]
order by sku nulls last, id
limit $n offset $m;
```

- Bottleneck at scale: the `ilike '%term%'` union (no btree help for a leading
  wildcard) and the `order by sku`.
- Proposal (when measured): a `pg_trgm` GIN index on the searchable text columns
  (or a generated `search_text`), plus a btree on `(tenant_id, sku)` for the
  sort. **Not added now** — no measured evidence, and the current catalogs are
  small; adding an index speculatively is out of scope.

## Deployment & smoke checklist

No deployment in this phase. After a future deploy, run the manual smoke plan in
the M8F.2 report (search by name/SKU/barcode; category/manufacturer/status
filters; combined filters; pagination; back/forward; shared filtered URL;
out-of-range `?page`; current-page image loading; edit/detail links;
create/edit/activate/deactivate regression; shop/showcase visibility; role
visibility; ar/he/en; public bundle free of secret keys).
