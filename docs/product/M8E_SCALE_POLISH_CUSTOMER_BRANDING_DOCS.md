# M8E — Scale Polish, Customer Pagination, Branding & Document Fidelity

Status: merged to main (`3004cb2`). Builds on M8D (main `80c6da1`). **One
migration** (`20260725100000_tenant_business_profile.sql`, additive). Mock stays
the zero-env default; no legal/payment/production change — `legal_effective`
stays false, drafts keep their DRAFT watermark + "not a tax invoice" notice.

> **M8E.1 (hotfix, `feature/M8E1-upload-logo-visibility-hotfix`)** — no
> migration. Fixes logo-upload error handling and makes the company/manufacturer
> logos visible. See the "M8E.1" section at the end.

## A — Server-side export of all filtered rows [M8E.1]

Exports now cover **every row matching the active filters**, up to a documented
cap, instead of only the loaded page.

- **Inventory movements** (the real gap — the list is server-paginated): a new
  `exportMovementsAction(query)` pages the SAME RLS-scoped, DB-side filtered
  query (owner/admin) in server batches up to **`MOVEMENTS_EXPORT_CAP` = 10,000**
  rows, then probes one past the cap to report whether more remain. The client
  builds the CSV (it has the catalog for localized product names + headers).
- **Orders & products** load fully client-side already, so their exports
  already covered the full filtered set; M8E adds a defensive **`EXPORT_CAP` =
  5,000** guard — past it the first 5,000 rows export and a warning shows.
- **Cap warning** (all three): `common.exportCapped` — Arabic "تم تصدير أول
  {count} نتيجة. ضيّق الفلاتر لتصدير نتائج أقل." shown after a capped export.
- Unchanged: CSV formula-injection defense (data cells beginning `= + - @` are
  neutralized; `+972…` phones stay text), localized headers, BOM, owner/admin
  page-gating, admin-only internal order number (customer surfaces stay
  publicRef-only).

## B — Customers list server-side pagination / search / filters [M8E.2]

`/admin/customers` is now operational for many stores: search + facets run in
the DB query and rows paginate.

- New `sbSearchCustomers(query, offset, limit)` (RLS-native PostgREST) +
  `searchCustomers` boundary + `searchCustomersAction`. Deterministic order
  (**active first, then name, then id**) → skip-/dup-free offset paging.
- **Search** (ILIKE) across name / contact / phone / address / city (all three
  city locales). The free-text term is sanitized of the PostgREST or-grammar
  metacharacters (`,()%\*`) before interpolation; RLS bounds results to the
  tenant regardless.
- **Facets**: lifecycle (active / inactive / all) and **private link**
  (has live link / no live link / all). "Has link" resolves the customer ids
  with a non-revoked, non-expired `customer_access_links` row (owner/admin
  SELECT under RLS) and applies an id in/not-in clause.
- **Deep links**: `?q=…&status=active|inactive&link=has|none` (inbound).
- The initial page is SSR'd; the client re-queries page 0 on filter change
  (search debounced 300ms) and appends pages on "load more" (id-deduped),
  mirroring the M8D movements table.
- Per-store order stats (count / last order) are keyed by customer id, built
  from the tenant's orders so a load-more row still resolves its stats.
- Mock mode filters the demo array in memory (the `link` facet has no mock
  data, so it is ignored in mock).

## C — Manufacturer / brand logo upload + private signing [M8E.3]

Manufacturers already had a `logo_url` (external URL only). M8E adds **uploaded
logos** to the SAME private `product-images` bucket — **no migration, no new
bucket** (the bucket RLS keys only on the first path segment = tenant uuid, so
a `<tenant_id>/manufacturers/…` prefix reuses the owner/admin policies).

- `uploadManufacturerLogoAction` → `sbUploadManufacturerLogo` (authenticated
  client, tenant-ownership check, path `<tenant>/manufacturers/<id_or_uploads>/…`).
  Reuses the product-image validation: MIME allowlist (jpeg/png/webp) + **2 MB**
  cap + magic-byte sniff that must match the declared type.
- The object PATH is stored on `manufacturers.logo_url`; **signed on read**:
  - admin: `signManufacturerLogos` (authenticated client, own-tenant prefix);
  - anon shop/showcase: `signOwnTenantLogoPaths` (service-role client,
    fail-closed) resolved by token_hash — so uploaded logos display on the
    storefront too. External http(s) URLs still pass through; a non-own,
    non-external value drops to the Factory glyph. A cross-tenant path is
    NEVER signed.
- The manager form gains a logo upload widget (tracks the value to PERSIST vs
  the signed preview, so an edit never re-persists an ephemeral signed URL, and
  a re-save never clears the current logo). Mock mode shows a local preview and
  persists nothing.
- owner/admin only (the existing `canManage` gate + the manufacturer RPC's
  owner/admin `authorize_tenant`); sales_rep read-only.

## D — Tenant business/profile settings + non-legal VAT display [M8E.4]

New owner/admin page `/admin/settings/business` edits the **display identity
documents actually use** (it was never editable — `create_tenant_with_owner`
sets only the names, so legal_name/phone/address rendered blank).

- **Migration** `20260725100000_tenant_business_profile.sql`: adds `email`,
  `logo_url`, `display_vat_rate numeric(5,4)` to `public.tenants` (with CHECK
  constraints) + an owner/admin `update_tenant_profile` RPC (SECURITY DEFINER,
  `search_path=''`, `authorize_tenant(owner/admin)`, RPC-only — no direct
  tenants write). Editable: name (ar/he/en), phone, email, address (ar/he/en),
  legal name, company id (ח.פ), display VAT rate, logo.
- **Business logo**: upload (private bucket, `<tenant>/branding/…`, signed on
  read via `sbGetSupplier`) OR external URL — same 2 MB / MIME / magic-byte
  validation. Shown on the document header (see E) and the settings preview.
- **Display VAT rate** is entered as a percent, stored as a fraction in [0,1),
  and is an **INTERNAL/DRAFT ESTIMATE input only** — a permanent note on the
  form states "these settings do not enable legal invoices". It never issues a
  tax invoice, never sets a legal figure; `legal_effective` and the
  MADAF_LEGAL_* flags stay OFF; the invoice_draft watermark + notices are
  untouched. This is SEPARATE from the inert M6B `tenant_tax_settings`
  (future-legal identity) — the two stores are not merged.
- `Supplier` gains `email` / `logoUrl` (signed) / `logoStoragePath` (raw) /
  `displayVatRate`; mock supplier gets an email + no display rate (→ falls
  back to VAT_RATE).
- Nav: a "Business profile" entry sits beside "Tax settings" (owner/admin;
  open in mock; hidden for sales_rep).

## E — Document HTML preview fidelity [M8E.5]

The HTML preview (`/admin/documents/[id]`) now renders the **same data the PDF
does**, removing three divergences:

- **Guest orders**: the preview used a live `customerById` lookup, which is
  empty for a guest showcase order (no `customerId`) → it showed "—". It now
  falls back to `order.customerSnapshot`, exactly like the PDF.
- **Totals**: the preview recomputed `subtotal * 0.18`. It now uses the
  **server-stored order totals** (`Order.subtotal/vatTotal/total`, added to the
  domain type and read from the orders row) when present — identical to the PDF
  (`orders.subtotal/vat_total/total`). Mock orders (no stored totals) recompute
  with the tenant **display VAT rate** (`supplier.displayVatRate ?? VAT_RATE`).
- **Business logo**: the header shows the tenant logo when set, else the app
  LogoMark.
- Unchanged (legally required): customer-facing ref stays `publicRef` (never
  the internal number), the invoice-draft DRAFT watermark + `notLegalNotice` +
  VAT-estimate/disclaimer wording, Hebrew-first default, RTL via `dir`. No
  legal numbering, no `legal_effective`, no provider/payment.

## i18n

ar/he/en in lockstep (typed, enforced by tsc): `common.exporting` +
`common.exportCapped`; `admin.customers.loadMore/loadingMore` + `.linkFilter.*`;
`admin.manufacturers` logo-upload keys; `admin.settings.business.*` (the full
business-profile block incl. the permanent non-legal note).

## Migrations / RPC / storage

- **One migration** `20260725100000_tenant_business_profile.sql` — additive
  columns on `tenants` + `update_tenant_profile` (owner/admin) RPC. No RLS
  loosened, no table write re-enabled, no anon/public read added.
- **No new storage bucket** — manufacturer + tenant logos reuse the existing
  private `product-images` bucket under strict `<tenant_id>/…` prefixes.
- Manufacturer RPCs unchanged (already round-trip `logo_url`).

## Security boundaries (unchanged / reaffirmed)

- No service_role in the client; no `NEXT_PUBLIC_SERVICE_ROLE`; logos are
  signed server-side (authenticated client for admin, service-role client for
  anon), fail-closed to a glyph. Only own-tenant object paths are ever signed.
- No raw token stored; token→tenant resolution for logo signing uses
  `token_hash` (never the raw token, never the path).
- product-images bucket stays PRIVATE (no public policy).
- Customer-facing surfaces never show the internal order number.
- Role gating: owner/admin for business profile + manufacturer/tenant logo
  writes (RPC + storage RLS enforce it); sales_rep read-only; anon nothing.
- Legal: `display_vat_rate` is a non-legal estimate; drafts stay drafts.

## Verification (local)

`npm run lint` / `npx tsc --noEmit` / `npm run build` (route guard) /
`npm audit --omit=dev` all green. `supabase db reset` (applies the new
migration) + `db lint` + `db advisors` clean. Probes: movement full-export
paging + cap; customer search/facets/pagination; RLS owner/admin vs
sales_rep/anon; own-tenant-only logo signing; `update_tenant_profile`
owner/admin gate + VAT range; document preview stored-totals + guest snapshot.

## Hosted staging steps (operator — confirm STAGING first; never reset/config-push)

1. **Push the migration**: `supabase db push` applies
   `20260725100000_tenant_business_profile.sql` (additive; safe on existing
   rows — all new columns are nullable). The M8C
   `20260724100000`/`20260724110000` migrations must already be applied.
2. **Redeploy Vercel with build cache OFF** — the build must end with the
   route-guard OK line.

## Manual smoke checklist (staging)

- Movements: filter, then export → CSV covers all filtered rows (not just the
  loaded page); force the cap path if a large ledger exists → warning shows.
- Customers: search by name/phone/city; toggle active/inactive + has-link/no-link;
  load more with no dupes; `?q=&status=&link=` deep link lands filtered.
- Manufacturer logo: owner/admin upload a PNG/JPG/WebP (<2 MB) → shows in the
  list + on the storefront chip; a bad type/oversize is rejected; a sales_rep
  sees no add/edit; a re-save without touching the logo keeps it.
- Business profile: owner/admin edit name/phone/email/address/legal/VAT + logo →
  appears on the document header/identity; sales_rep is 404; the non-legal note
  is present; VAT is an estimate only.
- Document preview: a guest showcase order shows the guest store details (not
  "—"); totals match the downloaded PDF; the tenant logo shows; the DRAFT
  watermark + "not a tax invoice" notice remain.

## Known limitations / next

- Orders/products lists still load fully client-side (their exports are
  complete + capped); server-side pagination for those lists is a future step.
- Customer order-stats still derive from a full orders scan (a per-customer
  aggregate RPC would remove that).
- `guest-created` / `signup-created` customer facets are **not** implemented —
  the `customers` table has no source column; adding them needs a schema change
  (documented, not invented).
- Movement product search still resolves the term to ids from the loaded
  catalog (1000-id `.in()` cap, documented since M8D).
- Recommended next (M8F): orders/products server-side pagination, a
  per-customer order-stats aggregate RPC, optional customer source column for
  guest/signup facets.

---

## M8E.1 — Upload-error hotfix + logo visibility

Operator feedback after M8E: (1) uploading an invalid image could leave the UI
stuck on "uploading"; (2) the company logo existed in settings but wasn't shown
anywhere, so the feature felt invisible. **No migration.**

### Root cause of the upload hang
The tenant/manufacturer logo upload handlers called `await uploadXAction(fd)`
with **no `try/catch/finally`**, so a REJECTED action promise never reset
`uploading`. The trigger: Next.js server actions cap the request body at **1MB
by default**, smaller than the app's own image limits (5MB product images, 2MB
logos) — a valid 1–2MB logo was rejected at the transport layer, the promise
rejected, and without a `finally` the button stayed disabled forever. (The
product-image handler already had a `finally`, so it recovered — but the >1MB
upload still failed.)

### What was fixed
- `next.config.ts`: `experimental.serverActions.bodySizeLimit = "6mb"` — valid
  images up to the app limit now actually upload instead of being rejected.
- All three logo/image upload handlers (tenant, manufacturer, product) now:
  wrap the upload in `try/catch/finally` (`uploading` is always reset — no
  more hang); **pre-validate on the client** (MIME + size) for instant feedback
  before any upload starts; map a distinct **`invalid`** reason for a
  magic-byte mismatch (corrupt/spoofed image) vs unsupported **`type`**; show a
  reassurance line that **the current image was not changed** on any failure;
  leave the existing logo/preview untouched on failure; and reset the file
  input so the user can immediately retry (even the same file).
- Shared client helper `src/lib/image-upload.ts` (`preValidateImage`,
  `IMAGE_ACCEPT`, size caps) — no server-only imports.
- New shared error strings `common.uploadInvalid` / `common.uploadKeepCurrent`
  (ar/he/en).

### Where the TENANT/company logo now appears
1. **Business settings** — the current logo previews, updates immediately after
   upload, and a helper line states where it appears.
2. **Admin shell (every admin page)** — the logo shows beside the tenant name
   in the sidebar (falls back to the tenant initial when absent). Fetched
   best-effort in the admin layout (a signing hiccup never blocks the chrome).
3. **Document preview** — already shown in the header (M8E.5); DRAFT watermark +
   "not a tax invoice" notice unchanged.
4. **Shop + showcase customer-facing headers** — the supplier logo shows beside
   the business name. Signed for the anon viewer via a NEW server-only
   `signTenantBrandingLogo` (resolves the tenant from the token_hash, signs the
   own-tenant `<tenant>/branding/…` path only, external URLs pass through,
   fail-closed to name-only). Never exposes a storage path or the service role.

### Where the MANUFACTURER logo now appears
1. **Manufacturers admin list** — logo avatar (M8E.3).
2. **Catalog filter chips** — small logo before the brand name (admin + shop +
   showcase, signed).
3. **Product cards** — a small brand logo before the manufacturer eyebrow name
   (admin + shop + showcase), fallback to name-only (no clutter).
   The product-form manufacturer field is a native `<select>` (can't embed an
   image in an `<option>`), so it stays text — documented, not a regression.

### Legal boundary
Logos are cosmetic branding only — showing a logo does NOT make a document a
legal invoice. `legal_effective` stays false; drafts keep the DRAFT watermark +
"not a tax invoice" notice + VAT-estimate wording.

### Known limitations
- **Server-generated PDF logo**: the on-demand pdfkit PDF does NOT yet embed the
  tenant logo (it would need a signed-bytes fetch + pdfkit image embedding on
  the legally-sensitive PDF path). The HTML preview — the primary, printable
  document view — DOES show the logo. PDF logo embedding is a scoped follow-up.
- Storefront/admin logos rely on a fresh signed URL per request; a signing
  failure falls back to the initial/name (never a broken image blocking the UI).

### Verification
`lint` / `tsc` / `build` (route guard OK) / `audit` (0 vulns) / `db reset` +
`db lint` + `db advisors` all green. No migration, no RLS change, no
service_role in client, product-images bucket stays private, own-tenant-only
logo signing (cross-tenant paths never signed — enforced on read in both
`sbGetSupplier` and `signTenantBrandingLogo`).

---

## M8E.2 — Canonical public token links hotfix

**Confirmed bug.** A generated showcase/shop/join/invite link sometimes used a
per-deploy **Vercel preview** hostname (e.g.
`madaf-…-<team>.vercel.app/ar/showcase/<token>`). Such preview hosts are gated
by **Vercel Deployment Protection**, so the link worked for the owner (logged
into Vercel) but **bounced an incognito recipient to the Vercel login**.
Replacing only the hostname with `https://madaf-drab.vercel.app` — same locale,
route, token — made it work in incognito.

**Root cause.** The four admin link-manager components built the absolute URL by
prepending **`window.location.origin`** to the server action's relative path
(`/[locale]/{shop|showcase|join|invite}/<token>`). So the copied link inherited
whatever host the admin happened to be on — including a preview deploy.

**Fix (no migration).** A shared client helper `src/lib/public-url.ts`:
- `canonicalOrigin()` resolves ONE canonical origin from **`NEXT_PUBLIC_APP_URL`**
  (falling back to `NEXT_PUBLIC_SITE_URL`), normalized (http(s) only, path/query/
  hash and trailing slash stripped to origin-only).
- It falls back to the request origin **only** for a localhost origin (local dev
  / mock). On a hosted (non-local) origin with **no** configured URL it returns
  null — the caller shows a clear error (`common.linkUrlError`) instead of
  emitting a preview-host link. It never silently leaks a preview host.
- `absolutePublicUrl(relativePath)` prepends the canonical origin, preserving the
  locale + route + token **exactly**; `buildPublicTokenUrl({locale, routeType,
  token})` builds from parts (validated).

All four managers (shop — create + regenerate; showcase; join/signup; invite/team)
now use `absolutePublicUrl(result.url)`. Token hashing, one-time raw-token
display, and **regenerate-revokes-the-previous-link** behavior are unchanged.
The Supabase password-reset `redirectTo` (`reset-password-form.tsx`) still uses
the request origin — it is the admin's own auth flow, gated by Supabase's
redirect-URL allowlist, and out of scope for public customer links.

**Affected public link types:** `/[locale]/shop/<token>`,
`/[locale]/showcase/<token>`, `/[locale]/join/<token>`, `/[locale]/invite/<token>`.

**Required hosted env var.** `NEXT_PUBLIC_APP_URL` must be set — on **both**
Production and Preview environments — to the canonical public URL. Staging value:
`https://madaf-drab.vercel.app` (client-visible, non-secret). If it is unset on a
hosted deploy, link generation now fails clearly rather than producing a broken
link. **A redeploy (cache off) is required** for the new value to inline.

**No migration, no RLS/storage/legal/payment change.**

**Tests** (`src/lib/public-url.test.ts`, Node built-in runner —
`node --experimental-strip-types --test src/lib/public-url.test.ts`, excluded
from the app build/lint): a preview origin never leaks; shop/showcase/join/invite
use the canonical origin; ar/he/en preserved; token preserved; trailing slash
normalized; path/malformed origins rejected/normalized; local fallback works;
hosted-without-config refuses; relative navigation unaffected; no raw token logged.

**Manual incognito verification.** Generate each link type in the admin,
open in a private window (not logged into Vercel), confirm it loads the
storefront/accept page (not the Vercel login) on all three locales; confirm a
regenerated link's previous URL is revoked. Do not paste real tokens into docs.
