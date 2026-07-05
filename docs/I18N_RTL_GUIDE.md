# i18n & RTL Guide

## Locales

| Code | Language | Direction | Role |
|---|---|---|---|
| `ar` | Arabic | **RTL** | must be excellent — many users are Arabic speakers |
| `he` | Hebrew | **RTL** | default app locale AND default for documents |
| `en` | English | LTR | clean fallback / admin option |

Definitions live in [`src/i18n/config.ts`](../src/i18n/config.ts):
`locales`, `defaultLocale = "he"`, `defaultDocumentLocale = "he"`,
`dirFor(locale)`, `intlLocaleFor`.

## Routing

- Every page is under `/[locale]/…`. The **root layout** is
  `src/app/[locale]/layout.tsx` (Next 16 supports nesting the root layout in
  a dynamic segment) and sets `<html lang={locale} dir={dirFor(locale)}>`.
- [`src/proxy.ts`](../src/proxy.ts) (Next 16 "proxy", formerly middleware)
  redirects any path without a locale prefix to `/he/...`.
- `generateStaticParams` prerenders all three locales for every route.
- Locale validation: `isLocale()` narrows the param; invalid → `notFound()`.

## Dictionaries

- One typed object per language: `src/i18n/dictionaries/{ar,he,en}.ts`.
- The shape is the `Dictionary` interface in `src/i18n/types.ts` —
  **adding a key there breaks the build until all three languages have it.**
  This is the completeness guarantee; keep it.
- Server pages call `getDictionary(locale)` and pass `dict` (or slices)
  into client components as props.
- `{count}`-style placeholders use `interpolate()` from
  `src/i18n/dictionaries/index.ts`.

## RTL rules (non-negotiable)

1. **Logical properties only.** Use `ms-*/me-*`, `ps-*/pe-*`,
   `start-*/end-*`, `text-start/text-end`, `border-s/e`, `rounded-s/e-*`.
   Never `ml/mr/pl/pr/left-/right-/text-left/text-right`.
2. **Directional icons flip.** Forward arrows: `rtl:-scale-x-100`.
   Back-arrows authored pointing "back" in RTL get `ltr:-scale-x-100`.
   Non-directional icons (cart, printer) never flip.
3. **Numbers, phones, SKUs, order numbers stay LTR** inside RTL text:
   wrap in `dir="ltr"` (see phone/SKU/order-number renders).
4. **Mixed-direction text**: shop names render as-is (proper nouns);
   product names come from the per-locale translation, so no bidi mixing
   inside a single string.
5. The sidebar, drawers and dropdowns are positioned with `start-*`/`end-*`
   so they mirror automatically in RTL.

## Formatting

Always use [`src/lib/format.ts`](../src/lib/format.ts) — never hand-format:

- `formatCurrency(amount, locale)` → ILS via `Intl.NumberFormat`
  (`he-IL`, `en-IL`, and `ar-IL-u-nu-latn`).
- `formatDate` / `formatDateLong`, `formatNumber` — same Intl tags.
- **Arabic pins Western (latn) digits** (`u-nu-latn`): local-market B2B
  users expect `₪58` / `24`, not `٥٨`/`٢٤`. Keep this unless users say
  otherwise.

## Fonts

Rubik (variable) covers Latin + Hebrew + Arabic in one font — loaded once
in the root layout with `subsets: ["latin", "arabic", "hebrew"]`. If the
brand later needs a dedicated Arabic display font, add it as a second
`next/font` variable and scope by `[lang="ar"]`.

## Documents vs UI language

The document previews (`document-view.tsx`) have their **own** language
state, defaulting to Hebrew (`defaultDocumentLocale`) regardless of UI
locale, with an in-page toggle. The printed sheet gets `dir`/`lang` from
the document language, not the UI.

## Known limitations

- The locale switcher preserves the path but **drops query params**.
- `not-found.tsx` receives no params → static trilingual content.

## Testing checklist per language

1. `<html lang dir>` correct (view source).
2. Header/nav mirrored in ar/he; sidebar on the right.
3. Chips rows scroll from the correct side.
4. Prices/dates/phones render LTR and aligned correctly inside RTL text.
5. Catalog → cart → checkout → success reads naturally end-to-end.
6. Document preview in each of the 3 document languages.
