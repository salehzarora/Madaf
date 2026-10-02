# Customer-specific package pricing V1

Implemented locally against PR36 (`c12c2a28c7b77e2460d5ee1b6cc081b3698fe736`).
This document describes code, not hosted activation or release approval. The
Pilot/recovery runbooks and the outstanding PR36 order-edit hold remain controlling.

## Commercial contract

An agreement belongs to one tenant, customer and product. It prices one current
package in ILS, excluding VAT; product VAT remains authoritative. Input is an
exact positive decimal string from `0.01` through `9999999.00`, with at most two
decimal places. Zero, negative, exponent, blank/null and excess precision inputs
are rejected. Existing zero-priced base products remain valid. Removing an
agreement is explicit and retains a revisioned tombstone.

The package contract includes unit, quantity, base unit and normalized size.
`products.package_contract_revision` changes whenever that tuple changes,
including A→B→A. An enabled agreement with any package mismatch is
`stale_package`; it cannot silently fall back to base. Owner/admin must review
the current package and explicitly reconfirm. Management uses expected agreement
and package revisions. Identical saves do not increment revisions or emit audit
noise. The customer detail panel provides bounded search, current terms,
Save/Reconfirm/Remove and a refresh path after a conflict, in AR/HE/EN.

## State and rollout

Every existing/new tenant receives `tenant_pricing_state` in `disabled` mode.
Missing state fails closed. The locked implementation decision permits inert
owner/admin agreement preparation while disabled, superseding the earlier scope
report's disabled-management restriction.

| Mode | Behavior |
| --- | --- |
| disabled | Base prices; legacy quote-less creations/edits remain compatible. Supplied quotes are checked. Agreements can be prepared but are not effective. |
| active | Agreements effective; every fresh creation and effective edit requires the supported quote, including base/no-agreement cases. |
| paused | No fresh creations or effective item edits. Authorized committed replay, recorded reads/documents and PR36 no-op/notes-only edits remain available. |

`set_tenant_pricing_state` is service-only, increments the activation epoch and
cannot return an ever-active tenant to `disabled`. There is no activation UI.
No hosted migration or activation is part of implementation QA.

## Database boundaries

Additive CLI-created migration: `20261001182158_customer_package_pricing.sql`.

- `customer_product_prices`: UUID primary key; unique tenant/customer/product;
  composite same-tenant customer and product FKs; restrictive customer/product
  deletion; tenant cascade; product lookup index; price, enabled tombstone,
  package snapshot/revision, agreement revision and actor/timestamps.
- `tenant_pricing_state`: tenant PK/FK, constrained mode, positive epoch and
  updated timestamp. Existing-row backfill and new-tenant trigger.
- Both tables have RLS enabled, no browser policies and no direct app grants.
  Service has SELECT only; mutations go through guarded functions.
- Six nullable historical `order_items` provenance fields: pricing source,
  agreement ID/revision, package revision, base unit and unit size. Existing
  history is not given invented provenance. Retained lines preserve snapshots.
- New management/list/resolution/quote RPCs use empty SECURITY DEFINER search
  paths and explicit caller grants. Internal projection, audit, token-scope,
  state, validation and insertion helpers are not externally callable.
- Pricing audit has a closed event set, `customer_price` entity and empty
  metadata. No price, quote, token, request/provider object is logged.

Only existing `create_order_request`, `create_order_request_from_token`,
`create_order_from_showcase_token` and `update_order_items` write orders. Each has
one unambiguous signature with trailing optional `p_quote jsonb`. Old signatures
are removed transactionally without CASCADE. No parallel order path exists.

## Resolution, quotes and replay

The server derives the selected authenticated tenant; the DB revalidates role,
membership and customer assignment. Private-shop scope comes from its validated
link. Showcase remains base-only, regardless of matching guest contact details.
Public resolution returns only bounded effective price/status/VAT DTOs; money
and rates are decimal strings. Denied, unavailable and stale results cannot be
interpreted as base prices.

`useEffectivePrices` provides memory-only resolution, at most 200 product IDs
per request and two simultaneous requests. All batches complete before price
sorting. Generation, identity, customer, catalog terms, focus and reconnect
invalidate results; A→B→A responses from old generations are ignored. Customer
switches preserve quantities and the logical submission key. Cart, cards, detail,
related tiles, per-unit values, order panel, review, checkout and private shop
consume the effective terms. The hero has no price display. Major page/layout
Server Components and AppShell stay server-side.

Quotes use `{version:1,digest:<64 lowercase hex>}`. The digest binds tenant,
customer, channel, actor/link, activation epoch, normalized quantities, complete
package/revision, agreement identity/revision/absence, effective price/VAT,
rounded lines and header sums. Edits also bind the order version and retained/new
mixture. The database recalculates once under locks and inserts that relation;
client prices/totals/provenance are never authoritative.

Creation claims retain the existing logical fingerprint, excluding changing
quote/price/revision fields. An authorized committed replay returns before fresh
pricing checks, even while paused or with an obsolete quote envelope. Scope is
rechecked after a duplicate claim waits. `{mode:"replay_only"}` can reconcile a
committed request but cannot create an order on a miss.

Each client captures the original submission payload only in memory. Ambiguous
responses retry that payload/key in replay-only mode. A changed quote refreshes
amounts and requires another deliberate confirmation, without rotating the key.
A restored key with missing original payload remains unresolved; the client does
not reconstruct notes/guest fields or guess a new submission. Authenticated key
persistence is synchronously written and read back before the first send.
Completion clears only the matching basket and preserves a subsequently changed
basket. Prices, quotes and private tokens are not added to browser storage, URLs,
public/shared caches, service-worker caches or diagnostics.

## Locking and financial integrity

The common lock order is state SHARE → edit order UPDATE (edits only) → all
involved product rows ascending SHARE → inventory rows ascending UPDATE.
Taking state before order in both edit quote/save prevents the quote/edit/pause
cycle; order still precedes all product/inventory locks. Activation takes only
the state row's exclusive lock. Agreement management uses the same product anchor
with NO KEY UPDATE, including when no agreement row exists. There is no
SHARE-to-UPDATE upgrade. Existing tenant sequence, guest-linking and reservation
ordering is retained.

PR36 remains authoritative: retained identity/name/package/price/VAT/provenance;
unchanged/notes saves preserve historical totals; quantity edits use saved terms;
committed removal then re-add uses current terms. Headers sum recorded rounded
line values. Historical package/inventory guards and aggregate quantity limits
remain. Fresh PDFs/print read recorded order terms, without a live resolver.
Draft/non-legal warnings and document authorization remain unchanged.

## Verification and release gates

`npm run test:pricing` covers pure contracts and mounted memory/race/reconciliation
behavior. Existing checkout/private-shop/showcase suites also exercise quoted and
ambiguous-response flows. `supabase/tests/customer_package_pricing.test.sql`
checks structure/grants/signatures. The owned E2E harness runs genuine local
GoTrue/PostgREST authorization tests, forced lock schedules, a production build
and Chromium journeys. Private fixtures, tokens, PDFs, screenshots and raw failure
logs remain ignored; only existing sanitized summary files are publishable.

Future release requires separate approval: apply the compatible disabled
migration → deploy all readers/writers → verify hosted signatures/build identity
and designated synthetic checks → coordinate legacy callers/client refresh →
activate only an approved tenant. Before activation, legacy rollback is bounded
by disabled compatibility. After activation, pause and forward-fix; do not roll
back to a base-only app, delete agreements or rewrite historical prices.
Local passes do not prove hosted parity, physical-device acceptance, backup/PITR
readiness, completion of outstanding PR36 gates or real-customer GO.
