# Madaf Design System (M0.2)

Tokens live in [`src/app/globals.css`](../src/app/globals.css) as Tailwind v4
`@theme` variables. **Always use tokens — never raw hex values in components**
— with ONE deliberate exception: the category identity system below.

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
