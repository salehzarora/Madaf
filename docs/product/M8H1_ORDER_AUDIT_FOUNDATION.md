# M8H.1 — Order Lifecycle Audit Foundation

**Status:** implemented on `feature/m8h1-order-audit-foundation` (NOT merged, NOT
deployed, migration NOT applied to hosted staging). Local-stack verified.

**No UI is added in this phase.** The Order Timeline is M8H.2 and will READ the
rows this phase produces.

## Why a foundation first

An Order Timeline must be *trustworthy*. If it reconstructed history by diffing
current state — or inferred events from `created_at`, `updated_at`, the current
status, the linked customer, the access-link state or the inventory ledger — it
would be wrong the moment anything changed out-of-band. M8H.1 instead makes every
successful Order lifecycle action write **exactly one audit row in the same
transaction as the mutation**. Nothing is reconstructed and nothing is backfilled.

## Complete Order mutation inventory

`public.orders` grants `authenticated` **SELECT only** (and `anon` nothing), so
the SECURITY DEFINER RPCs below are the *only* write paths. Verified from the live
catalog, not from the UI.

| # | Path | Caller | Tenant | Authorization | Audited |
|---|---|---|---|---|---|
| 1 | `create_order_request` | authenticated | `authorize_tenant` | owner/admin/sales_rep (rep must own the customer) | `order.created` |
| 2 | `create_order_request_from_token` | **anon** (private Shop link) | from the token | token resolve + rate limit | `order.created` |
| 3 | `create_order_from_showcase_token` | **anon** (Showcase guest) | from the token | token resolve + rate limit | `order.created` |
| — | `_order_create_core` | *private, shared by 1–3* | — | — | **no event** (see below) |
| 4 | `update_order_items` | authenticated | `authorize_tenant` | owner/admin | `order.updated` (effective only) |
| 5 | `update_order_status` | authenticated | `authorize_tenant` | owner/admin | `order.status_changed` (real transitions only) |
| 6 | `link_order_to_customer` | authenticated | `authorize_tenant` | owner/admin | `order.customer_linked` |
| 7 | `create_customer_from_order` | authenticated | `authorize_tenant` | owner/admin | `order.customer_linked` |
| 8 | `create_order_document` | authenticated | — | — | **no event** (does not write `orders`) |

**Triggers on `orders` (all untouched):** `orders_set_updated_at`,
`orders_set_public_ref`, and `orders_log_status_change` → `order_status_history`.

**Why `_order_create_core` does not emit.** All three creation channels share it.
Emitting there would either lose the channel identity or require passing it down.
Instead each **entry point** emits after the core succeeds, so every channel
records its own honest initiator and one creation can never produce two rows.

**Retry / idempotency.** Creation has no idempotency key (a retry is a *new*
order, and gets its own event — unchanged behavior). Status reserve/restore are
guarded by ledger existence and are already idempotent. Linking an already-linked
order raises. Requesting the current status returns early with no mutation.

## Final event taxonomy (closed, 4 keys — no "Other")

| Event | Meaning / trigger | Actor | Safe metadata | Sens. |
|---|---|---|---|---|
| `order.created` | one per successfully created order, any channel | `auth.uid()`, **NULL** on both token channels | `source`, `initiator_kind`, `initial_status`, `customer_kind`, `item_count` | low |
| `order.updated` | one per **effective** line/notes edit | `auth.uid()` | `changed_fields` (`items`/`notes`), `item_count_before/after` | medium |
| `order.status_changed` | one per **real** status transition | `auth.uid()` | `from_status`, `to_status`, `inventory_effect` | low |
| `order.customer_linked` | a previously-unlinked order gained a customer | `auth.uid()` | `link_kind` (`existing_customer`/`guest_conversion`) | medium |

Labels exist in **ar / he / en** (`dict.audit.order.*`); statuses reuse the
existing `dict.status.*`. An unrecognized type (e.g. the legacy `order.delivered`
demo row in the *local seed*) renders as an explicit **unknown event** — never
"Other". Sensitivity is derived, and an unknown type is `medium` (never
under-classified).

### Status strategy: **A** (one event + from/to)

The real machine is a 5-value enum (`new, confirmed, preparing, delivered,
cancelled`) with a small matrix (`new→{confirmed,cancelled}`,
`confirmed→{preparing,cancelled}`, `preparing→{delivered,cancelled}`), and the UI
already maps statuses. Eight per-transition keys would merely re-encode the enum
without adding meaning, so a single `order.status_changed` carrying safe `from`/`to`
enums was chosen. Strategy B is **not** implemented.

## Actor + initiator (a NULL actor is never "System")

`actor_user_id` stays honest: `auth.uid()`, which is **NULL** on both anonymous
token channels. Because a null actor alone is ambiguous, a **closed
`initiator_kind`** is recorded by the authoritative RPC:

- `authenticated_user` — an operator acted through an authenticated RPC;
- `customer_link` — a store ordered through its private Shop link (anon);
- `showcase_guest` — a visitor ordered through the Showcase (anon).

There is deliberately **no `system` kind** — no order path is system-created, so
inventing one would be dishonest. The DB helper **refuses** a `customer_link` /
`showcase_guest` event that carries an authenticated actor, so an operator can
never be recorded as a guest. Neither the raw token, its hash, the link id, the
shop URL, nor any customer/guest identity ever enters metadata.

## Transactional guarantee

The audit insert happens **inside the mutation RPC**, after every validation and
after inventory reconciliation. Mutation + inventory movements + audit row commit
together, and any failure (invalid transition, `MDF30` insufficient stock,
unauthorized, cross-tenant, explicit rollback) rolls back **all** of them. There
is no browser-side write, no second Server Action, no async best-effort logging
and no swallowed audit exception. pgTAP proves a failed stock reconciliation and
an explicit rollback both leave zero audit rows.

## Inventory + status ledgers: explicit non-duplication

Two specialized ledgers already exist and are **left completely untouched**:

- **`order_inventory_movements`** remains the authoritative *stock-quantity*
  ledger (`order_reserved`, `order_edit_adjustment`, `order_reservation_released`).
  The audit event carries only a safe `inventory_effect` enum
  (`none | reserved | restored`) — **never** quantities, product ids or stock
  levels. It is derived from what the ledger *actually recorded*, so an order
  whose products are all untracked honestly reports `none`. No movement is
  duplicated into `audit_events`, and no inventory math or taxonomy changed.
- **`order_status_history`** (the `orders_log_status_change` trigger) remains the
  specialized *status* ledger. The audit event is the Timeline-facing business
  event. The trigger and table are unchanged.

Inventory semantics are provably intact: reserve once on entering
`confirmed`/`preparing`, no double-deduct on `preparing`, no deduction on
`delivered`, restore exactly once per product on cancellation.

## Customer-link decision: deliberate dual-entity, not duplication

Linking an order to a customer is **one business action that belongs to two
timelines**. M8G.2's `customer.order_linked` / `customer.created`
(entity = *customer*) are preserved byte-for-byte; M8H.1 adds
`order.customer_linked` (entity = *order*), written in the same transaction, from
**both** link paths (`link_order_to_customer` → `existing_customer`,
`create_customer_from_order` → `guest_conversion`).

This is not accidental duplication: the Customer Timeline filters
`entity_type='customer'` and the Order Timeline filters `entity_type='order'`, so
**each row appears in exactly one timeline**. Omitting the order-side row would
leave the Order Timeline silently missing a change of buyer. No old link action is
backfilled, customer **origin is unchanged**, and the guest snapshot never enters
either event.

### Explicitly NOT audited

Inventory reservation/restoration (→ `inventory_effect` only), order documents
(no `orders` write; separate workflow), customer-snapshot writes (part of
creation), and every read/search/filter/pagination/export/detail path.

## Database design

**Migration:** `supabase/migrations/20260802100000_m8h1_order_audit_foundation.sql`
(additive; **not applied to hosted staging**).

**Helper:** `public._log_order_audit_event(p_tenant_id, p_event_type, p_order_id,
p_metadata)` — SECURITY **INVOKER**, `search_path = ''`, fully schema-qualified,
static SQL, `entity_type` hardcoded to `'order'`, actor from `auth.uid()`. It
enforces a closed 4-event allowlist, requires metadata to be a **JSON object**,
bounds it at **4000 chars**, and allowlists metadata **keys per event type** (so a
price, a token, a name or any future stray key is rejected outright). It is
`REVOKE`d from `public`, `anon` and `authenticated`, and is **not** granted to
`service_role` — no client role can execute it; it is reachable only from the
SECURITY DEFINER RPCs, which run as the owner. The M8G.2 customer helper is not
weakened or modified.

**RLS (additive).** The existing customer clause is reproduced **verbatim** and an
order clause is AND-ed on:

```sql
is_tenant_member(tenant_id)
AND (entity_type <> 'customer' OR can_access_customer(tenant_id, entity_id))
AND (entity_type <> 'order'
     OR (entity_id IS NOT NULL AND can_access_order(tenant_id, entity_id)))
```

Each clause is vacuous for the other entity type, so **customer rows behave
exactly as before** and non-customer/non-order rows keep plain tenant-member
visibility. Order rows now require `can_access_order` and **fail closed on a NULL
`entity_id`** (that guard matters: `can_access_order` short-circuits to true for
owner/admin regardless of the id). A `sales_rep` therefore sees Order events only
for orders already visible to them; guest/unlinked orders stay owner/admin-only.
`authenticated` still cannot INSERT/UPDATE/DELETE `audit_events`; `anon` has no
access at all (a direct read raises `42501`). *(The policy was renamed to reflect
its new scope; the customer rule itself is unchanged, and the tests now assert the
rule rather than the name.)*

**RPC preservation.** All 7 producers were replaced with **identical** signatures,
return types, security modes, `search_path`, grants (`anon` still only on the two
token RPCs), token validation, rate limiting, tenant/role authorization, inventory
math and error behavior — the only change in each body is the audit insert and the
locals needed to derive it. This is independently confirmed by the regenerated
types: the diff contains **only** the new helper, meaning no producer signature
moved.

**Index: reuse, no new index.** M8G.3's
`audit_events (tenant_id, entity_type, entity_id, created_at DESC, id DESC)` is
structurally generic (`entity_type` is an indexed column, not a filter). Local
EXPLAIN of a representative future Order Timeline query:

```
Limit
  ->  Index Scan using audit_events_customer_timeline_idx on audit_events
        Index Cond: (tenant_id = … AND entity_type = 'order' AND entity_id = …)
```

Index Cond covers all three leading columns and there is **no Sort node** — the
DESC/DESC key order already satisfies `ORDER BY created_at DESC, id DESC`. No new
index is added, and the existing one is neither renamed nor dropped.

## Mock parity

The pure derivation model in `src/lib/order-audit.ts`
(`deriveOrderCreatedEvent`, `deriveOrderStatusEvent`, `deriveOrderUpdateEvent`,
`deriveOrderCustomerLinkedEvent`) is the single source of truth for *when* an
event fires and *what* it carries; the DB producers implement exactly this
contract and the mock write paths call it directly, so neither mode can drift. In
mock: a successful create records one `order.created` (authenticated channel — the
token/showcase flows are Supabase-only and do not run in mock); a real transition
records one `order.status_changed`; a **no-op** (same status, identical lines) and
a **rejected** mutation (invalid transition, unknown order, Supabase-only write)
record **none**. No PII, snapshot, token, item or price is ever recorded, and there
is no test-only taxonomy.

## Verification (local)

- `npm test` → **341** app checks (incl. **43** new `test:order-audit`).
- `supabase test db` → **303** pgTAP checks (incl. **68** new order-audit checks:
  helper catalog + privilege matrix, allowlist/metadata-shape/size/key rejection,
  all three creation channels with honest actors, no-op/invalid/same-state
  silence, inventory reserve/no-double-deduct/restore-once, MDF30 + rollback
  removing the event, dual-entity linking, RLS rep-scoping/cross-tenant, anon
  denial).
- `npm run lint`, `npx tsc --noEmit`, `npm run build` → clean; build ends
  `[check-dynamic-routes] OK`. `npm audit --omit=dev` → 0 vulnerabilities.
- `supabase db reset` / `db lint` → clean.
- Bundle scan → **0** for `sb_secret_`, `service_role`, `NEXT_PUBLIC_SERVICE_ROLE`,
  Postgres connection strings, `_log_order_audit_event`, `_log_customer_audit_event`,
  `token_hash`, `customer_snapshot`, and both fixture tokens.

## Performance

One bounded audit INSERT per successful included action (a single
`insert into public.audit_events`, inside the helper). No audit N+1 (never inside
a per-line loop), no audit-history read during a mutation, no exact count, no full
Orders/Customers fetch, no line-item history copied. Public-order rate limiting is
untouched. The client payload is unchanged (no UI in this phase).

## Known limitations

- The **local seed** contains a legacy demo row (`entity_type='order'`,
  `event_type='order.delivered'`, `{"order_number": "MDF-1043"}`) that predates
  this taxonomy. It is *not* produced by any RPC, `seed.sql` never runs on hosted,
  and M8H.2 will render it as an explicitly *unrecognized* event (never "Other").
  Seed behavior is preserved as instructed.
- `update_order_items` still re-snapshots lines and bumps `updated_at` even for an
  identical resubmission (unchanged behavior); only the **audit** is change-gated,
  so a no-op edit records nothing.
- `inventory_effect` is honest but coarse by design — exact quantities remain in
  `order_inventory_movements`.

## Next

**M8H.2 — Order Timeline** will consume these rows entity-scoped
(`entity_type='order'`, `entity_id`) over the reused M8G.3 index, with the same
bounded keyset/cursor contract as the Customer Timeline.

**Staging deployment order (when authorized):** this migration applies after the
two M8G.3 migrations; it is additive and requires no backfill.
