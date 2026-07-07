# Documents & Invoices Guide

## ⚠️ The legal rule of this repository

**Madaf does NOT create legal tax invoices in this phase — and must never
claim to.** We are building a *legal-invoice-ready architecture only*.

Approved wording (already in all three dictionaries under `docs.*`):

- "Invoice draft" / טיוטת חשבונית מס / مسودة فاتورة ضريبية
- "Document preview" / תצוגת מסמך / معاينة المستند
- "Not a legal tax invoice until tax settings/provider integration are
  configured."

> **M6B (inert foundation) changes NONE of the above.** M6B added per-tenant
> **tax settings** (`/admin/settings/tax`, owner/admin) and an **inert** legal
> schema + default-OFF feature flags — but **no legal tax invoice is issued, no
> allocation number is requested, and no provider is called**. Saving tax
> settings issues nothing (the page says so in all three languages), and the
> `invoice_draft` keeps its DRAFT watermark + "not a tax invoice" notice
> unchanged. Do not remove any draft warning until real issuing ships (M6E+)
> and is reviewed + per-tenant enabled (M6G).

> **M6C (disabled numbering skeleton) also changes NONE of the above.** M6C
> added a DISABLED-by-default `draw_legal_document_number` RPC that draws an
> **internal, NON-LEGAL preview** number (`DRAFT-LEGAL-YYYY-######`) behind two
> default-OFF gates. It **issues no legal invoice, requests no allocation
> number, integrates no provider, and adds no payment or legal PDF**; it does
> not attach a `legal_number` to `legal_documents` or reach any UI/route.
> Numbering is **not legally active** — this is a skeleton, not production legal
> numbering. Draft watermarks + "not a tax invoice" notices are untouched.

> **M6D (provider sandbox/mock) also changes NONE of the above.** M6D added a
> server-only provider abstraction with only a **NullProvider** (disabled) and a
> **SandboxProvider** (deterministic mock, every response marked non-legal). No
> real tax-authority integration, no real allocation number (מספר הקצאה), no
> production provider mode, no credentials, no payments, no legal PDF. It changes
> no `legal_documents` row, attaches no `legal_number`, sets no `issued`/
> `provider_approved` status, and is wired to no UI/route. Draft watermarks +
> "not a tax invoice" notices remain untouched.

> **M6E (sandbox orchestration) also changes NONE of the above.** M6E can, only
> when every gate is explicitly enabled, write clearly-marked **SANDBOX /
> NON-LEGAL** rows (a `draft_internal` `legal_documents` row with `sandbox=true`,
> `legal_effective=false`; `legal_number`/`allocation_number` stay NULL) + a
> redacted log pair. A HARD CHECK keeps `legal_effective=false` — a real legal
> document is IMPOSSIBLE in M6E. No real tax invoice, allocation number, provider
> call, payment, PDF, or tokenized-customer legal download. The M5 `invoice_draft`
> and every draft watermark / "not a tax invoice" notice remain untouched.
> **M6E.1** hardened the RPC so a direct call cannot bypass the app: it enforces
> tenant tax readiness, draws the M6C number itself (duplicate fails before draw),
> and persists no caller JSON (SQL-generated sandbox payloads only). Still nothing
> legal is issued; all draft warnings remain.

> **M6F (sandbox archival/signing) also changes NONE of the above.** M6F can, only
> when the DB kill switch is on and the target is an M6E sandbox / non-legal
> document, write **write-once, NON-LEGAL** archival + signing records —
> tamper-evidence placeholders, not a real archive, not a real digital signature,
> not tax-compliant. Signatures are `SANDBOX-…` placeholders; a HARD CHECK keeps
> `legal_effective=false`. No real tax invoice, allocation number, provider call,
> production mode, payment, or legal PDF; `legal_number`/status untouched; all
> draft watermarks / "not a tax invoice" notices remain.

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

## Server-side PDF download (M5A)

M5A adds **real server-generated PDFs** for the three SAFE document types
(order request, delivery note, invoice **draft**) — alongside the existing
HTML preview. Download links live on the admin order-detail Documents card
(`/admin/orders/[id]`); the route is
`GET /[locale]/admin/orders/[id]/documents/[type]?lang=he|ar|en`.

- **Still NOT legal invoices.** M5A issues no tax invoice, uses no legal
  numbering, and integrates no tax-authority/provider API. The document
  number is an INTERNAL `DOC-<orderSerial>-<O|D|I>` (mirrors the seed/mock),
  never an immutable legal sequence.
- **Invoice-draft PDFs always carry** a rotated `טיוטה/مسودة/DRAFT`
  watermark **and** the localized `docs.notLegalNotice`. Its DB `status`
  stays `draft` — the `documents_invoice_draft_never_generated` CHECK still
  forbids `generated`. Never remove the watermark or notice.
- **Every** PDF (all three types) prints the universal footer
  `docs.pdfFooter` — "generated by Madaf · internal document · not a tax
  invoice" (trilingual).
- **Delivery notes show no prices** — items + quantities + a signature block
  only (same rule as the HTML sheet).
- **Hebrew-first**: the PDF defaults to `defaultDocumentLocale` (`he`);
  `?lang=` re-renders in ar/he/en.
- **Totals + line items come from the order snapshots** (`orders.subtotal/
  vat_total/total`, `order_items.*_snapshot`) — never recomputed from client
  input. VAT is an 18% ESTIMATE, labeled as such.
- **Engine**: pdfkit + a vendored OFL Rubik TTF (Latin/Hebrew/Arabic/₪) in
  `src/lib/pdf/` (server-only, Node runtime). No hosted deps, no Chromium.
  Hebrew + English render cleanly; Arabic shapes correctly but full
  mixed-direction bidi polish (inter-word spacing in Hebrew+number runs) is
  an M5B refinement.
- **On-demand + recorded**: the route generates the PDF from live order data
  and, in supabase mode, records/refreshes the `documents` row via the
  `create_order_document` RPC (idempotent per order+type). Mock mode
  generates the PDF and persists nothing. PDFs are NOT stored in a bucket in
  M5A — see M5B below.
- **Access**: owner/admin generate for any tenant order; a `sales_rep` only
  for assigned-customer orders (RLS on the read + `can_access_order` in the
  RPC); a walk-in/null-customer order is owner/admin only; anon has no path.

## Stored PDFs + signed-URL delivery (M5B · M5B.1)

M5B stores each generated PDF in a **PRIVATE** Supabase Storage bucket and
serves it via a **short-lived signed URL**; **M5B.1** locks uploads to a
**trusted server-only path**. The legal boundary is **unchanged** (still
drafts, still no tax invoices, no numbering, no provider, no payments).

- **Bucket `documents` is private** (`public=false`) — no public URLs, no
  anon access. Path: `<tenant_id>/documents/<order_id>/<document_type>/
  <document_id>_<locale>.pdf` — no token_hash / secret / raw token in it.
- **Normal authenticated users cannot upload, overwrite, or read documents
  objects directly (M5B.1).** The bucket's `storage.objects` policies were
  DROPPED, so RLS denies every anon/authenticated SELECT/INSERT/UPDATE/DELETE
  on it — closing the M5B forgery vector where a user with `can_access_order`
  could plant a fake PDF at the deterministic path. The **service role**
  (which bypasses RLS) does the upload/sign, used ONLY from the server-only
  `src/lib/data/document-storage.ts` after the route has authorized the
  request. product-images policies are untouched.
- **Access is still verified via the authenticated context first**: the
  download route reads the order under RLS (`can_access_order` → 404 for a
  rep on an unassigned order / non-member), records via
  `create_order_document`, and records the storage metadata via
  `set_document_storage` on the **authenticated** client (which re-checks
  `authorize_tenant` + `can_access_order`). Only then does the trusted
  service client upload + sign. So a `sales_rep` gets a document only for an
  assigned-customer order; owner/admin any tenant order; walk-in/null-customer
  owner/admin only; non-member/anon nothing; cross-tenant blocked.
- **Signed URLs are short-lived (~60s)** and only created by the trusted
  server after the access checks; the route 302-redirects to one. The public
  object URL returns an error; there is no authenticated direct-download path.
- **Storage metadata** (`storage_path` / `generated_at` / `file_size_bytes`
  / `checksum`) lives on `documents`, written ONLY by the SECURITY DEFINER
  `set_document_storage` RPC — the table stays read-only (no direct writes).
  M5B.1: the RPC validates the storage path **exactly** against the
  DB-derived `<tenant>/documents/<order>/<type>/<id>_<locale>.pdf` (rejecting
  any mismatched tenant/order/type/id/locale, traversal, non-`.pdf`, blank).
- **Reuse vs regenerate**: a download reuses a stored object ONLY when the
  recorded `storage_path` is exactly the expected DB-derived path (M5B.1 —
  never trust an object at an unexpected path); otherwise it regenerates
  through the trusted server path. `?regenerate=1` (the admin "Regenerate"
  action) always re-renders. There is no content-hash cache-skip yet.
- **Mock mode** stores nothing and streams the freshly-rendered bytes (M5A).
- **Not exposed to tokenized customers**: PDF download stays admin-only;
  customer/token PDF access is a future, fully-scoped addition.
- **Trusted-storage client (M5C)**: upload/sign use a DEDICATED server-only
  service-role client (`src/lib/data/trusted-document-storage.ts`), separate
  from the generic demo `getServiceContext`. It is **local-only by default and
  fails closed** (refuses production `NODE_ENV` and non-local URLs; key from a
  non-public env var; never in a client bundle). **Production is an explicit
  opt-in**: set `MADAF_TRUSTED_DOCUMENT_STORAGE=enabled` plus
  `MADAF_TRUSTED_DOCUMENT_STORAGE_PROJECT_REF=<ref>` (which pins the Supabase
  URL to `<ref>.supabase.co`) and `SUPABASE_SERVICE_ROLE_KEY` — a hosted URL
  without a matching ref is refused. If the client is unavailable /
  misconfigured, the route safely **streams** the freshly-rendered PDF without
  storing it (never errors, never leaks). See `.env.example` and
  `supabase/README.md`.

## What the backend agent must add before invoices become real

1. **Tax settings** on the supplier: VAT registration type
  (עוסק מורשה/פטור), rates, rounding rules.
2. **Provider integration** for legal issuance & allocation numbers
   (Israel Tax Authority "חשבוניות ישראל" allocation-number regime) —
   via a certified invoicing provider/API.
3. **Immutable numbering** sequences per document type, per legal entity.
4. **Signed PDF generation + archival** (7 years). M5A generates *draft*
   PDFs on demand; **M5B stores** them in a private bucket with signed-URL
   delivery. Still remaining: **cryptographic signing** and **immutable
   long-term archival** (versioned, tamper-evident) — M6.
5. Only after all of the above may UI labels drop the "draft" wording —
   behind a feature flag, defaulting OFF.

**Deferred to M6 (legal invoicing):** the legal items above (tax settings,
numbering, provider integration, cryptographic signing, long-term archival).
The **architecture for these is now designed** in
[LEGAL_INVOICING_ARCHITECTURE.md](LEGAL_INVOICING_ARCHITECTURE.md) (**M6A —
design spike, NOTHING IMPLEMENTED**). Read it before starting M6B.

> **M6A changed no behavior.** There is still **no legal tax invoice, no tax
> authority / provider integration, and no legal numbering** in Madaf. The
> `invoice_draft` stays a **draft**; a future legal `tax_invoice` will be a
> **separate, feature-flagged** document family — the draft is never renamed
> or promoted into a legal invoice, and its DRAFT watermark + "not a tax
> invoice" notices are **not** removed. Legal issuing (M6E+) is off by default
> and requires a tax/accounting/legal review before any production use.

**Nice-to-have polish (non-legal):** a content-hash cache-skip so unchanged
documents never re-render; further Arabic mixed-direction bidi refinement;
per-locale font subsetting; and (only if fully scoped + tested)
tokenized-customer PDF access.

Until then, every invoice surface keeps the draft watermark and notices.
