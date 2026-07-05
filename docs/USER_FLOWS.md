# User Flows

## 1. Supplier sales-visit flow (primary — tablet in the shop)

```
Admin → Shops → "Start order" (deep link /catalog?customer=cXX)
   or  Catalog → "Select shop" picker
→ Catalog: browse / search / filter, add packages via steppers
→ Sticky cart bar shows packages + subtotal → View cart
→ Cart: adjust quantities, confirm shop, add notes
→ Continue to order request (checkout)
→ Checkout: shop details prefilled from selected shop, delivery preference
→ Send order request
→ Order-success screen with demo order number
```

Key details:

- The selected shop is stored on the cart (`customerId`) and shown as
  "Ordering for: <shop>" on the catalog.
- Quantities are **packages** (cartons/packs) — wholesale reality.
- The admin "Start order" action on a shop row preselects that shop.

## 2. Remote shop-owner flow (link ordering)

```
Owner opens catalog link (e.g. /ar/catalog)
→ Browses catalog (no shop preselected)
→ Adds products → Cart → Checkout
→ Fills shop name / contact / phone manually
→ Sends order request → success screen
```

Same screens as flow 1 — the only difference is that shop details are
typed rather than picked. (Future: tokenized links that pre-identify the
shop — see FUTURE_BACKEND_HANDOFF.md.)

## 3. Admin flow (supplier back-office)

```
/admin dashboard: new orders count, open orders, month total,
                  low stock, recent orders list
→ Orders: filter by status chips → open order
→ Order detail:
    - visual status pipeline: New → Confirmed → Preparing → Delivered
      (+ Cancelled toggle) — demo-only state
    - items with line totals, shop card, notes
    - document links (Order Request / Delivery Note / Invoice Draft)
→ Document preview: Hebrew-first sheet, language toggle, print
```

Supporting admin routes:

- **Products**: searchable list; "Add product" form (mock, not persisted).
- **Inventory**: stock in packages, low-stock filter, expiry column for
  tracked products (dairy).
- **Shops**: list with per-shop order stats and "Start order".
- **Documents**: index of all generated documents with legal banner.

## Status model

`new → confirmed → preparing → delivered`, with `cancelled` reachable from
any state. Colors/tones are defined once in `order-status-badge.tsx`.

## Empty / edge states designed

- Catalog with no filter matches → EmptyState with clear-filters hint.
- Empty cart → EmptyState with browse CTA.
- Checkout with empty cart → redirect back to cart.
- Order without notes → "No notes" placeholder.
- Product without expiry tracking → "—" in inventory expiry column.
- Out-of-stock product → disabled add button, danger badge, 0 stock row.
- Unknown URL → trilingual 404.
