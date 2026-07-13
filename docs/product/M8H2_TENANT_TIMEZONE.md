# M8H.2 — Tenant Timezone Foundation & Site-Wide Time Rendering

**Status:** implemented on `feature/m8h2-tenant-timezone` — **NOT merged, NOT
deployed, NOT staged; the migration has NOT been applied to hosted staging.**
Local-stack verified only. Corrected twice after review (a pre-merge review, then an
independent Codex review); both rounds are documented below rather than smoothed over.

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
| **Tenant timezone** | **`UTC`, or a Region/City IANA name** (`Asia/Jerusalem`), on `public.tenants.timezone` |
| **Fixed offsets & aliases** | **prohibited** — see below. `+03:00`, `UTC+2`, `-0500`, **`Etc/GMT±N`**, **`EST`/`HST`/`MST`**, `Factory`, `posix/*`, `right/*` are all rejected by the DB *and* the app. |
| **Locale** | independent of the timezone. Arabic UI + `Asia/Jerusalem` is normal. |
| **DST** | handled by the platform's IANA data. No offset table is hand-rolled. |
| **Browser timezone** | **never authoritative.** Shown only as a non-applied hint in Settings. |
| **Server machine timezone** | never used. |
| **Fallback** | a corrupt stored zone → **UTC**, logged (never the machine/device zone). |
| **Formatting** | one centralized, tested contract: `src/lib/time.ts`. |

## The stored-timezone contract: `UTC` or Region/City

Stated **positively**, not as a blocklist — a blocklist leaks, and *membership in
`pg_timezone_names` is not enough*. PostgreSQL recognizes every one of these:

| Recognized by PostgreSQL | Why it is still refused |
|---|---|
| `+03:00`, `UTC+2`, `-0500` | a bare offset cannot express DST at all |
| **`Etc/GMT+3`**, `Etc/GMT-2` | fixed-offset zones — **and POSIX-signed**: `Etc/GMT+3` is really **UTC−3**, so a tenant reaching for "+3" would run **six hours off**, permanently |
| **`EST`**, `HST`, `MST` | legacy abbreviations pinned to one offset — an `EST` tenant never observes DST |
| `Factory`, `posix/*`, `right/*` | internal / leap-second aliases; not places |

So the rule is: **`UTC`**, or **`Area/Location`** (multi-segment zones such as
`America/Argentina/La_Rioja` and hyphenated ones such as `America/Port-au-Prince`
included) that PostgreSQL knows. One predicate, three places — the picker filter,
the Server Action, and the database trigger — so the UI can never offer, and a
crafted call can never persist, a value the others would reject.

A real Region/City zone is **never** rejected merely for having no DST today
(`Africa/Abidjan` is fine): if its rules change, the IANA database carries the
change and we inherit it. That is the entire point of storing a *place*.

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
| **Dashboard today / month / trend** | `orders.created_at` | **UTC** (`toISOString().slice`, `createdAt.slice`) | `tenantToday` + `tenantDateKey` | server | n/a (grouping) |
| **Inventory expiry** (display) | `inventory_items.expiry_date` (**`date`**) | `formatDate` | **`formatDateOnly` — NO timezone** | client | — |
| **Inventory expiry** (anchor) | `expiry_date` vs "today" | **UTC** today | `tenantToday` — date-only, unshifted | server prop | — |

> **Two rounds of review found this phase half-done, twice.** The first pass migrated
> the movements *screen* but left its CSV on a raw UTC instant and its date *filter*
> on the browser's clock. The second (Codex) found that the filter re-resolved
> "today" on every paged request, that fixed-offset aliases (`Etc/GMT+3`, `EST`) were
> still storable, that impossible dates (`2026-02-30`) could turn a bounded query
> unbounded, and that the Dashboard and expiry horizon still grouped by **UTC** days.
> All are fixed here. The lesson is recorded rather than smoothed over: rendering a
> timestamp in the tenant's zone is not the same as *reasoning* in it.

## The tenant BUSINESS DAY (Dashboard + expiry)

Rendering a timestamp in the tenant's zone is only half the job. **Grouping** by day
or month is the other half, and the Dashboard was still asking in UTC:
`new Date().toISOString().slice(0, 10)` for "today", `.slice(0, 7)` for the month,
and `createdAt.slice(0, 10)` for the trend buckets.

Take **`2026-08-31T21:30:00Z`**. In `Asia/Jerusalem` that is **`2026-09-01`** — a
different day, a different **month**, and a different trend bar. So for the hours
between the tenant's midnight and UTC's, the KPI cards disagreed with the timestamps
printed immediately beside them: an order stamped *1 September, 00:30* was counted
under *31 August*, in *August's* month-to-date, in *yesterday's* bar.

`tenantDateKey(instant, zone)` (and `tenantMonthKey`) is the one business-day key.
It now backs **today's order count, today's value, month-to-date, the trend/sparkline
buckets** and the **inventory expiry anchor** — the last of which changed *only* its
anchor: `expiry_date` is a SQL `date` and stays date-only, compared as a calendar
ordinal, **never timezone-shifted** (that would move the day itself).

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

### Impossible dates fail CLOSED

`2026-02-30` is shaped exactly like a date and is not one — and every permissive
parser in the language *moves* it rather than refusing it (`Date.parse` accepts it;
`Date.UTC` balances it into March 2).

That was not cosmetic. The Orders parser used shape + `Date.parse`, so `?from=2026-02-30`
survived as an **active filter**; the converter then rejected the date and returned
`null` for that bound — and a **bounded** query silently became an **unbounded** one.
It did not return an error. It returned *every order ever*, and exported them.

So there is now **one** strict parser, `parseDateOnlyStrict` — exact `YYYY-MM-DD`,
a real Gregorian date, round-trip verified (so `2026-02-29` fails and `2028-02-29`
passes), reject-never-balance — and every date boundary path goes through it:

| Path | Behaviour on an impossible date |
|---|---|
| `tenantDateRangeUtc` | returns **`null`** — never a partial (and therefore wider) range |
| `nextCalendarDay` | returns **`null`** — never rolls `02-30` into March |
| Movements Server Action | **refuses the request** (`error: "invalid_date"`); does not query, does not export |
| Orders URL | enters the **`invalid`** state (see below) |
| Orders list / count / export | **refuse to run at all** |

#### `none`, `valid` and `invalid` are three different states

The first fix *cleared* the impossible dates — and that was still wrong, because it
made an invalid filter indistinguishable from **no filter**. The list, the exact
count and the export then ran as an ordinary unfiltered request: `?from=2026-02-30`
did not error and did not return nothing. It returned **every order**, and a
malformed *bounded* export became an **all-dates** export up to the cap.

`OrdersQuery` therefore carries an explicit discriminator:

| `dateFilter` | Meaning | What may query |
|---|---|---|
| `none` | no date params (or `?from=`, a cleared input) | everything — the legitimate unfiltered state |
| `valid` | every supplied date is real | everything, bounded |
| **`invalid`** | at least one supplied date is impossible | **nothing** |

- **The page** redirects to the canonical URL with only the date params removed —
  preserving search, statuses, source, customer and page size — **before any data
  query runs**. The redirected request is then an honest, explicit no-date request.
- **The export action** returns `{ ok: false, error: "invalid_date" }`: no query, no
  rows, no CSV, and the cap is never approached.
- **The query builders** (supabase *and* mock) **refuse** an `invalid` state rather
  than emitting a query with no date predicates. That is what makes this structural
  instead of a promise each caller has to remember.
- One bad bound poisons the **whole** filter. Keeping the valid half would widen a
  bounded request (`to` alone means "everything up to that day").

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
instant at all. `resolveMovementAnchors` resolves the preset against the tenant's
clock and delegates the boundary maths to the same `tenantDateRangeUtc`, so the
ledger inherits every DST property proven below — including the 22h/26h days and the
zones where local midnight does not exist. "7 days" is seven **calendar** days
(`PlainDate.subtract`), never `7 × 86_400_000`.

### The movements filter SESSION: closed, atomic, and timezone-bound

The ledger pages by **offset**, and its requests are async. Three separate things go
wrong unless one filtered result set is treated as one explicit **session**. All
three were found by review, in three successive rounds — the fix is not "pin the
lower bound", which is what the first two attempts did.

**1. The range must be CLOSED at both ends.** Pinning only `from` still leaves
`to = null`. Rows come back `created_at DESC`, so a movement recorded *after* tenant
midnight — a row belonging to the **next** business day — still matched the old
session's query and landed at the **front** of the set, pushing every existing row
one place later. Page 2's offset then re-read a row page 1 already showed: the client
de-duplicated it, which **silently skipped a real row**, and `hasMore` stopped
describing the set on screen. Every relative preset now resolves **both** anchors
against the tenant's clock at the moment the filter is applied:

| Preset | `from` | `to` |
|---|---|---|
| Today | tenant today | **tenant today** |
| 7 days | tenant today − 6 calendar days | **tenant today** |
| Month to date | 1st of the tenant's month | **tenant today** |
| Custom | the operator's validated date | the operator's validated date |
| All | *(none)* | *(none)* — the only genuinely unbounded state |

`to` becomes a **next-day-start exclusive** UTC bound, so tomorrow's rows cannot
enter. The label still says "Today"; the range underneath it does not move.

**2. The session must be ATOMIC — in the component, not just the reducer.** Clearing
only the anchors on a filter change left the old rows, the old `hasMore`, and an
offset derived from them — while **Export stayed enabled**, so an export fired in that
window paired the *new* filters with the *old* result set.

A correct reducer was **not enough**. The filter controls each held their own
`useState` and a **passive `useEffect`** noticed the change and invalidated the session
*afterwards* — so one **committed render** still carried the new filter value beside
the old rows, the old `hasMore` and an enabled Export.

Fixing the *selects* was still not enough: the **product-search box** kept its own
state and invalidated only when its 300ms debounce elapsed, so for a third of a second
the input read "Widget" over the previous session's rows, with **Export enabled**.
Every filter — search included — now lives in the same reducer and dispatches
`filters_changed` **synchronously in the event handler**. The search passes
`defer: true`, which postpones **only the network request**; the invalidation happens
on the keystroke. There is no render in which a visible control can disagree with the
displayed session.

While the request waits, the session is `debouncing`: rows gone, anchors gone,
timezone binding gone, Export and Load-more unavailable, and a pending state visible.
A **no-op** patch (retyping the same applied term) returns the existing state
untouched — so a healthy session is not needlessly torn down, and **no generation is
burned**. Generations are allocated **by the reducer**, only when a transition is
accepted, so the component's request generation and the reducer's session generation
cannot drift apart.

*(The mounted tests prove this by firing the event **without `act()`** and reading the
DOM in the same synchronous turn — `act()` flushes passive effects and would hide the
very window the bug lived in. Both were confirmed **falsifiable** by deliberately
reintroducing the defect.)*

Every transition goes through one reducer (`src/lib/movement-session.ts`), which the
component renders from and the tests drive directly:

```
filters_changed → generation++, rows [], hasMore false, anchors null, tz null
                  → Export DISABLED, Load-more unavailable, offset implicitly 0
                  (dispatched IN THE HANDLER, not a passive effect)
resolved(gen)   → rows, hasMore, from, to, timeZone  → Export enabled
page_loaded(gen)→ append; a short page ends the list
page_failed(gen)→ session and anchors SURVIVE — a retry pages the SAME range
resolve_failed  → no rows, no export → a RETRY control appears
session_stale   → rows dropped, anchors void → a RE-APPLY control appears
retry           → same filters, NEW generation, offset 0, no old anchors, no old tz
```

**Both dead-ends are actionable.** A stale session used to show an explanation and
nothing to press, and a failed one showed nothing at all — and re-selecting the
already-selected filter fires no change event, so the operator was stuck. `failed`
now renders a localized error with a **Retry** button; `stale` renders the timezone
explanation with a **Re-apply filter** button (both `role="alert"`, both real
keyboard-reachable `<button>`s, ar/he/en). Both restart through the same path: same
selected filters, new generation, **offset zero**, no old rows, no old anchors, no old
timezone binding — so pressing either twice cannot mix generations.

Every response carries the **generation** it was issued for, so a slow reply for a
superseded filter is dropped: it cannot restore rows, anchors, `hasMore`, or
Export-readiness. Export and load-more both re-send the session's **own** canonical
snapshot, its closed anchors and its timezone binding — so the file and the screen
describe the same query by construction.

**3. The session is BOUND to the timezone it was resolved under — for its QUERY *and*
for its RENDERING.** The anchors are tenant-*local* dates, so their UTC window depends
on the tenant's zone. If an owner changes the zone in another tab, the identical
anchors silently denote a **different** window.

*Query side:* the client echoes back the server-issued `resolvedTimeZone` as an
**expected-session value** — comparison only; the server always reads the
authoritative zone from the cached authenticated context, and the client's value never
selects or authorizes anything. If they differ the server **refuses**
(`timezone_changed`) without querying or exporting, the rows are dropped, and Re-apply
resolves a fresh session under the new zone.

*Render side:* this is where the first attempt still leaked. The rows and the CSV were
formatted with the **page's `timeZone` prop** — the zone the page happened to be
rendered with. After a zone change forced a new session, the rows came from a query the
server ran under the **new** zone but were printed under the **old** one. So the page
prop is now **bootstrap only**: it seeds the initial SSR session (which genuinely *is*
its zone) and is never consulted again. Every row and every CSV cell is formatted with
**`session.timeZone`** — the zone the server resolved *that* session under.

*And a success must be able to name that zone.* The result type was one
optional-everything shape, so a type-valid `ok: true` could arrive **without**
`resolvedTimeZone` — and the client fell back to the page prop (`?? timeZone`),
printing a UTC-resolved session's rows in Jerusalem. The result is now
**discriminated**: `ok: true` **requires** `movements`, `hasMore`, `resolvedFrom`,
`resolvedTo` and `resolvedTimeZone`; the error variants carry none of them. Compile-time
`@ts-expect-error` tests pin it.

TypeScript is not a runtime trust boundary, though — this reply crosses the network. So
the client **also** validates it: a success whose `resolvedTimeZone` is missing or
blank is **refused**. The rows are not shown, Export and Load-more stay disabled, the
session enters `failed` with a **Retry**, and it is logged (no payload, no secrets).
**There is no fallback anywhere.** A later page likewise may not *redefine* the
session's zone — if one answers under a different zone it does not belong to this
session, so the session goes stale rather than being silently re-bound.

**Exactly-50-row behaviour (retained).** A final page that happens to be exactly
`MOVEMENT_PAGE_SIZE` rows leaves `hasMore` true, costing one extra request that comes
back empty and ends the list. Harmless, long-standing, and deliberately preserved.

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

`TIME_ZONE_OPTIONS` = `UTC` + every canonical zone the runtime knows that satisfies
the stored contract — **418** — computed **once per process on the server** and
passed to the control as a prop (no DB query, no browser API dependency, no secret).

**It lives in `src/lib/time-catalog.ts`, which is `server-only`.** It used to sit in
`time.ts` beside the formatters — and the formatters are imported by a dozen client
components, so the catalog's `Intl.supportedValuesOf("timeZone")` IIFE was being
evaluated in **eight client chunks**, rebuilding a 418-entry array in every visitor's
browser to produce a list that exactly one server-rendered page ever needs, and only
as a prop. Splitting the module removed it from the bundle entirely (scanned: zero
occurrences of `supportedValuesOf` in client chunks) while the formatters stay
client-safe. The picker's filter is the **same predicate** the Server Action and the
database trigger apply, so it cannot offer a value the write path would reject.

Deliberately **not** `pg_timezone_names`: that has **1196** rows including **598
`posix/*` aliases**, `Factory`, `Etc/GMT±N` and the legacy abbreviations — an
unusable picker, and half of it is unstorable anyway.

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

- `npm test` → **481** unit checks **+ 30 mounted component checks** (it runs both).
- `npm run test:movements-table` → **30/30**, MOUNTING THE REAL `MovementsTable` in
  jsdom (no copy, no re-implementation) with the Server Actions supplied through the
  production injection seam and resolved by hand, so intermediate renders are
  observable. **Reducer tests alone let five integration defects through**, so these
  are not optional. They cover: the render committed *by the change event itself* —
  and, separately, *by the keystroke itself* — already has no old rows, no Load-more
  and no Export, with a pending state visible and **no request yet issued**; rapid
  typing issues exactly one request for the final term; clearing the search invalidates
  the same way; a **no-op** retype keeps the session and burns no generation; Export and
  Load-more are inert during the debounce; superseded responses (success *and* failure)
  cannot restore or destroy a newer session; a session resolved under **UTC** renders
  and exports **UTC**, not the Asia/Jerusalem page prop; a **malformed success with no
  `resolvedTimeZone` fails closed** (no rows, no fallback, Retry offered) — as does a
  blank one; a later page cannot redefine the session's zone; `timezone_changed` clears
  the rows and offers a working **Re-apply**; **Retry and Re-apply are keyboard-focusable
  and keyboard-activatable**; and Hebrew/Arabic render bidi-safe timestamps with
  logical-CSS-only layout.
  Three of these were **verified to be falsifiable** by deliberately reintroducing the
  defect (deferring the dispatch; deferring the *keystroke's* dispatch; restoring the
  `?? timeZone` fallback) and watching them fail.
- `npm run test:movement-session` → **30/30**, driving the **production reducer** and
  the **production Server Actions** (not a copy): closed Today/7d/month ranges, a
  next-day movement excluded, offsets stable across midnight, an atomic filter reset,
  a stale response ignored, Export gated and Export/list parity, later-page retry
  reusing the same anchors, a timezone-changed session invalidated rather than
  reinterpreted, and the real `exportOrdersAction` refusing an impossible date with
  no rows and no CSV while the real query builder *rejects* rather than running
  date-less.
- `npm run test:tenant-timezone` → **48/48** (the fast subset of the matrix).
- `npm run test:inventory-time` → **23/23**: the movements CSV carries the tenant
  wall clock (09:57Z → **12:57**, winter → 11:57, no `+00` under a localized "Date"
  header); the filter resolves every bound **server-side in the tenant zone**; the
  client sends **no instant** and reads **no clock**.
- `npm run test:strict-date` → **15/15**: `2026-02-30`, `2026-04-31`, `2026-02-29`
  and friends are **rejected**, `2028-02-29` is accepted; an impossible lower bound
  never becomes unbounded; an impossible upper bound never rolls; the Orders URL
  clears the whole date filter rather than half-applying it.
- `npm run test:tenant-business-day` → **23/23**: `2026-08-31T21:30Z` is
  **2026-09-01** for the tenant — Dashboard today, month-to-date, trend bucket and
  the expiry anchor all agree with it, and a UTC tenant still sees August 31;
  a movements session **anchored** before midnight pages and exports against the
  **same** range after it; fixed-offset aliases are unstorable; the catalog is
  server-only; the device hint has a **null server snapshot** and no
  `suppressHydrationWarning`.
- `npm run check:timezone-catalog` → **418/418** offered zones accepted by the
  database validator — verified again **after** the rule was tightened, so no
  legitimate option was lost.
- `supabase test db` → **368** pgTAP (incl. **62** for this phase: column + NOT NULL
  + backfill; table-level validation of valid/invalid/empty/NULL; **`Etc/GMT+3`,
  `Etc/GMT-2`, `EST`, `HST`, `MST`, `Factory`, `posix/*`, `right/*` and bare offsets
  all refused `22023` on BOTH the RPC and the direct-table path**, while
  multi-segment, hyphenated and no-DST Region/City zones still pass; **private-helper
  privilege matrix**; RPC catalog + privileges; owner/admin allowed; sales_rep +
  non-member + cross-tenant refused; **the trigger still fires for a caller who
  cannot execute the validator**; ICU⇄pg catalog pins; **timestamps and origin
  unchanged**; `list_memberships` shape; no audit/RLS/producer regression; no row
  lost).
- `npm run lint`, `npx tsc --noEmit`, `npm run build` → clean; build ends
  `[check-dynamic-routes] OK`. `npm audit --omit=dev` → 0 vulnerabilities.
- `supabase db lint --schema public` → no schema errors.
- Generated types: `tenants.timezone`, `_is_valid_timezone`,
  `update_tenant_timezone`, and `list_memberships.timezone` — nothing else.
- Bundle scan → **0** for secrets, service-role, private helpers, tokens, snapshots
  — **and 0 for `Temporal` / `js-temporal` / `tenantDayStartUtcIso` /
  `tenantDateRangeUtc` / `resolveMovementAnchors` / `supportedValuesOf` /
  `TIME_ZONE_OPTIONS`**, proving both server-only boundaries hold (the Temporal
  conversion and the timezone catalog).

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

- **Deferred performance debt (pre-existing, NOT introduced and NOT fixed here):**
  the Dashboard reads the tenant's **full order history** via `listOrders()` and
  aggregates it in memory. M8H.2 changed only how those orders are **bucketed** (UTC
  day → tenant day); it did not add, worsen, or remove the unbounded read. Bounding
  it needs a server-side aggregate (an RPC, as M8F.3 did for customer stats) and is
  out of scope for a timezone-correctness phase. Recorded here so it is not mistaken
  for something this phase created.
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
