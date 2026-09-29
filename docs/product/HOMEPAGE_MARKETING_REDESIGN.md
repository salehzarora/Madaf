# Public homepage marketing redesign

Local UI implementation for Owner / Control Room visual review. No push,
merge, deployment or product launch is implied by this document.

## Scope and boundaries

- Existing public locale URLs (`/ar`, `/he`, `/en`) are unchanged.
- Only the homepage moves out of the `(shop)` route group so its marketing
  header/footer do not duplicate the ordering AppShell. Catalog, product, cart,
  checkout, private-link and admin layouts are untouched.
- The page is server-rendered. Existing LocaleSwitcher and a small details-menu
  dismissal wrapper are its interactive client leaves. Homepage translations
  are separately typed AR/HE/EN copy, not added to the shared client dictionary.
- The original MADAF shelf LogoMark and shared storefront palette are reused.
- Features describe implemented catalog, orders, inventory, customers, roles,
  assigned field sales and language support. Warehouse/fleet routing, payments,
  pricing plans, customer counts and invented contact details are not advertised.
- Supplier request is **visual only**: a labeled fieldset with editable preview
  fields, an explicit preview notice and a disabled send button. It is not a
  form and has no action, event submission, API, email integration or persistence.
- No dependencies, backend, auth, Supabase, push or business logic changed.

## Changed files

- Removed old `src/app/[locale]/(shop)/page.tsx`; added `src/app/[locale]/page.tsx`.
- Added `src/components/marketing/marketing-home.tsx`, `marketing-home.css`
  and `mobile-menu.tsx`.
- Added `src/i18n/dictionaries/marketing.ts`.
- Added the scoped CSS import in `src/app/globals.css`.
- Updated `src/components/landing-page.test.mts`.
- Added seven `public/images/marketing/*.webp` assets listed below.
- Updated `docs/DESIGN_SYSTEM.md` and added this document.

## Artwork

Seven new opaque images were generated with the built-in imagegen tool in
generation mode, then resized/compressed with the existing Sharp installation.
The checked-in assets are local WebP files under `public/images/marketing/`,
approximately 262 KB combined. No third-party URLs or image service is required.

Prompt direction used for the set:

- Hero: premium warehouse atmosphere; laptop, tablet and phone showing abstract
  navy/white dashboard, catalog and orders UI; kraft cartons, warm peach light;
  complete devices, no customer data, readable labels, logos or marketing text.
- Shared feature style: premium 3D miniature commercial logistics, matte ceramic
  and paper materials, navy/indigo, lavender and peach, pale seamless background,
  soft shadows, slightly elevated front view, full centered subject, 3:2 frame.
- Subjects: stocked warehouse (`warehouse.webp`); retail storefront with peach
  awning (`store.webp`); pallet, cartons, bottle and packaged goods (`goods.webp`);
  navy truck and white van (`delivery.webp`); warehouse team member with carton
  (`team.webp`); clipboard/checklist and cartons (`orders.webp`).
- `hero.webp` is labeled as an illustrative preview in all locales; it is not
  presented as a screenshot of a live customer account. Dashboard/language
  feature graphics and the platform diagram are native HTML/SVG/CSS.

## Verification

- Full application suite: **1,516 passed**, zero failures or skipped tests.
- Homepage/retained mini-preview suite: **22 passed**, including mounted menu
  dismissal, all three languages, route isolation and non-submitting fields.
- Lint, TypeScript, diff check and standard Turbopack production build passed.
- Production build's 13 critical dynamic-route guards passed.
- An initial build encountered stale `.next/dev` route types for the moved
  homepage. The generated cache was archived outside the repo, then the standard
  build passed. No compiler configuration or application workaround was added.
- Browser review: AR/HE/EN at 1440×900, 768×1024 and 390×844; additional 320px
  phone width. No document horizontal overflow. No browser warning/error logs
  observed. AR navigation closes after section selection; request fields remain
  a preview with sending disabled. Existing locale switching works.
- AGENTS.md is unchanged, including its Next.js managed block and custom rules.

Review screenshots are local artifacts in
`C:/Users/saleh/.codex/artifacts/madaf-homepage/`:

- `desktop-full.png` — Arabic complete page at 1440px width.
- `tablet-768.png`, `tablet-full.png` — Arabic tablet viewport / complete page.
- `mobile-390.png`, `mobile-full.png` — Arabic phone viewport / complete page.

Full-page captures use the measured document height to avoid the browser tool's
stitched capture defect; normal 900/1024/844px viewport geometry was checked
separately. These are Chromium responsive checks, not physical-device tests.
