# Documents & Invoices Guide

## ⚠️ The legal rule of this repository

**Madaf does NOT create legal tax invoices in this phase — and must never
claim to.** We are building a *legal-invoice-ready architecture only*.

Approved wording (already in all three dictionaries under `docs.*`):

- "Invoice draft" / טיוטת חשבונית מס / مسودة فاتورة ضريبية
- "Document preview" / תצוגת מסמך / معاينة المستند
- "Not a legal tax invoice until tax settings/provider integration are
  configured."

Hebrew document UI may show: **הזמנה**, **תעודת משלוח**, **טיוטת חשבונית
מס** — never plain "חשבונית מס" as a document title, and never wording that
implies legal issuance.

## Document types (M0)

| Type key | he | ar | en | Contents |
|---|---|---|---|---|
| `order` | הזמנה | طلبية | Order Request | items, prices, totals-as-estimate |
| `delivery` | תעודת משלוח | شهادة توصيل | Delivery Note | items + quantities, **no prices**, signature block |
| `invoiceDraft` | טיוטת חשבונית מס | مسودة فاتورة ضريبية | Tax Invoice — Draft | items, prices, VAT estimate, **DRAFT watermark + legal notice** |

Derivation rules (`src/lib/mock/documents.ts`): every order → `order`;
status preparing/delivered → `delivery`; delivered → `invoiceDraft`.

## Safety mechanics in the UI (keep all of them)

1. **Watermark**: `invoiceDraft` renders a rotated טיוטה/مسودة/DRAFT
   watermark across the sheet — it prints too, on purpose.
2. **Legal notice**: shown above the sheet AND inside the printed footer of
   every invoice draft (`docs.notLegalNotice`).
3. **Documents index banner** (`admin.documents.legalBanner`) — permanent.
4. **VAT is labeled an estimate** (`docs.vatEstimate`, currently 18% via
   `VAT_RATE` in `src/lib/types.ts`) with `docs.vatDisclaimer` under totals.
5. Checkout carries `checkout.disclaimer`: an order request is not an
   invoice and no payment happens.

## Hebrew-first behavior

Documents default to Hebrew regardless of UI language
(`defaultDocumentLocale = "he"` in `src/i18n/config.ts`). The preview has
its own language toggle (he/ar/en) that re-renders the sheet with the right
`dir`, translated labels and localized product names.

## Print

- `window.print()` from the preview toolbar; `.print-hidden` hides chrome.
- `.doc-sheet` (globals.css) is A4-proportioned (~794px @96dpi) and drops
  borders/shadows in `@media print`.

## What the backend agent must add before invoices become real

1. **Tax settings** on the supplier: VAT registration type
  (עוסק מורשה/פטור), rates, rounding rules.
2. **Provider integration** for legal issuance & allocation numbers
   (Israel Tax Authority "חשבוניות ישראל" allocation-number regime) —
   via a certified invoicing provider/API.
3. **Immutable numbering** sequences per document type, per legal entity.
4. **Signed PDF generation + archival** (7 years) — previews here are HTML.
5. Only after all of the above may UI labels drop the "draft" wording —
   behind a feature flag, defaulting OFF.

Until then, every invoice surface keeps the draft watermark and notices.
