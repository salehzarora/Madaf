# Madaf Ledger — Design Tokens

Rewrite the `@theme` block in `src/app/globals.css` (Tailwind v4). Semantic names are kept
where they exist today so most `bg-surface` / `text-ink` / `border-line` usage keeps working;
values change, and a few tokens are added.

## 1. `@theme` replacement

```css
@theme {
  /* Typography */
  --font-sans: var(--font-rubik), ui-sans-serif, system-ui, -apple-system,
    "Segoe UI", "Helvetica Neue", Arial, sans-serif;
  --font-mono: var(--font-plex-mono), ui-monospace, SFMono-Regular, Menlo, monospace; /* NEW */

  /* Surfaces & text — deeper warm paper */
  --color-background:     #F2EFE7;
  --color-surface:        #FFFFFF;
  --color-surface-warm:   #FBF9F3;   /* NEW: card header strips, table heads, wells */
  --color-surface-sunken: #EAE5D9;
  --color-ink:            #191612;
  --color-ink-soft:       #4E4941;
  --color-ink-muted:      #837B6D;
  --color-line:           #E2DCCD;
  --color-line-hair:      #EDE9DE;   /* NEW: row dividers */
  --color-line-strong:    #CBC3B0;

  /* Band — navigation chrome (NEW group) */
  --color-band:       #12312A;       /* sidebar, storefront cart bar, login bg, invite panel */
  --color-band-ink:   #F4F1E8;       /* text on band */
  --color-band-muted: #9DB4AA;       /* secondary text on band */

  /* Brand — bottle green (replaces teal scale) */
  --color-brand-50:  #EFF6F1;
  --color-brand-100: #D8EBDD;
  --color-brand-300: #8FC7AB;
  --color-brand-500: #2E8168;
  --color-brand-600: #17694F;        /* primary action */
  --color-brand-700: #125540;        /* hover, links */
  --color-brand-800: #0E4634;        /* active */
  --color-brand-900: #0B3A2C;
  --color-brand-950: #12312A;        /* = band */

  /* Accent — amber */
  --color-accent:      #E8A33D;      /* bright: on band, counts, active-nav bar */
  --color-accent-text: #9A6210;      /* readable amber on light surfaces */
  --color-accent-deep: #7A4E0C;      /* banner body text */
  --color-accent-soft: #F8EDD8;      /* badge fill */
  --color-accent-wash: #FDF8EC;      /* banner / tinted card bg */

  /* Status (square-dot ticket badges) */
  --color-info:    #3B62B8;  --color-info-soft:    #EDF1FA;
  --color-success: #23784A;  --color-success-soft: #E9F4EC;
  --color-warning: #9A6210;  --color-warning-soft: #F8EDD8;
  --color-danger:  #BC3A31;  --color-danger-soft:  #FAECEA;

  /* Shape & elevation — squarer, crisper */
  --radius-card:  0.875rem;  /* 14px */
  --radius-field: 0.625rem;  /* 10px */
  --radius-badge: 6px;
  --shadow-card:  0 1px 2px rgb(25 22 18 / 0.05), 0 6px 18px rgb(25 22 18 / 0.04);
  --shadow-float: 0 2px 6px rgb(25 22 18 / 0.08), 0 16px 48px rgb(25 22 18 / 0.12);
}
```

Order-status → tone mapping is unchanged (new=info, confirmed=brand, preparing=warning,
delivered=success, cancelled=danger); only values changed. `body` keeps
`background: var(--color-background); color: var(--color-ink);`.

## 2. Fonts (`src/app/[locale]/layout.tsx`)

Keep Rubik as-is. Add:

```ts
import { IBM_Plex_Mono } from "next/font/google";
const plexMono = IBM_Plex_Mono({
  weight: ["400", "500", "600"],
  subsets: ["latin"],
  variable: "--font-plex-mono",
  display: "swap",
});
// add plexMono.variable to the <html>/<body> className alongside rubik
```

Mono is only ever applied to Latin identifiers/digits (SKUs, order/doc numbers, emails,
warehouse slots, chart values) — it needs no Hebrew/Arabic glyphs.

## 3. Recurring motifs (canonical Tailwind)

**Shelf rule** — under page titles, document headers, above document totals.
Make a tiny shared component:

```tsx
export function ShelfRule({ className }: { className?: string }) {
  return (
    <div className={className}>
      <div className="h-0.5 bg-ink" />
      <div className="h-[3px] border-b border-line-strong" />
    </div>
  );
}
```

**Eyebrow label** — `text-[11px] font-bold uppercase tracking-[0.08em] text-ink-muted`
(on band: `text-band-muted`; on amber cards: `text-warning`).

**Mono identifier** — `font-mono text-[13px] font-semibold` + **always** `dir="ltr"`.
As a link: add `text-brand-700 hover:underline`.

**Ticket badge** (status/availability/doc-status) —
`inline-flex items-center gap-1.5 rounded-badge border px-2.5 py-[3px] text-xs font-semibold`
with tone soft bg + tone text + `border-current/25`; dot = `size-1.5 rounded-[2px] bg-current`.
Invoice-draft variants use `border-dashed` + warning tone.

**Focus ring** — `focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600`
(on band surfaces: `outline-accent`).

**Page title block** — eyebrow (optional) + `text-[28px] font-extrabold tracking-[-0.02em] text-ink`
+ subtitle `text-sm text-ink-soft` + `<ShelfRule className="mt-3" />`.

## 4. Contrast (checked)

ink/canvas 15.4:1 · band-ink/band 11.9:1 · band-muted/band 4.9:1 · white/brand-600 5.1:1 ·
accent-text/accent-soft ≥ 4.6:1 · accent-deep/accent-wash ≥ 7:1. Don't lighten these pairs.
