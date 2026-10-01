# Documents & Invoices Guide

## Current operational freshness policy (ORDER-FINANCIAL-INTEGRITY-001)

Download and Regenerate for order requests, delivery notes and invoice drafts
render one coherent saved order/header/items source into same-origin attachment
bytes (`private, no-store`). Share uses the same renderer with inline disposition.
Print passes its prepared source directly to the existing template; it does not
re-read live customer/catalog values or omit historical lines missing from the
catalog. Separate requests around an edit may observe different saved versions.

The older signed-object reuse policy below is historical, superseded by this
local change pending Control Room release approval. Storage objects, metadata,
private access policies and shared helpers are retained. A failed fresh render
does not fall back to an old PDF. IDs, numbers, locale selection, safe filenames,
invoice-draft notices and price-free delivery notes remain unchanged. See
[implementation evidence and release caveats](qa/ORDER_FINANCIAL_INTEGRITY_001.md).

## Native Android document actions (DOCUMENT-ACTIONS-ANDROID-001)

The Android WebView shell can advertise `documents.sharePdf` and
`documents.printPdf` in the existing `MadafNative.getCapabilities` response.
`DocumentQuickActions` then sends correlated `shareDocumentPdf` or
`printDocumentPdf` requests containing only the relative, authenticated
`/{locale}/admin/orders/{id}/documents/{order|delivery|invoiceDraft}?mode=share`
path. A dedicated `addEventListener("message")` subscriber leaves the push
bridge's `onmessage` handler untouched. Unsupported/older shells and ordinary
browsers keep the existing Web Share / inline-PDF fallback and Print link.
Download, Preview and Regenerate remain unchanged.

Native retrieves the same generated PDF with the existing WebView cookies,
validates its route/type/size, and keeps it in a bounded private cache. Share
opens Android's chooser using a read-granted FileProvider URI. Print passes the
original bytes to Android PrintManager; it does not call WebView `window.print()`
or reconstruct the document. Native replies contain only `opened`, `cancelled`
or `error`; neither paths, cookies nor provider details return to JavaScript.
`opened` means system UI opened, not that a recipient received or printer printed
the document. Cancellation is silent and failures use generic AR/HE/EN feedback.

This adds no endpoint, public access, database/auth/RLS change, storage-policy
change, dependency, legal activation or document-semantic change. The existing
server authorization, invoice-draft notices/watermark, price-free delivery note,
document numbering and download contract remain authoritative.

The companion Android APK and these web changes must both be released through
Control Room before production buttons can use native document actions. An APK
alone does not change the production website. Local web tests cover native and
browser routing/cancellation/error behavior; Android emulator tests cover bridge
restrictions, private URI grants, original PDF byte copying, PrintManager and the
system Share Sheet. Real tablet WhatsApp attachment, authenticated production
document retrieval and physical printing remain owner acceptance checks.

## Document quick actions (DOCUMENT-ACTIONS-001)

The order detail Documents card offers **Share → Print → Download**, with
**Preview → Regenerate** retained for existing records. All action labels,
loading states and fallback messages support Arabic, Hebrew and English. This
applies only to `order`, `delivery` and `invoiceDraft`; invoice drafts remain
non-legal, with their existing watermark, notices and numbering unchanged.

- **Share:** `DocumentQuickActions` fetches the existing PDF endpoint with
  `?mode=share`, same-origin credentials, no caching and no redirects. The route
  uses the same authenticated source read and guarded recording RPC, then the
  existing PDF renderer. It returns `application/pdf`, an inline safe filename
  and `private, no-store`. Share never signs or uploads a storage object. Only
  an actual PDF `File` enters `navigator.share`; no admin or signed URL is shared.
- **Fallback:** check `navigator.canShare({ files })` when available. Unsupported
  file sharing opens the inline PDF in a separate tab with normal browser PDF
  controls. A visible Open PDF link also handles popup blocking. Cancellation
  (`AbortError`) is silent; other failures show localized generic text. If the
  browser loses user activation while preparing a PDF, a fresh Share tap can
  use the prepared file. It is retained only in memory for up to 60 seconds and
  cleared on unmount or document identity change. No browser persistence is used.
- **Print:** a normal link opens
  `/{locale}/admin/orders/{id}/documents/{type}/print`. This dynamic admin page
  uses the shared `prepareOrderDocument` access/record path, then the existing
  HTML `DocumentView` through `DocumentPreview`, passing the prepared saved source.
  The print trigger waits for fonts/logo and requests `window.print()` once.
  The existing manual Print / Save PDF control remains available if the browser
  suppresses automatic printing. No PDF download or new printable template is
  involved. Mock mode can print all three types without a persisted mock record.
- **Download/Regenerate:** freshly render same-origin attachment bytes, without
  stored-object reuse or redirects. Default document language stays Hebrew,
  independently of UI locale; existing preview language controls are unchanged.

No migration, RLS/grant change, public document URL, security-policy relaxation,
dependency change, legal-document issuance or hosted configuration is introduced.
The service-role storage helpers and their exact-path validation are untouched.

`npm run test:document-actions` covers route allowlists, denied access/recording,
file-only sharing, cancellation, fallback/errors, activation retry, request
cleanup, AR/HE/EN actions, mock print preparation, one-time printing and preserved
draft/delivery content. It is included in `npm test`. The new print entry also
joins the build's critical dynamic-route guard.

Local browser QA: AR/HE/EN order actions at 390×844, 768×1024 and 1440×900;
no document horizontal overflow on those order pages. All three Share responses
were checked against a local production build: HTTP 200, real PDF bytes, inline
filename and private/no-store. All three Print entries returned the shared sheet.
Native WhatsApp/device share completion, physical printer output and hosted
authenticated acceptance remain device/release checks; local tests do not claim
those have passed.


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

> **M6G (documentation-only review gate) changes NONE of the above** and no code/
> schema/runtime behavior. It added
> [docs/legal-invoicing/PRODUCTION_ACTIVATION_REVIEW_CHECKLIST.md](legal-invoicing/PRODUCTION_ACTIVATION_REVIEW_CHECKLIST.md),
> which is REQUIRED before any future legal-effective work — no real issuing is
> enabled; M6B–M6F remain sandbox / non-legal / default-safe; all draft "not a tax
> invoice" warnings remain.

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
