# Future Backend Handoff

For the coding/backend agent that connects Madaf to real infrastructure.
Read PRODUCT_BRIEF.md and MVP_SCOPE.md first. **Do not redesign the UI** —
everything here was built to be wired, not rebuilt.

> **STATUS — M2 shipped** (M1: schema + RLS + seed; M1.1: RLS hardening).
> Every UI read now goes through `src/lib/data/` — no page or component
> imports `src/lib/mock` anymore (only the data layer does). Server pages
> await the data functions; client components receive props or the
> `ShopDataProvider` context (`src/lib/shop-data-context.tsx`), so no
> client ever fetches or sees a key. Pure helpers live in
> `src/lib/catalog-helpers.ts`. Supabase read branches are implemented in
> `src/lib/data/supabase-reads.ts` (server-only, local-dev service-role
> client pinned to the demo tenant — replaced by authenticated clients in
> M4). Mock remains the zero-config default; writes (checkout, CRUD,
> status) stay mock until M3. Setup: `supabase/README.md`.
>
> The "Type → table mapping" section below describes what was actually
> BUILT in M1 (it supersedes the original jsonb-translation sketch).

## Ground rules carried over from M0

- No secrets in the repo. Use `.env.local` (gitignored) + typed env access.
- Keep the trilingual dictionary system and the `Dictionary` interface —
  new UI strings must land in all three languages (the build enforces it).
- Keep all invoice-safety wording until legal invoicing is truly integrated
  (DOCUMENTS_AND_INVOICES_GUIDE.md).
- Keep logical-property RTL rules (I18N_RTL_GUIDE.md).

## Suggested stack

- **Supabase** (Postgres + Auth + Storage + RLS) as designed for below.
- Server Actions / Route Handlers for mutations; keep pages RSC-first.

## Type → table mapping (src/lib/types.ts is the contract) — AS BUILT in M1

Trilingual text is explicit `*_ar` / `*_he` / `*_en` columns (not jsonb /
translation tables). Full DDL: `supabase/migrations/`.

| TS type | Table | Notes |
|---|---|---|
| `Supplier` | `tenants` | tenant root; every tenant-owned table has `tenant_id` FK; `name_*`, `address_*`, `legal_name`, `company_id`, nullable tax fields, `order_seq` counter |
| — | `tenant_users` | `(tenant_id, user_id, role)` membership over `auth.users`; roles: `owner` / `admin` / `sales_rep`; RLS helpers build on it |
| `Category` | `categories` | `name_*`, `icon`, `color_hue` (= `Category.hue`), `sort_order` |
| `Manufacturer` | `manufacturers` | `name_*`, `logo_url`, `sort_order` |
| `Product` | `products` | `packageType`→`package_unit`, `unitsPerPackage`→`package_quantity`, plus `base_unit`, `unit_size`, `wholesale_price` (numeric ILS excl. VAT), `vat_rate` (0.18 default), `track_expiry`, `is_active`, `sku`/`barcode` nullable. **`availability` is DERIVED from inventory, not stored** |
| `ProductTranslation` | *(columns on `products`)* | `name_*` + `description_*` |
| `Customer` | `customers` | shop `name` (proper noun, single column), `city_*` per locale, `customer_type`, `contact_name`, `notes` |
| `InventoryItem` | `inventory_items` | `stockPackages`→`quantity_available`, `location`→`warehouse_location`, `nearestExpiry`→`expiry_date`, per-row `low_stock_threshold` (mock global const = 10) |
| `Order` | `orders` | `number`→`order_number` via `next_order_number(tenant_id)` (atomic counter, `MDF-1048…`); `status` enum = `OrderStatus`; denormalized `subtotal`/`vat_total`/`total`; `currency` (ILS), `source` |
| `OrderItem` | `order_items` | price/VAT/name/package **snapshots** (`product_name_snapshot` is jsonb `{ar,he,en}` so documents re-render in any language after product edits) |
| — | `order_status_history` | append-only; written automatically by an `orders` trigger — do not insert from app code |
| `OrderDocument` | `documents` | type enum: `order`→`order_request`, `delivery`→`delivery_note`, `invoiceDraft`→`invoice_draft`; `legal_notice` NOT NULL for invoice drafts (CHECK); `totals_snapshot` jsonb; voided, never deleted |
| — | `audit_events` | append-only generic trail |

Enums created: `order_status`, `order_source`, `document_type`,
`document_status`, `package_unit`, `base_unit`, `customer_type`,
`tenant_role`, `locale_code`. (`availability` is intentionally NOT an
enum/column — derive it.)

## Where mock meets real — exact seams

| Mock seam | File | Replace with |
|---|---|---|
| ✅ Catalog/admin reads (M2) | all pages await `src/lib/data/*`; client components use props / `ShopDataProvider` | done — implement per-function supabase writes next |
| Cart | `src/lib/cart-context.tsx` | keep client cart; submit via Server Action (M3) |
| Checkout submit | `checkout-view.tsx` `submit()` | Server Action: create order + items via `next_order_number()`, return real number (M3) |
| Order status control | `order-status-control.tsx` local state | plain `UPDATE orders.status` — history is trigger-written (M3) |
| New product form | `admin/new-product-form.tsx` | real insert incl. translations + image upload (Storage) (M3) |
| Product images | `product-image.tsx` gradients | Storage URLs with gradient fallback (M3) |
| Dev read client | `src/lib/data/supabase-reads.ts` service-role context | authenticated cookie-bound client + RLS (M4) |
| Demo "today" | `DEMO_TODAY` in `inventory-table.tsx` | real `new Date()` |
| Metrics | computed in `admin/page.tsx` | SQL aggregates (views) |

Deep link `/catalog?customer=cXX` should become a tokenized share link
(`/order/[token]`) that authenticates the shop.

## Auth model (design intent)

- **Supplier admin**: everything under `/admin`.
- **Sales rep**: catalog + cart + orders they created; shop picker limited
  to their route/territory.
- **Shop owner** (remote link): catalog scoped to the supplier, own orders.
- Anonymous: nothing (today's public demo access goes away).

RLS: all rows scoped by `tenant_id` (as built in M1); shop owners
additionally scoped by `customer_id`.

## Sequencing recommendation (M1…)

1. ✅ M1 — Supabase schema + RLS + storage + seed mirroring
   `src/lib/mock/*` (done — hand-written SQL seed with deterministic
   UUIDs; see `supabase/seed.sql`).
2. ✅ M2 — Read paths (done): all pages read via `src/lib/data/`;
   supabase read branches implemented server-side; mock stays the
   zero-config default; supabase mode is local-dev only until M4.
3. M3 — Write paths: checkout → orders (`next_order_number()`, item
   snapshots); status changes (plain `UPDATE` — history is trigger-
   written); product CRUD + image upload to `product-images`.
4. M4 — Auth + roles + tokenized shop links; tighten RLS (sales-rep
   scoping, shop-owner policies, tenant onboarding flow).
5. M5 — Documents: real numbering, PDF generation, archival.
6. M6 — Legal invoicing provider integration (see invoices guide).

## Definition of done for the handoff itself

- `npm run build` still green; all three locales still prerender.
- Mock modules deleted only after every consumer is migrated.
- The docs in this folder updated to reflect reality.
