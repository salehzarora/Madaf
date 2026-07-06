# Madaf Ledger — QA checklist

Run after each implementation phase and once at the end. Anything failing here blocks commit.

## Build & lint
- [ ] `npm run lint` clean
- [ ] `npm run build` green (zero-env / mock mode — no `.env.local` required)
- [ ] `npm audit --omit=dev --audit-level=moderate` — no NEW findings introduced by this branch
- [ ] No new dependencies in `package.json` (IBM Plex Mono comes via `next/font/google`, not a package)

## Route smoke (mock mode)
- [ ] `/` redirects to `/he`; `<html>` has correct `lang` + `dir` per locale
- [ ] `/he`, `/ar`, `/en` — landing renders
- [ ] `/he/catalog` (+ `?customer=c02` sales-visit banner), `/he/product/p01`, `/he/cart` → checkout → success
- [ ] `/he/admin`, `/ar/admin`, `/en/admin` — dashboard with charts (KPIs, trend, donut, widgets)
- [ ] `/he/admin/orders` → `/he/admin/orders/o1043` (pipeline, items, documents card)
- [ ] `/he/admin/products`, `/he/admin/inventory`, `/he/admin/customers`, `/he/admin/manufacturers`
- [ ] `/he/admin/documents` → `/he/admin/documents/doc-1043-i` (watermark + notices; doc-language toggle he/ar/en)
- [ ] Order detail → Documents card → download order / delivery / invoice-draft PDF still works (routes untouched)

## Visual / design-system
- [ ] Canvas `#F2EFE7`; cards white with `border-line` + `shadow-card`; no floating white-on-white
- [ ] Admin sidebar `#12312A` with amber active marker + orders count badge; content area stays light
- [ ] Status/availability/doc badges are squared tickets with square dots; invoice-draft badges dashed amber
- [ ] All identifiers (MDF-####, DOC-####-X, SKUs, A-01 slots, phones, emails) render in IBM Plex Mono
- [ ] Shelf rule under page titles and in document view
- [ ] Product cards: neutral placeholders (no gradient/pattern art), category dot, price bar with 44px add button; in-cart state = brand ring + stepper
- [ ] Dashboard charts match spec colors; no chart library imported
- [ ] No emoji as UI (category emoji replaced by dots except where dictionaries contain them)

## RTL / LTR (test he AND ar AND en)
- [ ] Sidebar sits at the inline start (right in he/ar); amber active bar on the start edge
- [ ] Forward arrows flip in RTL (`rtl:-scale-x-100`); back arrows correct in all three
- [ ] Order/doc numbers, SKUs, slots, phones, emails: LTR and unbroken inside RTL text
- [ ] Low-stock "7 / 10" style labels read stock-first in ALL locales (`dir="ltr"` present)
- [ ] Trend chart chronology follows reading direction; day labels `dd/M` not reordered
- [ ] Document view: doc-language toggle flips the sheet's `dir`/`lang` independently of UI locale; header meta table values properly spaced (logical padding)
- [ ] Product-name + SKU rows show a visible gap in RTL (flex+gap, not raw inline)
- [ ] Arabic shows Western digits everywhere (via `format.ts` — no hand-formatted numbers)

## Accessibility
- [ ] Interactive elements ≥ 44px on tablet/coarse pointers (buttons h-11+, add-button 44px; only in-pad steppers may be 34–38px)
- [ ] Visible focus ring (`outline-brand-600`; amber on band surfaces) on every interactive element
- [ ] No text below 11px; hints/meta ≥ 11px; body 13.5–14px
- [ ] Contrast: white on brand-600, band-muted on band, accent-text on accent-soft all pass (pre-checked pairs in DESIGN_TOKENS.md §4 — don't lighten)
- [ ] Icon-only buttons (square add, sort, menu, remove) have `aria-label`/`title`

## Guardrail greps (must all be clean)
```bash
git diff main --name-only | grep -E '^supabase/' && echo "FAIL: migrations touched"
git diff main -- src/lib/auth src/lib/data src/lib/actions | grep -vE '^[+-]\s*(className|class=)' | grep -E '^[+-]' | grep -viE 'classname|style' # review any hit manually
grep -rn "not a tax invoice\|אינה חשבונית מס\|ليست فاتورة ضريبية" src/i18n/dictionaries/ | wc -l   # must be ≥ 3 (one per language)
grep -rn "draftWatermark" src/ | wc -l    # still present
grep -rn "SERVICE_ROLE" src/ .env.example # no service-role in client code
grep -rn "NEXT_PUBLIC.*SERVICE" . --include="*.ts" --include="*.tsx"  # empty
grep -rn "recharts\|chart.js\|d3\|nivo\|echarts" package.json  # empty
```
- [ ] No legal-invoice issuing route/UI added; no payment UI; no tax-provider dependency
- [ ] i18n: `tsc` (via build) passes — proves new keys exist in all three dictionaries; no keys deleted
