# M8G.1 — Immutable Customer Origin (Acquisition Tracking)

**Status:** implemented on `feature/m8g1-customer-origin` (NOT merged, NOT
deployed, migration NOT applied to hosted staging). Local-stack verified.

## Purpose

Record **how each customer first entered Madaf** — a trustworthy, write-once
acquisition origin surfaced in the admin Customers experience and filterable
through the existing server-side Customers search/pagination.

`customers.origin` represents the **original acquisition origin** and is **not**:
the most recent order source, a preferred ordering channel, the last editor, the
current relationship status, or an editable marketing label. It is set once by
the DB create path that materialised the row and is never rewritten by later
edits, activation, assignment, renames, or orders. **No manual origin editing is
introduced in this phase.**

## Creation-path inventory (verified)

Direct table writes on `public.customers` were locked in
`20260705160000_lock_catalog_writes.sql` (RPC-only; SELECT-only for
`authenticated`). Exactly **three** active paths INSERT a customer row, plus the
seed:

| Path | Function | Inserts customer? | Historically distinguishable? |
|---|---|---|---|
| Manual admin create | `create_customer` (`20260717100000`) | yes | **no** provenance recorded |
| Self-signup / **Join** approval | `approve_customer_signup_request` (`20260719100000`) | yes | **yes** — `customer_signup_requests.approved_customer_id` composite FK |
| Guest-order promotion | `create_customer_from_order` (`20260721110000`) | yes | **no** reliable marker |
| Seed / demo | `supabase/seed.sql` | yes | fixed ids only |

Not creation paths (verified, excluded): `link_order_to_customer` (links an
existing customer), `update_customer` / `set_customer_active` (edit/lifecycle),
shop token orders and showcase guest orders (`create_order_from_showcase_token`
leaves `customer_id` NULL — a guest order does **not** create a customer). **Join
and Signup are the same underlying path** (a tokenised "join" link feeds a signup
request that approval materialises) — they are therefore **one** origin, not two.

## Final vocabulary (closed enum `public.customer_origin`)

| Value | Definition (non-overlapping) |
|---|---|
| `manual` | Owner/admin created the store directly (`create_customer`). |
| `signup` | A self-signup / join request was approved (`approve_customer_signup_request`); provably linked via `approved_customer_id`. |
| `guest_conversion` | A guest showcase order was promoted to a permanent customer (`create_customer_from_order`). |
| `legacy_unknown` | Origin not reliably determinable — every pre-M8G.1 row that is not provably a signup, **and** the defense-in-depth default. |

Values map 1:1 to a distinct create path; `legacy_unknown` is the explicit
"unknown/historical" bucket. **There is no `other` bucket.**

## Backfill contract (conservative)

The migration adds the column with `DEFAULT 'legacy_unknown'` (filling all
existing rows), then reclassifies **only** the provable signups:

```sql
update public.customers c set origin = 'signup'
  from public.customer_signup_requests r
 where r.approved_customer_id = c.id and r.tenant_id = c.tenant_id
   and c.origin = 'legacy_unknown';
```

- **Evidence source:** `customer_signup_requests.approved_customer_id` — an
  immutable composite FK `(tenant_id, approved_customer_id) → customers`. Set
  once at approval, never rewritten. Deterministic + idempotent.
- **Precedence:** signup evidence beats the default; the three origins are
  mutually exclusive in practice (each path inserts a distinct new row).
- **Ambiguous rows:** manual and guest-promotion history are byte-for-byte
  identical (no provenance was ever recorded), so they stay `legacy_unknown`.
  **Manual is never inferred.** We do **not** use name, phone, current orders,
  status, assignment, or a linked guest order as evidence (a guest order can be
  linked to a *pre-existing* customer by `link_order_to_customer`, so it proves
  nothing).
- **Local fixtures:** seed sets 8 stores to an explicit 2/2/2/2 spread. pgTAP
  exercises the backfill UPDATE on fresh fixtures (a signup-linked row → signup;
  an unlinked row stays legacy_unknown).

## Database design

- **Migration:** `supabase/migrations/20260730100000_m8g1_customer_origin.sql`
  (additive; one enum, one column + backfill, create-or-replace of the three
  create RPCs). No table/policy/storage/RLS change; no data loss; no Order
  mutation; no DROP/DELETE/TRUNCATE.
- **Column:** `customers.origin public.customer_origin NOT NULL DEFAULT
  'legacy_unknown'`.
- **Constraint:** closed enum (mirrors the `customer_type` enum convention).
- **Default:** `legacy_unknown` — defense-in-depth only. Every active create
  path OVERRIDES it (`create_customer` → `manual`, signup approval → `signup`,
  guest promotion → `guest_conversion`). A future path that forgets is flagged
  honestly as `legacy_unknown`, never silently mislabelled `manual`.
- **Index:** none added. EXPLAIN shows the origin filter rides the existing
  `customers_tenant_id_idx` (per-tenant partitions are small); a `(tenant_id,
  origin)` index is **deferred** — no measured need.

## Immutability

No trigger is used. Immutability is structural:

- `customers` has **no** INSERT/UPDATE/DELETE RLS policy and `authenticated`
  has **no** UPDATE/INSERT table grant — a direct `UPDATE ... SET origin` by an
  authenticated caller is denied (`42501`).
- The only writers are SECURITY DEFINER RPCs; the three create paths set origin
  at INSERT only; `update_customer` and `set_customer_active` are **untouched**
  (their column lists never reference origin).
- No create RPC accepts an origin parameter — the browser cannot assert it; the
  server derives it from the operation being executed. `searchCustomersAction`
  re-validates the origin *filter* with `isCustomerOrigin` (never trusts a raw
  string), and the filter is read-only.
- Re-approving an already-reviewed signup request raises (idempotency guard), so
  an existing origin is never rewritten.

## Application integration

- **Types:** `CustomerOrigin` + `isCustomerOrigin` + `Customer.origin` +
  `CustomerQuery.origin` (`src/lib/types.ts`).
- **URL contract:** `src/lib/customers-query.ts` — pure parser/serializer for the
  Customers list URL state (`q`, `status`, `link`, `origin`). Invalid origins
  normalize to "all"; defaults are omitted from the URL; there is no page param
  (load-more is ephemeral, so any filter change re-renders from the first page).
- **Supabase filter:** `sbSearchCustomers` adds `.eq("origin", q.origin)` in the
  DB query **before** the order/range, tenant-scoped and RLS-bound. `mapCustomer`
  surfaces `origin`. One query — no N+1.
- **Mock filter:** mirrors the same semantics (an absent origin ⇒
  `legacy_unknown`).
- **UI:** `CustomerOriginBadge` (presentational; the three known origins get a
  coloured dot, `legacy_unknown` is a muted dashed badge — clearly "unknown").
  Shown as a column on the Customers list and as read-only metadata on the
  customer detail header. A URL-driven origin `<Select>` filter joins the search
  + status + link facets; changing it navigates (shareable, back/forward, resets
  load state) and preserves unrelated facets. No editable origin control exists.
- **Statistics:** the M8F.3 stats RPC integration is unchanged; stats still merge
  by id for the current page.
- **Export:** no Customers CSV export exists (confirmed) — none added.
- **Locales/RTL:** origin labels + descriptions in ar/he/en (typed by
  `src/i18n/types.ts`); logical CSS only.

## Activity Log / Audit decision

Origin is derived automatically inside the existing create transactions, so
M8G.1 introduces **no new user-triggered mutative action** and **no new audit
event**. **Documented gap:** the generic `public.audit_events` table exists but
has **zero producers anywhere in the app** — no create path (customer, order,
product) currently emits an event. Wiring the first-ever audit producer (with a
new event-type / category / sensitivity / ar-he-en label vocabulary) is out of
scope and would broaden this phase; origin is instead stored immutably on the
customer row (self-documenting). Read-only origin browsing (view/filter/search/
paginate/open detail) logs nothing. No `origin.changed` event exists (no manual
change path). Nothing is routed to an "Other" bucket.

## Tests

- **pgTAP** `supabase/tests/customer_origin.test.sql` (33 assertions): column
  shape / NOT NULL / default / closed enum; valid accepted + invalid rejected;
  seed explicit origins + no row lost; backfill (signup-linked → signup, unlinked
  stays legacy_unknown, manual never inferred); create paths derive
  manual/signup/guest_conversion; no origin arg on any create RPC; edit /
  deactivate / linked order / guest order / re-approve / direct authenticated
  UPDATE never rewrite origin; RLS unchanged (SELECT-only, no UPDATE
  policy/grant); owner sees all, cross-tenant blocked, sales_rep sees origin only
  for assigned customers; existing stats / product-search / access-link RPCs
  intact. **Total DB tests after reset: 125.**
- **App** `src/lib/customer-origin.test.ts` (`npm run test:customer-origin`, 33
  cases): URL parse/serialize/compose (default, valid, invalid-normalize,
  round-trip, filter-change resets load, unrelated facets preserved, rapid
  composition, clearing preserves others); ar/he/en + legacy labels; mock
  manual/signup/legacy rows; server-side origin filter + exact count +
  current-page-only + composition with search/status; stats still merge;
  zero-order unchanged; source guards for immutability, server-controlled
  derivation, read-only/no-audit, no "Other", and the client/server secret
  boundary. **Full `npm test`: 178.**

## Deployment order (when approved)

1. Merge `feature/m8g1-customer-origin` → `main` (ff-only).
2. Apply migration `20260730100000` to hosted staging (`db push --linked`).
3. Deploy the app.
4. Post-deploy smoke (below).

Because the create RPCs now reference the `origin` column, the migration must be
applied **before** the app deploy.

## Staging smoke plan (authenticated)

Customers list shows an origin badge per store + an origin filter; filtering by
each origin narrows to matching stores and reflects in the count + load-more; a
shared `?origin=…` URL reproduces the filter and back/forward restores it;
clearing origin preserves search/status; the detail page shows read-only origin;
a newly approved signup store shows `signup`, a guest-promoted store shows
`guest_conversion`, a manually added store shows `manual`; pre-existing stores
show their backfilled origin (signup where linked, else unknown); a sales_rep
sees origins only for assigned stores; ar/he/en + RTL correct; public bundle free
of secrets.

## Known limitations

- Historical manual vs guest-promotion rows are indistinguishable and stay
  `legacy_unknown` (honest — no provenance was ever recorded). Going forward they
  are classified precisely.
- No manual origin reassignment (deliberately out of scope).
- Customer timelines / CRM notes / analytics are **out of scope** (deferred).
