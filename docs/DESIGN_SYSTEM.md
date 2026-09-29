# Madaf Design System — Storefront V3, Admin V3 and Ledger surfaces

> ⚠️ **PARTIALLY STALE — do not use as a Pilot operational source.**
> The **Storefront Ordering Presentation Layer** is current for the customer
> routes listed below. The **Admin V3 Presentation Layer** covers AdminShell and
> the Dashboard body; **Madaf Ledger** remains the default for other Admin bodies
> and for other excluded surfaces.
> Material from **"Category identity system (M0.2)"** onward records earlier
> milestones, including conflicting palette, typography, product-art and layout
> descriptions. It does not override either current scoped section. Implementation
> authority is `src/app/globals.css` and the scoped CSS it imports. The
> authoritative source for the monitored Pilot is
> [`pilot/MONITORED-PILOT-LAUNCH-RUNBOOK.md`](pilot/MONITORED-PILOT-LAUNCH-RUNBOOK.md).
> Earlier milestone material is retained as a historical record.

Global Ledger tokens live in [`src/app/globals.css`](../src/app/globals.css) as Tailwind v4
`@theme` variables. **Always use tokens — never raw hex values in components**
— with TWO deliberate exceptions: the category identity colors below
(`category-style.ts`) and manufacturer brand tiles.

The [Storefront Ordering Presentation Layer](#storefront-ordering-presentation-layer)
below governs Catalog, Product, Cart, Checkout, Success,
Private Shop and Showcase presentation. Its shared tokens and scoped rules take
precedence over older storefront descriptions; global Ledger primitives remain
available to Admin page bodies, auth/onboarding and legal/document UI.

## Public marketing homepage

The homepage at `/ar`, `/he` and `/en` now uses the dedicated server-rendered
`src/app/[locale]/page.tsx` and `marketing/marketing-home.tsx`. It retains the
existing LogoMark and storefront navy/peach/lavender tokens, with a marketing
header/footer, device hero, platform diagram, feature illustrations, steps,
audience cards and supplier-request preview. The old landing-specific rules
below describe the prior ordering-shell homepage and no longer govern this route.

All new styles use `.marketing-*` selectors in `marketing/marketing-home.css`.
The existing ordering AppShell, providers and route layouts are unchanged.
Only LocaleSwitcher and the small mobile-menu dismissal wrapper are client
components. The request preview has labeled fields but no form, submission
handler, persistence or API call; its send button is disabled. No pricing plans,
unverified contact details or unsupported logistics capabilities are advertised.

See [homepage scope, artwork and QA](product/HOMEPAGE_MARKETING_REDESIGN.md).

## Admin V3 Presentation Layer

ADMIN-DASHBOARD-STYLE-005 establishes shared Admin chrome and the Dashboard V3
body. It preserves Rubik typography, typed AR/HE/EN dictionaries, logical CSS,
tenant data boundaries and existing navigation. This is a presentation contract,
not approval to merge, deploy or admit real customers; the Pilot runbook remains
the operational authority.

### Dashboard refinement 006B (current override)

The `/[locale]/admin` body now has a working server-driven period selector and
selected-period analytics. This subsection supersedes the 005 descriptions below
of an unfiltered Dashboard trend, month-only primary revenue tile, and icon-only
product rows. Shared AdminShell behavior and other page bodies are unchanged.

- Native GET controls use `range=24h|48h|7d|30d|3m|custom`, with `from`/`to` for
  custom. The default is 30 days. Invalid, reversed, future or over-366-day custom
  ranges fall back to 30 days with localized feedback. Calendar dates use the
  server-derived tenant timezone; hour presets cover elapsed hours ending now.
- New/Open order KPIs describe orders **created in the selected period, grouped
  by current status**. Their sparklines are creation cohorts, not a history of
  backlog changes. The third primary KPI is selected-period non-cancelled sales.
  These three cards have static zero-based microcharts; no percentages are invented.
- Today KPIs stay today; inventory, active product/shop counts and all operational
  alerts stay current-state. Signup counts remain owner/admin-gated. Recent
  Orders remains the latest six across all dates. Localized copy identifies these
  semantics. Missing signup permission leaves four alerts, not an empty fifth slot.
- Revenue trend, status mix and top product/shop rankings follow the selected
  range. Hour presets use hourly buckets; 7/30 days use tenant-local days; three
  months use weeks. Custom uses days through 93 days and weeks above that. Empty
  buckets are real zero values. Exact-value tables include all bucket intervals,
  counts and amounts; hourly intervals include offsets to disambiguate DST.
- The range trend fits the entire bounded series in its card, with sparse date
  ticks and exact-value disclosures. General-purpose legacy chart behavior stays
  available to its existing callers. Charts do not require client aggregate state.
- Top Products and Low Stock use compact 44px contained images. A dedicated
  data-layer helper deduplicates the displayed 5+4 product IDs, selects only ID
  and image, and reuses batch signing. Only display URLs enter ProductImage;
  missing, invalid and failed images use the existing brand mark fallback with
  Admin V3 colors. No full catalog lookup or per-row data query is introduced.
- Operational alerts use two larger tinted priority cards followed by compact
  supporting cards. Tablet uses two columns; desktop with five permitted cards
  uses a 6-track grid (3+3, then 2+2+2). Mobile stacks cleanly. Zero-state copy,
  destinations and permission decisions remain unchanged.

The Dashboard remains server-rendered. Only the small native form leaf manages
which date inputs appear. The additive, read-only, SECURITY INVOKER
`get_dashboard_period_metrics` RPC returns bounded aggregates under existing RLS.
It requires the 006B migration before a separately approved Supabase release;
this local milestone does not apply it to hosted infrastructure.

Implementation/data semantics and QA contract:
[`product/ADMIN_DASHBOARD_REFINEMENT_006B.md`](product/ADMIN_DASHBOARD_REFINEMENT_006B.md).

### Scope and architecture

| Surface | Coverage |
| --- | --- |
| Shared AdminShell | Every `/[locale]/admin` route and its descendants: sidebar, desktop top bar, mobile/tablet header, drawer and bottom navigation |
| Dashboard V3 body | Only `/[locale]/admin`: heading/actions, primary/secondary KPIs, operational alerts, Trend Chart, Status Donut, Low Stock, Top Shops, Top Products and Recent Orders |
| Deferred bodies | Products, Orders, Manufacturers, Inventory, Customers, Documents, Team, Business Settings and Tax Settings retain their current Ledger/internal presentation; they inherit the V3 shell only |

- `AdminLayout` remains a Server Component and the existing authentication and
  membership gate. Supabase users without a session go to Login; those without
  membership go to Onboarding. Mock mode retains its zero-configuration demo.
- `AdminShell` retains its existing client boundary for navigation and dialog
  lifecycle. The Dashboard page and its presentation components remain
  server-rendered; aggregates do not move into client state.
- The page still calls unchanged `getDashboardMetrics()`, a bounded recent-order
  read with `pageSize: "6"`, and server-derived `getTenantTimeZone()`. The aggregate
  uses the existing tenant-scoped RPC in Supabase mode and matching mock
  definitions. No full order-history read is introduced by presentation.
- Pending signup counts are requested only for Supabase owner/admin. The exact
  server-side count reads no signup rows/PII; unauthorized and mock states have
  no signup card or reserved slot.
- CSS imports are global, but `.admin-v3` plus named shell/dashboard selectors
  make styling opt-in. Do not override global Ledger or Storefront tokens,
  shared Button/Input/Card defaults, or arbitrary child-page elements. The
  Storefront presentation layer below remains independent.

| Responsibility | Implementation under `src/components/` |
| --- | --- |
| Shell/theme | `admin-shell.tsx`, `admin/admin-theme.css` |
| Heading, KPIs and alerts | `dashboard/dashboard-top.tsx`, `dashboard/dashboard-top.css`, `dashboard/kpi-card.tsx`, `metric-card.tsx`, `dashboard/operational-alert-card.tsx` |
| Analytics | `dashboard/dashboard-analytics.tsx`, `dashboard/analytics-card.tsx`, `dashboard/trend-chart.tsx`, `dashboard/status-donut.tsx`, `dashboard/dashboard-analytics.css` |
| Operational widgets | `dashboard/dashboard-widgets.tsx`, `dashboard/dashboard-widgets.css` |

### Palette and usage

[`admin/admin-theme.css`](../src/components/admin/admin-theme.css) owns these
scoped tokens. Components consume tokens rather than introducing another palette.

| Name | Token | Color | Use |
| --- | --- | --- | --- |
| Navy Deep | `--admin-navy-deep` | `#0B1828` | Dark navigation structure |
| Navy | `--admin-navy` | `#152442` | Headings and primary text |
| Indigo | `--admin-indigo` | `#28365D` | Supporting dark structure/analytical ink |
| Emerald | `--admin-emerald` | `#007A63` | Primary actions and active navigation |
| Teal | `--admin-teal` | `#087F83` | Primary-action hover and positive operational accent |
| Cyan | `--admin-cyan` | `#E6F7FA` | Mint/positive supporting surfaces |
| Blue | `--admin-blue` | `#3565CF` | Informational and new-order signals |
| Lilac | `--admin-lilac` | `#ECEBFF` | Analytical/supporting surfaces |
| Lilac Strong | `--admin-lilac-strong` | `#8177C8` | Supporting/categorical accents |
| Peach | `--admin-peach` | `#FFF0E5` | Warning surfaces |
| Warning | `--admin-warning` | `#A34717` | Warning text and low-stock accents |
| Danger | `--admin-danger` | `#B83242` | Actual danger/out-of-stock emphasis |
| Canvas | `--admin-canvas` | `#F4F7FC` | Cool page background |
| Surface | `--admin-surface` | `#FFFFFF` | Cards and controls |
| Muted | `--admin-muted` | `#596782` | Supporting text and metadata |
| Border | `--admin-border` | `#DFE6F1` | Neutral edges and dividers |
| Focus | `--admin-focus` | `#3758C8` | Focus on light surfaces |
| Focus-on-dark | `--admin-focus-on-dark` | `#99E8D3` | Focus on dark navigation |

Navy carries structure/headings; Emerald carries primary actions/active states.
Teal and mint support analytics and positive operational accents. Blue indicates
information/new orders, Lilac supports analysis, and Peach supports warnings.
Semantic success, warning and danger retain their meaning. Chart categories are
not replacements for status-badge semantics. Navigation also uses dedicated
light ink/muted tokens and a restrained dark gradient; the canvas washes are
static. None of these rules redefines the Storefront palette.

### AdminShell contract

- **Desktop, >=1280px:** a permanent 240px sticky sidebar at logical inline-start
  (AR/HE right, EN left), internally scrollable navigation and a desktop top bar.
- **Below 1280px:** mobile/tablet top bar, modal drawer and bottom navigation.
  Destinations remain **Dashboard, Orders, Products, Customers, Menu**. Active
  links use `aria-current="page"`, a visible indicator and stronger text as well
  as color. Bottom controls are at least 44px; the page clearance and navigation
  padding both include the bottom safe-area inset.
- The native dialog has an accessible name and modal semantics. Opening locks
  document scroll and focuses Close. Explicit Tab/Shift+Tab traversal contains
  focus among eligible controls, including links when native WebKit Tab behavior
  omits anchors. Disabled, hidden, inert and negative-tabindex controls are skipped.
- Escape, Close, backdrop, route navigation and the desktop transition dismiss
  the drawer. Cleanup releases the scroll lock; same-route dismissal restores
  opener/scroll, while destination navigation retains its own focus/scroll.
  Crossing 1280px restores focus to the active sidebar link if the opener is hidden.
- At viewport heights <=600px the complete drawer scrolls, preventing long tenant
  and identity text from squeezing navigation. Drawer language-link focus rings
  stay inset within their light pill. Other dark-surface controls use mint focus.
- Existing route matching, role visibility, tenant switcher, locale switcher and
  logout are preserved. No search, notification, command palette or promo CTA is added.

### Dashboard heading, cards and alerts

`DashboardTop` presents the existing heading and Add Product / Review Orders /
Open Catalog links. Heading/actions wrap; actions retain 44px minimum height.
Primary KPIs use 20px rounded cards with Blue, Mint, Lilac and Peach washes;
secondary KPIs use smaller white 16px tiles. Navy text, cool borders, restrained
shadows and component-scoped surfaces form the shared visual grammar.

Values retain full formatted ILS/counts, tabular digits and LTR bidi isolation.
Responsive value sizing handles large amounts without clipping; labels wrap.
Open orders display real new/confirmed/preparing shares with textual counts.
The month card shows actual revenue and order count. Alerts retain their existing
destinations; positive counts receive badges and zero uses calm explanatory copy.
No totals are recomputed from a bounded widget preview.

### Dashboard charts

`DashboardAnalytics` composes white 22px `AnalyticsCard` sections with Navy
headings and scoped chart colors. Trend consumes the existing ascending series
of at most 14 **populated tenant-local dates with orders**, using non-cancelled
subtotals. It does not fill missing dates, filter or re-aggregate the supplied data.
The footer names the latest recorded date; Month Revenue is not a chart total.

Mint bars and an Emerald maximum sit on quiet grid lines. Each point has a full
calendar date, compact visible amount and accessible exact ILS value. The named,
focusable region scrolls internally with readable lanes, including long values;
it must never widen the document. A native keyboard-operable exact-value
disclosure exposes the date/value table. Dates remain calendar dates and display
LTR; removal of formatting direction marks affects display only. Empty series
have localized copy and actual zero values remain visible.

The 156px donut uses new/confirmed/preparing/delivered/cancelled in categorical
Blue/Emerald/Peach/Lilac/Gray. Exact proportional, butt-ended arcs have no fixed
gaps that erase tiny positive shares. The localized total and all five legend
counts remain available, including zeros. Total zero shows a neutral ring and
localized explanation. Legends wrap at 13px; cards >=500px wide place ring and
legend side by side. Charts are static and add no library, animation, date-range
selector, query or client boundary.

### Dashboard operational widgets

White 22px section cards continue the chart surfaces with Navy labels, neutral
local SVG icons and Emerald accents. Each widget has a localized empty state.

- **Low Stock:** up to four supplied rows, in supplied order, with localized names,
  available locations and each product's own threshold. Bar width is stock/threshold
  clamped only for drawing, without a positive floor. Zero is zero and has explicit
  out-of-stock text; Danger is reserved for actual zero stock. The link remains
  `/admin/inventory?low=1` beneath the active locale.
- **Top Shops / Customers:** the top four supplied stored names, order counts and
  subtotals, with guests excluded by existing metrics.
- **Top Products:** the top five supplied products by non-cancelled line revenue,
  including historical inactive products. Ranked rows show explicit ranks and exact
  ILS values. No new thumbnail/avatar reads or ranked-row links are introduced.
- **Recent Orders:** the bounded six-order read remains full width. Each linked
  row exposes reference, customer, tenant-zone timestamp, line count, stored
  subtotal and status. Customer fallback is `customerName → snapshot name → "—"`,
  specifically `customerName ?? customerSnapshot?.name ?? "—"`; preserve empty strings.
  IDs, amounts and numeric timestamps remain bidi-safe; mixed-language stored
  names use automatic direction. Existing status semantics remain; only the
  Dashboard preparing badge uses Admin Warning ink to reach 5.21:1 contrast,
  and the local wrapper rounds badge corners. Shared Badge defaults stay unchanged.

### Responsive contract

Dashboard content remains bounded to **1096px**. Phone content uses 16px gutters,
24px from 640px and 32px from 1024px. Below the desktop shell breakpoint the
bottom content padding is `104px + safe-area-inset-bottom`; desktop uses 32px.

| CSS viewport width | Shell | Primary / secondary KPIs | Alerts | Analytics | Lower widgets / Recent Orders |
| --- | --- | --- | --- | --- | --- |
| <360px | Header, drawer, bottom nav | 1 / 1 column | 1 column | Stacked | Stacked widgets; all order fields stacked |
| 360–639px | Header, drawer, bottom nav | 2 / 2 columns | 1 column | Stacked | Stacked widgets; all order fields stacked |
| 640–767px | Header, drawer, bottom nav | 2 / 2 columns | 2 columns | Stacked | Stacked widgets; all order fields stacked |
| 768–1023px, tablet portrait | Header, drawer, bottom nav | 2 / 2 columns | 2 columns | Stacked | 2-column widgets; third card spans; Recent Orders full-width field grid |
| 1024–1279px, tablet landscape | Header, drawer, bottom nav | 4 / 4 columns | 3 columns | 1.6:1, approximately 62/38 | 3 widgets; full-width Recent Orders |
| >=1280px, desktop | 240px sidebar and top bar | 4 / 4 columns | 3 columns | 1.6:1 split | 3 widgets; full-width Recent Orders |

At wide desktop the bounded content prevents giant stretched cards. Zoom reflows
through the same CSS breakpoints; browser zoom is never disabled. Analytics and
lower-widget min-width rules keep scrolling local to the chart.

### Data truthfulness rules

- **No fake growth percentages.** Show only supported stored/derived metrics.
- **No fake date-range selector.** Trend means latest populated dates with orders,
  not automatically “last N days.”
- **No fake search, notification or command palette.** Do not imply absent features.
- **Latest trend point is not today** unless its date actually matches the current
  tenant-local day. Browser or machine timezone is never business-date authority.
- **Low stock means strictly below each product's individual threshold**, not a
  shared display threshold or count inferred from the four-row preview.
- **Chart colors are categorical**, not substitutes for semantic status colors.
- **Recent Orders uses stored subtotal and tenant-local time**; preserve the
  `customerName → snapshot name → "—"` nullish fallback without inventing a customer
  or replacing a stored empty string.

### Accessibility, QA and future Admin pages

Keep visible focus on light and dark surfaces, 44px primary/shell controls,
keyboard-operable disclosures and chart scrolling, modal lifecycle cleanup,
safe-area clearance, full accessible values and RTL/LTR isolation. No essential
interaction depends on motion. The existing loading skeleton remains compatible;
its opacity pulse is decorative and was not redesigned by this milestone.

Use `test:dashboard-metrics`, `test:signup-count` and `test:dashboard-ui` alongside
the full suite, timezone matrix, lint, typecheck, build and production dependency
audit. JSDOM tests cover semantics, data binding and lifecycle; actual modal
layout/inertness, focus, overflow, zoom and cross-route containment require browser
checks. Windows Playwright WebKit is **not physical Safari verification**; do not
claim physical iPhone/iPad coverage from it. Local QA does not establish hosted
migration parity, backup readiness, release approval or real-customer GO.

Later approved Admin-body milestones should reuse these tokens, the existing
shell, the Dashboard heading/action grammar and section-card grammar. Extend
consistent form/table/filter conventions when those bodies are implemented;
there is no new universal V3 form/table/filter kit in this milestone. Do not
create speculative components or apply Dashboard selectors to unrelated bodies.
The existing Product/Add permission UX issue remains separate: the Dashboard
Add Product link is visible to sales reps, while the unchanged destination denies
that role and the Products list already hides its Add action. This is a navigation
inconsistency, not an authorization bypass; presentation does not change role
policy or authorize product writes.


## Madaf Ledger visual system (sitewide refresh)

The default visual language outside Storefront V3 and the scoped Admin V3 surfaces is **"Madaf
Ledger"** — a wholesale supplier's paper ledger digitized. The original spec lives in
[`docs/design/madaf-ledger/`](design/madaf-ledger/).

**Foundations**
- **Canvas** — warm paper `--color-background: #F2EFE7`; cards are white
  `bg-surface` with `border-line` + `shadow-card` (no floating white-on-white).
  Warm fills: `bg-surface-warm` (strip headers, table heads, footers),
  `bg-surface-sunken` (wells).
- **Band** — deep bottle-green `--color-band: #12312A` for legacy Ledger
  "spine" surfaces (AdminShell uses the scoped Admin V3 palette above);
  text on it is `text-band-ink` / `text-band-muted`.
- **Accent** — amber `--color-accent: #E8A33D` for the active-nav marker,
  cart count, and invoice-draft emphasis. Amber text on light uses
  `text-accent-text` / `text-accent-deep` for contrast; never as body color.
- **Brand** — bottle greens `brand-600` (primary action) → `brand-800`
  (active). Scale is 50/100/300/500/600/700/800/900/950 (no 200/400).

**Type**
- Two families via `next/font/google` in `[locale]/layout.tsx`: **Rubik**
  (`--font-rubik`, all scripts) and **IBM Plex Mono** (`--font-plex-mono`,
  Latin identifiers only). Use `font-mono` for every Latin identifier —
  SKUs, order/doc numbers (`MDF-####`, `DOC-####-X`), phones, emails,
  slot codes, `7 / 10` composites, chart values — each also wrapped in
  `dir="ltr"`.
- Page titles: `text-[28px] font-extrabold tracking-[-0.02em]` over an
  eyebrow `text-[11px] font-bold uppercase tracking-[0.08em] text-ink-muted`,
  closed with a `<ShelfRule>`.

**Ledger components** (`src/components/ui/`)
- `ShelfRule` — 2px ink rule + 1px hairline, sits under page titles / in
  the document view (shelf-edge motif).
- `Badge` — squared "ticket" (`rounded-badge`, `border-current/25`) with a
  `dot` (square pip) and `dashed` variant; invoice-draft badges are dashed
  amber.
- `Select` — native `<select>` in a squared field with a logical-end chevron
  (catalog sort).
- `Chip` / `Input` / `Button` / `Card` (with `CardHeader variant="strip"`)
  all follow the squared, hairline-ruled ledger idiom; focus ring is
  `outline-brand-600` (amber on band surfaces).

**Category dots** — the ledger identity is a single muted **color dot**
per category (`categoryDot()` in `category-style.ts`), a small square pip on
cards/tabs. ProductImage's `default` presentation retains a **neutral** paper
placeholder (faint package glyph + mono unit-size tag). Storefront V3 media uses
the shared presentation described below. The older category-art specification
later in this document is historical, not the current ProductImage contract.

## Storefront Ordering Presentation Layer

Storefront V3 is the approved ordering presentation established by
CATALOG-STYLE-REFRESH-003 and extended by STOREFRONT-STYLE-004. It preserves
Madaf's identity, Rubik typography, typed AR/HE/EN content and each route's
existing ordering behavior. Authenticated routes retain their zero-configuration
mock demo. Public token routes retain their existing token-enabled data-mode
guards; mock mode does not make private credentials or guest ordering available.

### Scope

| Flow | Routes |
| --- | --- |
| Authenticated customer/sales storefront | `/[locale]`, `/[locale]/catalog`, `/[locale]/product/[id]`, `/[locale]/cart`, `/[locale]/checkout`, `/[locale]/order-success` |
| Private Shop | `/[locale]/shop/[token]`, including its success and invalid/inactive states |
| Guest Showcase | `/[locale]/showcase/[token]`, including browse, guest checkout, success and invalid states |

**Excluded:** Admin; auth, onboarding, invite and join routes; legal/document UI.
Visual consistency does not change permissions, data models, order contracts,
inventory behavior or release approval.

### Palette and usage

| Role | Color | Use |
| --- | --- | --- |
| Navy | `#182444` | Structural anchors, primary text, active navigation |
| Indigo | `#273A68` | Supporting dark surfaces and control states |
| Pale lilac | `#F5F3FA` | Storefront canvas and light wells |
| Warm wash | `#FFF8F2` | Restrained light surface warmth |
| Peach | `#FFB38C` | Primary action accent |
| Selected lilac | `#EEE9FF` | Selected products/customer context and controls |
| Violet edge | `#5D56A7` | Selection and interactive border feedback |
| Slate | `#58617A` | Secondary text and metadata |
| Cool edge | `#DCE0ED` | Neutral dividers and borders |
| Focus violet | `#5144B2` | Focus on light surfaces |

Navy anchors the hero, ordering header/footer and sticky cart; white/lilac carry
the content. Peach is the action accent, never a substitute for a stock/status
color. The approved treatment also uses small peach cart-count/icon/package
details and a faint static hero/canvas wash; do not expand it into large content
fills or promotional claims. Violet is reserved for selection/focus interaction
feedback, including hover borders. Semantic warning/danger colors still mean
low stock, expiry attention, sold out or destructive action as appropriate;
they are not decorative labels. Focus indicators on dark controls must remain
legible: the card increment retains its contrasting peach outline, while the
ordering stepper uses a light focus surface with a violet outline.

### Architecture and containment

[`storefront-theme.css`](../src/components/storefront-theme.css) owns the shared
`--storefront-*` palette. Catalog `--catalog-ui-*` / `--catalog-card-*` variables
are compatibility aliases, not another palette. Preserve the existing sRGB
dialog scrim token and semantic success/warning/danger tokens.

- AppShell remains a **Server Component** and supplies the authenticated
  `.storefront-theme` wrapper. Header/footer rules are scoped beneath that
  wrapper; body canvas propagation uses `body:has(> .storefront-theme)`.
- StorefrontCatalogLink is the bounded pathname-aware client leaf. AppShell
  passes only `locale` and `dict.nav.catalog`; CartLink and LocaleSwitcher remain
  existing client children. Do not move the shell or full dictionary across a
  new client boundary to style navigation.
- Private Shop and Showcase use explicit `.storefront-theme` roots for browse,
  checkout and terminal states. They do not render authenticated AppShell,
  navigation, CartProvider, ShopDataProvider or CustomerPicker.
- ProductImage's `storefront` presentation and `catalog-card` compatibility
  presentation share V3 media. `default` and legacy `catalog` remain separate;
  the catalog hero opts its photos into the full-media fill while OrderPad
  retains the legacy treatment.
- CSS imports are global, but presentation selectors are opt-in. Do not recolor
  global Button/Input/Card, brand tokens or semantic status primitives. Shared
  QuantityStepper styling also requires a route-specific class.

| Responsibility | Implementation |
| --- | --- |
| Theme, header/footer | `storefront-theme.css`, `app-shell.tsx`, `storefront-catalog-link.tsx` |
| Shared media | `product-image.tsx`, `storefront-product-media.css`; `catalog-product-media.css` retains legacy catalog art |
| Catalog workspace, cards and review | `catalog-workspace.css`, `product-card.tsx`, `order-pad.tsx` |
| Public homepage | `marketing/marketing-home.css`, `marketing/marketing-home.tsx`, `src/app/[locale]/page.tsx` (route); replaces prior landing usage |
| Product and related navigation tiles | `storefront-product.css`, `product-detail-actions.tsx`, `storefront-product-tile.tsx` |
| Cart | `storefront-cart.css`, `cart-view.tsx` |
| Checkout and Success | `storefront-checkout.css`, `checkout-view.tsx`, order-success route |
| Public shared browse/terminal presentation | `shop/private-shop.css` with explicit Showcase `.public-store-*` aliases |
| Guest checkout | `shop/showcase-storefront.css`, `shop/showcase-view.tsx` |

The CSS/component paths in this table are relative to `src/components/` unless
identified as a route. Public presentation reuse preserves the independent
ShopView and ShowcaseView controllers.

### Product Card V3

- Integrated **5:4** media, with a **4:3** media fallback below 360px. Real images
  remain centered and uncropped with `object-fit: contain`, without added inner
  padding. A softened copy of the same photo fills the media behind the complete
  product, with only the foreground photo's side edges feathered into it;
  baked-in backgrounds and source margins are not removed.
- Missing or failed images use static, abstract branded package artwork. The
  media is decorative; the product link/name supplies the accessible label.
- A two-line product name, optional manufacturer, compact wholesale package
  details, prominent package price and secondary unit price preserve ordering
  context. Prices and identifiers remain bidi-safe.
- A peach Add action becomes the package quantity control when selected. Lilac
  surfaces and a violet edge indicate selection; the line total remains visible.
- Sold-out products cannot be initially added or incremented. Existing cart
  quantities remain decrementable/removable; visual status never changes those
  rules or the submission-key lifecycle.

### Shared product/media system

The shared V3 renderer uses centered `object-fit: contain` with `5cqw` padding,
except catalog-card photos and the opt-in catalog hero/product-detail photos,
which remove that padding and use a softened photo backdrop within the same
media area.
Transparent photos remain transparent; baked backgrounds and source margins
are preserved. Missing/failed images use static abstract package artwork and
the existing size-tag semantics. No background removal, generated image service
or runtime image processing was introduced. Image signing/data boundaries are
unchanged. Do not describe the legacy `default` real-photo renderer as contained:
it retains its separate `object-cover` behavior.

| Consumer | Geometry |
| --- | --- |
| Catalog cards | 5:4 media; 4:3 below 360px |
| Product detail | 4:3 below 640px; square at 640–1023px; 6:5 from 1024px; 26px frame corners |
| Related navigation tiles | 4:3 media, linked product navigation without ordering controls |
| Cart thumbnails | 72×72px, 16px corners, size tag/tiny brand detail omitted |
| Checkout thumbnails | 52×52px, size tag/tiny brand detail omitted |
| Private Shop / Showcase cards | 4:3 media with 17px media corners |
| Landing preview | 4:3 media below 1024px; 2:1 from 1024px |

Public product cards retain in-place ordering, optional manufacturer, package
details, wholesale price, Peach Add, Violet selection and sold-out controls.
They do not gain product-detail navigation, favorites or promotional badges.

### Responsive layout and ordering surfaces

**Catalog** retains its approved workspace geometry:

| Viewport | Product grid / ordering surface |
| --- | --- |
| Width below 360px | One column; sticky cart and review |
| Width 360–639px | Two columns; sticky cart and review |
| Width at least 640px | Three columns; review is a centered modal |
| Width at least 1024px **and** height at least 650px | Three columns plus sticky OrderPad |
| Width at least 1280px **and** height at least 650px | Four columns plus OrderPad |
| Width at least 1600px **and** height at least 650px | Five columns plus OrderPad |

The workspace has a 1720px maximum width. Short wide viewports retain the
three-column grid and sticky cart instead of squeezing in a side panel. Logical
layout places the panel left in Arabic/Hebrew and right in English. Only its
line list scrolls; customer context and totals stay fixed.

The hero uses static branded decoration and up to three actual catalog products
(one on phones); dimensions are content-aware minimums. Search, horizontal
category scrolling, manufacturer disclosure and sort remain the existing
discovery controls. Stock/availability labels follow product data.

The sticky cart reviews the same cart state. Its existing Review Cart trigger
opens a native dialog: bottom sheet on phones, centered modal from 640px, with
24px corners and a navy backdrop. View Cart continues to the existing cart route;
it is not a payment or order-submission action. Keep native focus containment,
nested customer-popover Escape behavior, focus return, scroll restoration and
closing on a usable side-panel orientation. Emptying the cart hides the sticky
bar while an already-open review safely retains its empty state.

**Other route layouts** use their own bounded geometry:

| Surface | Actual responsive behavior |
| --- | --- |
| Landing | Max 1320px; hero splits at 768px; category grid 2/3/6 columns at base/640/1024; feature grid 1/2/4 at the same breaks; three role columns from 768px |
| Product | Max 1200px; one column below 640px, two from 640px; related tiles 2/3/4 columns at base/640/1024 |
| Cart | Max 1200px; one column below 1024px, then `minmax(0, 1fr) 336px`; line controls sit below on phone and in a 176px column from 640px |
| Authenticated Checkout | Max 1200px; fields become two columns at 640px; 336px summary column from 1024px; recap list has a 320px scroll maximum |
| Order Success | Max 720px; centered panel; action column becomes a row at 640px |
| Private Shop / Showcase browse | Max 1200px; product grid 1/2/3/4 columns at base/360/640/1024px |
| Showcase checkout | Max 640px; one-column phone fields, two from 640px; 16px inputs with minimum 46px height |

Cart preserves zero-minimum grid tracks and children (`minmax(0, 1fr)` /
`min-inline-size: 0`) to prevent intrinsic content from expanding the document.
The Cart summary is not sticky. Authenticated Checkout and Showcase checkout
keep final submission in normal document flow so the form remains scrollable.

### Ordering surfaces and security-flow distinctions

**Authenticated CartProvider != Private Shop local cart != Showcase local cart.**
Visual reuse never authorizes controller, state, persistence or security reuse.

- **Authenticated:** the existing CartProvider retains customer selection,
  localStorage cart persistence and its submission-key lifecycle. Cart uses
  White/Lilac line/panel surfaces; Checkout retains existing fields, delivery
  controls, action contract and server-authoritative pricing/totals. Success
  displays the existing public reference, next steps and navigation.
- **Private Shop:** a token-derived fixed customer, independent local Map cart,
  notes and sticky submit. Its Navy/Indigo bar submits through the existing
  private-link action with the `shop_token` key namespace. The bar includes
  safe-area padding, is capped at 60dvh with scrolling, and has existing
  content-space reservations for normal/error/conflict states.
- **Showcase:** independent local Map cart and guest snapshot with
  `customer_id = NULL`. Its browse bar only switches to guest checkout. The
  read-only recap, required store name, optional guest fields, localized city,
  notes, Back action and final submit preserve their existing semantics. Back
  retains cart/controlled notes; uncontrolled identity inputs reset on remount.
  The submission namespace remains `showcase`.
- **Both public flows:** raw URL tokens remain credentials passed through the
  existing action boundary; persisted submission-key lookup uses a SHA-256 token
  digest plus channel namespace, not raw tokens. Storage preparation fails closed;
  rejected/ambiguous attempts reuse the key, conflict preserves state, explicit recovery rotates it, and
  success clears cart/notes/key. Do not conflate these storage mechanics with
  authenticated CartProvider persistence.

Success uses semantic green, Navy headings and a Lilac/White public-reference
panel. Error/conflict states retain persistent accessible danger/warning alerts.
Invalid-link terminal panels preserve existing anonymous public copy, noindex
metadata and route guards without exposing internal IDs or token diagnostics.
No payment, shipping, tax, customer-persistence or order path was added.

### Accessibility and performance

Ordering actions and quantity buttons retain at least 44px touch targets. Use
logical CSS for spacing, radii and positioning; keep AR/HE RTL and EN LTR, including isolated
numbers. Retain native semantics, meaningful labels, disabled states and visible
keyboard focus. Honor reduced-motion preferences: catalog explicitly suppresses
transitions for reduced motion; other new surfaces use restrained color/border
feedback and static decoration. No new animation dependency exists. ProductImage
photos remain lazy-loaded; no image-generation/runtime-processing pipeline was added.

Keep Storefront CSS and presentation variants scoped. Verify changes in Chromium
and genuine WebKit where available, especially `:has()`, `color-mix()`, container
queries, native dialog/popover behavior, `100dvh` and safe-area bottom spacing.
Device emulation does not prove physical iPhone Safari chrome, keyboard or
nonzero safe-area behavior. Do not add compatibility workarounds without a
demonstrated defect, or infer hosted/release approval from local visual QA.

## Category identity system (M0.2)

Madaf is a retail catalog, so each category owns a visual identity —
defined once in [`src/lib/category-style.ts`](../src/lib/category-style.ts)
and used by product art, catalog chips and landing tiles:

| Category | Palette | Pattern (product art) |
|---|---|---|
| Drinks | sky blues | bubbles (carbonation) |
| Snacks & Sweets | warm oranges | confetti |
| Coffee & Tea | rich ambers/browns | coffee beans |
| Canned & Pantry | tomato reds | can-top rings |
| Dairy | soft milk blues | waves |
| Cleaning | fresh emeralds | sparkles |

Rules:
- Category colors are for **identity only** (chips, tiles, placeholder
  art) — never for actions, status or text hierarchy.
- Product placeholder art (`product-image.tsx`) = category gradient +
  drawn SVG pattern + category icon + unit-size shelf tag, all
  **deterministic per product id** (stocked-shelf variety, stable renders).
- New categories must be added to `category-style.ts` (falls back to a
  neutral style otherwise).

## Typography

- **Font:** [Rubik](https://fonts.google.com/specimen/Rubik) via
  `next/font/google` — one variable font covering Latin, Hebrew and Arabic,
  loaded in `src/app/[locale]/layout.tsx` as `--font-rubik`.
- Weights used: 400 (body), 500 (labels/medium), 600–700 (headings, prices).
- Numbers in tables/prices use `tabular-nums`.

## Color tokens

### Semantic surfaces & text (use these first)

| Token | Utility | Use |
|---|---|---|
| `background` `#f7f6f3` | `bg-background` | app background (warm, not gray) |
| `surface` `#ffffff` | `bg-surface` | cards, headers, tables |
| `surface-sunken` `#f1efeb` | `bg-surface-sunken` | wells, hovers, chips track |
| `ink` `#211e1b` | `text-ink` | primary text |
| `ink-soft` `#57524c` | `text-ink-soft` | secondary text |
| `ink-muted` `#8a847c` | `text-ink-muted` | hints, meta |
| `line` `#e8e5e0` | `border-line` | default borders |
| `line-strong` `#d6d2cb` | `border-line-strong` | inputs, emphasized borders |

### Brand & accent

- **Brand (shelf teal):** `brand-50 … brand-950`; primary actions use
  `bg-brand-600` (`#1e7a70`), hover `brand-700`. Light fills `brand-50`,
  borders `brand-200/300`.
- **Accent (warm amber):** `accent-50 … accent-900` — used **sparingly**:
  cart count badge, demo badge, expiry highlights. Never for primary actions.

### Status

| Token | Soft bg | Meaning |
|---|---|---|
| `info` | `info-soft` | new orders, informational notices |
| `success` | `success-soft` | in stock, delivered |
| `warning` | `warning-soft` | low stock, preparing, expiry, invoice-draft banners |
| `danger` | `danger-soft` | out of stock, cancelled, destructive |

Order-status → tone mapping lives in
[`order-status-badge.tsx`](../src/components/order-status-badge.tsx):
new=info, confirmed=brand, preparing=warning, delivered=success,
cancelled=danger.

## Shape & elevation

- `--radius-card: 1rem` → `rounded-card` (cards, tables, sheets).
- `--radius-field: .75rem` → `rounded-field` (buttons, inputs, chips-rects).
- `--shadow-card` → `shadow-card` (resting cards);
  `--shadow-float` → `shadow-float` (hover, dropdowns, drawers).
- Chips and pills are fully rounded (`rounded-full`).

## Spacing & layout

- Content max width: **catalog & storefront header `max-w-[1720px]`**
  (retail density on wide screens); landing sections & admin `max-w-6xl`.
- Catalog grid: 2 cols mobile → 3 sm → 4 lg → 5 on 2xl, with a sticky
  **order pad** column (330px, xl+) and a sticky search/filter zone (md+).
- Page padding: `px-4 sm:px-6`; admin adds `lg:px-8`.
- Card padding: `p-5 sm:p-6`; compact cards `p-4`.
- **Tap targets:** interactive elements ≥ 44px on tablet — buttons are
  `h-11`/`h-12`/`h-13`, steppers `size-11`.

## Core components (src/components/)

| Component | File | Notes |
|---|---|---|
| Button | `ui/button.tsx` | primary/secondary/outline/ghost/danger · sm/md/lg |
| Card | `ui/card.tsx` | Card/CardHeader/CardTitle/CardContent |
| Badge | `ui/badge.tsx` | neutral/brand/success/warning/danger/info |
| Chip | `ui/chip.tsx` | toggleable filter chip (`aria-pressed`) |
| Input/Textarea/Select/Label | `ui/input.tsx` | 44px fields, focus ring `brand-200` |
| App shell | `app-shell.tsx` | storefront header + footer |
| Admin shell | `admin-shell.tsx` | sidebar (start side), mobile drawer |
| Locale switcher | `locale-switcher.tsx` | segmented, path-preserving |
| Product card | `product-card.tsx` | retail card: manufacturer eyebrow, bold name, LOUD package price + per-unit, solid stock badge on art, one-tap add |
| Product image | `product-image.tsx` | category gradient + SVG pattern + unit-size shelf tag (deterministic) |
| Order pad | `order-pad.tsx` | sticky POS-style order panel on catalog (xl+) |
| Mini catalog preview | `mini-catalog-preview.tsx` | landing hero visual from real mock products |
| Quantity stepper | `quantity-stepper.tsx` | package quantities, big targets |
| Availability badge | `availability-badge.tsx` | dot + label |
| Order status badge | `order-status-badge.tsx` | dot + label, tone-mapped |
| Order status control | `order-status-control.tsx` | visual pipeline (admin) |
| Metric card | `metric-card.tsx` | dashboard stat tile |
| Empty state | `empty-state.tsx` | dashed well + icon + hint + action |
| Customer picker | `customer-picker.tsx` | "ordering for shop" dropdown |
| Document view | `document-view.tsx` | A4 sheet, watermark, print CSS |
| Logo | `logo.tsx` | shelf mark SVG + wordmark |

Icons: [lucide-react](https://lucide.dev). Directional icons (arrows) get
`rtl:-scale-x-100` (or `ltr:-scale-x-100` for back-arrows authored for RTL).

## Interaction rules

- Hover states change color/elevation, never move layout.
- Focus: `focus-visible:outline-2 outline-brand-500` on all interactive
  elements.
- Transitions: `transition-colors`/`transition-shadow` only — no bounce.
- Disabled: `opacity-50` + `pointer-events-none`.

## Voice & content

- Trilingual copy lives in `src/i18n/dictionaries/{ar,he,en}.ts` typed by
  `src/i18n/types.ts` — adding a key to the type forces all three languages.
- Tone: professional, warm, concise. No exclamation marks except the
  order-success moment.
- Every demo/mock behavior is labeled in the UI (demo badge, mock notices).
