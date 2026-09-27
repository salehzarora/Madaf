# Admin Dashboard refinement 006B

Scope: only `/[locale]/admin`. The shared AdminShell, other Admin bodies and
Storefront are unchanged. No dependency, table, RLS, authentication, protected
write RPC, inventory, payment, legal or hosted-configuration changes.

## Period contract

`searchParams` is awaited by the server page. One request-time clock and the
server-derived tenant timezone resolve a validated `DashboardRange`. The native
GET form has a small client leaf solely to reveal custom inputs. It receives
localized labels and date strings, never aggregates or full Dictionary.

| Selection | Bounds | Buckets |
| --- | --- | --- |
| 24h / 48h | Elapsed hours ending at captured now | Hourly, anchored to range start |
| 7d / 30d (default) | Today plus preceding 6 / 29 tenant calendar dates | Daily |
| 3m | Following date after three calendar months ago through today | Weekly, final interval may be shorter |
| Custom | Inclusive from/to dates; maximum 366 days, no future end | Daily through 93 days, weekly beyond |

Every interval is inclusive-start/exclusive-end. Temporal handles real tenant
day starts, DST gaps/overlaps and skipped dates. Invalid presets, duplicate
values, impossible/reversed/oversized/future dates and zero-elapsed custom dates
fall back to 30 days with localized feedback. Hourly labels include offsets;
repeated local wall times remain distinguishable. No machine/browser timezone
is authoritative. Different bucket lengths (DST days and partial final weeks)
are shown as totals, not normalized rates or growth percentages.

## What changes with the range

- New/Open KPIs: currently new/open orders **created within the selected range**.
  Their sparklines group the same cohort by creation interval. They are not
  historical status snapshots or a reconstruction of past backlog levels.
- Sales KPI and sparkline: non-cancelled stored ex-VAT subtotals in the range.
- Trend: the same revenue by contiguous buckets, including actual zeros.
- Status donut: current statuses of all orders created in range, cancellations
  included. The exact bucket table labels its live count as non-cancelled orders.
- Top five products: non-cancelled stored line revenue in range, including
  historical inactive products. Top four linked shops: stored subtotals in range.

Today count/revenue remain today. Active products/shops, low stock and all
operational alerts remain current-state across dates so old pending work is not
hidden. Signup visibility/count still uses the existing Supabase owner/admin
gate. Recent Orders remains the globally latest six with all existing fields and
nullish customer fallback. Labels explicitly distinguish the current sections.

## Reads, boundedness and security

The original `get_dashboard_metrics` remains unchanged for current operations.
The additive `get_dashboard_period_metrics(uuid,timestamptz[])` read-only RPC is
STABLE, SECURITY INVOKER, uses empty search_path and grants execution only to
authenticated callers (PUBLIC/anon revoked). Existing row policies and explicit
tenant filtering remain authoritative, including sales-rep assignments.
This additive function is necessary because the existing RPC accepts no period
and returns only all-time aggregates and its old sparse trend. Computing these
new totals from a paged order list would reintroduce truncation. No tables,
policies, grants on tables or existing RPC contracts change; database types were
regenerated from the local database rather than edited manually.

The server computes contiguous UTC edges. SQL independently rejects null/empty,
multidimensional, shifted-index, non-finite, non-increasing and oversized arrays,
more than 93 intervals, or elapsed spans above 367 days (366 local days plus DST).
It aggregates in SQL, returning scalars, at most 93 buckets, five products and
four shops; no full order history or catalog crosses the API row ceiling.

Thumbnail enrichment deduplicates the current five ranked/four stock IDs, uses
one explicit tenant-filtered ID/image select capped to nine, and reuses existing
authenticated Storage batch signing. The output projects only display URLs:
editing storage paths are discarded. External URLs retain existing behavior;
foreign paths, missing images/signing failures and browser load failures fall
back. ProductImage's prop type now permits the minimal image fields; existing
Storefront callers/rendering are unchanged.

At most six Dashboard database requests: two aggregate RPCs, one recent exact
count, one six-row recent page, one nine-ID thumbnail select and one authorized
signup count. Signing adds at most one Storage batch request. Authentication /
cached membership resolution is separate. Empty ID sets and unauthorized signup
states skip their reads. No per-row N+1 queries.

## Validation and release boundary

Unit/component tests cover presets/custom fallback, timezone boundaries, range
aggregation, empty buckets, ranking and cancellations, page searchParams binding,
current-state containment, images, signing bounds, localization and shell gates.
Transactional pgTAP fixtures cover owner/admin/rep/foreign/anonymous boundaries,
malformed intervals and totals beyond 1,000 orders. The original SQL suite remains.

Browser QA uses a local production build. The fixed mock dataset is historical;
current ranges can correctly show zero. A custom June–July 2026 range exposes the
stored mock orders without changing timestamps. Supplementary image/five-alert
screenshots use clearly identified synthetic fixtures with the same production
CSS and component code; no real customer data or hosted writes are used.

The new migration and generated types are local review artifacts. Hosted
application, push, merge and deployment are outside this milestone's authority.

Local verification: 31 dashboard-metric tests, 115 dashboard-UI tests and 1,412
full-suite tests pass. Lint, typecheck, production build and production audit
(zero vulnerabilities) pass. The new RPC passes 25 transactional SQL assertions;
the existing dashboard SQL suite retains all 47 assertions. Direct local function
lint reports no findings. Browser checks include the required AR/HE/EN viewports,
all widths from 320 through 1920, custom GET navigation, keyboard/drawer behavior,
and Chromium/WebKit coverage of hourly and dense 93-day series. Sparse chart ticks
and one peak label preserve legibility without losing exact bucket values.
