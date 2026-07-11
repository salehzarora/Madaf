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

Additionally, the **root layout** (`app/[locale]/layout.tsx`) hydrated
`ShopDataProvider` with the full **active** product list **and** the full
customer list for **every** route — including admin routes — so opening the
admin Products list serialized the whole catalog + customer collections into the
browser regardless of pagination. The correction pass fixes this too (see
**Admin-route payload**).

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

Free-text `q` matches (complete, server-side, exact-count- and
pagination-compatible):

- product name (`name_ar`, `name_he`, `name_en`)
- SKU (`sku`)
- barcode (`barcode`) — **added** in M8F.2 (the old UI didn't search it)
- **manufacturer / brand name (all three locales)** — the pre-M8F.2 search
  matched the manufacturer name (current locale only); **restored** here and
  **improved** to all three locales.

### Previous search contract (verified against base `c4e9929`)

The base `ProductsTable` predicate matched: `translations.{he,ar,en}.name`,
`sku`, and `manufacturer.name[locale]` (current locale only). It did **not**
match barcode or category name. So the previously-searchable fields were
**product name (3 locales), SKU, and manufacturer name (current locale)**.
M8F.2 preserves all of them (manufacturer name broadened to 3 locales) and adds
barcode. **Category name was never searchable and is not added.**

### How the manufacturer-name search stays complete + safe (no migration)

Product-name/SKU/barcode are the product's own columns → one `.or(... ilike)`.
Manufacturer name lives on the related `manufacturers` table; PostgREST can't
`OR` a top-level column with a related-table column in one query. Rather than a
migration, M8F.2 resolves the matching brand ids **first** and unions them in:

1. `sbManufacturerIdsMatching(client, tenant, term)` — a **complete (uncapped),
   tenant-scoped** query over the `manufacturers` reference table returning
   **all** brand ids whose `name_ar/he/en` match. This is **not** a capped
   pre-scan of a large relation and **not** an unbounded id list: `manufacturers`
   is bounded per-tenant reference data — the very set already loaded once for
   the filter dropdown. Precedent: `sbSearchCustomers` (`hasLink`) and
   `sbSearchInventoryMovements` (`productIds`) use the same pattern.
2. The products `.or()` adds `manufacturer_id.in.(…thoseIds)` alongside the
   name/sku/barcode `ilike`s. The **same** pre-resolved id set feeds the count,
   the page, and the export, so count == list and pagination is exact.

Mock mirrors this exactly: `filterMockProducts` passes each product's
manufacturer name (via `manufacturerById`) to `productMatchesSearch`, which ORs
the product's own columns with the brand name (all locales). Because the brand
pre-query is **complete** and expressible with the **existing schema +
authenticated PostgREST**, this is the "implement it" path — **not**
`BLOCKED ON DATABASE DESIGN`.

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

## Admin-route payload (full catalog no longer shipped)

The provider tree was split by route so admin routes receive **only** bounded
reference data:

- **Root layout** — hydrates **no** catalog data and renders **no**
  `ShopDataProvider`/`CartProvider` (just `<html>/<body>`).
- **Storefront `(shop)` layout** — hydrates the **full** `ShopDataProvider`
  (products, categories, manufacturers, customers) **+** `CartProvider`. The
  shop flows (catalog, cart, order pad, pickers, checkout) legitimately browse
  the whole catalog client-side; unchanged behavior, just scoped here.
- **`admin` layout** — hydrates a **slim** `ShopDataProvider`:
  `categories` + `manufacturers` only (the filter/label reference data),
  `products={[]}` and `customers={[]}`. The paginated Products list fetches only
  its current page via `searchProducts`.
- **`admin/documents/[id]`** — the one admin route whose `DocumentView` needs
  line-item + customer names provides `products` + `customers` **locally** via a
  nested `ShopDataProvider` on that route only.
- **Auth/token pages** (login, onboarding, reset-password, invite/join/shop/
  showcase tokens) are self-contained and use neither provider.

Result on `/admin/products`: the browser receives the **current page of
products** + the bounded **categories/manufacturers** reference lists — never
the full product, customer, or inventory collections. Guarded by source-level
tests (`guard:` cases in `products-query.test.ts`) so a regression that
reintroduces `listProducts`/`listInventory` on the admin products page or the
admin/root layout fails the suite. Only the current page's images are signed
(the list route). Category/manufacturer option lists come from the complete,
uncapped, tenant-scoped `listCategories`/`listManufacturers`.

## Deterministic sorting

**The single mock/supabase contract:**

1. Non-blank SKUs sort **before** blank ones. A SKU is **blank** when it is
   NULL/missing, empty (`""`), or whitespace-only.
2. Among non-blank SKUs: ascending by raw SKU, **by UTF-16 code unit**
   (`<`/`>`) — **not** `localeCompare` (whose result varies by environment
   locale). For the ASCII SKUs the app produces this equals the DB byte order.
3. Case: code-unit, so uppercase sorts before lowercase (`'D'`=0x44 < `'a'`=0x61).
4. Numeric-looking SKUs: plain string order (`"A-10"` < `"A-2"` because
   `'1'` < `'2'`) — no natural/numeric sort.
5. Duplicate SKUs → the **id** tie-break.
6. Final unique tie-breaker: `id` ascending (code-unit).

Mock: `compareProductsForList` (+ `isBlankSku`). Supabase:
`.order("sku", { ascending: true, nullsFirst: false }).order("id")`. **Parity:**
the product write path (`readProductInput` → `str()` trims blanks to
`undefined` → stored **NULL**) never stores empty/whitespace SKUs, so the DB
only holds a non-blank value or NULL — for which `nullsFirst:false` (NULL last)
+ ASCII code-unit ordering matches the mock exactly. The fixture test
(`A-2`, `A-10`, lowercase, duplicate, empty, whitespace, NULL, equal-SKU
distinct ids) asserts the exact order and **no duplicate or skipped row across
pages**. (A hand-inserted empty-string SKU is the one value the app can't
produce; fully DB-guaranteed byte ordering for arbitrary SKUs would need a
`COLLATE "C"`/generated sort column — a migration, out of scope.)

The old list sorted by **category shelf order then SKU**, but shelf order lives
on the `categories` relation and can't be expressed server-side without a
denormalized column (migration). SKU (the old **secondary** key) is promoted to
primary; within a selected category the order is identical to before.

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

Madaf's audit surface is the append-only `public.audit_events` table
(`event_type` e.g. `product.created`, `order.status_changed`,
`document.voided`), written **only by DB triggers / service-role on MUTATIONS**
(RLS: members `SELECT` only; no client/app inserts). It records **state
changes**, never reads.

- **Did Product CSV export already have an audit event?** No. The base export
  (`c4e9929`) was a **client-side** `downloadCsv` built from already-loaded data
  — no server action, no audit.
- **Does M8F.2 change the export's user-visible action or data scope?** No. Same
  owner/admin action, same filtered rows (up to the cap); it just moved to a
  server action so the browser no longer holds the full catalog.
- **Sensitivity:** the export projects tenant-scoped catalog data the owner/
  admin already sees (no secrets, no cross-tenant data, no image paths).
- **New audit event required?** **No.** Export — like search, filtering,
  pagination, list-opening and signed-image resolution — is a **read**;
  `audit_events` is mutation-only, so logging a read would be inconsistent with
  the established model and is explicitly out of scope. Nothing falls into
  "Other" (no new `event_type` is introduced).
- Existing product create/edit/activate/deactivate/inventory mutations retain
  their current audit behavior verbatim (`setProductActiveAction` etc.
  unchanged). M8F.2 introduces **no new mutative action**.

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

- **Category-shelf-ordered server sort.** Would need a denormalized
  `category_sort_order` column on `products` (a migration). SKU order is used
  instead (documented above).
- **DB-guaranteed byte-exact SKU ordering for pathological SKUs** (empty/
  whitespace/collation-sensitive). Would need a `COLLATE "C"`/generated sort
  column (migration). The app write path prevents such SKUs, so mock/supabase
  agree for all app-producible data.
- **Full-catalog reads on other admin routes** (e.g. `admin/orders/[id]`,
  `admin/manufacturers`, `admin/documents/[id]`) load their own products as
  props — pre-existing, out of M8F.2 scope (which targets the Products list).

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
