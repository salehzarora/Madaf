# M7F — Demo Polish & Missing Core Features

Status: implemented on `feature/M7F-demo-polish-core-features` (not merged).
Builds on M7E.2 (force-dynamic detail routes). Mock mode stays the zero-env
default; supabase mode is the staging target.

## What shipped

| # | Area | Change |
|---|------|--------|
| P1 | Product images | Device upload now works when **creating** a product, not just editing. Mock mode shows a local preview. |
| P2 | Stores/customers | Admins can now **create and edit** a store/customer (was seed-only) and manage its private link (incl. **regenerate**). Detail page shows address + recent orders. |
| P3 | Order reference | Confirmed the tokenized-shop success shows the customer the **public** ref (`MDF-XXXXXXXX`), never the internal sequential number; added a "keep this reference" hint. |
| P3a | Private catalog | `/catalog` opened without an authenticated tenant/token shows a clear "this catalog is private — open your supplier's link" message instead of a confusing empty grid. |
| P4 | Lists | Orders list: search (number/ref/shop) + public-ref column + empty hint. Products list: manufacturer + active/inactive filters. |
| P5 | Dashboard | At-a-glance strip: today's orders, active products, active shops. |

## P0 — nothing regressed

The three authenticated detail routes stay **dynamic (`ƒ`)** — no
`generateStaticParams` was added, `export const dynamic = "force-dynamic"`
kept:
`/[locale]/product/[id]`, `/[locale]/admin/orders/[id]`,
`/[locale]/admin/documents/[id]`. The only `generateStaticParams` in the repo
remains the locale enumeration in `src/app/[locale]/layout.tsx`.

## Image upload model (P1)

Product images already had a complete, hardened server path (M3B/M4A); M7F
only removed the create-mode limitation.

- **Bucket**: `product-images`, **private** (`public=false`), 5 MiB cap,
  `image/jpeg|png|webp|avif`. Created by
  `supabase/migrations/20260705120000_storage_product_images.sql`.
- **RLS** keys on the FIRST path segment being the tenant uuid: tenant
  members read; owner/admin insert/update/delete. Uploads run on the
  **authenticated cookie client** — **no service_role**.
- **Path**: edit mode → `<tenant_id>/products/<product_id>/<file>`; create
  mode (new) → `<tenant_id>/products/uploads/<uuid>-<file>`. Both are under
  the tenant prefix, so the existing RLS + read-time signing both apply, and
  the path is persisted verbatim by `create_product` on save.
- **Validation** (`uploadProductImageAction`, unchanged): MIME allowlist,
  5 MB cap, **magic-byte sniff** that must match the declared type
  (anti-spoof), filename sanitize (`[a-z0-9._-]`, `slice(-80)`), plausible
  product-id check.
- **Read**: private objects are signed at read time (`signProductImages`,
  1 h TTL) for the authenticated admin catalog; external `http(s)` URLs pass
  through unchanged.
- **Mock mode**: shows a local `URL.createObjectURL` preview and persists
  nothing.

**Known limitation (deferred → M7G):** the anonymous `/shop/<token>` page
cannot sign private-bucket objects, so **uploaded** product images fall back
to the placeholder there; **external image URLs** still render for shops. To
show uploaded images to customers we need to sign product-image paths in the
`get_token_catalog` path with a trusted server client (mirroring the M5C
document-storage pattern). See "Deferred" below.

## Stores/customers & private links (P2)

- **New RPCs** (migration `20260717100000_customer_write_rpcs.sql`):
  `create_customer` / `update_customer` — `SECURITY DEFINER`,
  `search_path=''`, tenant derived via `authorize_tenant(['owner','admin'])`,
  length-capped, **RPC-only** (direct customer writes stay blocked, as with
  the catalog). No schema change to `customers` — all columns already existed.
- **Type**: `Customer` now surfaces the existing `address` and `notes`
  columns (optional); `mapCustomer` reads them.
- **UI**: "Add store" CTA + empty state on the shops list; a create route
  (`/admin/customers/new`) and edit route (`/admin/customers/[id]/edit`,
  supabase-only); the shop detail shows address + a **Recent orders** list;
  the customer form is mock-aware (demo notice, no persist).
- **Private links**: unchanged security model (hash-only, shown once). Added
  a safe **Regenerate** = revoke the old link + issue a new one, reusing the
  existing `insert`/`revoke` RPCs — no new token behavior.

Terminology: the app already brands these as "Shops / חנויות / المحلات"
(business customers); M7F keeps that and clarifies via copy.

## Public order reference (P3)

Already correct as of M7E: `create_order_request_from_token` returns the
random `public_ref` in its `order_number` column, so `submitTokenOrder` →
`ShopView` shows the customer `MDF-XXXXXXXX`, not the internal sequence.
Admin order detail shows **both** the internal number and the public ref.
M7F adds a "keep this reference" hint and clarifying comments only.

## Verification (local)

- `npm run lint` clean · `npm run build` green · `npm audit --omit=dev
  --audit-level=moderate` 0 vulns.
- `supabase db reset --local` applies cleanly; `db lint` = no schema errors;
  `db advisors` = no issues.
- Route table shows `ƒ` for the three detail routes.
- SQL probe confirmed `create_customer`/`update_customer` succeed via
  owner/admin, are rejected for anon, and enforce length caps.

## Manual staging steps required (operator)

1. **Apply the migration to Frankfurt** (`xcfjxgdfjvsqkhuiczu`) — confirm it
   is STAGING first, never reset/config-push:
   ```
   supabase db push
   ```
   Applies `20260717100000_customer_write_rpcs.sql` **and** the still-pending
   `20260716100000_order_public_ref.sql` (from M7E) if not yet applied. The
   latter is what makes the customer see `MDF-XXXXXXXX`.
2. **Redeploy Vercel** from the merged branch **with build cache OFF**, then
   confirm the deployment route table still shows `ƒ` for the three detail
   routes.
3. Smoke: create a store → generate/copy its link → open `/shop/<token>` →
   order → success shows `MDF-XXXXXXXX`; create a product with an uploaded
   image; open `/catalog` with no token → private-link message.

## Deferred (→ M7G)

- **Manufacturer/company logo device upload** — only a URL field exists
  today. Reuse the product pattern (same bucket under
  `<tenant_id>/manufacturers/…`, or a dedicated bucket) + a
  `sbUploadManufacturerLogo` action with the same validation.
- **Anon-shop display of uploaded product images** — sign private paths in
  the token catalog path with a trusted server client (M5C pattern). External
  URLs already work on shops.
- **Company/supplier image** — net-new (no column/field today).
