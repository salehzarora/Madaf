-- ═══════════════════════════════════════════════════════════════════════
-- Madaf M4C — multi-tenant membership, tenant selection, sales_rep scoping
--             foundation, and anonymous-token rate limiting
--
-- M4A/M4B assumed ONE membership per user (unique(user_id) on tenant_users)
-- and derived the single tenant inside authorize_tenant. M4C supports a user
-- belonging to MULTIPLE tenants and switching between them:
--
--   1. Drop unique(user_id); the PK (tenant_id, user_id) still forbids a
--      duplicate membership in the SAME tenant.
--   2. authorize_tenant now VERIFIES the caller-named tenant is one of the
--      caller's own memberships with an allowed role — it no longer derives
--      a single tenant. The client still cannot pick a tenant they don't
--      belong to (that is the whole check), and the app passes the
--      membership-verified "selected tenant" cookie value.
--   3. The tenant-scoped team/link RPCs gain an explicit p_tenant_id (the
--      selected tenant), passed straight to authorize_tenant.
--   4. accept_tenant_invite lets a user join a SECOND tenant; a duplicate in
--      the same tenant is rejected cleanly.
--   5. list_memberships() feeds the tenant switcher.
--
-- Also: a sales_rep_customers assignment table + owner/admin RPCs
-- (foundation — enforcement in the read/order path is deferred to M4D), and
-- a minimal per-token-fingerprint rate limiter on the anonymous shop-token
-- endpoints (raw tokens are never stored; only the SHA-256 fingerprint).
--
-- Preserves every M4A/M4B guarantee: RLS unchanged, no direct table writes
-- re-enabled, no anon/public catalog, token_hash never member-readable, all
-- new tables grant-locked (no TRUNCATE/REFERENCES/TRIGGER/MAINTAIN for API
-- roles), SECURITY DEFINER with search_path=''.
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1. Multi-tenant membership ───────────────────────────────────────────
-- The PK (tenant_id, user_id) keeps memberships unique per tenant; drop the
-- one-tenant-per-user constraint added in M4A.
alter table public.tenant_users
  drop constraint if exists tenant_users_single_membership_uniq;

comment on table public.tenant_users is
  'Tenant memberships (role: owner/admin/sales_rep). A user MAY belong to multiple tenants (M4C); the PK (tenant_id, user_id) forbids duplicates within one tenant. READ-ONLY at the table level for authenticated (own rows + owner/admin roster). Writes go EXCLUSIVELY through create_tenant_with_owner (onboarding) and the M4B RPCs accept_tenant_invite / update_tenant_member_role / remove_tenant_member, which enforce owner/admin gates, valid roles, no self-promotion and last-owner protection.';

-- ── 2. authorize_tenant — verify caller-named tenant (multi-tenant) ───────
create or replace function public.authorize_tenant(
  p_tenant_id uuid,
  p_roles public.tenant_role[]
)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text := coalesce((select auth.jwt() ->> 'role'), '');
  v_uid uuid := (select auth.uid());
  v_member_role public.tenant_role;
begin
  -- Trusted service role (local-dev bootstrap / SECURITY DEFINER internals
  -- that pass an explicit tenant). Must still name an existing tenant.
  if v_role = 'service_role' then
    if p_tenant_id is null
       or not exists (select 1 from public.tenants t where t.id = p_tenant_id) then
      raise exception 'authorize_tenant: service role must pass an existing tenant'
        using errcode = '22023';
    end if;
    return p_tenant_id;
  end if;

  if v_uid is null then
    raise exception 'authorize_tenant: authentication required'
      using errcode = '42501';
  end if;

  -- M4C: the caller must NAME the tenant, and must be a member of THAT
  -- tenant with an allowed role. The tenant_id is never trusted — it is
  -- accepted ONLY when it matches one of the caller's own memberships.
  if p_tenant_id is null then
    raise exception 'authorize_tenant: a tenant must be specified'
      using errcode = '42501';
  end if;

  select tu.role into v_member_role
  from public.tenant_users tu
  where tu.user_id = v_uid and tu.tenant_id = p_tenant_id;
  if not found then
    raise exception 'authorize_tenant: caller is not a member of this tenant'
      using errcode = '42501';
  end if;

  if not (v_member_role = any (p_roles)) then
    raise exception 'authorize_tenant: role % is not permitted for this action', v_member_role
      using errcode = '42501';
  end if;

  return p_tenant_id;
end;
$$;

comment on function public.authorize_tenant(uuid, public.tenant_role[]) is
  'Verifies the caller is a member (with an allowed role) of the NAMED tenant and returns it; service_role passes an explicit existing tenant. Multi-tenant (M4C): the client-supplied tenant_id is accepted only if it matches one of the caller''s own memberships.';

revoke all on function public.authorize_tenant(uuid, public.tenant_role[]) from public, anon;
grant execute on function public.authorize_tenant(uuid, public.tenant_role[]) to authenticated, service_role;

-- ── 3. list_memberships — all of the caller's tenants (for the switcher) ──
create or replace function public.list_memberships()
returns table (
  tenant_id uuid,
  role public.tenant_role,
  name_ar text,
  name_he text,
  name_en text
)
language sql
stable
security definer
set search_path = ''
as $$
  select tu.tenant_id, tu.role, t.name_ar, t.name_he, t.name_en
  from public.tenant_users tu
  join public.tenants t on t.id = tu.tenant_id
  where tu.user_id = (select auth.uid())
  order by tu.created_at;
$$;

comment on function public.list_memberships() is
  'Every tenant the calling user belongs to (id, role, names) — powers the tenant switcher. Deterministic order by join time.';

revoke all on function public.list_memberships() from public, anon;
grant execute on function public.list_memberships() to authenticated, service_role;

-- ── 4. accept_tenant_invite — multi-tenant friendly ──────────────────────
-- A user may now accept invites to several tenants; the PK (tenant_id,
-- user_id) still rejects joining the SAME tenant twice (MDF07).
create or replace function public.accept_tenant_invite(p_token text)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_email text;
  v_hash text;
  v_inv public.tenant_invitations%rowtype;
begin
  if v_uid is null then
    raise exception 'accept_tenant_invite: authentication required' using errcode = '42501';
  end if;
  if p_token is null or length(p_token) < 16 then
    raise exception 'accept_tenant_invite: invalid token' using errcode = '22023';
  end if;
  v_hash := encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  select * into v_inv from public.tenant_invitations where token_hash = v_hash;
  if not found then
    raise exception 'invite not found' using errcode = 'MDF02';
  end if;
  if v_inv.revoked_at is not null then
    raise exception 'invite revoked' using errcode = 'MDF03';
  end if;
  if v_inv.accepted_at is not null then
    raise exception 'invite already accepted' using errcode = 'MDF05';
  end if;
  if v_inv.expires_at is not null and v_inv.expires_at <= now() then
    raise exception 'invite expired' using errcode = 'MDF04';
  end if;

  select lower(u.email::text) into v_email from auth.users u where u.id = v_uid;
  if v_email is null or v_email <> v_inv.email then
    raise exception 'accept_tenant_invite: this invite was issued to a different email'
      using errcode = 'MDF06';
  end if;

  begin
    insert into public.tenant_users (tenant_id, user_id, role)
    values (v_inv.tenant_id, v_uid, v_inv.role);
  exception when unique_violation then
    raise exception 'accept_tenant_invite: you are already a member of this tenant'
      using errcode = 'MDF07';
  end;

  update public.tenant_invitations
     set accepted_at = now(), accepted_by = v_uid
   where id = v_inv.id;

  return v_inv.tenant_id;
end;
$$;
revoke all on function public.accept_tenant_invite(text) from public, anon;
grant execute on function public.accept_tenant_invite(text) to authenticated, service_role;

-- ── 5. Tenant-scoped RPCs re-signed with an explicit selected tenant ─────
-- Each now takes p_tenant_id (the app's membership-verified selected tenant)
-- and passes it straight to authorize_tenant. Old (tenant-less) signatures
-- are dropped so only the multi-tenant-safe versions remain.

drop function if exists public.list_tenant_members();
create function public.list_tenant_members(p_tenant_id uuid)
returns table (user_id uuid, email text, role public.tenant_role, created_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  v_tenant := public.authorize_tenant(p_tenant_id, array['owner', 'admin']::public.tenant_role[]);
  return query
    select tu.user_id, u.email::text, tu.role, tu.created_at
    from public.tenant_users tu
    join auth.users u on u.id = tu.user_id
    where tu.tenant_id = v_tenant
    order by tu.created_at;
end;
$$;
revoke all on function public.list_tenant_members(uuid) from public, anon;
grant execute on function public.list_tenant_members(uuid) to authenticated, service_role;

drop function if exists public.create_tenant_invite(text, public.tenant_role, text, text, timestamptz);
create function public.create_tenant_invite(
  p_tenant_id uuid,
  p_email text,
  p_role public.tenant_role,
  p_token_hash text,
  p_token_preview text default null,
  p_expires_at timestamptz default null
)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_tenant uuid;
  v_email text := lower(nullif(trim(coalesce(p_email, '')), ''));
  v_id uuid;
begin
  v_tenant := public.authorize_tenant(p_tenant_id, array['owner', 'admin']::public.tenant_role[]);
  if p_role not in ('admin', 'sales_rep') then
    raise exception 'create_tenant_invite: role must be admin or sales_rep' using errcode = '22023';
  end if;
  if v_email is null or char_length(v_email) < 3 or char_length(v_email) > 254
     or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'create_tenant_invite: a valid email is required' using errcode = '22023';
  end if;
  if p_token_hash is null or length(p_token_hash) < 32 or length(p_token_hash) > 128 then
    raise exception 'create_tenant_invite: invalid token hash' using errcode = '22023';
  end if;
  insert into public.tenant_invitations
    (tenant_id, email, role, token_hash, token_preview, expires_at, invited_by)
  values
    (v_tenant, v_email, p_role, p_token_hash,
     nullif(trim(coalesce(p_token_preview, '')), ''),
     p_expires_at, (select auth.uid()))
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.create_tenant_invite(uuid, text, public.tenant_role, text, text, timestamptz) from public, anon;
grant execute on function public.create_tenant_invite(uuid, text, public.tenant_role, text, text, timestamptz) to authenticated, service_role;

drop function if exists public.revoke_tenant_invite(uuid);
create function public.revoke_tenant_invite(p_tenant_id uuid, p_invite_id uuid)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  v_tenant := public.authorize_tenant(p_tenant_id, array['owner', 'admin']::public.tenant_role[]);
  update public.tenant_invitations i
     set revoked_at = coalesce(i.revoked_at, now())
   where i.id = p_invite_id and i.tenant_id = v_tenant and i.accepted_at is null;
  if not found then
    raise exception 'revoke_tenant_invite: invite is unknown, already accepted, or belongs to another tenant'
      using errcode = '22023';
  end if;
  return p_invite_id;
end;
$$;
revoke all on function public.revoke_tenant_invite(uuid, uuid) from public, anon;
grant execute on function public.revoke_tenant_invite(uuid, uuid) to authenticated, service_role;

drop function if exists public.update_tenant_member_role(uuid, public.tenant_role);
create function public.update_tenant_member_role(
  p_tenant_id uuid,
  p_user_id uuid,
  p_new_role public.tenant_role
)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_tenant uuid;
  v_uid uuid := (select auth.uid());
  v_current public.tenant_role;
begin
  v_tenant := public.authorize_tenant(p_tenant_id, array['owner']::public.tenant_role[]);
  if p_new_role not in ('admin', 'sales_rep') then
    raise exception 'update_tenant_member_role: role must be admin or sales_rep (owner transfer is a future phase)'
      using errcode = '22023';
  end if;
  if p_user_id = v_uid then
    raise exception 'update_tenant_member_role: you cannot change your own role' using errcode = '42501';
  end if;
  select role into v_current from public.tenant_users
   where tenant_id = v_tenant and user_id = p_user_id;
  if not found then
    raise exception 'update_tenant_member_role: user is not a member of this tenant' using errcode = '22023';
  end if;
  if v_current = 'owner' and (
    select count(*) from public.tenant_users where tenant_id = v_tenant and role = 'owner'
  ) <= 1 then
    raise exception 'update_tenant_member_role: cannot demote the last owner' using errcode = '42501';
  end if;
  update public.tenant_users set role = p_new_role
   where tenant_id = v_tenant and user_id = p_user_id;
end;
$$;
revoke all on function public.update_tenant_member_role(uuid, uuid, public.tenant_role) from public, anon;
grant execute on function public.update_tenant_member_role(uuid, uuid, public.tenant_role) to authenticated, service_role;

drop function if exists public.remove_tenant_member(uuid);
create function public.remove_tenant_member(p_tenant_id uuid, p_user_id uuid)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_tenant uuid;
  v_current public.tenant_role;
begin
  v_tenant := public.authorize_tenant(p_tenant_id, array['owner']::public.tenant_role[]);
  select role into v_current from public.tenant_users
   where tenant_id = v_tenant and user_id = p_user_id;
  if not found then
    raise exception 'remove_tenant_member: user is not a member of this tenant' using errcode = '22023';
  end if;
  if v_current = 'owner' and (
    select count(*) from public.tenant_users where tenant_id = v_tenant and role = 'owner'
  ) <= 1 then
    raise exception 'remove_tenant_member: cannot remove the last owner' using errcode = '42501';
  end if;
  delete from public.tenant_users where tenant_id = v_tenant and user_id = p_user_id;
end;
$$;
revoke all on function public.remove_tenant_member(uuid, uuid) from public, anon;
grant execute on function public.remove_tenant_member(uuid, uuid) to authenticated, service_role;

drop function if exists public.insert_customer_access_link(uuid, text, text, text, timestamptz);
create function public.insert_customer_access_link(
  p_tenant_id uuid,
  p_customer_id uuid,
  p_token_hash text,
  p_token_preview text default null,
  p_label text default null,
  p_expires_at timestamptz default null
)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_tenant uuid;
  v_id uuid;
begin
  v_tenant := public.authorize_tenant(p_tenant_id, array['owner', 'admin']::public.tenant_role[]);
  if p_token_hash is null or length(p_token_hash) < 32 or length(p_token_hash) > 128 then
    raise exception 'insert_customer_access_link: invalid token hash' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.customers c where c.id = p_customer_id and c.tenant_id = v_tenant
  ) then
    raise exception 'insert_customer_access_link: customer is unknown or belongs to another tenant'
      using errcode = '22023';
  end if;
  insert into public.customer_access_links
    (tenant_id, customer_id, token_hash, token_preview, label, expires_at, created_by)
  values
    (v_tenant, p_customer_id, p_token_hash,
     nullif(trim(coalesce(p_token_preview, '')), ''),
     nullif(trim(coalesce(p_label, '')), ''),
     p_expires_at, (select auth.uid()))
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.insert_customer_access_link(uuid, uuid, text, text, text, timestamptz) from public, anon;
grant execute on function public.insert_customer_access_link(uuid, uuid, text, text, text, timestamptz) to authenticated, service_role;

drop function if exists public.revoke_customer_access_link(uuid);
create function public.revoke_customer_access_link(p_tenant_id uuid, p_link_id uuid)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  v_tenant := public.authorize_tenant(p_tenant_id, array['owner', 'admin']::public.tenant_role[]);
  update public.customer_access_links l
     set revoked_at = coalesce(l.revoked_at, now())
   where l.id = p_link_id and l.tenant_id = v_tenant;
  if not found then
    raise exception 'revoke_customer_access_link: link is unknown or belongs to another tenant'
      using errcode = '22023';
  end if;
  return p_link_id;
end;
$$;
revoke all on function public.revoke_customer_access_link(uuid, uuid) from public, anon;
grant execute on function public.revoke_customer_access_link(uuid, uuid) to authenticated, service_role;

-- ── 6. sales_rep_customers — assignment foundation (management only) ──────
-- Owner/admin assign customers to a sales_rep. M4C ships the table + locked
-- grants + management RPCs; ENFORCEMENT in the customer-read / order path is
-- deferred to M4D (documented) so the current order flow is not disturbed.
create table public.sales_rep_customers (
  tenant_id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  customer_id uuid not null,
  assigned_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id, customer_id),
  foreign key (tenant_id, customer_id)
    references public.customers (tenant_id, id) on delete cascade
);

comment on table public.sales_rep_customers is
  'Which customers a sales_rep is assigned to, per tenant. Management-only in M4C (owner/admin assign/unassign via RPC); read/order-path ENFORCEMENT is M4D. RLS: owner/admin read their tenant''s assignments, a rep reads its own. No direct writes.';

create index sales_rep_customers_tenant_user_idx
  on public.sales_rep_customers (tenant_id, user_id);

alter table public.sales_rep_customers enable row level security;

-- Locked exactly like the other M4 tables: anon nothing; authenticated a
-- column SELECT (all columns are non-sensitive ids/timestamps); no writes;
-- no TRUNCATE/REFERENCES/TRIGGER/MAINTAIN.
revoke all on public.sales_rep_customers from anon, authenticated;
revoke truncate, references, trigger, maintain
  on public.sales_rep_customers from anon, authenticated;
grant select (tenant_id, user_id, customer_id, assigned_by, created_at)
  on public.sales_rep_customers to authenticated;
grant select, insert, update, delete on public.sales_rep_customers to service_role;

create policy "sales_rep_customers: owner/admin read tenant, rep reads own"
  on public.sales_rep_customers for select to authenticated
  using (
    public.has_tenant_role(tenant_id, array['owner', 'admin']::public.tenant_role[])
    or user_id = (select auth.uid())
  );

create or replace function public.assign_customer_to_rep(
  p_tenant_id uuid,
  p_user_id uuid,
  p_customer_id uuid
)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  v_tenant := public.authorize_tenant(p_tenant_id, array['owner', 'admin']::public.tenant_role[]);
  -- Target must be a sales_rep member of this tenant.
  if not exists (
    select 1 from public.tenant_users tu
    where tu.tenant_id = v_tenant and tu.user_id = p_user_id and tu.role = 'sales_rep'
  ) then
    raise exception 'assign_customer_to_rep: target is not a sales_rep of this tenant'
      using errcode = '22023';
  end if;
  -- Customer must belong to this tenant.
  if not exists (
    select 1 from public.customers c where c.id = p_customer_id and c.tenant_id = v_tenant
  ) then
    raise exception 'assign_customer_to_rep: customer is unknown or belongs to another tenant'
      using errcode = '22023';
  end if;
  insert into public.sales_rep_customers (tenant_id, user_id, customer_id, assigned_by)
  values (v_tenant, p_user_id, p_customer_id, (select auth.uid()))
  on conflict (tenant_id, user_id, customer_id) do nothing;
end;
$$;
revoke all on function public.assign_customer_to_rep(uuid, uuid, uuid) from public, anon;
grant execute on function public.assign_customer_to_rep(uuid, uuid, uuid) to authenticated, service_role;

create or replace function public.unassign_customer_from_rep(
  p_tenant_id uuid,
  p_user_id uuid,
  p_customer_id uuid
)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  v_tenant := public.authorize_tenant(p_tenant_id, array['owner', 'admin']::public.tenant_role[]);
  delete from public.sales_rep_customers
   where tenant_id = v_tenant and user_id = p_user_id and customer_id = p_customer_id;
end;
$$;
revoke all on function public.unassign_customer_from_rep(uuid, uuid, uuid) from public, anon;
grant execute on function public.unassign_customer_from_rep(uuid, uuid, uuid) to authenticated, service_role;

create or replace function public.list_rep_assignments(p_tenant_id uuid)
returns table (user_id uuid, customer_id uuid, created_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  v_tenant := public.authorize_tenant(p_tenant_id, array['owner', 'admin']::public.tenant_role[]);
  return query
    select a.user_id, a.customer_id, a.created_at
    from public.sales_rep_customers a
    where a.tenant_id = v_tenant
    order by a.created_at;
end;
$$;
revoke all on function public.list_rep_assignments(uuid) from public, anon;
grant execute on function public.list_rep_assignments(uuid) to authenticated, service_role;

-- ── 7. token_access_attempts — minimal anon-token rate limiter ───────────
-- Counts FAILED resolutions per (purpose, token fingerprint) in a rolling
-- window. The fingerprint is the SHA-256 of the presented raw token — the
-- raw token is NEVER stored. No IP is stored (not reliably available in the
-- DB). Valid tokens never accumulate failures, so normal shop flow is never
-- blocked; hammering ONE bad/revoked token is. Global/IP limiting is M4D.
create table public.token_access_attempts (
  id bigint generated always as identity primary key,
  purpose text not null,
  fingerprint text not null,
  window_start timestamptz not null default now(),
  attempts integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (purpose, fingerprint)
);

comment on table public.token_access_attempts is
  'Rate-limit counters for anonymous shop-token endpoints. Keyed by (purpose, SHA-256 token fingerprint) — the raw token is never stored, no IP is stored. Written only by the SECURITY DEFINER token RPCs; no anon/authenticated access.';

-- Fully locked: no anon/authenticated access at all (server-side only).
alter table public.token_access_attempts enable row level security;
revoke all on public.token_access_attempts from anon, authenticated;
revoke truncate, references, trigger, maintain
  on public.token_access_attempts from anon, authenticated;
grant select, insert, update, delete on public.token_access_attempts to service_role;

-- Window + limit: at most 20 failed attempts per fingerprint per 15 minutes.
-- Returns TRUE when the caller is currently over the limit. (A boolean, not
-- a raise: the token endpoints must RETURN normally so the failure counter
-- they write actually commits — a raised exception would roll the whole call
-- back, counter included, and the limiter could never accumulate.)
create or replace function public._token_rate_exceeded(p_purpose text, p_fingerprint text)
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_attempts integer;
  v_window_start timestamptz;
begin
  select attempts, window_start into v_attempts, v_window_start
  from public.token_access_attempts
  where purpose = p_purpose and fingerprint = p_fingerprint;
  return found
     and v_window_start > now() - interval '15 minutes'
     and v_attempts >= 20;
end;
$$;
revoke all on function public._token_rate_exceeded(text, text) from public, anon, authenticated;
grant execute on function public._token_rate_exceeded(text, text) to service_role;

create or replace function public._record_token_failure(p_purpose text, p_fingerprint text)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
begin
  loop
    update public.token_access_attempts
       set attempts = case when window_start < now() - interval '15 minutes' then 1 else attempts + 1 end,
           window_start = case when window_start < now() - interval '15 minutes' then now() else window_start end,
           updated_at = now()
     where purpose = p_purpose and fingerprint = p_fingerprint;
    exit when found;
    begin
      insert into public.token_access_attempts (purpose, fingerprint)
      values (p_purpose, p_fingerprint);
      exit;
    exception when unique_violation then
      -- concurrent insert; loop back to the UPDATE branch
    end;
  end loop;
end;
$$;
revoke all on function public._record_token_failure(text, text) from public, anon, authenticated;
grant execute on function public._record_token_failure(text, text) to service_role;

-- ── 8. Wire the limiter into the anonymous token endpoints ───────────────
-- Only the token RESOLUTION is rate-limited (a valid token that then fails
-- for order-content reasons is NOT counted). Invite acceptance is NOT
-- rate-limited here — it requires an authenticated (attributable) caller.
create or replace function public.get_token_catalog(p_token text)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_tenant uuid;
  v_customer uuid;
  v_link uuid;
  v_result jsonb;
  v_fp text := encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex');
begin
  -- Over the failure limit for this token fingerprint → deny (null). The app
  -- shows the same neutral "link no longer valid" screen as any bad token.
  if public._token_rate_exceeded('shop_catalog', v_fp) then
    return null;
  end if;
  -- Resolve; on failure RECORD the attempt and RETURN NULL (a normal return
  -- so the counter write commits — re-raising would roll it back).
  begin
    select tenant_id, customer_id, link_id into v_tenant, v_customer, v_link
    from public._resolve_token(p_token);
  exception when others then
    perform public._record_token_failure('shop_catalog', v_fp);
    return null;
  end;

  update public.customer_access_links set last_used_at = now() where id = v_link;

  select jsonb_build_object(
    'tenant', (
      select jsonb_build_object('name_ar', t.name_ar, 'name_he', t.name_he, 'name_en', t.name_en)
      from public.tenants t where t.id = v_tenant
    ),
    'customer', (
      select jsonb_build_object('name', c.name, 'city_ar', c.city_ar, 'city_he', c.city_he, 'city_en', c.city_en)
      from public.customers c where c.id = v_customer
    ),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name_ar', c.name_ar, 'name_he', c.name_he, 'name_en', c.name_en,
        'icon', c.icon, 'color_hue', c.color_hue) order by c.sort_order)
      from public.categories c where c.tenant_id = v_tenant), '[]'::jsonb),
    'manufacturers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id, 'name_ar', m.name_ar, 'name_he', m.name_he, 'name_en', m.name_en,
        'logo_url', m.logo_url) order by m.sort_order)
      from public.manufacturers m where m.tenant_id = v_tenant), '[]'::jsonb),
    'products', coalesce((
      select jsonb_agg(row_to_json(pr)::jsonb order by pr.cat_sort, pr.sku)
      from (
        select p.id, p.sku, p.name_ar, p.name_he, p.name_en,
               p.description_ar, p.description_he, p.description_en,
               p.category_id, p.manufacturer_id, p.package_unit, p.package_quantity,
               p.base_unit, p.unit_size, p.wholesale_price, p.vat_rate,
               p.image_url, p.track_expiry,
               inv.quantity_available, inv.low_stock_threshold,
               coalesce(cat.sort_order, 99) as cat_sort
        from public.products p
        left join public.inventory_items inv
          on inv.tenant_id = p.tenant_id and inv.product_id = p.id
        left join public.categories cat on cat.id = p.category_id
        where p.tenant_id = v_tenant and p.is_active
      ) pr), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;
revoke all on function public.get_token_catalog(text) from public;
grant execute on function public.get_token_catalog(text) to anon, authenticated, service_role;

create or replace function public.create_order_request_from_token(
  p_token text,
  p_items jsonb,
  p_notes text default null
)
returns table (order_number text)
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_tenant uuid;
  v_customer uuid;
  v_link uuid;
  v_order_number text;
  v_fp text := encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex');
begin
  -- Over the limit → deny (no order row). App treats a null order as failure.
  if public._token_rate_exceeded('shop_order', v_fp) then
    return query select null::text;
    return;
  end if;
  -- Resolve; on failure RECORD + RETURN null-ish (normal return so the
  -- counter commits). Order-content errors below are NOT rate-limited.
  begin
    select tenant_id, customer_id, link_id into v_tenant, v_customer, v_link
    from public._resolve_token(p_token);
  exception when others then
    perform public._record_token_failure('shop_order', v_fp);
    return query select null::text;
    return;
  end;

  -- Token is valid past here; order-content errors are NOT rate-limited.
  select o.order_number into v_order_number
  from public._order_create_core(v_tenant, p_items, v_customer, p_notes, 'remote_customer') o;

  update public.customer_access_links set last_used_at = now() where id = v_link;
  return query select v_order_number;
end;
$$;
revoke all on function public.create_order_request_from_token(text, jsonb, text) from public;
grant execute on function public.create_order_request_from_token(text, jsonb, text) to anon, authenticated, service_role;
