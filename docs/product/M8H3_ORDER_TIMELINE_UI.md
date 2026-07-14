# M8H.3 — Order Timeline UI

Exposes the **existing** M8H.1 order lifecycle audit history in Order Details as
a read-only, tenant-safe Activity timeline. No new audit events, no new order
mutations, no change to the order state machine, and **no migration**.

---

## 1. Why there is no migration

M8H.3 adds **zero** SQL. The existing contract was already sufficient, and this
was verified before any code was written:

| Need | Already provided by | Evidence |
|---|---|---|
| Order-scoped, indexed read | M8G.3 index `audit_events (tenant_id, entity_type, entity_id, created_at DESC, id DESC)` — the name says *customer*, the shape is **entity-generic** | `supabase/tests/order_timeline.test.sql` asserts the ORDER query is an **index scan with no Sort node** |
| Authorization | M8H.1 `audit_events` SELECT policy: `entity_type <> 'order' OR (entity_id is not null AND can_access_order(tenant_id, entity_id))` | pgTAP proves rep/guest/cross-tenant scoping |
| Actor labels | M8G.3 `get_timeline_actor_labels_for_ids` (owner/admin, ≤50 deduped ids) | reused unchanged |
| Read-only guarantee | `authenticated` has **SELECT only** on `audit_events` — no INSERT/UPDATE/DELETE policy or grant exists | pgTAP asserts all three privileges are absent |

M8H.1's own migration header states this outright: *"no new index (M8G.3's … is
generic and already serves the entity-scoped Order query)"*.

## 2. Event catalog (the real, committed one)

The closed 4-event set from `_log_order_audit_event`. No event was invented.

| Event | Rendered as | Safe metadata rendered |
|---|---|---|
| `order.created` | "Order created" | honest channel (`initiator_kind`) + line count |
| `order.updated` | "Order updated" | changed **field names** (`items` / `notes`) + line-count before → after. **Never the values.** |
| `order.status_changed` | "Status changed" | before → after **status chips** + the safe stock effect (`reserved` / `restored`; `none` renders nothing) |
| `order.customer_linked` | "Linked to a customer" | `link_kind` (existing customer vs guest conversion) |

**Unknown events are real, not hypothetical.** `supabase/seed.sql` still carries
a legacy `order.delivered` row on an order, with metadata `{"order_number":
"MDF-1043"}` — an event outside the catalog carrying a key no current producer
may write. It renders as the explicit **"Unrecognized event"** label (never
"Other"), and its metadata is projected to `{}`. A mirror of that exact row lives
in the mock so the demo exercises the same path.

## 3. Safe display projection

The M8H.1 SQL helper enforces a per-event key allowlist on **write**.
`clientSafeOrderMetadata` re-applies the same allowlist on **read**, so a
legacy/stray key cannot cross the wire even though the DB stores it. This is the
last line of defence, and it is what stops `order_number` from reaching the
browser.

`source` and `initial_status` are stored (and SQL-legal) but deliberately **not**
projected: `initial_status` is always `new` (noise) and the channel is already
conveyed by `initiator_kind`. Only what is rendered is shipped.

Never shown: raw JSON, token hashes, customer snapshots, notes text, prices,
totals, product ids, quantities, order numbers, internal UUIDs.

## 4. Authorization

The Timeline inherits the Order Details visibility contract exactly — it adds no
authorization of its own, because RLS *is* the boundary:

- **Tenant** is server-derived (`getReadContext`); a client-supplied tenant is
  never trusted, and a tenantless/invalid request returns an empty page.
- **owner/admin** — every order in the tenant.
- **sales_rep** — only orders whose customer is assigned to them. Not an
  unassigned customer's order, not a guest (null-customer) order, not another
  tenant's.
- **Actors** — named (email) labels are **owner/admin only**, matching the team
  roster boundary. A sales_rep sees the neutral "A team member"; the RPC is never
  even called for them. A deleted actor → "Unknown user". A `NULL` actor is
  **never** silently relabelled "System" — the anonymous channel (private link /
  showcase guest) is stated honestly in the detail line instead.

## 5. Pagination

Keyset (not offset), reusing the M8G.3 primitives verbatim so the two timelines
cannot drift:

- order: `created_at DESC, id DESC` — deterministic, with an id tie-break for
  equal timestamps.
- cursor: opaque base64 of `(created_at, id)`. It carries no tenant, no order id,
  no secret, and **never authorizes** anything. A malformed cursor normalizes to
  the first page rather than throwing.
- page size: default 20, clamped to [1, 50]. There is no unbounded path.
- the client dedupes by audit id and guards overlapping clicks with a ref, so a
  page can never be appended twice.

## 6. Timezone

Every timestamp goes through `formatTenantDateTime(iso, locale, timeZone)` with
the **server-derived tenant zone** (M8H.2). No `toLocaleString` without a zone,
no browser clock, no server-machine clock, no raw UTC ISO in the UI.

Changing the tenant timezone changes how historical instants are **displayed**;
it never rewrites a stored timestamp (they are absolute `timestamptz` UTC
instants).

## 7. Activity-log definition for this feature

| | |
|---|---|
| **Action** | Order Timeline read / view |
| **Audit behavior** | **No new audit event.** This is a read-only visibility feature. Opening it, paging it, retrying it, and resolving actors all write nothing. |
| **Why it is structural, not a promise** | `authenticated` holds no INSERT privilege on `audit_events` at all, and the only producer (`_log_order_audit_event`) is executable by no client role. A "timeline viewed" event would be pure audit noise and is deliberately not produced. |
| **Events displayed** | the real M8H.1 catalog (§2) |
| **Scope** | current authenticated tenant, current order only |
| **Sensitivity** | read-only UI; safe display projection only; raw audit payload never exposed |
| **Category** | Order / Activity |
| **Labels** | ar `النشاط` · he `פעילות` · en `Activity` |

## 8. UI

A single **Activity** `Card` at the end of the main column of Order Details
(below the items editor), matching the Customer Timeline card exactly. No tabs
were introduced — Order Details stacks cards, and the Timeline joins that stack,
so it reads as part of the page rather than a bolted-on section. On mobile the
two-column grid collapses and the card flows naturally at the bottom.

- semantic `<ol>` / `<li>`; every row carries a text label (never icon- or
  colour-only meaning);
- the status transition is two localized chips + a decorative, RTL-mirrored
  arrow, with the full "Status: New → Confirmed" sentence exposed to screen
  readers so the transition is never announced as a bare "New Confirmed";
- actor emails are bidi-isolated (`dir="ltr"` + mono) so `@`/`.` do not reorder
  inside an Arabic/Hebrew sentence;
- Load more is keyboard-accessible and `aria-busy` while loading;
- a load failure shows a localized `role="alert"` + **Retry** and **keeps the
  already-rendered rows** — a Timeline failure can never blank Order Details, and
  raw backend error text never crosses the wire (the action returns only
  `{ ok: false }`);
- an order with no history shows a calm empty state — not an error, and no
  fabricated creation event.

## 9. Deferred (explicitly NOT in this phase)

- A global/tenant-wide Activity Log or audit browser route (guarded against in
  `order-audit.test.ts` and `tenant-timezone.test.ts`).
- Filtering/searching the timeline; exporting it.
- Any new order event type, producer, or mutation.
- Document/legal events on the order timeline.
