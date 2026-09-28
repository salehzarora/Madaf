# Native push V1.2 — preferences and events

Local implementation bundle on `codex/native-push-v1-2-preferences-events`, based
on `63c4cd4fa30a5631a10665d05aecd7389763d561`. This document records implementation,
not hosted activation or physical-device acceptance. The Pilot runbook remains
authoritative for release decisions. No hosted migration/configuration, Android,
Firebase credentials, domain, or release packaging changes are part of this work.

## Architecture and recipient boundary

Successful authoritative business RPC → server data-layer hook → guarded Next.js
`after()` callback → service-only event claim → current eligible recipients →
server-only Firebase Admin data message → existing native handler.

Every recipient query enforces event tenant = registered device tenant, current
owner/admin membership, enabled device, matching owned live auth session, no ban,
no anonymous user, and current event preference. Status additionally excludes
the history row's `changed_by` across **all** of that user's devices. Registration
still associates an installation with one selected tenant/account at a time.
No authorization is inferred from editable metadata or a browser tenant/user ID.

`push_event_recipients` is the shared, service-only predicate for all four event
types. The original `new_order_push_recipients` derives its tenant from the claimed
order before delegating. New event tenants/actors come from committed DB claims;
product mutation hooks use the server-derived tenant and successful product RPC.
Preferences are read at recipient lookup, never snapshotted at event creation.

## Notification preferences

`push_notification_preferences` has primary key `(tenant_id,user_id)` and a
composite membership FK with cascading deletion. Booleans are non-null;
`created_at`/`updated_at` are maintained. No backfill is needed:

| Preference | Missing row/default |
| --- | --- |
| New orders | ON |
| Store signup requests | ON |
| Low stock | ON |
| Order status changes | OFF |

RLS is enabled with no direct anon/authenticated table grants. Guarded
`get_my_push_preferences` and `save_my_push_preferences` derive `auth.uid()` and
verify current membership, session ownership/expiry, ban and anonymous status.
There is no `p_user_id`. The browser action accepts exactly four booleans; extra
keys, tenant/user spoofing and malformed payloads are rejected. Its tenant comes
from `getSessionContext`, never the request body. The service role reads the table
for delivery. DB RPCs allow sales-rep preference storage for future compatibility;
the V1.2 settings page/action and push delivery remain owner/admin only.

`/{locale}/admin/settings/notifications` uses Admin V3 surfaces, Bell navigation,
four compact icon/switch cards, typed AR/HE/EN strings and saving/saved/error
feedback. These are **user + supplier**, not device-specific preferences. Mock
mode is explicitly labeled and cannot pretend to persist a save. Failed live
reads fail closed instead of showing defaults that could overwrite saved choices.
No FCM token, installation UUID or device ID is exposed in this UI.
An opaque server-derived account/supplier scope remounts the form on tenant switch.
The save action rechecks that scope against current server context, rejecting stale
forms during a switch instead of writing previous-tenant values into the new tenant.
This scope is a consistency guard; live DB authorization remains mandatory.

## Events and content

| Event | Authoritative identity / dedupe | Content | Relative path |
| --- | --- | --- | --- |
| New order | Original `push_order_dispatches` claim retained | Existing V1.1 safe business name, order number, subtotal | `/{locale}/admin/orders/{id}` |
| Signup request | Exact inserted request UUID; unique generic dispatch claim | Safe store display name only | `/{locale}/admin/customers/signup` |
| Status | Exact old/new transition in `order_status_history`; claim by history UUID | Validated order number + existing localized status label | `/{locale}/admin/orders/{id}` |
| Low stock | Unique tenant/product crossing generation | Localized product name + authoritative current remaining quantity | `/{locale}/admin/inventory` |

Signup V2 preserves token resolution, failure limiter, field validation and pending
cap, adding `INSERT ... RETURNING id`. It never queries the latest request. The
legacy boolean RPC delegates to the same insertion and retains its null failure
contract. The browser Server Action still returns only the existing neutral
success/failure result. **Dispatch replay** is deduplicated; two separately
accepted signup submissions still create two requests under existing behavior.

Status hooks run only when the successful RPC returns differing old/new statuses.
No-op, invalid transition and stock reconciliation failure cannot schedule an
alert. Claims exclude initial history rows and resolve the exact committed
transition, even if the order has since progressed. Current monotone lifecycle
does not revisit an earlier status. Actor and tenant are not caller inputs.

Builders validate UUID/order-number/path inputs, normalize locale to ar/he/en
(invalid → he), remove injected controls/bidi formatting/line separators from
human display text, bound it to 80 code points and apply controlled bidi isolates.
Only title/body/path enter the data message. Contact fields, addresses, notes,
auth data, raw tokens and unrelated business fields are never selected for these
new messages. Missing/invalid optional display content falls back safely.

## Low-stock transition design and coverage

Push LOW means **`quantity_available <= low_stock_threshold`**. Existing dashboard
and storefront `<` availability presentation is intentionally unchanged.

`push_low_stock_state` records current low/high and a monotonic generation per
tenant/product. A small inventory trigger uses authoritative OLD/NEW values to
record each high→low crossing in `push_low_stock_crossings` in the business
transaction. This is private bookkeeping, never a network call. New inventory
and existing rows at migration time establish a baseline without notifications;
an initial low row is not an observed high→low crossing. Recovery resets state.
Low→lower creates no event. Threshold-only changes are covered.

The service claim locks the authoritative inventory row first, refreshes current
low state and atomically consumes unclaimed generations. Inventory/state lock
ordering matches writers. Concurrent/replayed claimers cannot return the same
generation. Separate generations retain rapid high→low→high→low transitions even
if callbacks arrive late or out of order. Payload quantity is current at claim,
not the earlier crossing snapshot. Recovered or older-than-15-minute crossings
are consumed without a stale warning. Previously claimed generations never resend.

| Application write path | Hook and authoritative source |
| --- | --- |
| Manual stock adjustment | `sbAdjustInventoryStock` after `adjust_inventory_stock` |
| Inventory upsert / threshold edit | `sbUpsertInventory` after `upsert_inventory_item` |
| Product creation with inventory | `sbCreateProduct` after `create_product`; establishes initial baseline |
| Product update with inventory | `sbUpdateProduct` after `update_product`; existing quantity input remains ignored by current RPC |
| Confirmation / preparing reservation | `sbUpdateOrderStatus` after a real successful transition |
| Reserved-order item edit | `sbUpdateOrderItems` after successful reconciliation |
| Cancellation / release | Same status hook; restored stock resets capture state |
| Delivery | Same status hook; current lifecycle does not deduct stock again |

For order mutations, `push_inventory_products_for_order` derives products from
committed order lines **union reservation movement history**, scoped through the
order tenant. Removed lines therefore remain covered. New-order creation does not
change inventory. No additional application inventory-write path was found.
Direct operational SQL may be captured by the trigger but has no application
delivery callback; no background worker/poller is added or claimed.

## Failure and delivery limits

Scheduling and callback errors are independently caught with fixed diagnostics.
Firebase/recipient/cleanup failures never roll back or change successful business
responses. Invalid-token cleanup compares both device ID and exact token, and only
definitive invalid/unregistered errors disable a registration. Transient errors
preserve devices. Logging contains aggregate outcomes only, not provider payloads.

The inventory trigger catches bookkeeping errors with a fixed warning so stock
mutations succeed. A crossing whose capture fails can be lost; subsequent OLD/NEW
changes continue safely. No guaranteed delivery/outbox is claimed. Claims are
at-most-once, callbacks use a soft 25-second budget and 100-recipient pages, and
provider failures, process termination or budget exhaustion can lose already
claimed alerts. Providers may independently retry; there is no application replay
of a consumed claim. Preferences changed before recipient lookup take effect;
there is no promise to retract a message already handed to Firebase.

## Migration and validation

Migration: `20260928141506_native_push_preferences_events.sql`.

Four private RLS tables: preferences, generic signup/status dispatches, low-stock
state and crossings. New preference guard/read/save RPCs, shared recipient RPC,
signup/status/low-stock claim RPCs, order inventory-product resolver, low-stock
capture trigger and signup V2 are included. Existing new-order recipient and legacy
signup RPCs are replaced additively; historical migrations and order/inventory
business RPCs remain unchanged. Generated TypeScript DB types are regenerated.

See [V1.2 QA evidence](NATIVE_PUSH_V1_2_QA.md) for test results, acceptance limits
and the complete file manifest. Hosted application/migration ordering and a real
device test remain Control Room release work, not implementation side effects.
