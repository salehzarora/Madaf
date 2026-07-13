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
| Inventory movements | `order_inventory_movements.created_at` | implicit | `formatTenantDateTime` | client (prop) | **yes** |
| Inventory movements CSV | `order_inventory_movements.created_at` | **raw UTC ISO** under a localized "Date" header | tenant wall clock (matches the screen) | client | yes |
| Dashboard recent orders | `orders.created_at` | implicit | `formatTenantDateTime` | server | — |
| **Inventory expiry** | `inventory_items.expiry_date` (**`date`**) | `formatDate` | **`formatDateOnly` — NO timezone** | client | — |

> **The movements ledger was caught half-migrated.** The first pass converted its
> *screen* to tenant-local time but left the CSV emitting a raw UTC instant and left
> the date *filter* on the browser's clock — so the same page could **display** a
> movement on one date and **filter** it onto another. Both are fixed here; see
> *Two date filters* below.

### Date-only fields are NOT timezone-converted

`inventory_items.expiry_date` is a SQL **`date`**: a calendar date with no instant
and no zone. Converting it would *shift the day* — `2026-07-13` read as UTC
midnight and rendered in `America/New_York` displays **07-12**. `formatDateOnly`
takes `(dateStr, locale)` and **no timezone at all**, so no zone can move it.

## Tenant-local date filters, and the reverse conversion

A date an operator picks means **a calendar day in the tenant's timezone**.
Bounds are **start-inclusive, next-day-start-exclusive**, so `to=2026-07-05`
includes the whole local 5th:

```
from 2026-07-05  →  created_at >= tenantDayStartUtcIso("2026-07-05", tz)
to   2026-07-05  →  created_at <  tenantDayStartUtcIso(nextCalendarDay("2026-07-05"), tz)
```

Both bounds come from **one builder**, `tenantDateRangeUtc(from, to, tz)`
(`src/lib/tenant-day.ts`), which `buildOrdersQuery` calls once — so the **exact
count, the page and the CSV export** physically cannot disagree about where a day
begins. The mock path calls the same function. Date presets ("today", last 7 days)
use `tenantToday(tz)` — *today for the business*, not for the viewer's device.

### Two date filters, one builder

There are **two** date-range filters in the product, and both are tenant-local:

| Filter | Where bounds are resolved | Preset source |
|---|---|---|
| **Orders** list / count / CSV | server (`buildOrdersQuery` → `tenantDateRangeUtc`) | `tenantToday(tz)` |
| **Inventory movements** list / load-more / CSV | server (`sbSearchInventoryMovements` → `tenantMovementRangeUtc`) | `tenantToday(tz)`, **server-side** |

The movements filter used to be computed **in the browser** by a legacy M8C helper
(`src/lib/date-range.ts`) that took `new Date(y, m, d)` for "local midnight", added
`86_400_000` for "a day", and did `Date.parse(\`${d}T00:00:00\`)` for a typed date.
Every one of those reads the **device** clock, so "today" meant today *for whoever
was looking*, and a DST day was bounded an hour wrong. That helper is **deleted**;
the client now sends only a **preset plus date-only strings** and cannot express an
instant at all. `tenantMovementRangeUtc` resolves the preset against the tenant's
clock and delegates the boundary maths to the same `tenantDateRangeUtc`, so the
ledger inherits every DST property proven below — including the 22h/26h days and the
zones where local midnight does not exist. "7 days" is seven **calendar** days
(`PlainDate.subtract`), never `7 × 86_400_000`.

### The reverse conversion is NOT offset arithmetic

The forward direction (instant → wall clock) is unambiguous. The reverse — *when
does this local date begin?* — is the hard one, and **offset math cannot express
it**, because **local 00:00 does not always exist**.

M8F.1 took the offset in a single pass and was an hour off on Jerusalem's two
transition days. The first M8H.2 attempt added a second pass, which fixed
Jerusalem — and was still **wrong for every zone that springs forward AT
midnight**. The exhaustive matrix caught it:

| Zone | Local date | Two-pass returned | Which is actually |
|---|---|---|---|
| America/Santiago | 2025-09-07 | `2025-09-07T03:00Z` | **2025-09-06 23:00** — the previous day |
| America/Havana | 2025-03-09 | `2025-03-09T04:00Z` | **2025-03-08 23:00** |
| America/Asuncion | 2025-10-05 | `2025-10-05T03:00Z` | **2025-10-04 23:00** |
| Atlantic/Azores | 2025-03-30 | `2025-03-30T00:00Z` | **2025-03-29 23:00** |

An hour of the *previous* day would have been counted, listed and exported under
the requested one. Piling on a third pass would not fix the class of bug, so the
conversion now delegates to a real timezone primitive:

> **`Temporal.PlainDate.from(date).toZonedDateTime(zone)`** — the TC39-specified
> **start of day**: the *first instant that belongs to that calendar date in that
> zone*. Not "midnight, disambiguated".

via **`@js-temporal/polyfill`** (the TC39 reference implementation; MIT/ISC, one
dependency, `npm audit` clean). It reads the platform's IANA data — the **same data
`Intl` formats with**, so display and filtering can never drift apart — and
hand-rolls no transition table.

**Semantics (explicit, not incidental):**

| Case | Behaviour |
|---|---|
| local 00:00 **does not exist** (DST gap) | → the **earliest instant that does** belong to the date (e.g. `01:00`). No business instant of that day is skipped. |
| local 00:00 is **ambiguous** (DST overlap) | → the **earlier** of the two instants, so the whole repeated hour is filed under the day it displays on. |
| range bounds | start-**inclusive** / next-day-start-**exclusive**, always. |

**It is `server-only`.** Date filtering is a server concern (the count, the page and
the export must agree), and the boundary keeps the polyfill out of the browser
bundle — verified: the client bundle contains no `Temporal`, no `js-temporal`, no
`tenantDayStartUtcIso`. The client only ever needs the forward direction, which is
plain `Intl`.

### Assumptions the code does NOT make

Every one of these is false for some selectable zone, and each is regression-tested:

| Tempting assumption | Reality |
|---|---|
| local 00:00 always exists | **6 zones** skip it in 2025–2028 (Africa/Cairo, America/Asuncion, America/Havana, America/Santiago, Asia/Beirut, Atlantic/Azores) |
| a DST step is one hour | **Australia/Lord_Howe** moves 30 min; **Antarctica/Troll** moves **two hours** |
| a local day is 23/24/25 h | **Antarctica/Troll** has a **22-hour** and a **26-hour** day |
| offsets are whole hours | **Asia/Kathmandu** +05:45, **Pacific/Chatham** +12:45/+13:45 |

## Database

**Migration:** `supabase/migrations/20260803100000_m8h2_tenant_timezone.sql` (additive).

1. **`public.tenants.timezone text NOT NULL DEFAULT 'Asia/Jerusalem'`** — the
   `DEFAULT` backfills every existing tenant. The value comes from the product's
   documented single market; it is **not inferred** from a tenant's name, address,
   locale, phone, IP or current UTC offset, and any tenant can be moved elsewhere.
2. **`_is_valid_timezone(text)`** (STABLE, `search_path=''`) + a **`BEFORE INSERT
   OR UPDATE OF timezone` trigger** (`SECURITY DEFINER`). The trigger is **required,
   not belt-and-braces**: `authenticated` holds a **direct `UPDATE` grant** on
   `tenants` (RLS-gated to owner/admin), so RPC-only validation could be bypassed by
   a direct table write. Validation is against `pg_catalog.pg_timezone_names`;
   invalid names, empty strings, NULL and bare offsets all raise **`22023`**. Both
   helpers are **private** — the default `PUBLIC EXECUTE` is revoked (see
   *Private database functions* below).
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

## Timezone options, and the ICU ⇄ PostgreSQL catalog difference

`TIME_ZONE_OPTIONS` = `['UTC', ...Intl.supportedValuesOf('timeZone')]` — **418**
canonical Region/City zones, computed **once per process on the server** and passed
to the control as a prop (no DB query, no browser API dependency, no secret).

Deliberately **not** `pg_timezone_names`: that has **1196** rows including **598
`posix/*` aliases** and `Factory` — an unusable picker.

But the picker's catalog (Node/**ICU**) and the validator's catalog
(PostgreSQL/**IANA**) are *two different timezone databases on two different release
cadences*. If ICU knew a zone Postgres didn't, the UI would advertise an option that
can never be saved. So that is a **gate**, not an assumption:

```
npm run check:timezone-catalog     # 418/418 accepted by public._is_valid_timezone
```

It asserts every offered name against the **real** database validator (not a copy of
its rules), plus: UTC present, no duplicates, no fixed offsets, no `posix/*`,
`right/*` or `Factory`. Local-stack only; no service_role; never hosted. Like
`supabase db lint` it needs Docker, so it runs in the pre-merge gate rather than CI.

**The one real difference found:** ECMA-402 hands us ICU's canonical spelling
**`Asia/Katmandu`**, while IANA/PostgreSQL prefer **`Asia/Kathmandu`**. They are the
same +05:45 zone and **both are accepted by the database** (pinned in pgTAP), so
nothing breaks — the picker simply shows ICU's spelling. Because a stored-but-not-
offered spelling is therefore possible, the control **always includes the tenant's
current zone in its list**, so an owner can never open Settings and fail to see
their own timezone.

The database stores only the IANA identifier; no translated label is persisted.

## Settings UI

On the existing **Business settings** route, which is already **owner/admin only**
(sales_rep is 404'd), so a rep never sees the control — and the RPC re-verifies
owner/admin server-side regardless. Searchable list, the current IANA identifier,
an **explicit Save** with loading / success / error states, `role="radiogroup"` +
`aria-checked` + a labelled search input, bidi-isolated (`dir="ltr"`) zone
identifiers, logical CSS only (RTL/LTR safe), ar/he/en. Fixed offsets are not offered.

### The device hint is browser-only, post-hydration, and non-authoritative

The control shows the viewer's own zone as a hint when it differs from the tenant's.
It is read through `useSyncExternalStore` whose **server snapshot is `null`**, so:

- the **server render inspects nothing** — no `resolvedOptions()` on the server;
- the server HTML and the first client render are **identical by construction**, so
  there is no hydration mismatch and **no `suppressHydrationWarning`** anywhere;
- the hint appears only **after hydration**, in the browser, where "your device"
  actually means something;
- if the runtime cannot resolve a zone, it stays `null` and **no hint renders** —
  never a broken node, never a guess;
- it **never** auto-selects and **never** auto-saves. The tenant's stored zone
  remains the authoritative selection, changed only by an explicit Save.

Computing it during render (the first attempt) would have resolved it on the
**server**, announcing the *server machine's* timezone as "your device" — the exact
server-zone leak this phase exists to remove. The identifier is wrapped in
`<bdi dir="ltr">` rather than interpolated raw, so it does not reorder inside an
Arabic/Hebrew sentence.

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

**The boundary matrix — `npm run test:timezone-matrix`.** The production conversion
is run over **every selectable timezone × every date in a four-year window**:

| | |
|---|---|
| Timezones | **418** (the entire catalog the UI can offer) |
| Date range | **2025-01-01 → 2028-12-31** (1,461 dates) |
| Cases | **610,698** |
| Failures | **0** |
| Runtime | **~105 s** |
| Shortest local day found | **22 h** (Antarctica/Troll, 2025-03-30) |
| Longest local day found | **26 h** (Antarctica/Troll, 2025-10-26) |
| Nonexistent local midnights found | **24**, across **6** zones |

For every zone/date it asserts: the start is a valid instant; the next day's start
is strictly later; **rendering the start back in the tenant zone returns the
requested date**; it is the **earliest** instant that does (one ms earlier is a
different date); the day's exclusive end **is** the next day's start, so the days
**tile the timeline with no gap and no overlap**; and the last millisecond of a day
still belongs to it. Plus: independence from `process.env.TZ`, independence from the
locale, determinism across repeated calls, and explicit pins for the non-hour zones
and the four zones the old math got wrong. **It runs in CI on every PR** — a
regression here silently mis-files orders in the list, the count and the export.

**The rest:**

- `npm test` → **413** app checks (incl. **48** `test:tenant-timezone`, the fast
  representative subset of the matrix, and **23** `test:inventory-time`).
- `npm run test:inventory-time` → **23/23**: the movements CSV carries the tenant
  wall clock (09:57Z → **12:57**, winter → 11:57, no `+00` under a localized "Date"
  header); the movements filter resolves every bound **server-side in the tenant
  zone** (23h/25h days, a date whose local midnight does not exist, start-inclusive
  / next-day-exclusive, immune to `process.env.TZ`, the device zone and the locale);
  the client sends **no instant** and reads **no clock**; the device hint has a
  **null server snapshot**, never auto-applies, and uses no `suppressHydrationWarning`.
- `npm run check:timezone-catalog` → **418/418** offered zones accepted by the
  database validator.
- `supabase test db` → **351** pgTAP (incl. **45** new: column + NOT NULL +
  backfill; table-level validation of valid/invalid/empty/NULL/fixed-offset;
  **private-helper privilege matrix**; RPC catalog + privileges; owner/admin
  allowed; sales_rep + non-member + cross-tenant refused; **the trigger still
  fires for a caller who cannot execute the validator**; ICU⇄pg catalog pins;
  **timestamps and origin unchanged**; `list_memberships` shape; no audit/RLS/
  producer regression; no row lost).
- `npm run lint`, `npx tsc --noEmit`, `npm run build` → clean; build ends
  `[check-dynamic-routes] OK`. `npm audit --omit=dev` → 0 vulnerabilities.
- `supabase db lint --schema public` → no schema errors.
- Generated types: `tenants.timezone`, `_is_valid_timezone`,
  `update_tenant_timezone`, and `list_memberships.timezone` — nothing else.
- Bundle scan → **0** for secrets, service-role, private helpers, tokens, snapshots
  — **and 0 for `Temporal` / `js-temporal` / `tenantDayStartUtcIso`**, proving the
  server-only boundary holds.

## Private database functions

| Function | Security | PUBLIC | anon | authenticated | service_role |
|---|---|---|---|---|---|
| `_is_valid_timezone(text)` | invoker | ✗ | ✗ | ✗ | ✗ |
| `_tenants_validate_timezone()` | **definer** | ✗ | ✗ | ✗ | ✗ |
| `update_tenant_timezone(uuid,text)` | definer | ✗ | ✗ | **✓** | ✗ |

PostgreSQL grants `EXECUTE` to `PUBLIC` on every new function **by default**, which
would have left both internal helpers callable by `anon`. They are revoked.

Two things make that safe, and both are pgTAP-asserted rather than assumed:

1. A trigger function's `EXECUTE` privilege is checked when the **trigger is
   created**, not each time it **fires** — so validation still runs for callers who
   cannot invoke it. *(Asserted: an authenticated owner gets `42501` calling
   `_is_valid_timezone` directly, yet a direct `UPDATE` of `+03:00` is still refused
   with `22023`, and a valid zone still saves.)*
2. `_tenants_validate_timezone` is **`SECURITY DEFINER`**, so its nested call to
   `_is_valid_timezone` runs as the owner. A `SECURITY INVOKER` trigger would run as
   the *calling* role and the revoke would have broken the legitimate owner/admin
   write — this is the reason for the definer, not incidental hardening.

## Known limitations

- Timezone-change auditing is deferred (see above).
- **Two** date-range filters exist today — **Orders** and **Inventory movements** —
  and both resolve their bounds server-side through the same boundary primitive, so
  any future filter inherits the correct semantics by using it.
- The option list follows the runtime's ICU data; a zone added to IANA after the
  Node build would not be *offered* until the runtime updates (the database would
  still accept it, and `check:timezone-catalog` would still pass — the gate protects
  against the dangerous direction: offering something the DB rejects).
- Correctness is proven for **2025–2028**. The conversion has no hardcoded
  transition data — it reads the platform's IANA database — so it is not *limited*
  to that window; that is simply the range under exhaustive test. Widen
  `FIRST_DATE`/`LAST_DATE` in `timezone-matrix.test.ts` to extend the proof.
- No timezone is intentionally excluded: the catalog is the runtime's full canonical
  set (minus `posix/*`, `right/*`, `Factory`, which are internal aliases, not places).

## Next

**M8H.3 — Order Timeline** consumes the M8H.1 audit rows and will render every
event through this tenant-timezone contract (which is precisely why it was
deferred to land after this foundation).

**Staging deployment order (when authorized):** this migration applies after
`20260802100000`; it is additive and needs no backfill beyond the column default.
