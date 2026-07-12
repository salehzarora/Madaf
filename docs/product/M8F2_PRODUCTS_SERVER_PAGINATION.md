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

## The read-only search RPC (`public.search_product_page_ids`)

Migration `supabase/migrations/20260728100000_m8f2_product_search_page_rpc.sql`
adds ONE additive function that resolves both earlier blockers (complete
brand-name search + exact deterministic SKU order). It is the reason the prior
`manufacturer_id.in.(…)` fold-in and the sort-collation divergence are gone.

- **Signature:** `search_product_page_ids(p_tenant_id uuid, p_search text,
  p_category_id uuid, p_manufacturer_id uuid, p_status text, p_page int,
  p_page_size int)`.
- **Returns** ONE row (even for zero matches): `total_count bigint`,
  normalized `page`, `page_size`, `total_pages`, and `product_ids uuid[]` — the
  CURRENT page's ordered ids only, **bounded by the page size (≤ 100)**. No
  signed image URLs, no unbounded id set.
- **Security:** `SECURITY INVOKER`, `STABLE`, `set search_path = ''`, fully
  schema-qualified. Runs as the authenticated caller, so the existing RLS SELECT
  policies on `products` + `manufacturers` (`is_tenant_member(tenant_id)`) are
  the authorization boundary. `p_tenant_id` is **server-derived**
  (`getReadContext`) and applied as an explicit belt-and-braces filter — it
  never authorizes by itself: an authenticated user passing a tenant they are
  not a member of gets **zero** rows (proven in pgTAP). `revoke all … from
  public, anon`; `grant execute … to authenticated` only (no anon/PUBLIC/
  service_role). No `SECURITY DEFINER`.
- **Detail fetch:** the data layer calls the RPC for the page's ids, then
  fetches detail rows (incl. the `inventory_items` embed for availability) for
  just those **bounded** ids (`.in("id", ids)`, ≤ page size), re-orders them by
  the RPC order, and **safely skips** any id whose row vanished between count
  and fetch. Only the current page's images are signed.

## Supported search fields

Free-text `q` is a **literal, case-insensitive substring** (the RPC uses
`strpos(lower(field), lower(term)) > 0` per field, so `%`/`_` are never wildcard
operators and no term matches across a field boundary). It covers, via a
tenant-safe `products ⟕ manufacturers` LEFT JOIN expressed as
`product-field match OR manufacturer-name match`:

- product name (`name_ar`, `name_he`, `name_en`)
- SKU (`sku`)
- barcode (`barcode`) — **added** in M8F.2 (the old UI didn't search it)
- **manufacturer / brand name (`name_ar`, `name_he`, `name_en`)** — the
  pre-M8F.2 search matched the brand name (current locale only); **restored and
  broadened to all three locales**.

A product that matches its **own** name/SKU/barcode is kept even when its
manufacturer does not match (LEFT JOIN); a product whose own fields don't match
is included when its **manufacturer** name matches. Category name was never
free-text searchable and is not added; category + manufacturer remain
first-class **filters**. Mock mirrors this exactly (`productMatchesSearch` with
the manufacturer name). Verified against base `c4e9929`: the previously-
searchable fields (product name ×3, SKU, manufacturer name) are all preserved.

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

The RPC computes it all in one round trip: filters + search are applied, then a
window (`count(*) over ()` + `row_number()`) yields the **exact** `total_count`,
`total_pages = ceil(total / page_size)` (≥ 1), the page **clamped** to
`[1, total_pages]`, and the current page's ordered `product_ids` (via the
`row_number` range). An out-of-range `?page` (stale/shared/hand-edited)
**normalizes to the last page** — never a 500/416/redirect-loop; zero matches
return `total 0, page 1, total_pages 1, product_ids '{}'`. `page_size` is bounded
1…100 and `page` ≥ 1 inside the RPC. Defaults: page size **50**, max **100**
(`PRODUCTS_PAGE_SIZE` / `PRODUCTS_MAX_PAGE_SIZE`). Mock mirrors count/clamp/slice
identically.

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

## Deterministic sorting — exact mock/supabase parity

The ONE contract, applied identically in both modes:

1. non-blank SKUs before blank ones — **blank** = `nullif(btrim(sku), '') is
   null` (NULL, empty, or spaces-only; `btrim` trims **spaces** only);
2. non-blank SKUs ascending by their space-trimmed value in **`COLLATE "C"`**
   (byte order);
3. final unique tie-break: `id` ascending.

- **Supabase (the RPC):** `order by (nullif(btrim(sku),'') is null),
  nullif(btrim(sku),'') collate "C" asc, id asc`. `COLLATE "C"` pins the order to
  **byte order in every environment** — independent of the DB's `lc_collate`
  (measured `en_US.UTF-8`), which is exactly why a per-`ORDER BY` collation
  (i.e. an in-query object) was required rather than relying on the column
  default.
- **Mock (`compareProductsForList`):** blank via `skuSortKey` (btrim spaces →
  null if empty); non-blank compared by **UTF-8 bytes** (`utf8ByteCompare` via
  `TextEncoder`) — **not** `localeCompare` and **not** JS `<` (UTF-16 code
  units, which mis-order astral vs high-BMP characters relative to code points).
  UTF-8 byte order == `COLLATE "C"` for **every** Unicode string.

**Parity evidence (measured on the local DB):** `COLLATE "C"` orders
`A-10, A-2, A-C, AB, DUP, a-5` then blanks — the app test
`compareProductsForList reproduces the DB COLLATE "C" order` asserts the mock
produces the identical sequence; the pgTAP suite asserts the RPC's order for
mixed-case, punctuation, Unicode (high-BMP U+E000 before astral U+10000),
NULL/blank-last, and the duplicate-sort-key id tie-break. So the contract holds
for uppercase/lowercase/mixed-case/digits/punctuation/internal-spaces/Unicode/
duplicate/NULL/empty/whitespace, with an `id` tie-break and no dup/skip across
adjacent pages.

The old list sorted by **category shelf order then SKU** (client-side); shelf
order lives on the `categories` relation and can't be expressed server-side
without a denormalized column, so SKU (the old secondary key) is promoted to
primary — within a selected category the order is identical to before.

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
as `exportProductsAction`, sharing the RPC search semantics with the list:

- owner/admin gated in supabase mode (a sales_rep is refused); mock stays open.
- re-parses the same filters, **drops** `page`/`pageSize`, fetches `cap+1` to
  flag truncation (`PRODUCTS_EXPORT_CAP = 5000`) → exports **all filtered rows**
  up to the cap, not the visible page.
- **bounded page batching:** `sbListProductsForExport` loops the RPC at
  `page_size = 100`, accumulating each page's ordered detail rows until the cap
  or `total_pages`. Each request's id set is bounded (≤ 100 — no unbounded id
  expression); a `seen` set de-dupes any id that reappears (concurrent insert),
  and a `maxPages` guard + the `total_pages` break prevent any infinite loop,
  repeated page, or missing/duplicate id. Order is preserved across pages.
- localized headers (`t.csv.*`), UTF-8 BOM, and CSV formula-injection guard are
  all preserved (`src/lib/csv.ts`, unchanged).
- no image signing, and no image URL / storage path in the CSV.

## Roles / RLS / tenant isolation

Unchanged and preserved. Reads use `getReadContext` (= `getDataContext`, the
authenticated cookie-bound client) under existing RLS. The search RPC is
SECURITY INVOKER, so RLS on `products` + `manufacturers` is the boundary; the
server-derived tenant is passed as `p_tenant_id` and applied as a belt-and-braces
filter, never as authorization (an unauthorized tenant arg → zero rows, proven
in pgTAP). The bounded detail fetch adds an explicit `.eq("tenant_id", …)`; a
tenantless caller short-circuits to empty. No client-supplied tenant/role is
trusted (`ProductsQuery` carries neither). The admin list still shows inactive
products (member-visible SELECT policy); no role's product visibility is
broadened (sales_rep sees the same set — proven in pgTAP).

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

**Database — pgTAP** (`supabase/tests/product_search_page.test.sql`, 32
assertions, run via `supabase test db`): function signature; SECURITY INVOKER;
PUBLIC/anon/service_role cannot execute + authenticated can; tenant isolation +
unauthorized-tenant-arg → zero rows; sales_rep not broadened; owner sees
inactive; zero-result metadata; exact count; page-size normalization;
out-of-range clamp; search by name/SKU/barcode/manufacturer-name;
direct-field-OR-manufacturer; category/manufacturer/active/inactive/combined
filters; `COLLATE "C"` mixed-case/punctuation/Unicode ordering; NULL+blank last;
duplicate-sort-key id tie-break; two adjacent pages disjoint; no cross-tenant
manufacturer-JOIN leakage. Fixtures create disposable second/third tenants +
authenticated users (rolled back).

**Application** (`src/lib/products-query.test.ts`, mock mode, production
functions): parsing/bounds/URL round-trip; filter/pagination/rapid-composition;
search by product name/SKU/barcode **and manufacturer name (ar/he/en)**;
direct-field-OR-manufacturer; combined filters; deterministic order incl. the
`compareProductsForList reproduces the DB COLLATE "C" order` parity check, the
Unicode `utf8ByteCompare` check, and the tricky SKU fixture with no dup/skip;
export parity; image-path stripped; provider-coverage + no-unbounded-`.in()`
guards.

`npm test` runs public-url + orders-search + products-search; CI runs `npm test`.

## Migration & boundaries

- **Additive migration** `20260728100000_m8f2_product_search_page_rpc.sql` —
  creates ONE function (`search_product_page_ids`). No table/policy/grant change
  (other than the function's own grant), **no existing migration edited**,
  no storage-policy change, no `service_role` grant, no product/inventory
  lifecycle / legal / payment change. Applied and validated **locally only**
  (`supabase db reset` from zero, `supabase db lint` clean, `supabase test db`
  PASS). **Not applied to hosted staging** in this phase.

## Deferred index recommendation (do NOT add now)

The RPC's hot path is the `strpos(lower(...), lower(term))` OR across product +
joined manufacturer columns, plus the `order by … collate "C"`. For large
catalogs, a future option (when measured): a `pg_trgm` GIN over a materialized
`search_text`, plus a btree supporting the `(tenant_id, sku COLLATE "C", id)`
order. **Not added** — no measured evidence; catalogs are small; the RPC returns
only a bounded page.

## Deployment & smoke checklist

**Deployment order (when approved):** apply the additive migration to hosted
staging FIRST (the browser client calls the RPC, so it must exist before the app
build deploys), then deploy the app. The migration is additive and safe to apply
ahead of the app. **No hosted migration has been applied yet.**

After deploy, run the manual smoke plan in the M8F.2 report (search by
name/SKU/barcode **and manufacturer/brand name**; category/manufacturer/status
filters; combined filters; pagination; back/forward; shared filtered URL;
out-of-range `?page`; current-page image loading; edit/detail links;
create/edit/activate/deactivate regression; shop/showcase visibility; role
visibility; ar/he/en; public bundle free of secret keys).
