# M8G.2 — Customer Lifecycle Audit Foundation

**Status:** implemented on `feature/m8g2-customer-audit-foundation` (NOT merged,
NOT deployed, migration NOT applied to hosted staging). Local-stack verified.

## Why the audit foundation precedes the Customer Timeline

The Customer Timeline (M8G.3) must render a **trustworthy** history. If it
reconstructed events by diffing current state or guessing from orders, it would
be wrong the moment anything changed out-of-band. M8G.2 instead turns the
existing (producer-less) `public.audit_events` table into a **transactional
source of truth**: every successful customer mutation writes exactly one
audit row *in the same transaction* as the mutation. The Timeline later just
reads that source. **No Timeline UI is built here.**

## Existing audit schema inventory

`public.audit_events` (core_schema.sql), unchanged by this phase:

| column | type | notes |
|---|---|---|
| `id` | bigint identity PK | |
| `tenant_id` | uuid NOT NULL | FK tenants ON DELETE CASCADE |
| `actor_user_id` | uuid NULL | FK auth.users ON DELETE SET NULL |
| `event_type` | text NOT NULL | free-text (no CHECK) — closed set enforced by the helper |
| `entity_type` | text NOT NULL | `'customer'` for this phase |
| `entity_id` | uuid NULL | the customer id |
| `metadata` | jsonb NOT NULL default `{}` | safe allowlist only |
| `created_at` | timestamptz NOT NULL default now() | DB-generated |

- **Indexes:** `(tenant_id, created_at desc)`, `(actor_user_id)`.
- **RLS:** enabled; one policy — members read their tenant's rows
  (`is_tenant_member(tenant_id)`). **No** insert/update/delete policy.
- **Grants:** `authenticated` = **SELECT only**; `service_role` = full; `anon` =
  nothing.
- **Previous zero-producer gap (re-verified on this branch):** repo-wide there
  are **zero** `insert into audit_events` outside `seed.sql` (demo data). No RPC,
  no app code produced audit rows. **M8G.2 wires the first producers.**
- No `app` private schema exists → the helper follows the repo's `public._`
  private-function convention.

## Complete customer mutation inventory → event decision

| RPC | mutates | emits | notes |
|---|---|---|---|
| `create_customer` | customers | `customer.created` (origin manual) | — |
| `approve_customer_signup_request` | customers | `customer.created` (origin signup) | ONE event; no separate `signup.approved` |
| `create_customer_from_order` | customers + orders | `customer.created` (origin guest_conversion) | source_order_id only; no snapshot |
| `update_customer` | customers | `customer.updated` | change-gated; PII-redacted |
| `set_customer_active` | customers | `customer.activated` / `customer.deactivated` | state-change-gated |
| `link_order_to_customer` | orders | `customer.order_linked` | customer-category; origin unchanged |
| `replace_customer_access_link` | customer_access_links | `customer.access_link.created` **or** `.rotated` | rotated iff a prior active link was revoked |
| `revoke_customer_access_link` (2-arg) | customer_access_links | `customer.access_link.revoked` | only when an active link was revoked |
| `revoke_customer_access_links_for_customer`, `insert_customer_access_link` | — | none | OBSOLETE (revoked from all roles) — not producers |
| `reject_customer_signup_request` | signup_requests | none (**deferred**) | mutates a request, no customer entity → belongs to a future Signup/Access-request category |
| seed / mock writes | — | none | no fake historical events |

## Final event taxonomy (closed — no "Other")

For every event: **actor** = `auth.uid()` (server-derived); **timestamp** =
`created_at` (DB `now()`); **tenant** = server-derived (`authorize_tenant`);
**branch/warehouse scope** = **null / N/A** (customer actions are tenant-wide, no
warehouse dimension); **entity_type** = `customer`; **category** = Customer
management (app-derived from the event type). Reason: none of the current RPCs
accept a real reason → no reason field is invented.

| event | trigger | entity id | safe metadata | sensitivity | en / he / ar |
|---|---|---|---|---|---|
| `customer.created` | a customer row created | new customer | `origin` (+`customer_type` manual · `signup_request_id` signup · `source_order_id` guest) | low | Customer created / לקוח נוצר / تم إنشاء زبون |
| `customer.updated` | edit changed ≥1 field | customer | `changed_fields` (keys only) + `customer_type {from,to}` | medium | Customer updated / לקוח עודכן / تم تحديث زبون |
| `customer.activated` | inactive→active | customer | `before_active,after_active` | low | Customer reactivated / לקוח הופעל מחדש / تمت إعادة تفعيل الزبون |
| `customer.deactivated` | active→inactive | customer | `before_active,after_active` | low | Customer deactivated / לקוח הושבת / تم تعطيل الزبون |
| `customer.access_link.created` | first private link | customer | `link_id` (+`expires_at`) | medium | Access link created / קישור גישה נוצר / تم إنشاء رابط وصول |
| `customer.access_link.rotated` | link replaced | customer | `link_id` (+`expires_at`) | medium | Access link regenerated / קישור גישה חודש / تم تجديد رابط الوصول |
| `customer.access_link.revoked` | active link revoked | customer | `link_id` | medium | Access link revoked / קישור גישה בוטל / تم إلغاء رابط الوصول |
| `customer.order_linked` | guest/unlinked order linked | customer | `order_id, previous_linkage` | low | Order linked to customer / הזמנה שויכה ללקוח / تم ربط طلب بالزبون |

Unknown/future event types render an **explicit "Unrecognized event"** label,
never "Other".

## Duplicate & no-op decisions

- **Creation:** exactly one `customer.created` per create path (three paths, one
  event each). Signup approval is **not** duplicated as both `signup.approved` +
  `customer.created` — the business action is creating the customer.
- **Guest conversion:** one event; the guest snapshot (name/phone/address) is
  **never** copied — only `origin` + `source_order_id`.
- **Access-link helper:** `replace_customer_access_link` emits one event
  (created vs rotated by whether a prior active link existed); internal
  revoke+insert does not double-log. `revoke_customer_access_link` logs one event
  only when a link was actually active.
- **Order-link category:** modeled as a **customer**-category event (the customer
  is the timeline subject); no separate order-entity row (no dual-entity events).
- **No-op update:** the RPC still runs the UPDATE (response/`updated_at`
  preserved) but logs **nothing** when no allowlisted field changed. (The RPC did
  not previously detect no-ops; M8G.2 adds a before/after diff **only** for the
  audit gate.)
- **No-op activation:** requesting the already-current state logs nothing.
- **Already-linked order / already-revoked link:** no event.
- **Idempotent retries:** re-approving a reviewed request raises (existing guard)
  → no event; an identical create is a genuinely new customer → a genuine new
  event.

## Transactional guarantee

Each event is inserted by the **same SECURITY DEFINER RPC** that performs the
mutation, in the **same transaction** — so the event commits iff the mutation
commits, and a rolled-back / rejected / failed mutation writes no event (pgTAP
proves the savepoint-rollback case). No async/browser audit write, no second
request, no best-effort logging.

## Audit helper design

`public._log_customer_audit_event(p_tenant_id, p_event_type, p_entity_id,
p_metadata)`:

- **SECURITY INVOKER**, `search_path = ''`, fully schema-qualified.
- **Revoked from public, anon, authenticated** → not client-callable. It is only
  ever invoked from within the SECURITY DEFINER mutation RPCs (which run as the
  table owner), so it inherits their insert privilege. Chosen INVOKER over
  DEFINER as defense-in-depth: even if execute leaked, an INVOKER call by a
  client would run as that client, which has no INSERT on audit_events.
- **Actor** = `(select auth.uid())` derived inside the helper — never a param.
- **Closed allowlist** of the 8 event types (raises on anything else — no
  "Other"); **bounded metadata** (raises > 4000 chars); no dynamic SQL.

(Inline INSERTs were an option; a single helper centralizes the allowlist +
bound + actor derivation across 8 producers with less duplication.)

## Metadata allowlist / PII redaction / token exclusion

- **Never stored:** raw token, token hash, public URL, full phone/email/address/
  name/notes values, guest snapshot values, payment/legal payloads, product image
  paths, auth claims, error stacks.
- **customer.updated** stores changed field **keys** + a safe enum `customer_type
  {from,to}` — never the PII values. The renderer additionally ignores any
  non-allowlisted metadata key (defense-in-depth; pgTAP + app tests prove PII
  values never appear even if injected).
- Metadata size is bounded in the helper.

## Category / sensitivity / labels

- **Category** = `customer` (Customer management), **derived** in the app from the
  event type (no DB column). ar/he/en labels in `dict.audit.category`.
- **Sensitivity** derived per type (`low`/`medium`); access-link + update are
  `medium` (credential / PII-field context), lifecycle transitions `low`. Never
  `high` (no event carries raw PII/tokens).
- All labels + safe detail templates in ar/he/en (`dict.audit`), typed by
  `src/i18n/types.ts`; RTL-correct (the type-change template mirrors for he/ar).

## Activity Log UI compatibility

- **No Activity Log screen exists** in the app (audit_events had zero consumers).
  Per scope, **no new screen, no Customer Timeline, no Customer-detail Activity
  tab** is added. This phase ships the **typed render contract**
  (`src/lib/audit-events.ts`: taxonomy, category, sensitivity, localized labels,
  PII-safe `renderCustomerAuditDetails`, explicit unknown handling) that M8G.3 and
  any future Activity Log consume.

## Mock parity

Mock-mode customer writes are Supabase-only (they throw in mock), so there is no
mock mutation flow to audit. Parity is provided by the **pure derivation model**
in `audit-events.ts` (`deriveCustomerCreatedEvent` / `deriveCustomerUpdateEvent`
/ `deriveActivationEvent`) — same taxonomy + metadata shape + no-op/change
semantics as the SQL producers — used by the application tests. No contradictory
mock-only audit system, no test-only taxonomy.

## Migration details

- **File:** `supabase/migrations/20260731100000_m8g2_customer_audit_foundation.sql`
  (additive: one private helper + create-or-replace of 8 existing RPCs).
- **RPC preservation:** every replaced RPC keeps its exact signature, return type,
  SECURITY DEFINER mode, `search_path=''`, grants (authenticated + service_role,
  revoke public/anon), tenant/role checks, and business result — only the
  transactional audit insert (and, for update/activation, a before/after diff)
  is added. `revoke_customer_access_link` is re-created at its **current 2-arg
  `(p_tenant_id, p_link_id)`** signature (the legacy 1-arg overload was dropped in
  M4C — not resurrected).
- **One RLS TIGHTENING (not a weakening):** the `audit_events` read policy is
  rewritten so a CUSTOMER-category row is visible only when the caller
  `can_access_customer(tenant_id, entity_id)` — owner/admin keep tenant-wide
  visibility; a sales_rep sees audit rows **only** for its assigned customers
  (closing an M4D scope leak that would otherwise appear the moment audit_events
  gains customer producers). Non-customer event rows keep the existing
  tenant-wide member read.
- **No** storage change, new column, DROP/DELETE/TRUNCATE of data, data loss,
  origin change, or historical backfill.

### Read-scope fix (found in self-review)

Before M8G.2, `audit_events` had no customer producers, so the M1 tenant-wide
"members can read" policy exposed nothing per-customer. Adding customer producers
would let a `sales_rep` `GET /rest/v1/audit_events?entity_type=eq.customer` and
read the history of **unassigned** customers (existence, event types,
changed-field keys, link/order ids) — violating the M4D rule that a sales_rep
sees only assigned customers. The fix ships the read-scoping **with** the producer
in the same migration:

```sql
drop policy "audit_events: members can read" on public.audit_events;
create policy "audit_events: members read; customer rows rep-scoped"
  on public.audit_events for select to authenticated
  using (public.is_tenant_member(tenant_id)
         and (entity_type <> 'customer'
              or public.can_access_customer(tenant_id, entity_id)));
```

pgTAP proves a sales_rep reads its assigned customer's rows but none for
unassigned customers, while owner keeps tenant-wide visibility.
- **Generated types:** regenerated; diff = the one new helper signature (no
  column changes).

## Index decision

**Deferred.** The only existing index relevant to reads is
`(tenant_id, created_at desc)`, which already covers a tenant-wide activity log.
Local `EXPLAIN` of an **entity-scoped** (per-customer Timeline) query seq-scans
without a `(tenant_id, entity_type, entity_id, created_at desc)` index — but there
is **no reader and no data** in this phase, so adding it now would be speculative.
Recommended for **M8G.3** when the Timeline reader + real volume exist to measure.

## Tests

- **pgTAP** `supabase/tests/customer_audit.test.sql` (52): direct-insert/helper
  privilege denial; server-derived actor/tenant; one event per create
  (manual/signup/guest incl. no-snapshot); change-gated + PII-redacted update;
  no-op update/activation → no event; distinct activate/deactivate; access-link
  created/rotated/revoked + no token/URL; already-revoked/already-linked no
  event; order-linked + origin unchanged; failed/rolled-back/unauthorized/
  cross-tenant → no event; admin actor; closed vocabulary; DB-generated
  timestamp; signatures/security/grants preserved; tenant-isolated reads; no rows
  lost. **DB total: 177.**
- **App** `src/lib/customer-audit.test.ts` (`test:customer-audit`, 32): taxonomy
  recognition, category, sensitivity, ar/he/en labels, no "Other", explicit
  unknown handling, safe details rendering (origin/changed-fields/type-change),
  PII/token never rendered, derivation model (change→event, no-op→none), source
  guards (server-derived, no client forgery, no Timeline UI, no helper call in
  app code, DB-taxonomy parity). **Full `npm test`: 210.**

## Deployment order (when approved)

1. Merge → main (ff-only). 2. Apply migration `20260731100000` to staging
(`db push --linked`). 3. Deploy the app. Because the create RPCs now write audit
rows, apply the migration **before** the app deploy.

## Staging smoke plan (authenticated)

Perform each mutation and confirm exactly one correct `audit_events` row (via a
read-only query or a future Timeline): manual create → `customer.created`
(origin manual); approve a signup → `customer.created` (origin signup); promote a
guest order → `customer.created` (origin guest_conversion, no snapshot in
metadata); edit fields → `customer.updated` (only changed keys, no PII values);
no-op edit → no row; deactivate/reactivate → distinct rows; already-current →
none; generate/regenerate/revoke a private link → created/rotated/revoked (no
token in metadata); link a guest order → `customer.order_linked` (origin
unchanged); a cross-tenant/sales_rep attempt → no row; another tenant's rows are
not visible; ar/he/en labels + RTL correct; public bundle secret-free.

## No fake historical backfill

The migration writes **no** audit rows for existing customers. Legacy customers
have no invented actor/timestamp/history — the trail starts at the first real
mutation after deployment. (Documented limitation below.)

## Known limitations

- **No historical trail** before deployment (by design — no fabricated events).
- **Signup rejection** is deferred (no customer entity; future Signup/Access
  category).
- **Compliance-grade immutability** is not added: `service_role` can still
  update/delete audit rows and `tenant_id ON DELETE CASCADE` removes the trail
  with its tenant (pre-existing schema properties) — revisit only if a legal-grade
  append-only trail is required.
- The Customer Timeline UI + entity-scoped index are **deferred to M8G.3**.
