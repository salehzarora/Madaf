-- ═══════════════════════════════════════════════════════════════════════
-- M8H.2 — Tenant TIMEZONE foundation
--
-- The database already stores absolute instants correctly (timestamptz = UTC).
-- Nothing here rewrites a single stored timestamp. What was missing is an
-- EXPLICIT per-tenant timezone for PRESENTATION and for tenant-local date
-- boundaries; until now the app formatted with the runtime's implicit timezone
-- and hard-coded 'Asia/Jerusalem' for order date filters.
--
-- This migration adds, additively:
--   1. public.tenants.timezone  text NOT NULL  — an IANA name (e.g. Asia/Jerusalem)
--      Existing rows backfill to the approved initial value for this
--      Israel-focused product. NOT a fixed offset: '+03:00' is rejected, because
--      an offset cannot express DST (Asia/Jerusalem is +02:00 in winter and
--      +03:00 in summer — a stored offset would silently break twice a year).
--   2. _is_valid_timezone(text) + a BEFORE INSERT OR UPDATE OF timezone TRIGGER
--      validating against pg_catalog.pg_timezone_names. The trigger is REQUIRED
--      (not just RPC validation) because `authenticated` holds a direct UPDATE
--      grant on tenants (RLS-gated to owner/admin) — so an invalid timezone could
--      otherwise reach the column through a direct table write.
--   3. update_tenant_timezone(p_tenant_id, p_timezone) — the authoritative,
--      owner/admin-gated write path (authorize_tenant; the client-supplied tenant
--      never self-authorizes; sales_rep and anon are denied).
--   4. list_memberships() gains `timezone`, so the tenant timezone arrives with
--      the read context that ALREADY runs once per request — zero extra queries,
--      no N+1, and it can never be sourced from the browser.
--
-- NOT done here: no timestamp is modified; no session/database timezone is set;
-- no audit producer, audit RLS, order status, inventory, storage or index is
-- touched; no historical backfill beyond populating the new column.
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1. The column ─────────────────────────────────────────────────────────
-- The DEFAULT backfills every existing tenant (and future onboarding, which does
-- not yet ask for a timezone) with the approved initial value. It is derived from
-- the product's documented single market — NOT inferred from a tenant's name,
-- address, locale, phone, browser, IP or current UTC offset. Any tenant can be
-- moved to another region afterwards through update_tenant_timezone.
alter table public.tenants
  add column timezone text not null default 'Asia/Jerusalem';

comment on column public.tenants.timezone is
  'M8H.2 — IANA timezone name (e.g. Asia/Jerusalem) used for ALL business-facing '
  'time rendering and tenant-local date boundaries. Never a fixed UTC offset: an '
  'offset cannot express DST. Stored timestamps remain absolute UTC instants; '
  'changing this value changes only how they are DISPLAYED.';

-- ── 2. Validation: the STORED-TIMEZONE CONTRACT, enforced at the TABLE ─────
--
-- A tenant timezone is 'UTC', or a Region/City IANA identifier. Nothing else.
--
-- Stated POSITIVELY, because the things that must be refused are open-ended and a
-- blocklist would leak. PostgreSQL RECOGNIZES all of the following — every one of
-- them is in pg_timezone_names, and every one of them breaks the DST contract:
--
--   '+03:00', 'UTC+2', '-0500'   bare offsets — cannot express DST at all
--   'Etc/GMT+3', 'Etc/GMT-2'     fixed-offset zones. Worse, they are POSIX-SIGNED:
--                                'Etc/GMT+3' is actually UTC MINUS 3 — a tenant
--                                picking it would silently run 6 hours off.
--   'EST', 'HST', 'MST'          legacy abbreviations pinned to one offset, so a
--                                US tenant on 'EST' never observes DST.
--   'Factory', 'posix/*', 'right/*'  internal/leap-second aliases, not places.
--
-- The rule below therefore requires an Area/Location shape (multi-segment zones
-- such as 'America/Argentina/La_Rioja' included) and excludes the fixed-offset and
-- alias namespaces. A REAL Region/City zone is never rejected merely for having no
-- DST today — if its rules change, the IANA database carries the change and we
-- inherit it, which is the entire point of storing a place instead of an offset.
create function public._is_valid_timezone(p_timezone text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_timezone is not null
     and p_timezone <> ''
     and (
       p_timezone = 'UTC'
       or (
         -- Area/Location, one or more segments: letters, digits, '_' and '-' only.
         -- No '/' at all ⇒ a legacy abbreviation (EST/HST/MST/Factory/GMT). A '+'
         -- can only occur in a fixed-offset name (Etc/GMT+3); no city has one.
         p_timezone ~ '^[A-Za-z][A-Za-z0-9_-]*(/[A-Za-z0-9_-]+)+$'
         -- …and the fixed-offset / alias namespaces are not places.
         and p_timezone !~* '^(posix|right|Etc|SystemV|US|Brazil|Canada|Chile|Mexico)/'
       )
     )
     -- Final authority: PostgreSQL's own timezone database must know it.
     and exists (
       select 1 from pg_catalog.pg_timezone_names z where z.name = p_timezone
     );
$$;

comment on function public._is_valid_timezone(text) is
  'M8H.2 — the STORED-TIMEZONE CONTRACT: true only for ''UTC'' or a Region/City '
  'IANA name PostgreSQL recognizes. Bare offsets (+03:00), fixed-offset zones '
  '(Etc/GMT+3 — POSIX-signed, so it is really UTC-3), legacy abbreviations '
  '(EST/HST/MST), Factory and posix/right aliases are all REJECTED: none of them '
  'can express daylight saving. A real Region/City zone is never rejected merely '
  'for having no DST today.';

-- SECURITY DEFINER so the nested _is_valid_timezone call runs as the function
-- OWNER. That is what lets both helpers be fully private (see the revokes below):
-- a SECURITY INVOKER trigger would execute as the calling role, and revoking
-- EXECUTE on _is_valid_timezone would then break the legitimate owner/admin write.
-- It is safe to define: it reads NEW.timezone, writes nothing, and returns or raises.
create function public._tenants_validate_timezone()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public._is_valid_timezone(new.timezone) then
    raise exception
      'tenants.timezone: % is not a recognized IANA timezone name (e.g. Asia/Jerusalem)',
      coalesce(new.timezone, '<null>')
      using errcode = '22023';
  end if;
  return new;
end;
$$;

-- Fires on INSERT and on any UPDATE that touches timezone, so NO write path —
-- RPC, direct table UPDATE under RLS, or seed — can persist an invalid value.
create trigger tenants_validate_timezone
  before insert or update of timezone on public.tenants
  for each row execute function public._tenants_validate_timezone();

-- Both helpers are PRIVATE. PostgreSQL grants EXECUTE to PUBLIC on every new
-- function by default, which would let anon and any authenticated user call them
-- directly — needless reachable surface (and _is_valid_timezone probes
-- pg_timezone_names). No application role ever calls either one:
--   • _is_valid_timezone runs inside the trigger function and inside
--     update_tenant_timezone, BOTH of which are SECURITY DEFINER → owner rights.
--   • a trigger function's EXECUTE privilege is checked when the TRIGGER IS
--     CREATED, not each time it fires, so the trigger keeps working for every role.
-- service_role gets no grant either: it has no reason to call an internal helper.
revoke all on function public._is_valid_timezone(text) from public, anon, authenticated;
revoke all on function public._tenants_validate_timezone() from public, anon, authenticated;

-- ── 3. The authoritative write path ───────────────────────────────────────
-- Mirrors update_tenant_profile exactly: SECURITY DEFINER, empty search_path,
-- authorize_tenant(owner/admin) so p_tenant_id NEVER self-authorizes, 22023 on a
-- bad value. It accepts ONLY the timezone — no other tenant field is writable
-- through it. update_tenant_profile is left completely untouched.
create function public.update_tenant_timezone(
  p_tenant_id uuid,
  p_timezone text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_tz text := btrim(coalesce(p_timezone, ''));
begin
  v_tenant := public.authorize_tenant(
    p_tenant_id, array['owner', 'admin']::public.tenant_role[]);

  if not public._is_valid_timezone(v_tz) then
    raise exception
      'update_tenant_timezone: % is not a recognized IANA timezone name', coalesce(nullif(v_tz, ''), '<empty>')
      using errcode = '22023';
  end if;

  update public.tenants
     set timezone = v_tz, updated_at = now()
   where id = v_tenant;

  return v_tz;
end;
$$;

comment on function public.update_tenant_timezone(uuid, text) is
  'M8H.2 — owner/admin-only tenant timezone update (authorize_tenant). Accepts an '
  'IANA name only; rejects fixed offsets. Changes DISPLAY + future tenant-local '
  'date boundaries — never a stored timestamp.';

revoke all on function public.update_tenant_timezone(uuid, text) from public, anon;
grant execute on function public.update_tenant_timezone(uuid, text) to authenticated;

-- ── 4. Carry the timezone on the EXISTING read context ────────────────────
-- list_memberships() already runs exactly once per request (React-cached session
-- context) and already joins tenants. Returning the timezone here means the app
-- never issues an extra tenant query, never an N+1, and can never take the
-- timezone from the browser. A return-type change requires DROP + CREATE; the
-- name, argument list (none), security mode, search_path and grants are all
-- preserved. Rows stay scoped to the CALLER's own memberships (no cross-tenant
-- leak).
drop function if exists public.list_memberships();

create function public.list_memberships()
returns table (
  tenant_id uuid,
  role public.tenant_role,
  name_ar text,
  name_he text,
  name_en text,
  timezone text
)
language sql
stable
security definer
set search_path = ''
as $$
  select tu.tenant_id, tu.role, t.name_ar, t.name_he, t.name_en, t.timezone
  from public.tenant_users tu
  join public.tenants t on t.id = tu.tenant_id
  where tu.user_id = (select auth.uid())
  order by tu.created_at;
$$;

comment on function public.list_memberships() is
  'The caller''s tenant memberships (+ the tenant display name and M8H.2 IANA '
  'timezone). Scoped to auth.uid(); no cross-tenant rows.';

revoke all on function public.list_memberships() from public, anon;
grant execute on function public.list_memberships() to authenticated, service_role;
