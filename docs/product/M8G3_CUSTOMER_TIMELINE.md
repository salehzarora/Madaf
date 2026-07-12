# M8G.3 — Customer Timeline (bounded entity audit read)

**Status:** implemented on `feature/m8g3-customer-timeline` (NOT merged, NOT
deployed, neither M8G.3 migration applied to hosted staging). Local-stack verified.

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

## Actor resolution (a bounded id-query, no roster read, no N+1, no identity leak)

`auth.users` is the only identity (email only — there is no profile/display-name
table). Labels are resolved through one bounded data-layer contract,
`getTimelineActorLabelsForIds(actorIds)` (Supabase `sbGetTimelineActorLabels` /
mock `mockActorLabels`), backed by a **genuinely bounded RPC**:

- **input is bounded** — `distinctActorIds` collects the **distinct, non-null**
  `actor_user_id`s on the current page only, deduped and hard-capped at 50 (the
  page maximum). The resolver only ever sees this page's actors, never a per-row
  lookup;
- **empty input performs no query** — a page with no attributed actors issues
  zero database calls;
- **owner/admin viewer** → **exactly one** call to
  `get_timeline_actor_labels_for_ids(p_tenant_id, p_actor_user_ids[])`, which
  joins **only** the requested ids to the tenant's members + `auth.users` and
  returns at most `{ actor_user_id, actor_email }` rows for them. The **full
  roster is never read** — the query drives from the ≤50 requested ids into the
  `tenant_users` PK, not the other way around. A resolved id → `named` (email); an
  id that is not a current member (removed / off-roster) → `former team member`;
- **sales_rep viewer** → the lookup short-circuits with an empty map and **no
  query**, so every attributed actor shows the neutral `A team member` label —
  the identity is deliberately not shown. (The RPC itself *also* denies a
  sales_rep via `authorize_tenant`, so even a direct call cannot leak emails.)
  `resolveTimelineActor` additionally guards on `isAdmin` *before* consulting the
  map (defense-in-depth);
- **`actor_user_id IS NULL`** (the acting user was deleted —
  `ON DELETE SET NULL`) → `Unknown user`.

### Why projection-after-`list_tenant_members` was not enough — and the RPC

The prior correction (`60d36ea`) bounded the *result* to the page's ≤50 actors,
but the only authorized email source at the time, `list_tenant_members(tenant)`,
still **read the entire roster** and the projection happened afterward in
TypeScript. Filtering after an unbounded read is not a bounded query. `auth.users`
is not client-readable, so a minimal `SECURITY DEFINER` RPC is required (exactly
like `list_tenant_members`). The new
`get_timeline_actor_labels_for_ids(p_tenant_id, p_actor_user_ids uuid[])`:

- **STABLE, `search_path = ''`, fully schema-qualified**, `SECURITY DEFINER` only
  for the `auth.users` join;
- **owner/admin gate + tenant validation via `authorize_tenant`** — the
  client-supplied `p_tenant_id` authorizes *only* if the caller is an owner/admin
  member of it (raises `42501` for a sales_rep, non-member, or cross-tenant
  attempt); the tenant never self-authorizes;
- **input bound inside the DB** — distinct non-null ids counted; **> 50 distinct →
  `22023`**; duplicates/nulls never inflate the request; empty array → zero rows;
- **returns only `(actor_user_id uuid, actor_email text)`** — no role, tenant,
  phone, provider, identities, or any other `auth.users` field;
- **requested-only, current-member-only** — a cross-tenant / non-member / unknown /
  removed id simply yields no row (never a fabricated one); at most 50 rows;
- **least privilege** — `revoke all from public, anon`; `grant execute to
  authenticated` only; **no `service_role` grant** (the RPC is only ever invoked
  by an authenticated owner/admin). No RLS, policy, grant on any existing object,
  producer, index, taxonomy, or data changed. `list_tenant_members` is left
  untouched (still used by the team roster).

Migration: `supabase/migrations/20260801110000_m8g3_timeline_actor_lookup_rpc.sql`
(additive; **not applied to hosted staging**).

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
  predicate, viewer-aware `resolveTimelineActor`, `distinctActorIds` (bounded
  page-actor set), `buildTimelineEvent`, `clientSafeMetadata`.
- `src/lib/data/customer-timeline.ts` — `getCustomerTimelinePage` dispatcher +
  the bounded `getTimelineActorLabelsForIds` actor-label contract (mock default;
  supabase server-only via dynamic import).
- `src/lib/mock/audit-events.ts` — demo rows for store `c01` (all 8 event types;
  one null-actor row; an off-roster actor) so the Timeline renders zero-config.
- `src/lib/actions/customer-timeline.ts` — `loadCustomerTimelineAction`, the
  read-only "load more" server action (validates id + bounds cursor length).
- `src/components/admin/customer-timeline.tsx` — the client list (load-more with
  an in-flight guard, empty / error+retry states, a11y, ar/he/en + RTL).
- `supabase/migrations/20260801100000_m8g3_customer_timeline_index.sql` (the
  Timeline event index) + `supabase/migrations/20260801110000_m8g3_timeline_actor_lookup_rpc.sql`
  (the bounded actor-label RPC).
- `src/lib/customer-timeline.test.ts` (app checks) +
  `supabase/tests/customer_timeline_index.test.sql` (index) +
  `supabase/tests/timeline_actor_labels_rpc.test.sql` (the actor RPC).

**Modified**
- `src/lib/data/supabase-reads.ts` — `sbGetCustomerTimelinePage` (the bounded,
  RLS-scoped read) + `sbGetTimelineActorLabels` (one bounded RPC call keyed on the
  page's ≤50 distinct actor ids; the `list_tenant_members` roster read is gone).
- `src/lib/supabase/database.types.ts` — regenerated: the new RPC signature only.
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

- `npm test` → **298** app checks pass (incl. **87** timeline checks — the bounded
  id-RPC path, dedup/cap/empty/oversized, sales_rep no-query, no-roster/no-N+1
  source guards, and the additive-RPC migration guard).
- `supabase test db` → **235** pgTAP checks pass, incl. the **33** new actor-RPC
  checks (signature, 2-column return, DEFINER/STABLE/empty-search_path, the
  PUBLIC/anon/service_role-denied + authenticated privilege matrix, 0/50/51 input
  bounds, requested-only + no-full-roster + cross-tenant + unknown/removed +
  ≤50-row behavior, owner/admin resolve, sales_rep + non-member denial, no tenant
  forgery, email-only exposure, and M8G.2 RLS/producers/index/no-mutation
  regressions) plus the 22 index checks.
- `npm run lint`, `npx tsc --noEmit`, `npm run build` → clean; build ends
  `[check-dynamic-routes] OK`; the customer detail route is dynamic (`ƒ`).
  `npm audit --omit=dev` → 0 vulnerabilities. Generated types regenerated locally
  (RPC signature only).
- Client bundle scan → **0** hits for `sb_secret_`, `service_role`,
  `NEXT_PUBLIC_SERVICE_ROLE`, Postgres connection strings,
  `_log_customer_audit_event`, `token_hash`, the server-only Timeline read /
  actor-RPC symbols, `list_tenant_members`, or any fixture email; the browser key
  is publishable/anon only.

## Explicitly out of scope

No global Activity-Log route/screen; no new mutation or audit event; no change to
the M8G.2 producers, taxonomy, RLS policy, or grants; no customer/order mutation;
no hosted-staging migration; not merged, not deployed.
