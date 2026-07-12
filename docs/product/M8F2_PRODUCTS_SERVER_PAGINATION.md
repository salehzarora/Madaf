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

Free-text `q` matches the product's **own top-level columns** — complete,
server-side, exact-count- and pagination-compatible in one bounded `.or()`:

- product name (`name_ar`, `name_he`, `name_en`)
- SKU (`sku`)
- barcode (`barcode`) — **added** in M8F.2 (the old UI didn't search it)

**Manufacturer scoping** is the first-class manufacturer **FILTER** (`.eq` on
`manufacturer_id`) — complete, bounded, exact — and category scoping is the
category filter. Category name was never free-text searchable.

### Previous search contract (verified against base `c4e9929`)

The base `ProductsTable` predicate matched `translations.{he,ar,en}.name`,
`sku`, and `manufacturer.name[locale]` (current locale only) — not barcode, not
category name. So the previously-searchable fields were **product name (3
locales), SKU, and manufacturer name (current locale)**.

### Manufacturer/brand-name free-text search — BLOCKED ON DATABASE DESIGN

The base substring-matched the manufacturer NAME (it held the full manufacturer
list in memory). Reproducing that as a **complete, exact, count-/pagination-
compatible** server-side query is **not expressible** in PostgREST:

- The top-level `.or()` can reference only the parent (`products`) columns.
- An embedded/`!inner` filter (`manufacturers!inner … name.ilike`) filters the
  parent by manufacturer name but with **AND** semantics — it cannot be `OR`-ed
  with the product's own-column matches, so products that match by name/SKU but
  not by brand would be dropped.
- The only single-query fold-in is pre-resolving the matching brand ids and
  adding `manufacturer_id.in.(…all of them…)` — an **unbounded** URL list whose
  size grows with the match set and can exceed URL/query limits (a prior
  attempt did exactly this). That is not acceptable and has been **removed**.

A complete, exact, pagination-compatible union of the product's own columns with
the related manufacturer name therefore **requires a database object** (below).
Until then, manufacturer-name **free-text** search is not provided; the bounded
manufacturer **filter** preserves the operator's ability to see a brand's
products. Guarded by a source-level test
(`no unbounded manufacturer-id .in() expansion`).

#### Smallest additive database design (proposal — NOT implemented)

Preferred: a **generated `search_text` column** on `products` that concatenates
the product's searchable text with the manufacturer name, kept current.

- **Option (a) — generated column + trigger:** `products.search_text text`
  populated by a `BEFORE INSERT/UPDATE` trigger on `products` from its own
  columns **plus** a lookup of `manufacturers.name_{ar,he,en}` by
  `manufacturer_id`, plus an `AFTER UPDATE OF name_* ON manufacturers` trigger
  that refreshes `search_text` for that brand's products. Search becomes one
  bounded `search_text ILIKE '%term%'` — complete, exact count, server
  pagination, no id list.
- **Option (b) — denormalized `manufacturer_name`:** a `products.manufacturer_name`
  text column synced by the same two triggers; the `.or()` adds one
  `manufacturer_name.ilike` term (still bounded).
- **Option (c) — RPC / view:** a `SECURITY INVOKER` view or RPC that joins
  `products`→`manufacturers` and exposes the combined text; the data layer
  filters/paginates/counts against it.
- **RLS / tenant:** unchanged — the column/view stays on `products` under the
  existing tenant-scoped SELECT policy; `search_text`/`manufacturer_name` carry
  no cross-tenant data; the trigger writes run in the product/manufacturer write
  path already gated by the catalog RPCs.
- **Params / count / pagination / fields:** identical to today
  (`ProductsQuery`; count-first + `.range`; sort unchanged); search field set
  gains manufacturer name.
- **Index:** only if measured — a `pg_trgm` GIN on `search_text` for large
  catalogs; **not** added now.
- **Not implemented / no migration** pending control-room approval.

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

Per-mode deterministic order (skip-/dup-free within each mode):

1. Non-blank SKUs before blank (NULL/empty/whitespace) ones.
2. Non-blank SKUs ascending: mock by UTF-16 **code unit** (`compareProductsForList`
   + `isBlankSku`); supabase `.order("sku", { ascending, nullsFirst:false })`.
3. Final unique tie-break: `id` ascending.

The old list sorted by **category shelf order then SKU** (client-side); shelf
order lives on the `categories` relation and can't be expressed server-side
without a denormalized column, so SKU (the old secondary key) is promoted to
primary — within a selected category the order is identical to before.

### Exact mock/supabase parity — BLOCKED ON DATABASE DESIGN

The accepted SKU domain is **not** collation-safe, and the two modes order it
differently. Findings:

- **Validation (`create_product`/`update_product` RPCs):** SKU is
  `nullif(trim(...), '')` (blank → NULL) and length-capped at 64. There is **no
  format restriction** — lowercase, mixed case, Unicode, punctuation and
  internal spaces are all accepted.
- **Schema:** `products.sku` is plain `text` with **no explicit `COLLATE`**;
  the unique index is `(tenant_id, sku) where sku is not null`.
- **Local DB / column collation (measured):** database `lc_collate =
  en_US.UTF-8`; the `sku` column inherits the **default** (`en_US.UTF-8`) — not
  `C`, and not pinned by any migration.
- **Measured divergence** (`ORDER BY sku` vs code-unit / `COLLATE "C"`):
  - `en_US`: `A-10, A-2, a-5, A-C, AB, DUP`
  - `C`    : `A-10, A-2, A-C, AB, DUP, a-5`
  A lowercase/punctuation SKU (`a-5`, `A-C`) sorts **differently** — so mock
  (code-unit) and supabase (`en_US`) do **not** agree over the full valid SKU
  domain. (Empty/whitespace never reach the DB — the write path stores NULL —
  and current seed/fixture SKUs are uppercase `MDF-NNNN` where the two agree,
  but the application accepts values where they do not.)

Neither the schema nor validation restricts SKUs to a collation-safe domain
(rules out outcome A), the DB collation can't be forced per-`ORDER BY` through
PostgREST (no collation option), and replicating `en_US` ICU/glibc collation in
JS is infeasible (rules out mirroring the DB in mock). Exact parity therefore
requires a **database object** and is **not** created here.

#### Smallest additive database design (proposal — NOT implemented)

- **Preferred — pin the sort collation:** `ALTER TABLE products ALTER COLUMN sku
  TYPE text COLLATE "C";` (or add a generated `sku_sort text COLLATE "C"`
  mirroring `sku`). `ORDER BY sku` (or `sku_sort`) then equals byte/code-unit
  order in **every** environment, matching the mock comparator exactly for all
  SKUs. The unique index `(tenant_id, sku)` is unaffected by ordering collation.
- **Alternative — normalized generated sort key:** a generated column (e.g.
  lower/normalized) if a case-insensitive operator order is preferred; the mock
  comparator would mirror that same normalization.
- **RLS / tenant / params / count / pagination / fields:** all unchanged — this
  only changes the SKU **ordering** collation.
- **Index:** the existing `(tenant_id, sku)` unique index already supports the
  ordered scan; a dedicated sort index only if measured.
- **Not implemented / no migration** pending control-room approval.

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

## BLOCKED ON DATABASE DESIGN (require control-room approval)

- **Complete manufacturer/brand-name free-text search** — needs a generated
  `search_text` / denormalized `manufacturer_name` column (or RPC/view). See
  _Manufacturer/brand-name free-text search_ above. Interim: the manufacturer
  filter.
- **Exact mock/supabase SKU-sort parity over the full valid SKU domain** — needs
  `sku` (or a generated sort column) `COLLATE "C"`. See _Exact mock/supabase
  parity_ above. Interim: per-mode deterministic SKU order (agrees for the
  current uppercase-ASCII SKUs).

## Deferred (not done in this phase, no migration)

- **Category-shelf-ordered server sort.** Would need a denormalized
  `category_sort_order` column (a migration). SKU order is used instead.
- **Full-catalog reads on other admin routes** (`admin/orders/[id]`,
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
