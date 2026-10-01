# ORDER-FINANCIAL-INTEGRITY-001 — local review evidence

Date: 2026-10-01. Branch: `codex/order-financial-integrity-001`.
Base: `d4d7ffa07211d17c5cb22534f6327c07e4c54826` (fetched and matched before work).
Implementation and synthetic verification only; no hosted migration, push, PR,
merge, deployment, Android change or customer-specific pricing implementation.

## Findings, reproductions and changed policy

| Finding | Before | After / evidence |
| --- | --- | --- |
| Retained terms | Every edit deleted/re-snapshotted lines from live catalog terms, even identical/notes saves. | Retained IDs, names, manufacturer, package unit/count, price and VAT remain. Identical normalized saves perform no UPDATE/movement/edit event. Notes-only saves update notes and one bounded event. Quantity changes use saved terms; new products use current base terms. |
| Header rounding | Header VAT rounded the sum of unrounded tax, separately from line VAT. Two distinct 0.03 lines at 18% produced 0.07 header total versus 0.08 recorded line totals. | Creation core and effective item edits sum `line_subtotal`, `line_vat` and `line_total`. All three actual creation channels and mixed saved VAT edits are tested. |
| Aggregate limit | Individually valid duplicate inputs could aggregate above 9,999 on edit. | Validate each normalized aggregate before mutations. 5,000 + 4,999 succeeds; 5,000 + 5,000 and 9,999 + 9,999 reject atomically. |
| Stale operational Download | An exact stored path could return obsolete signed PDF bytes; fresh upload then redirect could race with another overwrite. Print also re-read live catalog/customer data. | Every Download/Regenerate renders one coherent saved source into same-origin attachment bytes. Share stays inline. Print passes its prepared source directly; Preview reads that same snapshot projection. No storage reuse, upload, redirect or obsolete-render fallback in this route. |

These are explicit policy corrections, not descriptions of unchanged behavior.
There is no discount engine, customer price table, pricing context or quote digest.

Baseline on the unmodified effective functions: **18 failures / 32 SQL assertions**
(14 passed; pgTAP reported 0 whole wallclock seconds). Baseline PDF regression:
**3 failures / 22 tests**, 19 passed, Node duration **1,031.6748 ms**. All three
Download variants returned the obsolete redirect instead of fresh attachment bytes.
The final SQL file retains those first 32 assertions and extends coverage to 71.

## Editing, inventory and compatibility

- Removal followed by a later committed re-add creates a new line at then-current
  base terms. Remove/re-add before the same save remains a retained product.
- Guest-to-customer linking preserves items and amounts. Committed creation-key
  replay remains unchanged and preserves the original order/amounts after catalog
  changes. Existing concurrency/idempotency suites also pass.
- Null-product or duplicate-product historical lines reject explicitly rather
  than being silently discarded or merged across potentially different terms.
- Tenant/role, active-product and terminal-status gates remain. The active-product
  gate still applies to identical/notes-only calls; this task does not relax it.
- Package unit/count mismatches reject retained quantity changes and actual
  tracked reservation deltas, including tracking added after confirmation and
  removal that would restore a different package. No unit conversion occurs.
- Effective edits lock the order, ascending product rows `FOR SHARE`, then the
  existing ascending inventory rows. Product writers already lock product before
  inventory. Forced interleavings test both writer-before-edit and edit-before-
  writer, plus existing reserve/reserve, reserve/restore and edit/edit cases.
  A final review reproduced stock tracking initialized during an edit after the
  early package guard: the edit incorrectly committed (11/12 live cases passed,
  one failed; 11,712.0197 ms Node duration). Package compatibility is now checked
  again under the inventory row lock, before any deduction/restoration. The
  forced interleaving rejects with `22023`, rolls back the first product/order/
  snapshots/ledger/audit, and preserves the separate committed stock initialization.
- One existing `order.updated` event per effective edit; none for a no-op. Metadata
  contains only existing changed-field/count projections, not financial values,
  notes or raw payloads. Rejected edits preserve order/items/inventory/ledger/
  audit/document metadata exactly.

Migration: `20261001104117_order_financial_integrity.sql`, replacing only
`_order_create_core(uuid,jsonb,uuid,text,order_source)` and
`update_order_items(uuid,uuid,jsonb,text)`. Existing signatures, grants, RLS and
empty `SECURITY DEFINER search_path` remain. No schema-field/contract changes;
generated database types were not edited or regenerated. The effective public
creation wrappers are `create_order_request`, `create_order_request_from_token`
and **`create_order_from_showcase_token`**.

## Historical and document boundaries

No historical backfill or monetary repair. Identical/notes-only saves preserve
even deliberately inconsistent legacy headers; effective item edits derive new
headers from recorded line amounts. No tax rates or legal issuing are activated.

The editor uses retained saved names/package/price and explains the policy in
AR/HE/EN. Existing UI/backend limits remain. Print/Preview render every saved
line, buyer and recorded amounts without live catalog/customer substitution.
Unsnapshotted SKU/base-unit extras are omitted rather than invented; the document
and order identifiers, numbers, default Hebrew/document language controls,
tenant-time dates, safe filenames, invoice-draft warnings/watermark and price-free
delivery notes remain. Native Share/Print still request the same inline route.

All current operational Download/Regenerate links reach the corrected route;
none bypasses it through a stored URL. Historical private objects/metadata and
shared storage helpers remain intact. Separate requests around an edit can see
different coherent saved versions; they are not promised byte-identical.

## Local validation

CI-compatible Node **22.22.0**, Next **16.3.6**, Supabase CLI **2.107.0**.
Physical local `node_modules`; no dependency/lockfile changes. Durations below are
measured command wall time unless explicitly labeled Node/Playwright duration.

| Check | Result | Duration |
| --- | --- | --- |
| Focused SQL | 71/71 PASS | 2.930 s CLI command |
| Full database suite | 1,354/1,354 PASS, 30 files | 9.642 s CLI command; pgTAP 8 whole seconds |
| Fresh migration replay | 67 migrations; history count 67; both definers retain empty search path | 27.537 s stack startup |
| Local DB function lint, error level | PASS, empty findings | 1.715 s |
| Full application suite | 1,589/1,589 PASS, no skips | 82.269 s |
| Focused document tests within full suite | 24 route + 24 quick-action + 13 Print = 61/61 PASS | 3,776.1663 ms summed Node test durations |
| Live concurrency / submission idempotency | 12/12 PASS, no skips | 23,383.8535 ms Node duration; 24.121 s command |
| Lint | PASS | 15.789 s |
| Typecheck | PASS | 2.949 s |
| Standard Turbopack production build + route guard | PASS, 14 critical dynamic routes | 11.024 s |
| Fresh local-Supabase standard build + route guard | PASS, 14 critical dynamic routes | 9.500 s |
| Timezone matrix | 7/7 PASS | 100.292 s |
| Timezone catalog against owned local DB | All 419 offered zones accepted | 10.835 s |
| Deployment-safety synthetic matrix | 10/10 PASS, including expected rejection cases | 3.731 s |
| Production dependency audit | PASS, 0 vulnerabilities | 1.487 s |
| Existing process/fixture destination guards | 22 PASS, 0 failures, 1 platform skip | 14.265 s |
| Fresh Chromium | 7/7 PASS, one worker, zero retries | 26,402.601 ms Playwright; whole owned run 77.488 s |
| Download/Share PDF extraction | Both actual files contain saved quantity/package/price and 40/7.2/47.2 totals; 12 checks PASS | 13 ms |
| Diff / managed instructions | `git diff --check` PASS; AGENTS.md unchanged | Final diff inspection |

The full suite initially caught a historical migration-count guard (66 -> 67);
the exact count and the assertion that the older timeline milestone adds no
migration remain. The old Preview guard requiring live products/customers was
explicitly replaced by a saved-source/no-live-provider guard. Two original route
expectations of storage upload/redirect were explicitly changed to fresh bytes.
No unrelated assertions were weakened.

The first live concurrency attempt needed a valid category in its synthetic
product-update fixture; corrected fixtures then passed all original 11. After the
new tracking race was reproduced and corrected, one immediate fixed run had an
unreachable-local-status skip; the final fresh replay ran the test files serially
and passed all 12 with no skips. The first Chromium
attempt passed all six existing journeys but failed the new G journey's ambiguous
price locator. The narrowed editor-row locator passed on a new owned run. Both
browser attempts executed scoped cleanup; these were not hidden retries.

G uses a real prior synthetic private Storage PDF/metadata, then actual UI catalog
price/VAT edits, identical/notes/quantity saves, and fresh Download/Share/Print.
It proves retained identity, price 10 and VAT 18% after catalog changed to 40/10%,
two effective events, unchanged stored path/checksum/number, and Print totals.
Both downloaded real PDFs were additionally extracted and the Download was
rendered/reviewed locally; totals are 40/7.20/47.20, not stale 30/5.40/35.40 or
live-price 160. Raw PDFs/rendering evidence remain ignored and private.

**Storage coverage distinction:** the approved E2E harness disables trusted
production signing. Therefore its prior object alone does not reproduce baseline
signing reuse. The baseline-failing route tests, with a working synthetic signer,
prove that the old-path and mutable-redirect branches are eliminated. No hosted
Storage or production signing acceptance is claimed.

## Cleanup and remaining limits

Only guarded, uniquely owned disposable Docker projects and loopback destinations
were used. Normal synthetic seed was applied only to the owned DB for existing
DB suites; normal owner stack/config/seed was not changed or reset. Final cleanup
inspection covered **8 owned runs**: **0 owned containers remain**, and app/backend
ports 3108/58320/58321/58322/58324 are free. Latest financial cleanup: **3.858 s**;
successful browser cleanup: **4.120 s**. Raw logs, credentials and PDFs are excluded
from Git/public summaries. No real SMS, Push, payments or commercial orders.

The safety suite's POSIX process-group case is skipped on Windows; the Windows
owned Job Object descendant test passes. No cleanup guarantee after an external
hard kill is claimed. Physical device/native Share/Print, hosted deployment,
migration parity and hosted Storage acceptance remain unverified in this task.
Package protection is bounded to saved unit/count on item edits; it does not add
missing historical base-unit/size snapshots or redesign initial status reservation.

## Changed-file inventory

- SQL: `supabase/migrations/20261001104117_order_financial_integrity.sql`;
  `supabase/tests/order_financial_integrity.test.sql`.
- Editor/mapping: `src/components/admin/order-items-editor.tsx`;
  `src/lib/types.ts`; `src/lib/data/supabase-reads.ts`; `src/lib/data/orders.ts`
  (policy comment).
- Typed explanation: `src/i18n/types.ts`;
  `src/i18n/dictionaries/ar.ts`, `he.ts`, `en.ts`.
- Documents: `src/app/[locale]/admin/orders/[id]/documents/[type]/route.ts`;
  its `print/page.tsx`; `src/components/document-preview.tsx`;
  `src/components/document-view.tsx`.
- Tests: `src/lib/pdf/document-actions.test.mts`;
  `src/components/document-print.test.mts`; `src/lib/products-query.test.ts`;
  `src/lib/order-timeline.test.ts`; `src/lib/data/order-concurrency.live.test.ts`;
  `tests/e2e/journeys.spec.ts`; `tests/e2e/seed.mjs` (isolated prerequisites only).
- Docs: `docs/DOCUMENTS_AND_INVOICES_GUIDE.md`;
  `docs/product/M7I_GUEST_SHOWCASE_ORDERING_INVENTORY.md`; this report.

24 files. No historical migration, generated type, dependency, workflow,
protection, hosted config or AGENTS.md change.

## Proposed release order and rollback caveats

Control Room must review and authorize release separately. After that, apply the
additive migration first and deploy the matching Web commit promptly in a
controlled window: the old editor still displays live catalog prices against the
new retained-term SQL policy. Deploying Web first would instead show saved terms
while old SQL still re-snapshots. Avoid editing during that mixed-version window.
Then run owner-approved hosted checks; local passes do not establish hosted GO.

Never reverse a deployment by rewriting an applied migration or repair historical
money automatically. A coordinated rollback needs a separately reviewed additive
function migration and matching Web version; restoring old SQL reintroduces
repricing/rounding/aggregate behavior, and restoring the old document route can
reuse stale objects. Kept historical metadata/files are not current-download
freshness guarantees. No rollback or hosted release was executed here.
