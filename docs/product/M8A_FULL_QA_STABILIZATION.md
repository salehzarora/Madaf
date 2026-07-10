# M8A — Full Product QA, Stabilization & Route Guard

Status: implemented on `feature/M8A-full-product-qa-stabilization` (not
merged). Builds on M7I (main `0416e23`). Mock stays the zero-env default; no
legal/payment/production change — `legal_effective` stays false, drafts stay
non-legal.

## What M8A is

A full-project QA audit (multi-agent, 10 areas: auth/onboarding, dashboard,
products/catalog, customers/signup, shop/showcase flows, orders/inventory,
documents/PDFs, i18n/RTL, security/RLS, deployment/perf) followed by a
stabilization batch: every confirmed P1 fixed, the highest-value P2s fixed,
and one guard added (dynamic-route build check). New features (inventory
movements UI, duplicate-customer detection, dashboard alert cards) were
deliberately deferred to M8B because P1 bugs existed — per the "fix serious
bugs first" rule.

## Audit verdict

- **P0: none.** Security posture verified intact (all mandated greps + SQL
  checks pass: no client service_role, no NEXT_PUBLIC secrets, anon has no
  direct table grants, RLS on all tables, SECURITY DEFINER functions pin
  search_path, token_hash-only storage, no public product-images policy, no
  payments, legal flags only in fail-closed guard code).
- **P1 (2 root causes, both fixed):**
  1. The shop order-submit RPC lost its anonymous-token rate limiter.
  2. Deactivating a tracked product crashed `/admin/inventory` and could
     500 the `/admin` dashboard (non-null-asserted lookups against
     active-only product maps).
- ~24 P2 / ~24 P3 catalogued; the highest-impact P2s fixed here, the rest
  logged under "Known limitations / M8B backlog".

## Migrations added (apply to hosted staging with `supabase db push` only)

| File | Fix |
| --- | --- |
| `20260722100000_restore_shop_order_rate_limit.sql` | **P1.** M7E's `order_public_ref` migration re-declared `create_order_request_from_token` and silently dropped the M4D `_token_rate_exceeded`/`_record_token_failure` calls — the only anonymous WRITE endpoint was unthrottled against token probing. Re-declared with BOTH behaviors: M4D limiting (over-limit → null; resolution failure → counted, null; valid tokens never blocked; order-content errors not rate-limited) and the M7E public_ref return. Probed: valid token still orders (public ref returned); bad token → null + `token_access_attempts('shop_order')` rows. |
| `20260722110000_backfill_document_numbers.sql` | **P2.** M7G switched document numbering to public_ref but never backfilled — pre-M7G/seeded documents still leaked the internal warehouse sequence (`DOC-1042-I`). Backfills `documents.document_number` from the order's public_ref (suffix re-derived from `document_type`) and clears `storage_path`/`generated_at`/`file_size_bytes`/`checksum` on changed rows so stale stored PDFs (old number baked in) regenerate on next download. `supabase/seed.sql` now derives document numbers from public_ref directly. Probed: 0 internal-derived numbers remain after reset. |
| `20260722120000_preserve_descriptions_on_product_update.sql` | **P2 (data loss).** `update_product` full-overwrote every column, so fields the edit form doesn't carry were NULLed on each save. Descriptions are now overwritten ONLY when their key is present in the payload (jsonb `?`); the write layer omits absent description keys. Probed: absent keys preserve, explicit null clears. Barcode stays full-overwrite by design — the form now prefills it, so clearing is deliberate. |

## App fixes

- **Inactive-product crash class (P1)** — all 6 non-null-asserted map lookups
  guarded; `/admin` dashboard, `/admin/inventory` and `/admin/orders/[id]`
  fetch `listProducts({ includeInactive: true })` for their lookup maps
  (the shared storefront context stays active-only). Order detail now RENDERS
  lines whose product was deactivated/deleted (new `unavailableProduct`
  fallback label) instead of hiding them while the subtotal counted them.
  Dashboard "Products" KPI counts active only.
- **Frozen clocks** — dashboard "Month revenue" no longer hardcoded to
  `2026-07` (real current month in supabase mode; demo month in mock);
  inventory "expiring soon" horizon uses the real current day in supabase
  mode; the misleading all-time "Today" badge removed from the new-orders KPI.
- **Per-row low-stock threshold** — `isLowStock` honors
  `inventory_items.low_stock_threshold` (falls back to 10); the dashboard
  low-stock card bar/label uses the per-row threshold too, so low-stock
  signals agree with the catalog availability badge.
- **Product edit data loss** — `Product.barcode` added to the domain type
  (mapped in supabase reads); the edit form prefills it. Descriptions
  preserved server-side (migration above).
- **Invite return path** — email SIGNUP now honors the validated `?next=`
  (an invited teammate returns to the invite instead of being derailed into
  creating their own tenant); a signed-in membershipless user on /login also
  keeps `next`.
- **/join/<token> dead-link screen** — GET-time liveness check
  (`isSignupLinkAlive`, trusted server client, token_hash lookup) renders the
  existing invalid-link screen instead of a form that can never submit.
  FAIL-OPEN: if the check can't run, the form renders and the submit RPC
  stays the security boundary.
- **Order editor notes** — clearing notes now actually clears them (an empty
  string reaches the RPC; undefined = keep).
- **Regenerate link keeps expiry** — regenerating an expiring private shop
  link no longer mints a never-expiring one (remaining lifetime carried
  forward, rounded up to whole days).
- **Guest orders in dashboard** — Recent activity shows the guest store name
  from the snapshot instead of "—".

## UX / hardening polish

- **Mobile admin** — the drawer gains a footer with LocaleSwitcher + Logout
  (previously desktop-top-bar only; mobile had neither).
- **noindex on token pages** — `/shop/[token]`, `/showcase/[token]`,
  `/join/[token]`, `/invite/[token]` export `robots: noindex, nofollow`
  (the raw token in the URL is the credential; leaked links must not be
  search-indexable).
- **Shop submit errors visible** — failure banner renders inside the sticky
  order bar (next to the button), not far up the page.
- **Broken image fallback** — `ProductImage` (now a client component) swaps
  to the placeholder on img error instead of the browser broken-image glyph.
- **Stale copy fixed (ar/he/en)** — admin showcase-link copy no longer says
  "view products only (no ordering)" (showcase links take guest orders since
  M7I); invite "already belong to a supplier / second supplier unsupported"
  error corrected post-M4C to "already a member of this supplier"; private
  shop empty-catalog message no longer tells the BUYER to "add products".

## M8A.4 — dynamic-route build guard

`scripts/check-dynamic-routes.mjs` runs after every `npm run build` (wired
into the build script) and FAILS the build if any critical detail/token route
(`product/[id]`, `admin/orders/[id]` (+documents), `admin/documents/[id]`,
`admin/customers/[id]`(+edit), `admin/products/[id]/edit`, `invite/join/shop/
showcase [token]`) is statically generated (appears in the prerender
manifest) or disappears (renamed without updating the guard). This prevents
the old Vercel "●" bug class from silently returning.

## Verification (local)

`npm run lint` / `npx tsc --noEmit` / `npm run build` (incl. route guard:
"11 critical routes exist and none are SSG") / `npm audit --omit=dev` all
green. `supabase db reset` applies all migrations; `db lint` no schema
errors; `db advisors` no issues. DB probes: valid shop-token order returns a
public ref; bad tokens denied + counted; document numbers all public_ref-
derived; update_product preserves absent descriptions / clears present-null /
saves barcode. Adversarially-verified multi-agent review of the full diff ran
before commit.

## Hosted staging steps (operator — confirm STAGING first; never reset/config-push)

1. `supabase db push` to Frankfurt (`xcfjxgdfgjvsqkhuiczu`) — applies
   `20260722100000_restore_shop_order_rate_limit`,
   `20260722110000_backfill_document_numbers`,
   `20260722120000_preserve_descriptions_on_product_update`.
   The backfill will renumber any hosted pre-M7G documents and clear their
   stored PDFs (regenerated with correct numbers on next download).
2. No new env vars. Redeploy Vercel with **build cache OFF** — the build now
   runs the route guard automatically.
3. Smoke per the checklist below.

## Manual smoke checklist (staging)

- Deactivate a product that has inventory → `/admin` dashboard and
  `/admin/inventory` render (product still listed in inventory); its order
  detail shows the line; reactivate.
- Edit a product with a barcode → barcode survives an unrelated edit.
- Private shop link: submit an order on a valid link (works, public ref);
  hammer a bad token (fails, no order); regenerate an expiring link → new
  link keeps an expiry.
- Open a revoked/expired `/join/<token>` → invalid-link screen at GET time.
- Email-invite flow: invited user signs UP via `?next=` → lands back on the
  invite page.
- Admin order: clear the notes in the editor → notes actually clear.
- Mobile admin: drawer shows locale switcher + logout.
- Dashboard: month revenue reflects the real current month; guest orders
  show their store name in Recent activity.
- Documents for OLD orders download with `DOC-<public-ref>-X` numbers.

## Known limitations / M8B backlog (from the audit — not regressions)

- No inventory-movements ledger UI / manual stock adjustment (top M8B pick).
- No duplicate-customer warning on signup approval / guest-order promotion.
- No dashboard cards for pending signup requests / pending guest orders.
- Customers list has no search; orders list "Total" column shows ex-VAT
  subtotal; cancel/reject are single-click (no confirm dialog).
- Document HTML preview renders from live catalog (PDF is snapshot-correct);
  showcase cart is lost on locale switch; signed image URLs expire after
  30 min of browsing; root layout fetches full lists per request (no
  React.cache dedup); Arabic store/customer terminology drift (محل/دكان).
- sales_rep still sees (always-failing) product/inventory edit UI.
