# M7H — Shop Link Security, Buying UX, Showcase Links & Inventory

Status: implemented on `feature/M7H-shop-link-inventory-polish` (not merged).
Builds on M7G. Mock stays the zero-env default; supabase mode is the staging
target.

## A — Private shop link regeneration (fix)

**Bug:** after regenerating a store's link, an old copied link still worked.
**Root cause:** `customer_access_links` allowed MANY active links per customer
(only `token_hash` is unique), and both "Generate" and "Regenerate" touched
only one link row — sibling active links survived. (`_resolve_token` /
`get_token_catalog` correctly reject a revoked link; the defect was scope.)

**Fix:** a store now keeps exactly ONE live link. New RPC
`revoke_customer_access_links_for_customer(p_tenant_id, p_customer_id)`
(owner/admin, `authorize_tenant`, scoped by customer) revokes every active
link; `createCustomerLinkAction` (and therefore Regenerate) calls it **before**
issuing the fresh link, so every old URL stops working immediately.
Migration `20260720100000`. Probed: 3 active → revoke-all → 0 active → old link
dead.

## B — Private shop buying UX

`/shop/<token>` is now a real B2B ordering page:
- **Read-only store context** — a locked "Ordering for: `<store>`" banner (the
  buyer can never change who the order is for; the store comes from the token).
- **Search + filters** — a shared, sticky, mobile/RTL filter bar (search by
  name/SKU/manufacturer, category tabs, manufacturer chips, in-stock chip,
  sort, clear) via the new `src/lib/catalog-filter.ts` +
  `src/components/shop/catalog-filter-bar.tsx` (reused by the showcase).
- **Clearer cart** — sticky bar with cart label, line count, total, checkout.
- Product cards show image, name, manufacturer, package, price, add/quantity.
- Distinct empty states ("no products" vs "no results for these filters").
- Checkout unchanged: known store, success shows the public ref only.

## C — Product showcase (view-only) links

A supplier sends a "view products" link to a prospective customer who browses
but CANNOT order. New tokenized link type, mirroring the signup-link security:
- Migration `20260720120000`: `catalog_showcase_links` table (token_hash only,
  RLS owner/admin read, RPC-only writes, no anon table access) + RPCs
  `insert/revoke_catalog_showcase_link` (owner/admin), `_resolve_showcase_token`
  (service_role only, in-DB hash), and `get_showcase_catalog` (anon,
  rate-limited `showcase_catalog`) which returns the tenant's active catalog
  with **NO customer and NO ordering**.
- Route `/[locale]/showcase/[token]` (anon, supabase-only) → `ShowcaseView`
  (search/filters, product grid, NO cart/checkout) with a "Request store
  access" CTA that explains how to ask the supplier for a private ordering link.
- Admin manages showcase links on `/admin/customers/signup` (a new section).
- Reuses `signOwnTenantPaths` so uploaded product images show (signed) here too.
- **No catalog is exposed without a valid showcase or shop token.** Probed:
  create → view-only catalog (no customer) → invalid/revoked → null → anon
  table/resolve denied → sales_rep create blocked.

## D — Product images in the private shop (diagnosis + fix)

**The signing code was correct.** Images fail on hosted because the trusted
(service-role) storage client is **fail-closed**: on Vercel (production) with a
hosted Supabase URL it throws unless its envs are set, so signing returns an
empty map and the shop shows placeholders. Admin is unaffected (it signs on the
authenticated cookie client). This is a CONFIG issue, not a code bug.

Code improvements: extracted a shared `signOwnTenantPaths` (used by shop +
showcase) and added an **actionable diagnostic** — when the trusted client is
unavailable it logs a safe, non-secret one-liner naming the exact envs to set.

**Required Vercel envs (server-only; project ref `xcfjxgdfjvsqkhuiczu`):**
```
MADAF_TRUSTED_DOCUMENT_STORAGE=enabled
MADAF_TRUSTED_DOCUMENT_STORAGE_PROJECT_REF=xcfjxgdfjvsqkhuiczu
SUPABASE_SERVICE_ROLE_KEY=<the project's service_role key>   # never NEXT_PUBLIC
```
`MADAF_TRUSTED_DOCUMENT_STORAGE_PROJECT_REF` must match the host label of
`NEXT_PUBLIC_SUPABASE_URL` (`<ref>.supabase.co`). If unset, uploaded images show
as placeholders (external image URLs still render) — no crash, no leak. These
are the SAME envs the document PDFs already require.

## E — Inventory deduction on delivery

**Bug:** delivering an order never reduced stock. **Fix:** migration
`20260720110000` adds an append-only `order_inventory_movements` ledger and
rewrites `update_order_status` to deduct on the transition to `delivered`:
- Deducts each order line's `quantity` from `inventory_items.quantity_available`
  (both in whole PACKAGES), **exactly once** — the ledger guards against
  double-deduction (reload / re-click); the `FOR UPDATE` order lock serializes
  concurrent deliveries; `delivered` is terminal so it fires once.
- **Insufficient stock BLOCKS delivery** with a clear error (`MDF30`); the
  transaction rolls back so the order stays `preparing`. (`inventory_items` has
  a `quantity_available >= 0` CHECK — negative stock isn't allowed.)
- Products with no inventory row are untracked → skipped.
- **Cancel** before delivery does not deduct.
- **Moving back out of `delivered` does NOT auto-restore stock** (chosen for
  safety; a manual inventory adjustment is required — documented).
- Owner/admin only; ledger is owner/admin-read, RPC-write only, no anon.

Probed: stock 10 → deliver → 7; deliver again → 7 (no double); movement `-3`
logged; insufficient (have 2, need 5) → blocked, order stays preparing; cancel
→ no deduction.

## i18n

Added `access.shop.storeLocked`, an `access.showcase` block (visitor), and
`admin.customers.signup.showcase*` keys across ar/he/en; reworded
`access.links.regenerateHint` (revokes ALL) and the Arabic
`access.shop.orderingFor` = "الطلبية مخصصة لـ". Types regenerated.

## Verification (local)

`npm run lint` / `npx tsc --noEmit` / `npm run build` / `npm audit` clean. The
detail + token routes stay `ƒ` (incl. `showcase/[token]`). `supabase db reset`
applies all three migrations; `db lint` = no schema errors; `db advisors` = no
issues. See probes above.

## Hosted staging steps (operator — confirm STAGING first; never reset/config-push)

1. `supabase db push` to Frankfurt (`xcfjxgdfjvsqkhuiczu`) — applies
   `20260720100000_revoke_links_for_customer`,
   `20260720110000_deduct_inventory_on_delivery`,
   `20260720120000_catalog_showcase_links`.
2. Set the trusted-storage Vercel envs (Part D) so shop/showcase images render.
3. Redeploy Vercel with **build cache OFF**; confirm the detail + token routes
   render `ƒ`.

## Known limitations / next

- Showcase CTA is informational (no self-serve signup from a showcase token — a
  showcase→signup handoff is a future enhancement).
- No auto stock restore on un-deliver; requires manual adjustment.
- Existing hosted customers with multiple active links keep them until the next
  regenerate/create (which revokes all).
