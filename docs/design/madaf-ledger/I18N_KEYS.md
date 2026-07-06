# Madaf Ledger — New i18n keys

Rules (repo `CLAUDE.md`): every UI string goes through `src/i18n/dictionaries/{ar,he,en}.ts`,
typed by `src/i18n/types.ts` — add each key to the type first so all three languages are
forced. **Never remove or change existing keys/translations.** No other new strings are
needed; everything else in the redesign reuses existing dictionary entries.

## `catalog.*` (sorting — Catalog v2 command bar)

| Key | he | ar | en |
|---|---|---|---|
| `catalog.sort` | מיון | الترتيب | Sort |
| `catalog.sortFeatured` | מומלץ | مقترح | Featured |
| `catalog.sortPriceAsc` | מחיר עולה | السعر تصاعدياً | Price low-high |
| `catalog.sortPriceDesc` | מחיר יורד | السعر تنازلياً | Price high-low |
| `catalog.sortName` | שם | الاسم | Name |

## `admin.dashboard.*` (Dashboard v2 — new sub-object)

| Key | he | ar | en |
|---|---|---|---|
| `trend` | מגמת הזמנות | اتجاه الطلبيات | Orders trend |
| `trendSub` | סכום יומי | مجموع يومي | Daily total |
| `statusMix` | התפלגות סטטוס | توزيع الحالات | Status mix |
| `topProducts` | מוצרים מובילים | أبرز المنتجات | Top products |
| `topCustomers` | חנויות מובילות | أبرز المحلات | Top shops |
| `byRevenue` | לפי היקף הזמנות | حسب حجم الطلبيات | By order value |
| `today` | היום | اليوم | Today |
| `lowSub` | מתחת לסף של 10 אריזות | دون حدّ 10 عبوات | Below the 10-package threshold |
| `emptyLabel` | אזל | نفد | Out |
| `ordersCount` | {count} הזמנות | {count} طلبيات | {count} orders |

Notes:
- `ordersCount` uses the existing `interpolate()` `{count}` convention.
- Sort labels render as `"{sort}: {option}"` in the select.
- Numbers/dates inside these strings still go through `src/lib/format.ts`
  (Arabic pins Western digits — do not hand-format).
