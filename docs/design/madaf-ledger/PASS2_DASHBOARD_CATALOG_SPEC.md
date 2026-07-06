# Madaf Ledger — Pass 2 spec: Dashboard v2 & Catalog v2

These two screens supersede the Pass 1 versions. Everything is buildable with plain
HTML/CSS + inline SVG — **no chart library**.

Chart palette (restrained): track `line-hair #EDE9DE` · normal `brand-300 #8FC7AB` ·
emphasis `brand-600 #17694F` · highlight/today `accent #E8A33D` · terminal/muted `line-strong #CBC3B0` ·
"new" info `#3B62B8`. Values in mono; axis/labels 10–11px `text-ink-muted`.

---

## 2. Dashboard v2 (`src/app/[locale]/admin/page.tsx`)

Composition ("editorial columns"), content `max-w-[1096px] mx-auto flex flex-col gap-4`:

1. **Header row**: title block (h1 + subtitle + ShelfRule) with quick actions at the end —
   primary sm "Add product", outline "Review orders", ghost "Open catalog as customer".
   (The old quick-actions card is removed.)
2. **KPI row** — `grid grid-cols-4 gap-3`, new `kpi-card.tsx`:
   - Card base: `rounded-card border border-line bg-surface p-4.5 shadow-card`; eyebrow label; value `text-[30px] font-extrabold tabular-nums tracking-[-0.02em]`.
   - *New orders*: value + `bg-info-soft text-info` chip "Today" (`admin.dashboard.today`) + sub-line "Open orders: N".
   - *Open orders*: value + **segmented mini-bar** `flex h-1.5 rounded-[3px] overflow-hidden bg-line-hair` with spans sized by new/confirmed/preparing share, colors `#3B62B8 / #17694F / #E8A33D`.
   - *Month revenue*: value + **sparkline** — SVG `viewBox="0 0 84 30"`, polyline of daily totals, `stroke-brand-600` width 2, round caps; end dot `r=2.6 fill-accent`; sub-line "{count} orders".
   - *Low stock* (warning variant): `border-warning/35 bg-accent-wash`, eyebrow `text-warning`; value + danger mono chip `{emptyLabel} · 0` (out-of-stock count); sub-line `admin.dashboard.lowSub`.
3. **Trend + status** — `grid grid-cols-[1.8fr_1fr] gap-3`:
   - **`trend-chart.tsx`** (card with plain header: title + sub eyebrow, month total in mono brand at the end). Pure flexbox bars:
     `flex items-end gap-2 h-[150px] border-b-[1.5px] border-line-strong`; each day =
     `flex-1 flex flex-col items-center justify-end gap-1.5 h-full` → mono value label
     (compact `2.9K` format; today's in `text-accent-text`) + bar `w-full max-w-11 rounded-[5px_5px_2px_2px]`
     with `height: {pct}%` (min 2px). Colors: zero-day `bg-line-hair`, normal `bg-brand-300`,
     max day `bg-brand-600`, **today `bg-accent`**. `title` attr = full currency. Below the
     baseline: matching flex row of mono `dd/M` labels (`dir="ltr"`).
     **Data**: group non-cancelled orders by calendar day over the last 14 days (mock shows 9),
     summing `orderSubtotal` — aggregate from the existing `listOrders()` result; no new endpoints.
   - **`status-donut.tsx`**: SVG `viewBox="0 0 42 42"`, all circles `r=15.9 stroke-width=6 fill-none`,
     container rotated −90°; track circle `stroke-line-hair`; one circle per status with
     `stroke-dasharray="{frac*C - 1.2} {C - frac*C + 1.2}"` and cumulative negative
     `stroke-dashoffset` (C = 2π·15.9 ≈ 99.9) — the 1.2 gap separates segments.
     Center overlay: mono total + caps "orders" label. Legend: rows of 9px square dot +
     label + mono count. Colors: new `#3B62B8`, confirmed `#17694F`, preparing `#E8A33D`,
     delivered `#8FC7AB`, cancelled `#CBC3B0` (terminal states stay muted).
4. **Widgets row** — `grid grid-cols-3 gap-3`:
   - **Top products** (top 5 by summed line revenue, non-cancelled): row = name + mono
     currency at the end, then 6px progress bar (`bg-line-hair` track, width = value/max;
     #1 `bg-brand-600`, others `bg-brand-300`). Header carries `byRevenue` eyebrow.
   - **Top shops** (top 4 by summed subtotals): ranked rows `divide-y divide-line-hair` —
     22px mono rank tile (#1: `bg-band text-accent`, rest `bg-background text-ink-soft`),
     name + "{count} orders" sub-line, bold tabular total.
   - **Low stock** (amber-wash card, top 4): row = mono slot chip
     (`rounded-[5px] bg-ink/[.07] px-1.5 font-mono text-[10px]`, `dir="ltr"`), name,
     mono `"{stock} / 10"` **with `dir="ltr"`** (bidi reorders it otherwise — caught in review);
     under it a 5px progress bar of stock vs threshold (`bg-accent`, `bg-danger` when 0, min-width 3%).
5. **Recent activity** — full-width strip-header card; borderless table rows:
   mono order link (110px col) · shop (semibold) · date + line-count (muted) ·
   bold tabular total (end-aligned) · ticket badge (130px col, end).

**States**: loading = `bg-surface-warm` skeleton blocks inside each card; chart with no
orders = small EmptyState inside the card; data error = inline `bg-danger-soft text-danger`
notice — never a blank card.

**Mobile** (dashboard): band header (menu + eyebrow + title) → KPI 2×2 grid overlapping the
band by `-mt-6` → status as **horizontal segmented bar** (`h-2.5 rounded-[5px]` + wrap legend)
→ mini trend (74px bars, no value labels) → recent list → bottom tab bar.

---

## 3. Catalog v2 (`catalog-view.tsx`, `product-card.tsx`)

Header row: title block at start; **compact sales-visit band** at end
(`rounded-field bg-band px-3.5 py-2.5 shadow-[0_4px_14px_rgb(18_49_42/0.25)]` — amber-tinted
store icon tile `size-8.5 rounded-[9px] bg-accent/15 text-accent`, band-muted eyebrow
"Ordering for", cream shop name + muted city, amber-outline change button
`border border-accent/50 text-accent hover:bg-accent/10`). ShelfRule under the row.

### Command bar (sticky with tabs under the header, `top-16`, canvas backdrop-blur)
`flex items-center gap-2.5`: search input `h-12 flex-1 rounded-field ps-11` (icon start) +
**sort `Select`** `h-12 min-w-[180px] text-[13.5px] font-semibold` with options
`{sort}: {sortFeatured|sortPriceAsc|sortPriceDesc|sortName}` (keys in I18N_KEYS.md).
Mobile: 46px square icon-button (lucide `ArrowUpDown`) opening a sort sheet.

### Category tabs (`category-tabs` — replaces category pills on catalog only)
Row on a `border-b-2 border-line`; horizontally scrollable below md (`scrollbar-none`).
Tab: `relative flex items-center gap-1.5 px-3.5 pb-2.5 pt-2 text-sm shrink-0` —
category dot `size-2 rounded-[3px]`, name, mono count `text-[11px] text-ink-muted`.
Active: `font-bold text-ink` + underline
`absolute -bottom-0.5 inset-inline-[10px] h-[3px] rounded-t-[3px] bg-brand-600`.
Idle: `font-medium text-ink-soft hover:text-ink`. "All" tab carries the total count.
Toggle behavior identical to today's chips (click active → clear).

### Manufacturer tiles (`manufacturer-tile` — replaces small manufacturer chips)
Row: eyebrow "Manufacturers" + tiles + conditional "clear filters" ghost chip
(`hover:text-danger hover:bg-danger-soft`, only when any filter/search active) +
`ms-auto` mono results count.
Tile: `relative h-10 rounded-field border-[1.5px] ps-1 pe-3 flex items-center gap-2 shrink-0` —
30px initial tile `rounded-[7px] text-[13px] font-extrabold` with per-brand bg/fg
(coca `#B33A2E`/white, strauss `#2F4B8F`/white, osem `#B3542E`/white, elite `#3A2E23`/cream,
tara `#3E6FA8`/white, local `#12312A`/amber; fallback `surface-sunken`/ink-soft — render the
`logoUrl` image instead when present) + name `text-[13px] font-semibold`.
Idle: `border-line bg-surface text-ink-soft hover:border-ink`.
Selected: `border-brand-600 bg-brand-50 text-brand-800` + floating check
`absolute -top-1.5 -inset-inline-end-1.5 size-[17px] rounded-[6px] bg-brand-600 border-2 border-background` with 9px white check.
Multi-select semantics unchanged.

### Product card v2
- Art `aspect-[4/3] bg-[#F0ECE2]` (mobile `aspect-[5/4]`): faint package glyph; unit-size tag
  (ink/mono/cream, `dir="ltr"`, bottom-end); **stock badge only for lowStock/outOfStock**
  (`rounded-badge px-2 text-[11px] font-bold` on tone-soft); dashed amber expiry tag (end).
- Body `px-3.5 pt-3 gap-[3px]`: manufacturer eyebrow (`text-[11px] font-bold uppercase tracking-[0.05em] text-brand-700`)
  + category dot at the row end; name `text-[14.5px] font-bold leading-[1.35] line-clamp-2 min-h-[39px]`;
  package line `text-xs text-ink-muted`. **No price in the body.**
- **Price bar** `border-t border-line-hair px-3.5 pt-2.5 pb-3`:
  - Default: `flex items-center justify-between gap-2.5` — price `text-[19px] font-extrabold tabular-nums tracking-[-0.02em]`
    over per-unit `text-[11px] text-ink-muted`; end = **44×44 add button**
    `rounded-field bg-brand-600 text-white hover:bg-brand-700 active:scale-[.94]` with 18px plus,
    `aria-label={dict.catalog.addToCart}`.
  - Sold out: dashed chip `border border-dashed border-line-strong bg-surface-warm rounded-lg h-8.5 px-2.5 text-[11px] font-bold text-ink-muted` replaces the button.
  - In cart: line total `text-[15px] font-extrabold text-brand-800 tabular-nums` + compact stepper
    (38px buttons, mono qty, `border-[1.5px] border-brand-600 bg-brand-50`); card gets
    `border-brand-600` + ring shadow `0 0 0 1px #17694F, 0 6px 18px rgb(23 105 79/0.15)`.
- Hover: `shadow-float` only — no translation.
- Grid/breakpoints unchanged (2/3/4/5 cols; gap 4 desktop, 2.5 mobile). Order pad + sticky
  bottom cart bar unchanged from Pass 1.

### RTL/LTR notes (both screens)
- Underline indicators, tile checks, quote/marker bars, progress bars: logical props only.
- Chart day order follows reading direction (flex row) — right→left chronology in he/ar is intentional.
- `dir="ltr"` on: day labels, sparkline/bar value labels, ranks, "stock / 10", all identifiers.
- Donut/sparkline SVGs are direction-neutral; donut starts at 12 o'clock.
