# Madaf Ledger — Component Guide

All components live in `src/components/` (primitives in `src/components/ui/`).
Improve in place — do not fork parallel component trees. Class strings below are the
target resting state; keep existing behavior, props, and a11y attributes.

## Primitives (`ui/`)

### `ui/button.tsx`
Base: `inline-flex items-center justify-center gap-2 rounded-field font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:pointer-events-none disabled:opacity-50`
Sizes unchanged (`sm h-9 px-3 text-sm` / `md h-11 px-4 text-sm` / `lg h-12 px-6 text-base`).
- `primary`: `bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800 font-bold shadow-[inset_0_1px_0_rgb(255_255_255/0.12),0_1px_2px_rgb(25_22_18/0.2)]`
- `secondary` (**new meaning**: ink outline): `border border-ink text-ink hover:bg-ink hover:text-background`
- `outline`: `border border-line-strong bg-surface text-ink-soft hover:bg-background`
- `ghost`: `text-ink-soft hover:bg-surface-sunken hover:text-ink`
- `danger`: `bg-danger text-white hover:bg-[#A02D26]`

### `ui/badge.tsx`
`inline-flex items-center gap-1.5 rounded-badge border px-2.5 py-[3px] text-xs font-semibold`.
Tones: neutral `bg-background text-ink-soft border-line`; brand `bg-brand-50 text-brand-700 border-brand-600/25`;
info/success/warning/danger = `bg-{tone}-soft text-{tone} border-current/25`.
Add a `dot` prop rendering `<span class="size-1.5 rounded-[2px] bg-current" />`.
Add a `dashed` prop (`border-dashed`) — used by every invoice-draft badge.

### `ui/chip.tsx` (filter pills — still used on orders/products filters)
Idle: `h-10 rounded-full border border-line-strong bg-surface px-4 text-[13px] font-semibold text-ink-soft hover:border-ink`.
Selected-neutral ("All"): `border-ink bg-ink text-background`.
Selected-brand: `border-brand-600 bg-brand-50 text-brand-800 shadow-[inset_0_0_0_1px_var(--color-brand-600)]`.
Category chips render a dot `size-2 rounded-[3px]` in the category color (see §category identity) instead of the emoji.

### `ui/input.tsx`
Field base: `w-full rounded-field border border-line-strong bg-surface px-3.5 text-sm text-ink placeholder:text-ink-muted transition-colors focus:border-brand-600 focus:outline-none focus:ring-[3px] focus:ring-brand-600/15 disabled:opacity-50`. Heights unchanged (h-11).
Add `mono` variant: `font-mono text-[13px]` + callers pass `dir="ltr"` (emails, SKUs, tokens).
Label: `mb-1.5 block text-[13px] font-semibold text-ink-soft`.

### `ui/card.tsx`
Card: `rounded-card border border-line bg-surface shadow-card`.
New `CardHeader variant="strip"`: `flex items-center justify-between border-b border-line bg-surface-warm px-5 py-3.5` with `CardTitle` = `text-[15px] font-bold text-ink`. Used by every list/table/widget card.

### NEW `ui/shelf-rule.tsx`
See DESIGN_TOKENS.md §3. Used under page titles, in `document-view`, and above doc totals.

## App components

### `admin-shell.tsx` — dark sidebar + warm top bar
- Sidebar: `w-[248px] shrink-0 flex-col bg-band` (full height; contains the logo block, tenant switcher, nav). Logo mark on band = amber square variant (swap fills: rect `fill-accent`, shelves/goods `fill-band`).
- Nav item idle: `relative flex h-[42px] items-center gap-3 rounded-field px-3 text-sm font-medium text-band-muted hover:bg-band-ink/[.08] hover:text-band-ink`.
- Active: `bg-band-ink/10 font-bold text-band-ink` + amber marker `<span class="absolute inset-inline-start-0 top-2 bottom-2 w-[3px] rounded-full bg-accent" />` (logical start edge — right in RTL).
- Orders item count badge: `ms-auto inline-flex min-w-5 h-5 items-center justify-center rounded-badge bg-accent px-1.5 font-mono text-[11px] font-semibold text-band` (new-orders count).
- Tenant switcher (multi-tenant): band-tinted button `border border-band-muted/25 bg-band-ink/5 hover:bg-band-ink/10` with amber initial tile.
- Top bar: `h-16 border-b border-line bg-surface-warm px-7` — eyebrow (`tenant · page`) + page name at start; locale switcher + session chip (avatar `size-7 rounded-lg bg-band text-accent font-bold`, mono email, caps role) + logout at end.
- Mobile: dark top bar (band) with menu button + **bottom tab bar**: `fixed bottom-0 inset-x-0 bg-band rounded-t-2xl border-t border-band-muted/20` — 5 tabs (dashboard/orders/products/shops/menu), active `text-accent`, idle `text-band-muted`, 19px icons + 10px labels.

### `app-shell.tsx` — storefront
- Header `bg-surface-warm/95 border-b border-line`: green logo mark (band bg, cream shelves, two amber goods) + stacked wordmark (native name + mono caps "WHOLESALE"), hairline divider, supplier name; end: locale segment, admin ghost link, **cart button** `h-11 rounded-field bg-ink px-4.5 text-sm font-bold text-background hover:bg-black` with amber mono count chip.
- Footer: `border-t border-line bg-surface-warm py-5`, split row — `appNameNative · tagline` (semibold) and mock-notice in `rounded-badge border border-dashed border-line-strong px-2.5 py-1`.

### `product-card.tsx` — see PASS2 spec §3 for the final (v2) card. Highlights:
neutral placeholder art, stock badge only when NOT in stock, ink/mono unit-size tag,
manufacturer eyebrow + category dot, locked 2-line name, hairline **price bar** with
44px square add button ↔ line-total + stepper when in cart.

### `product-image.tsx` + `category-style.ts`
- Delete the gradient/pattern generator. Placeholder branch: `flex items-center justify-center bg-[#F0ECE2]` + lucide `Package` at `text-ink/[.16]` stroke 1.5 + unit-size tag `absolute bottom-2 inset-inline-end-2 rounded-badge bg-ink px-1.5 py-0.5 font-mono text-[10.5px] font-semibold text-background` with `dir="ltr"`. Keep the `imageUrl` photo branch unchanged.
- `category-style.ts` shrinks to `categoryDot(categoryId): string`: drinks `#7FB6D9`, snacks `#E5A05C`, coffee `#A9825A`, canned `#D98A79`, dairy `#9FB4D9`, cleaning `#7FBFA5`, fallback `line-strong`. Identity only — never for actions/status.

### `order-pad.tsx`
Header strip: `bg-band px-4 py-3.5` — title `text-sm font-bold text-band-ink` with amber cart icon and `ms-auto` amber mono count chip; shop selector = translucent band button (`border border-band-muted/35 bg-band-ink/5 text-band-ink`).
Lines: `divide-y divide-line-hair`, sm stepper on `bg-surface-warm`, `hover:text-danger hover:bg-danger-soft` remove.
Footer: `border-t border-line bg-surface-warm` — subtotal `text-xl font-extrabold tabular-nums tracking-[-0.02em]`, VAT note 11px, primary CTA h-[46px].

### `quantity-stepper.tsx`
`rounded-field border border-line-strong bg-surface-warm overflow-hidden`; buttons `hover:bg-surface-sunken`; value `font-mono font-semibold`. In-cart variant (inside product card): `border-[1.5px] border-brand-600 bg-brand-50`, buttons `text-brand-700 hover:bg-brand-100`, value `text-brand-800`.

### `order-status-control.tsx` (keep ALL transition logic)
Per step, stacked: **6px bar segment** `h-1.5 w-full rounded-[3px]` — current `bg-brand-600`, passed `bg-brand-300`, future `bg-line`; below it `size-[22px] rounded-lg font-mono text-[11px]` number tile (reached: `bg-brand-600 text-white`; else `bg-background text-ink-muted`) + label (`font-bold text-ink` reached / `text-ink-muted`). Steps in an `ol` with `gap-2`, each `flex-1`. Cancel: quiet `border border-line-strong rounded-lg h-9 px-3.5 text-xs font-semibold text-ink-muted hover:border-danger hover:text-danger`; when cancelled `border-danger bg-danger-soft text-danger`. Hint text stays.

### `metric-card.tsx`
Keep for non-dashboard pages: eyebrow label + `text-[32px] font-extrabold tabular-nums tracking-[-0.02em]` value + icon in `size-8 rounded-lg` tinted tile at the header's end. Warning tone tints the card: `border-warning/35 bg-accent-wash`, eyebrow `text-warning`. The dashboard itself uses the richer KPI cards from PASS2 spec.

### `empty-state.tsx`
`rounded-card border border-dashed border-line-strong bg-surface-warm px-6 py-12 text-center` — icon tile `size-14 rounded-card bg-surface-sunken text-ink-muted`, title `text-base font-bold`, hint `text-[13px] text-ink-muted max-w-[280px]`, action = secondary (ink-outline) button.

### `document-view.tsx` (**legal wording untouched**)
- Draft watermark: keep `rotate(-30deg)`; style `text-[100px] font-black tracking-[0.12em] text-danger/[.07] border-[6px] border-danger/[.07] rounded-2xl px-10 py-2`.
- Header: logo 52px + supplier name `text-[22px] font-extrabold text-brand-950`; end column gets dashed warning `Badge` "DRAFT", doc-type h1, and a small meta table — value cells `font-mono font-semibold` with **`padding-inline-start`** (physical padding breaks RTL) and `dir="ltr"`.
- `<ShelfRule>` under the header and above the totals; totals block `w-[280px]`.
- Parties: 3px start-edge bars — supplier `border-inline-start-[3px] border-line ps-3.5`, customer `border-brand-600`.
- Items table: `bg-surface-warm` head band; name+SKU cell = `inline-flex flex-wrap items-baseline gap-2` (**never** raw inline name+SKU — bidi collapses the space); qty `font-mono font-semibold`.
- Not-legal banner (screen + doc footer): `rounded-field border border-dashed border-warning/50 bg-accent-wash px-4 py-3 text-[13px] font-medium text-accent-deep` + triangle icon.

### Other
- `locale-switcher.tsx`: unchanged behavior; track `border-line bg-surface-sunken`.
- `customer-picker.tsx` / sales-visit banner: banner = band card (see PASS2 catalog header) — amber-tinted store icon tile, band-muted eyebrow, cream shop name, amber-outline "change" button.
- Team invite form: band-dark panel; inputs `border-band-muted/35 bg-band-ink/[.07] text-band-ink` (mono for email), submit = amber `bg-accent text-band font-extrabold hover:bg-[#F0B155]`.
- Login page: full-`bg-band` screen with faint shelf lines `bg-[repeating-linear-gradient(0deg,transparent,transparent_118px,rgb(244_241_232/0.06)_118px,rgb(244_241_232/0.06)_120px)]`; amber logo + cream wordmark above a `bg-[#F7F4EC] rounded-2xl p-8 shadow-float` card; mono email input; primary submit.

## RTL/LTR rules (apply everywhere)

- Logical properties ONLY: `ms-/me-/ps-/pe-/start-/end-/text-start`, `inset-inline-*`, `border-inline-start`, `padding-inline-*`.
- Directional icons: forward arrows `rtl:-scale-x-100`; back arrows authored for RTL get `ltr:-scale-x-100`.
- Every identifier (SKU, order/doc number, phone, email, slot, "7 / 10" style composites, chart day labels) is wrapped `dir="ltr"` — neutral characters between digit runs reorder in RTL otherwise.
- Name + identifier pairs: flex row with `gap`, never one bidi text run.
