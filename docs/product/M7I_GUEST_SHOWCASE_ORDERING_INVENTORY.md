# M7I — Guest Showcase Ordering, Inventory Reservation & Order Editing

Status: implemented on
`feature/M7I-guest-showcase-ordering-inventory-editing` (not merged). Builds on
M7H. Mock stays the zero-env default; supabase mode is the staging target.
No production/legal/payment work — invoice surfaces stay DRAFT, `legal_effective`
stays false.

Migrations added (local; apply to hosted staging with `supabase db push` only):

| File | Purpose |
| --- | --- |
| `20260721100000_inventory_reservation_lifecycle.sql` | Reserve stock on confirm/preparing (Part C) |
| `20260721110000_showcase_guest_order.sql` | Guest order + create-customer-from-order (Part A) |
| `20260721120000_update_order_items.sql` | Owner/admin order line editing (Part D) |

## A — Showcase links become ORDERABLE (guest ordering)

M7H's showcase link was view-only. It is now a real, no-login ordering surface
for an **unknown** store, mirroring the private-shop flow but without a customer
account:

- `ShowcaseView` gained a local cart (add / quantity stepper / sticky "review
  order" bar) → a **store-details checkout** (name required; contact, phone,
  email, city, address, notes optional) → a success screen showing only the
  customer-facing **public ref** (`MDF-XXXXXXXX`).
- New anon RPC **`create_order_from_showcase_token`** (SECURITY DEFINER,
  `search_path=''`): rate-limited (`showcase_order`), resolves the tenant from
  the token in-DB (`_resolve_showcase_token` — never trusts a client tenant),
  validates store fields (required name, length caps, email regex), then calls
  the shared private `_order_create_core(tenant, items, customer_id => NULL,
  notes, 'remote_customer')`. **All money is computed server-side from live
  products.** The order lands with `customer_id = NULL` and the store details in
  `customer_snapshot` (`guest = true`). No enum change — `remote_customer` is
  reused. **No inventory is reserved** (the order is `new` until an admin
  confirms — see Part C). Granted to anon/authenticated/service_role.
- The warehouse sees a guest order on the admin order detail with a **New store
  (guest order)** card (name/contact/phone/email/city/address) and two paths:
  - **Create shop from this order** → new RPC **`create_customer_from_order`**
    (owner/admin, `authorize_tenant`): inserts a `customers` row from the
    snapshot (same columns as `create_customer`; email folded into notes) and
    links the order (`customer_id`). Last-writer-safe (`FOR UPDATE`, refuses if
    already linked or if the snapshot has no name).
  - **Keep as a one-time order** (do nothing — the snapshot is enough).
- The orders list shows a **Guest** badge + the store name for guest orders and
  searches the snapshot name.

Probed: guest order via valid token → `customer_id NULL`, snapshot `guest=true`,
public ref returned; invalid/revoked token → no order (rate-limited); create
customer → row inserted + order linked; second create on the same order →
blocked ("already linked"); `_order_create_core` is **not** anon-callable
directly (`has_function_privilege('anon', …) = f`).

## B — Customer-facing product images (REAL code fix, not config)

M7H concluded this was a Vercel-config issue. **That was wrong.** Investigated
end-to-end: the customer-facing image signing borrowed
`getTrustedDocumentStorageClient()` — the **documents-PDF** client — which is
fail-closed behind `MADAF_TRUSTED_DOCUMENT_STORAGE=enabled` **and** a strict
`<ref>.supabase.co` host pin. Those guards exist for stored **PDFs** and are
unrelated to product images, so unless that separate subsystem was enabled AND
the ref/host/flag matched exactly, every uploaded shop/showcase image silently
rendered as a placeholder. Admin worked only because it signs on the
authenticated **cookie** client.

**Fix (code):** a dedicated server-only service-role client
`src/lib/data/product-image-storage.ts` → `getProductImageStorageClient()`,
gated by NOTHING except the URL + `SUPABASE_SERVICE_ROLE_KEY` (server env, never
`NEXT_PUBLIC`). `signOwnTenantPaths` and `signTokenProductImages` (shop) and
`signShowcaseImages` (showcase) now use it. Uploaded images render as soon as
the service-role key is set — the app already needs it.

Unchanged safety: `import "server-only"`; refuses to run in the browser; signs
**only** objects under `<tenant_id>/products/` (strict prefix — cross-tenant
paths are never signed); fail-closes to placeholders if the key is missing;
external image URLs still pass through. RLS is not weakened.

**Diagnostics:** `logImageSigning(context, attempted, signed, skipReason)` logs
a safe, non-secret one-liner (counts + a skip reason such as `no-tenant`,
`no-own-paths`, `service-role-key-missing:<msg>`, `sign-error:<msg>`, `ok`) —
never a token, tenant id, signed URL, or the key.

Probed (local storage, service-role client): uploaded an EDIT-mode path
(`<tenant>/products/<id>/…`) and a CREATE-mode path
(`<tenant>/products/uploads/<uuid>-…`) → both signed; a cross-tenant path was
excluded by the prefix filter. `PROBE_PASS`.

> Hosted note: the ONLY env required for shop/showcase images is now
> `SUPABASE_SERVICE_ROLE_KEY`. `MADAF_TRUSTED_DOCUMENT_STORAGE*` remains only for
> the documents-PDF subsystem and no longer affects images.

## C — 3-stage inventory lifecycle (reserve on confirm, not deliver)

M7H deducted stock on `delivered`, which is too late — a confirmed order could
oversell before delivery. Reworked to three effective stages:

- **New** — no stock change.
- **Confirmed / Preparing** — stock is **reserved** (deducted) HERE, once. On
  the first transition into `confirmed` or `preparing`, each line's `quantity`
  is subtracted from `inventory_items.quantity_available` and a
  `order_reserved` movement is written. Idempotent: a partial unique index
  (`order_inv_reserve_once`) + the `FOR UPDATE` lock guard against
  double-reserving (re-click / confirmed→preparing).
- **Delivered** — no additional change (stock already left on reserve).

**Insufficient stock BLOCKS confirm/preparing** with `MDF30`; the transaction
rolls back so the order stays `new`. The UI shows the exact operator message:
*"لا يوجد مخزون كافٍ لإكمال الطلبية. عدّل المخزون أو عدّل الكمية"* (ar/he/en).

**Cancel restores** reserved stock exactly once (`order_reservation_released`
movement, guarded by `order_inv_release_once`); the UI notes *"تم إرجاع المخزون
بعد إلغاء الطلبية"*. Net reserved per product is computed from the ledger
(`-sum(quantity_delta) where reason in ('order_reserved',
'order_edit_adjustment')`), which is what Part D reconciles against. Untracked
products (no inventory row) are skipped. Owner/admin only; ledger stays
owner/admin-read, RPC-write, no anon.

Probed: stock 10 → confirm → 7 (movement `-3`); confirm→preparing → still 7 (no
double reserve); cancel → 10 (movement `+3`); insufficient (have 2, need 5) →
blocked, order stays `new`.

## D — Admin order editing with inventory reconciliation

New RPC **`update_order_items(p_tenant_id, p_order_id, p_items, p_notes)`**
(owner/admin, `authorize_tenant`): change quantities, add/remove lines, update
notes. Money is recomputed server-side from live products (never trusts the
client). **Delivered/cancelled orders are locked** (`MDF31`).

If the order's stock is already **reserved** (confirmed/preparing), the RPC
reconciles inventory in the same transaction: for each product it computes
`delta = new_qty − net_reserved` (full outer join of the new line set vs the
reserved ledger), deducts/restores the difference, and writes an
`order_edit_adjustment` movement. Insufficient stock for an increase → `MDF30`
(clear error), whole edit rolls back. Then the order's lines are re-snapshotted
and totals recomputed.

UI: an **Edit order** section on the admin order detail (supabase mode only) —
inline quantity steppers, remove buttons, a **searchable** add-product picker,
notes, live subtotal, and a reserved-stock hint. Locked orders show the reason.

Probed: edit an unreserved (`new`) order → lines/totals change, no movements;
edit a reserved order: qty ↑ within stock → extra deducted (`order_edit_
adjustment` `-Δ`); qty ↓ / remove line → restored (`+Δ`); add a new line →
deducted; qty ↑ beyond stock → `MDF30`, no change; edit a delivered order →
`MDF31`.

## E — Searchable shop picker

The sales-visit "Ordering for shop…" picker (`customer-picker.tsx`) gained a
search box (name / contact / phone / city / address, all languages) with a
focus-on-open and a "no matches" state, so a rep with many assigned shops isn't
scrolling a long list. Assignment scoping is unchanged (a `sales_rep` still sees
only assigned customers via RLS).

## i18n

Added across ar/he/en (types regenerated): a reworked `access.showcase` block
(browse+order, checkout/store-details, success, disclaimers); `catalog.
searchShops` / `catalog.noShopsFound`; and an `admin.orders.detail` extension —
`statusInsufficientStock`, `stockRestored`, a `guest` sub-block (title, badge,
hint, one-time, create/creating/created/error), and an `edit` sub-block
(button, add-product, search, remove, save/saving/cancel, locked/reserved
hints, insufficient-stock, success). Guest checkout reuses the existing
`access.signup` field labels.

## Security boundaries (unchanged / reaffirmed)

- Anon can only browse + submit a guest order **via a validated showcase
  token** (in-DB hash resolution, rate-limited, `token_hash`-only storage). No
  anon table access, no public catalog policy, no global product exposure.
- The visitor never sets tenant/customer/price/total — all server-side.
- `_order_create_core` stays private (not anon-granted); reachable only through
  the SECURITY DEFINER wrappers.
- `create_customer_from_order` / `update_order_items` are owner/admin only via
  `authorize_tenant`; `update_order_status` reserve/restore stays owner/admin.
- Service-role key never reaches the browser; the image client is server-only.

## Verification (local)

`npm run lint` / `npx tsc --noEmit` / `npm run build` / `npm audit
--omit=dev --audit-level=moderate` clean. `supabase db reset` applies all
migrations; `db lint` = no schema errors; `db advisors` = no issues; types
regenerated (3 new RPCs). Detail + token routes stay `ƒ` (incl.
`showcase/[token]`, `admin/orders/[id]`). See per-part probes above and the
image-signing `PROBE_PASS`.

## Hosted staging steps (operator — confirm STAGING first; never reset/config-push)

1. `supabase db push` to Frankfurt (`xcfjxgdfgjvsqkhuiczu`) — applies
   `20260721100000_inventory_reservation_lifecycle`,
   `20260721110000_showcase_guest_order`,
   `20260721120000_update_order_items`.
2. Ensure `SUPABASE_SERVICE_ROLE_KEY` is set on Vercel (server-only) — this is
   now the ONLY env needed for shop/showcase product images (Part B).
3. Redeploy Vercel with **build cache OFF**; confirm the detail + token routes
   render `ƒ`.

## Known limitations / next

- Reserved stock is order-level, computed from the movements ledger; there is no
  separate "reserved" column on `inventory_items` (net reserved is derived).
- Un-delivering an order does not change stock (reserve already happened on
  confirm; delivered is a no-op) — consistent with the reserve model.
- Guest orders carry no login; a guest cannot track status (they keep the public
  ref to follow up with the supplier).
- A showcase→signup handoff and customer-visible order tracking remain future
  work.
