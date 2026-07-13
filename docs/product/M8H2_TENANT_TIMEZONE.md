# M8H.2 — Tenant Timezone Foundation & Site-Wide Time Rendering

**Status:** implemented on `feature/m8h2-tenant-timezone` (NOT merged, NOT
deployed, migration NOT applied to hosted staging). Local-stack verified.

## The problem was never the stored data

`2026-07-13 09:57:17+00` in the SQL editor is **correct**. `timestamptz` stores an
absolute instant in UTC, and the editor simply renders it in UTC — that same
instant *is* `12:57` in `Asia/Jerusalem`. Nothing was wrong with the database.

What was wrong was the **presentation**: the app formatted with
`Intl.DateTimeFormat` **without a `timeZone`**, so every business time silently
used whatever zone the *runtime* happened to be in — the server machine during
SSR, the **device** in the browser. And order date filters were hard-coded to
`Asia/Jerusalem` in a module constant.

M8H.2 makes the timezone **explicit, per-tenant, and authoritative**.

## The time contract

| | Rule |
|---|---|
| **Storage** | absolute instants, `timestamptz` (UTC). **Never rewritten.** |
| **Tenant timezone** | an **IANA name** (`Asia/Jerusalem`), stored on `public.tenants.timezone` |
| **Fixed offsets** | **prohibited** — `+03:00` cannot express DST. Jerusalem is **+02:00 in winter and +03:00 in summer**; a stored offset would be silently wrong for half the year. `+03:00`, `UTC+2` and `-0500` are rejected by the DB *and* the app. |
| **Locale** | independent of the timezone. Arabic UI + `Asia/Jerusalem` is normal. |
| **DST** | handled by the platform's IANA data. No offset table is hand-rolled. |
| **Browser timezone** | **never authoritative.** Shown only as a non-applied hint in Settings. |
| **Server machine timezone** | never used. |
| **Fallback** | a corrupt stored zone → **UTC**, logged (never the machine/device zone). |
| **Formatting** | one centralized, tested contract: `src/lib/time.ts`. |

## The 09:57 → 12:57 example

```
stored     2026-07-13T09:57:17.908Z        (absolute instant, UTC)
tenant     Asia/Jerusalem                   (IDT, UTC+3 in July)
displayed  12:57                            (ar / he / en — locale-independent)
winter     2026-01-13T09:57:17.908Z → 11:57 (IST, UTC+2 — NOT a fixed +03)
```

Both are regression-tested, along with the two DST transition days.

## Complete time-surface inventory

Every business-facing timestamp now renders through the tenant contract. `date`
columns are deliberately **excluded** (see below).

| Surface | Source | Previous | Now | S/C | Date filter |
|---|---|---|---|---|---|
| Orders list | `orders.created_at` | implicit runtime zone | `formatTenantDateTime` | client (prop) | **yes** |
| Orders list CSV | `orders.created_at` | **raw UTC ISO** under a localized "Date" header | tenant wall clock (matches the screen) | client | yes |
| Order detail | `orders.created_at` | implicit | `formatTenantDateTime` | server | — |
| Order documents (screen) | `documents.created_at` | implicit | `formatTenantDateTime` | server | — |
| Order document PDF | `documents.created_at` | implicit (render server's zone!) | `formatTenantDateLong(…, supplier.timezone)` | server | — |
| Documents list | `documents.created_at` | implicit | `formatTenantDateTime` | server | — |
| Customers list (last order) | `orders.created_at` | implicit | `formatTenantDate` | client (prop) | — |
| Customer detail (recent orders) | `orders.created_at` | implicit | `formatTenantDateTime` | server | — |
| **Customer Timeline** (M8G.3) | `audit_events.created_at` | implicit | `formatTenantDateTime` | client (prop) | — |
| Access links (expiry / last used) | `customer_access_links.*` | implicit | `formatTenantDateTime` | client (prop) | — |
| Showcase links (expiry) | `catalog_showcase_links.expires_at` | implicit | `formatTenantDateTime` | client (prop) | — |
| Signup links + requests | `customer_signup_*` | implicit | `formatTenantDateTime` | client (prop) | — |
| Team members + invites | `tenant_users`, `tenant_invitations` | implicit | `formatTenantDate` / `DateTime` | client (prop) | — |
| Inventory movements | `order_inventory_movements.created_at` | implicit | `formatTenantDateTime` | client (prop) | — |
| Dashboard recent orders | `orders.created_at` | implicit | `formatTenantDateTime` | server | — |
| **Inventory expiry** | `inventory_items.expiry_date` (**`date`**) | `formatDate` | **`formatDateOnly` — NO timezone** | client | — |

### Date-only fields are NOT timezone-converted

`inventory_items.expiry_date` is a SQL **`date`**: a calendar date with no instant
and no zone. Converting it would *shift the day* — `2026-07-13` read as UTC
midnight and rendered in `America/New_York` displays **07-12**. `formatDateOnly`
takes `(dateStr, locale)` and **no timezone at all**, so no zone can move it.

## Tenant-local date filters (and a real DST bug fixed)

A date an operator picks means **a calendar day in the tenant's timezone**.
Bounds are **start-inclusive, next-day-start-exclusive**, so `to=2026-07-05`
includes the whole local 5th:

```
from 2026-07-05  →  created_at >= tenantDayStartUtcIso("2026-07-05", tz)
to   2026-07-05  →  created_at <  tenantDayStartUtcIso(nextCalendarDay("2026-07-05"), tz)
```

The **count, the page and the CSV export** are all built by one `buildOrdersQuery`
with the same zone, so pagination can never disagree with the rows, and an export
can never contain a different set of days than the screen it came from. The mock
path mirrors it exactly.

**A latent DST bug from M8F.1 is fixed here.** Its offset math was single-pass: it
took the zone offset at *00:00 UTC*, which on a transition day is the wrong offset
for local midnight. Measured:

| Local day | one-pass result | actual local time | effect |
|---|---|---|---|
| 2026-03-27 (spring forward) | `2026-03-26T21:00Z` | **23:00** of the *previous* day | an hour **duplicated** |
| 2026-10-25 (fall back) | `2026-10-24T22:00Z` | **01:00** | the first business hour **skipped** |

A second pass (re-read the offset at the candidate instant and correct) fixes
both. Regression-tested, including that a spring day spans **23h**, an autumn day
**25h**, and that consecutive days **tile exactly** with no gap or overlap.

Date presets ("today", last 7 days) use `tenantToday(tz)` — *today for the
business*, not for the viewer's device.

## Database

**Migration:** `supabase/migrations/20260803100000_m8h2_tenant_timezone.sql` (additive).

1. **`public.tenants.timezone text NOT NULL DEFAULT 'Asia/Jerusalem'`** — the
   `DEFAULT` backfills every existing tenant. The value comes from the product's
   documented single market; it is **not inferred** from a tenant's name, address,
   locale, phone, IP or current UTC offset, and any tenant can be moved elsewhere.
2. **`_is_valid_timezone(text)`** (STABLE, `search_path=''`) + a **`BEFORE INSERT
   OR UPDATE OF timezone` trigger**. The trigger is **required, not belt-and-braces**:
   `authenticated` holds a **direct `UPDATE` grant** on `tenants` (RLS-gated to
   owner/admin), so RPC-only validation could be bypassed by a direct table write.
   Validation is against `pg_catalog.pg_timezone_names`; invalid names, empty
   strings, NULL and bare offsets all raise **`22023`**.
3. **`update_tenant_timezone(p_tenant_id, p_timezone)`** — SECURITY DEFINER,
   `search_path=''`, `authorize_tenant(owner/admin)` so `p_tenant_id` **never
   self-authorizes**; sales_rep, non-members and cross-tenant callers get `42501`.
   `PUBLIC`/`anon` revoked, `authenticated` granted. It writes **only** the
   timezone. `update_tenant_profile` is left **completely untouched** (adding a
   parameter would have created an *overload*, not a replacement).
4. **`list_memberships()`** gains `timezone` (DROP + CREATE; same name, no args,
   same security/search_path/grants). This is why there is **no extra query**: the
   zone rides the read context that already runs once per request.

**Not done:** no timestamp modified, no session/database timezone set, no audit
producer / audit RLS / order status / inventory / storage / index touched, no
historical backfill beyond populating the new column.

## Timezone options

`TIME_ZONE_OPTIONS` = `['UTC', ...Intl.supportedValuesOf('timeZone')]` — **418**
canonical Region/City zones, computed **once per process on the server** and passed
to the control as a prop (no DB query, no browser API dependency, no secret).

Deliberately **not** `pg_timezone_names`: that has **1196** rows including **598
`posix/*` aliases** and `Factory` — an unusable picker. Every one of the 418
offered names was verified to be accepted by PostgreSQL (418/418), so the UI can
never offer a value the database would reject. The database stores only the IANA
identifier; no translated label is persisted.

## Settings UI

On the existing **Business settings** route, which is already **owner/admin only**
(sales_rep is 404'd), so a rep never sees the control — and the RPC re-verifies
owner/admin server-side regardless. Searchable list, the current IANA identifier,
an **explicit Save** with loading / success / error states, `role="radiogroup"` +
`aria-checked` + a labelled search input, bidi-isolated (`dir="ltr"`) zone
identifiers, logical CSS only (RTL/LTR safe), ar/he/en. The browser's zone is
shown **only as a hint** and is never auto-applied. Fixed offsets are not offered.

## Changing the timezone

Changing it **does not touch a single stored instant**. Orders, customers, audit
rows and their `created_at`/`updated_at` values are byte-identical afterwards
(pgTAP-verified). Ordering is unaffected because ordering is by UTC instant. What
changes is (a) how instants are **displayed** and (b) how **future** tenant-local
date filters resolve. The admin tree is revalidated so the new zone takes effect.

> **Historical timestamps are absolute instants.** Changing the tenant timezone
> changes their displayed local wall clock, **not the moment that was recorded.**

No timezone is snapshotted onto existing rows. (A future *legal* document may need
a zone snapshot; legal invoicing remains disabled and out of scope.)

## Audit decision

There is **no existing Tenant/settings audit producer or taxonomy** — M8G.2 covers
the *customer* entity and M8H.1 the *order* entity. Inventing a general Tenant
audit architecture inside M8H.2 would be scope creep, and reusing the Customer or
Order categories for a tenant setting would be dishonest (and there is no "Other").

**Decision: timezone-change auditing is DEFERRED to a future Tenant-settings audit
phase.** Reads and date filters emit no audit events, and this phase adds none.

## Mock parity

The mock tenant carries its own `timezone` (`Asia/Jerusalem`), and mock date
filters use the same tenant-zone boundary functions as Supabase. The timezone
*write* is Supabase-only (the control short-circuits to a demo, exactly like the
existing business-profile form).

## Verification (local)

- `npm test` → **385** app checks (incl. **43** new `test:tenant-timezone`).
- `supabase test db` → **343** pgTAP (incl. **37** new: column + NOT NULL +
  backfill, table-level validation of valid/invalid/empty/NULL/fixed-offset,
  RPC catalog + privilege matrix, owner/admin allowed, sales_rep + non-member +
  cross-tenant refused, **timestamps and origin unchanged**, `list_memberships`
  return shape, no audit/RLS/producer regression, no row lost).
- `npm run lint`, `npx tsc --noEmit`, `npm run build` → clean; build ends
  `[check-dynamic-routes] OK`. `npm audit --omit=dev` → 0 vulnerabilities.
- Generated types: `tenants.timezone`, `_is_valid_timezone`,
  `update_tenant_timezone`, and `list_memberships.timezone` — nothing else.
- Bundle scan → 0 for secrets/service-role/private helpers/tokens/snapshots.

## Known limitations

- Timezone-change auditing is deferred (see above).
- Only the **Orders** list exposes a date-range filter today; the boundary
  primitive is shared, so any future filter inherits the correct semantics.
- The option list follows the runtime's ICU data; a zone added to IANA after the
  Node/browser build would need a runtime update (the DB would still accept it).

## Next

**M8H.3 — Order Timeline** consumes the M8H.1 audit rows and will render every
event through this tenant-timezone contract (which is precisely why it was
deferred to land after this foundation).

**Staging deployment order (when authorized):** this migration applies after
`20260802100000`; it is additive and needs no backfill beyond the column default.
