# Future Backend Handoff

For the coding/backend agent that connects Madaf to real infrastructure.
Read PRODUCT_BRIEF.md and MVP_SCOPE.md first. **Do not redesign the UI** —
everything here was built to be wired, not rebuilt.

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

## Type → table mapping (src/lib/types.ts is the contract)

| TS type | Table | Notes |
|---|---|---|
| `Supplier` | `suppliers` | tenant root; every table gets `supplier_id` FK for multi-tenant later |
| `Category` | `categories` | `name` as jsonb `{ar,he,en}` or `category_translations` |
| `Manufacturer` | `manufacturers` | same translation approach |
| `Product` | `products` | keep `package_type`, `units_per_package`, `base_unit`, `unit_size`, `wholesale_price` (numeric, ILS excl. VAT), `availability`, `track_expiry` |
| `ProductTranslation` | `product_translations` | `(product_id, locale, name, description)` — mirrors `translations` record |
| `Customer` | `customers` | shops; `city` translated jsonb; add `created_by` |
| `InventoryItem` | `inventory_items` | `stock_packages`, `location`, `nearest_expiry` |
| `Order` | `orders` | human number via sequence `MDF-####`; `status` enum = `OrderStatus`; `notes` |
| `OrderItem` | `order_items` | **`unit_price` snapshot at order time** — already modeled |
| `OrderDocument` | `order_documents` | type enum = `DocumentType`; later: pdf_url, legal fields |
| — | `profiles`/roles | auth: supplier_admin, sales_rep, shop_owner |

Enums to create: `order_status`, `document_type`, `package_type`,
`base_unit`, `availability`, `customer_type`, `locale`.

## Where mock meets real — exact seams

| Mock seam | File | Replace with |
|---|---|---|
| Catalog data | `src/lib/mock/*` imports in pages/components | server fetch (RSC) + search params |
| Cart | `src/lib/cart-context.tsx` | keep client cart; submit via Server Action |
| Checkout submit | `checkout-view.tsx` `submit()` | Server Action: create order + items, return real number |
| Order status control | `order-status-control.tsx` local state | mutation + optimistic update + audit trail |
| New product form | `admin/new-product-form.tsx` | real insert incl. translations + image upload (Storage) |
| Product images | `product-image.tsx` gradients | Storage URLs with gradient fallback |
| Documents list/preview | `src/lib/mock/documents.ts` | `order_documents` rows; keep derivation rules server-side |
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

RLS: all rows scoped by `supplier_id`; shop owners additionally scoped by
`customer_id`.

## Sequencing recommendation (M1…)

1. M1 — Supabase schema + seed from `src/lib/mock/*` (write a seed script
   that imports the mock modules — they're valid data).
2. M2 — Read paths: catalog, product, admin lists from DB.
3. M3 — Write paths: checkout → orders; status changes; product CRUD.
4. M4 — Auth + roles + RLS + tokenized shop links.
5. M5 — Documents: real numbering, PDF generation, archival.
6. M6 — Legal invoicing provider integration (see invoices guide).

## Definition of done for the handoff itself

- `npm run build` still green; all three locales still prerender.
- Mock modules deleted only after every consumer is migrated.
- The docs in this folder updated to reflect reality.
