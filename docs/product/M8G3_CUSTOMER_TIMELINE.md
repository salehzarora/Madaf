# M8G.3 — Customer Timeline (bounded entity audit read)

**Status:** implemented on `feature/m8g3-customer-timeline` (NOT merged, NOT
deployed, migration NOT applied to hosted staging). Local-stack verified.

## What this adds

A read-only **Activity** timeline on the Customer detail page
(`/admin/customers/[id]`) that renders the **real** `audit_events` rows produced
by M8G.2 for that one store — newest first, cursor-paginated, RLS-scoped. No new
mutation, no new audit event, no global Activity-Log route, no tab redesign.

It builds directly on M8G.2's transactional source of truth: the Timeline only
*reads*; it never reconstructs history by diffing state or guessing from orders.
If a store has no recorded events yet (all activity predates M8G.2), it shows an
honest empty state — never a fabricated history.

## The read: bounded, entity-scoped, deterministic

The data layer runs exactly one query per page:

```
WHERE tenant_id = <server-derived> AND entity_type = 'customer' AND entity_id = <id>
ORDER BY created_at DESC, id DESC
LIMIT pageSize + 1                 -- + optional (created_at, id) keyset cursor
```

- **Tenant is server-derived** (`getReadContext()` → the membership-verified
  cookie tenant); `entity_type` is a fixed literal. No client-supplied tenant,
  customer, page size, event type, or actor is ever trusted.
- **Bounded:** `pageSize` is clamped to `[1, 50]` (default 20); the query fetches
  `pageSize + 1` rows and uses the extra row only to compute `hasMore`. There is
  no full-history fetch.
- **Deterministic keyset pagination** on the composite sort key
  `(created_at DESC, id DESC)`. The cursor is the last row of the previous page;
  the next page is the rows **strictly older** than it, via the row-value
  comparison `(created_at, id) < (cursor.created_at, cursor.id)` (expanded for
  PostgREST as `created_at.lt.X,and(created_at.eq.X,id.lt.Y)`). Row-value (not
  id-only) so it stays correct even if `id` and `created_at` ever diverge
  (backfill / clock skew). This is exact — no dup, no skip, no offset drift.

### The cursor is opaque and never authorizes

`encodeTimelineCursor` base64url-encodes only `"<created_at>|<id>"` (isomorphic
`btoa`/`atob`, no `Buffer`, so the pure module runs on client and server).
`decodeTimelineCursor` validates it (base64, a `|` separator, a `^\d{1,19}$` id,
a parseable timestamp); anything malformed / oversized / tampered normalizes to
`null` → the first page. The cursor carries **no** tenant, customer id, secret,
or PII, and it is never an authorization token — **RLS is the only boundary.** A
forged cursor can at most change *where in the already-RLS-scoped result set* the
next page starts.

## Authorization: RLS + the existing rep scope (unchanged)

The read rides the M8G.2 `audit_events` SELECT policy verbatim:
`is_tenant_member(tenant_id) AND (entity_type <> 'customer' OR
can_access_customer(tenant_id, entity_id))`. So:

- a **sales_rep** sees the Timeline only for **assigned** customers (and reaches
  the detail page itself only for those — `getCustomer` is already RLS-gated);
- an **owner/admin** sees every store's Timeline tenant-wide;
- **cross-tenant** and unassigned reads return **zero rows**.

No RLS was loosened; no new policy, grant, or table write was added.

## Actor resolution (viewer-aware, no N+1, no identity leak)

`auth.users` is the only identity (email only — there is no profile/display-name
table). Actors for a whole page are resolved in **one** roster lookup, never
per-row:

- **owner/admin viewer** → `list_tenant_members()` (the existing owner/admin-gated
  roster RPC) resolves each `actor_user_id` to an email label (`named`); an
  `actor_user_id` no longer in the roster → `former team member`;
- **sales_rep viewer** → no roster access, so every attributed actor shows the
  neutral `A team member` label — **the identity is deliberately not shown.**
  `resolveTimelineActor` guards on `isAdmin` *before* the roster lookup, so a
  sales_rep can never receive an email even if a roster map were passed in
  (defense-in-depth; the data layer also only populates the map for owner/admin);
- **`actor_user_id IS NULL`** (the acting user was deleted —
  `ON DELETE SET NULL`) → `Unknown user`.

This reuses the existing team-roster visibility boundary exactly; it needs **no**
new RPC and never exposes another tenant's users.

## Client-safe rendering (no raw metadata, PII, tokens, hashes, or URLs)

Before a row reaches the client, `clientSafeMetadata` projects its stored
metadata down to a **per-event-type allowlist** of exactly the keys the renderer
uses (`created` → origin + customer_type; `updated` → changed_fields +
customer_type; access-link create/rotate → expires_at; everything else → `{}`).
`changed_fields` is further filtered to the known field-key allowlist. Unknown /
future event types project to `{}`. So link ids, order ids, request ids, and any
unexpected key never cross the wire — and tokens/hashes/URLs/PII are never stored
to begin with (M8G.2). The row still renders a text label + localized detail via
the shared M8G.2 `renderCustomerAuditDetails`; meaning is never conveyed by icon
or color alone (icons are `aria-hidden`).

## The index (the only schema change)

`20260801100000_m8g3_customer_timeline_index.sql` adds **one** additive covering
index:

```sql
create index audit_events_customer_timeline_idx
  on public.audit_events (tenant_id, entity_type, entity_id, created_at desc, id desc);
```

**Why it is justified (measured, not assumed).** The M8G.2 indexes are
`(tenant_id, created_at desc)` and `(actor_user_id)` — neither is entity-scoped,
so a per-customer read scans the whole tenant timeline and filters + sorts.
Local EXPLAIN on a realistic distribution (63k rows: 3k for the target customer,
60k for others), first page `LIMIT 21`:

| | plan | buffers |
|---|---|---|
| **without** the index | Index Scan on `(tenant_id, created_at)` + Filter (`Rows Removed by Filter: 1319`) + Incremental Sort | hit=84 |
| **with** the index | Index Scan using `audit_events_customer_timeline_idx`, Index Cond covers tenant+entity, **no** filter, **no** sort | hit=1 read=3 |

The `DESC/DESC` column order lets the index satisfy both the `ORDER BY` and the
`(created_at, id)` cursor directly, so pagination is a pure range scan. The
migration changes no policy, grant, function, or data; there is no backfill and
no customer/order mutation. Generated `database.types.ts` is unchanged (an index
is not part of the type surface) so it is not re-committed.

## Files

**New**
- `src/lib/customer-timeline.ts` — pure, isomorphic contract: page-size clamp,
  opaque keyset cursor (encode/decode/validate), DESC comparator + keyset
  predicate, viewer-aware `resolveTimelineActor`, `buildTimelineEvent`,
  `clientSafeMetadata`.
- `src/lib/data/customer-timeline.ts` — `getCustomerTimelinePage` dispatcher
  (mock default; supabase server-only via dynamic import).
- `src/lib/mock/audit-events.ts` — demo rows for store `c01` (all 8 event types;
  one null-actor row; an off-roster actor) so the Timeline renders zero-config.
- `src/lib/actions/customer-timeline.ts` — `loadCustomerTimelineAction`, the
  read-only "load more" server action (validates id + bounds cursor length).
- `src/components/admin/customer-timeline.tsx` — the client list (load-more with
  an in-flight guard, empty / error+retry states, a11y, ar/he/en + RTL).
- `supabase/migrations/20260801100000_m8g3_customer_timeline_index.sql`.
- `src/lib/customer-timeline.test.ts` (71 checks) + `supabase/tests/customer_timeline_index.test.sql` (22 checks).

**Modified**
- `src/lib/data/supabase-reads.ts` — `sbGetCustomerTimelinePage` (the bounded,
  RLS-scoped, no-N+1 read).
- `src/lib/audit-events.ts` — `renderCustomerAuditDetails` param loosened to the
  structural `{ eventType, metadata }` shape (a full `AuditEvent` still satisfies it).
- `src/app/[locale]/admin/customers/[id]/page.tsx` — the Activity `<Card>`.
- i18n (`types.ts` + `ar/he/en`) — the `audit.timeline` block.
- `src/lib/data/index.ts`, `src/lib/mock/index.ts` — re-exports.
- `src/lib/customer-audit.test.ts` — the M8G.2 "no Timeline yet" guard is
  retargeted to "no **global** Activity-Log route" (the per-customer Timeline is
  now delivered by M8G.3; a tenant-wide activity screen remains out of scope).
- `package.json` (+ `test:customer-timeline`, wired into `npm test`), `.github/workflows/ci.yml`.

## Verification (local)

- `npm test` → **282** app checks pass (incl. the 71 new timeline checks).
- `supabase test db` → **202** pgTAP checks pass (incl. the 22 new index checks:
  index shape, additivity, keyset order + tie-break + no-overlap, EXPLAIN uses
  the index with no Sort, and RLS rep/owner/cross-tenant scoping with the index
  present).
- `npm run lint`, `npx tsc --noEmit`, `npm run build` → clean; build ends
  `[check-dynamic-routes] OK`; the customer detail route is dynamic (`ƒ`).
- Client bundle scan → **0** hits for `sb_secret_`, `service_role`,
  `SUPABASE_SERVICE`, `_log_customer_audit_event`, `token_hash`, or the server
  read symbol.

## Explicitly out of scope

No global Activity-Log route/screen; no new mutation or audit event; no change to
the M8G.2 producers, taxonomy, RLS policy, or grants; no customer/order mutation;
no re-committed generated types.
