# Information Architecture

> ⚠️ **HISTORICAL / PARTIALLY STALE — do not use as a Pilot operational source.**
> The route map, the source layout (which still lists `lib/mock/` as the data
> source) and the data-relationship diagram (which has no tenant/membership
> entities) predate the multi-tenant, Supabase-backed product. **The
> authoritative source for the monitored Pilot is
> [`pilot/MONITORED-PILOT-LAUNCH-RUNBOOK.md`](pilot/MONITORED-PILOT-LAUNCH-RUNBOOK.md);
> actual runtime behavior is defined by the current code and migrations** —
> data access goes through `src/lib/data/`, and UI code must not import
> `src/lib/mock`. Kept unedited below as a historical record.

## Route map

All routes live under `/[locale]` (ar | he | en). `src/proxy.ts` redirects
bare paths to the default locale (`/` → `/he`, `/catalog` → `/he/catalog`).

```
/                                   → 307 → /he
/[locale]                           Landing (roles + features)
/[locale]/catalog                   Catalog (search, filters, sticky cart)
/[locale]/catalog?customer=cXX      Catalog with preselected shop
/[locale]/product/[id]              Product detail + related products
/[locale]/cart                      Cart (items, shop, notes, summary)
/[locale]/checkout                  Order request form + summary
/[locale]/order-success?n=MDF-XXXX  Confirmation
/[locale]/admin                     Dashboard (metrics, recent, low stock)
/[locale]/admin/products            Products list (search + category filter)
/[locale]/admin/products/new        New product form (mock)
/[locale]/admin/orders              Orders list (status filter)
/[locale]/admin/orders/[id]         Order detail (status pipeline, docs)
/[locale]/admin/inventory           Inventory (stock, low-stock, expiry)
/[locale]/admin/customers           Shops list (+ start order)
/[locale]/admin/documents           Documents index (legal banner)
/[locale]/admin/documents/[id]      Document preview (Hebrew-first)
```

## App directory layout

```
src/app/
  [locale]/
    layout.tsx          ← ROOT layout (html lang+dir, font, CartProvider)
    not-found.tsx       ← trilingual 404
    (shop)/             ← storefront route group (AppShell chrome)
      layout.tsx
      page.tsx          ← landing
      catalog/  product/[id]/  cart/  checkout/  order-success/
    admin/              ← admin subtree (AdminShell chrome)
      layout.tsx
      page.tsx  products/  products/new/  orders/  orders/[id]/
      inventory/  customers/  documents/  documents/[id]/
  globals.css           ← design tokens (Tailwind v4 @theme)
  favicon.ico
src/proxy.ts            ← locale redirect (Next 16 proxy, ex-middleware)
```

Route-group rationale: `(shop)` carries the storefront header/footer;
`admin/` carries the sidebar shell. Both nest inside the `[locale]` root
layout which owns `<html lang dir>` and the cart provider.

## Source layout

```
src/
  i18n/
    config.ts               locales, dirFor(), Intl tags (ar pins latn digits)
    types.ts                Dictionary interface (compile-time completeness)
    dictionaries/{ar,he,en}.ts + index.ts (getDictionary, interpolate)
  lib/
    types.ts                domain model + VAT_RATE + ORDER_STATUSES
    format.ts               formatCurrency/Number/Date/DateLong
    utils.ts                cn()
    cart-context.tsx        client cart (localStorage, packages, shop)
    mock/                   supplier, categories, manufacturers, products,
                            customers, orders, inventory, documents, index
  components/
    ui/                     button, card, badge, chip, input
    admin/                  products-table, orders-table, inventory-table,
                            new-product-form
    …                       shells, catalog view, cart/checkout views,
                            document view, badges, stepper, pickers, logo
```

## Data relationships (mock, mirrors future DB)

```
Supplier 1─┬─* Product *──1 Category
           │      │  *──1 Manufacturer
           │      └──1 InventoryItem (stock, location, nearestExpiry?)
           ├─* Customer (shop)
           └─* Order *──1 Customer
                  │ *──* OrderItem (productId, qty, unitPrice snapshot)
                  └──* OrderDocument (order | delivery | invoiceDraft)
```

Document derivation rules live in `src/lib/mock/documents.ts`.
