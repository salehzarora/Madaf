-- ═══════════════════════════════════════════════════════════════════════
-- Madaf M4D — enforce sales_rep customer scoping, owner transfer, stronger
--             anonymous-token rate limiting
--
-- M4C shipped the sales_rep_customers assignment table + management RPCs as a
-- FOUNDATION. M4D ENFORCES it:
--   * can_access_customer(tenant, customer) — owner/admin: any customer in
--     the tenant; sales_rep: only assigned customers.
--   * The customers SELECT policy is rep-scoped through that helper, so a rep
--     sees only assigned customers everywhere reads flow (lists, detail).
--   * create_order_request refuses a sales_rep order for an unassigned (or
--     absent) customer — owner/admin are unchanged; the token order flow
--     (SECURITY DEFINER, source='remote_customer') is untouched.
--
-- Owner transfer: promote_tenant_owner / demote_tenant_owner (owner-only,
-- tenant-scoped, last-owner protection; self-demotion allowed only if
-- another owner remains). Admin/sales_rep can never grant owner.
--
-- Rate limiting: a per-purpose GLOBAL failure counter is added alongside the
-- per-fingerprint one. It only ever blocks a fingerprint that has ALREADY
-- failed (so a valid token — which records no failures — is never blocked),
-- tightening repeat-offender blocking under aggregate abuse. Raw tokens/IPs
-- are still never stored (fingerprint only). Edge/IP limiting is infra work.
--
-- Preserves every prior guarantee: RLS not loosened, no direct table writes
-- re-enabled, no anon/public catalog, token_hash never member-readable,
-- SECURITY DEFINER search_path='', new grants locked.
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1. can_access_customer — the sales_rep scoping predicate ──────────────
-- owner/admin of the tenant → any customer; sales_rep → only assigned; a
-- non-member → false. SECURITY DEFINER so it can read tenant_users /
-- sales_rep_customers past their RLS; used by the customers policy AND the
-- order RPC (RLS does not apply inside SECURITY DEFINER order creation).
create or replace function public.can_access_customer(
  p_tenant_id uuid,
  p_customer_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if public.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.tenant_role[]) then
    return true;
  end if;
  return exists (
    select 1 from public.sales_rep_customers a
    where a.tenant_id = p_tenant_id
      and a.user_id = (select auth.uid())
      and a.customer_id = p_customer_id
  );
end;
$$;

comment on function public.can_access_customer(uuid, uuid) is
  'True when the caller may act on the given customer of the given tenant: owner/admin → any customer in the tenant; sales_rep → only customers assigned in sales_rep_customers. Basis of M4D sales_rep scoping (customers RLS + order creation).';

revoke all on function public.can_access_customer(uuid, uuid) from public, anon;
grant execute on function public.can_access_customer(uuid, uuid) to authenticated, service_role;

-- ── 2. Rep-scoped customers SELECT policy ────────────────────────────────
-- Replaces the M1.1 "any member reads all" policy. owner/admin still read
-- every customer in their tenant; a sales_rep reads ONLY assigned ones. No
-- new grants; direct writes stay blocked (M3B.1). The tokenized shop reads
-- customers via SECURITY DEFINER RPCs and is unaffected.
drop policy "customers: members can read" on public.customers;
create policy "customers: read (owner/admin all, rep assigned)"
  on public.customers for select to authenticated
  using (public.can_access_customer(tenant_id, id));

-- ── 3. Enforce sales_rep scoping in order creation ───────────────────────
create or replace function public.create_order_request(
  p_tenant_id uuid,
  p_items jsonb,
  p_customer_id uuid default null,
  p_notes text default null,
  p_source public.order_source default 'sales_visit'
)
returns table (order_id uuid, order_number text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  -- Tenant derived + role checked from membership (or service_role).
  v_tenant := public.authorize_tenant(
    p_tenant_id,
    array['owner', 'admin', 'sales_rep']::public.tenant_role[]);
  -- Token/remote sources may only be created by the token flow, not here.
  if p_source = 'remote_customer' then
    raise exception 'create_order_request: remote_customer orders come only from a shop link'
      using errcode = '22023';
  end if;
  -- M4D: a sales_rep may create orders ONLY for a customer assigned to them.
  -- owner/admin (and the trusted service_role) are unaffected. There is no
  -- fall-back to "all customers" for an unassigned rep.
  if public.has_tenant_role(v_tenant, array['sales_rep']::public.tenant_role[]) then
    if p_customer_id is null then
      raise exception 'create_order_request: a sales rep must order for an assigned customer'
        using errcode = '42501';
    end if;
    if not public.can_access_customer(v_tenant, p_customer_id) then
      raise exception 'create_order_request: customer is not assigned to this sales rep'
        using errcode = '42501';
    end if;
  end if;
  return query
    select * from public._order_create_core(
      v_tenant, p_items, p_customer_id, p_notes, coalesce(p_source, 'sales_visit'));
end;
$$;
revoke all on function public.create_order_request(uuid, jsonb, uuid, text, public.order_source) from public, anon;
grant execute on function public.create_order_request(uuid, jsonb, uuid, text, public.order_source) to authenticated, service_role;

-- ── 4. Owner transfer / promotion (owner only) ───────────────────────────
-- update_tenant_member_role handles admin↔sales_rep (and never grants owner /
-- never touches your own row). Owner transitions go through these two RPCs.

create or replace function public.promote_tenant_owner(
  p_tenant_id uuid,
  p_user_id uuid
)
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
    raise exception 'promote_tenant_owner: user is not a member of this tenant' using errcode = '22023';
  end if;
  if v_current = 'owner' then
    raise exception 'promote_tenant_owner: user is already an owner' using errcode = '22023';
  end if;
  update public.tenant_users set role = 'owner'
   where tenant_id = v_tenant and user_id = p_user_id;
end;
$$;
revoke all on function public.promote_tenant_owner(uuid, uuid) from public, anon;
grant execute on function public.promote_tenant_owner(uuid, uuid) to authenticated, service_role;

create or replace function public.demote_tenant_owner(
  p_tenant_id uuid,
  p_user_id uuid,
  p_new_role public.tenant_role
)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_tenant uuid;
  v_current public.tenant_role;
begin
  v_tenant := public.authorize_tenant(p_tenant_id, array['owner']::public.tenant_role[]);
  if p_new_role not in ('admin', 'sales_rep') then
    raise exception 'demote_tenant_owner: new role must be admin or sales_rep' using errcode = '22023';
  end if;
  select role into v_current from public.tenant_users
   where tenant_id = v_tenant and user_id = p_user_id;
  if not found then
    raise exception 'demote_tenant_owner: user is not a member of this tenant' using errcode = '22023';
  end if;
  if v_current <> 'owner' then
    raise exception 'demote_tenant_owner: user is not an owner' using errcode = '22023';
  end if;
  -- Last-owner protection — applies to self-demotion too (counts ALL owners,
  -- so demoting one is only allowed while another owner remains).
  if (select count(*) from public.tenant_users
      where tenant_id = v_tenant and role = 'owner') <= 1 then
    raise exception 'demote_tenant_owner: cannot demote the last owner' using errcode = '42501';
  end if;
  update public.tenant_users set role = p_new_role
   where tenant_id = v_tenant and user_id = p_user_id;
end;
$$;
revoke all on function public.demote_tenant_owner(uuid, uuid, public.tenant_role) from public, anon;
grant execute on function public.demote_tenant_owner(uuid, uuid, public.tenant_role) to authenticated, service_role;

-- ── 5. Stronger anonymous-token rate limiting ────────────────────────────
-- Record failures per fingerprint AND per a global (purpose, '*') counter —
-- '*' can never collide with a real 64-hex SHA-256 fingerprint. The global
-- limit only ever blocks a fingerprint that has ALREADY failed, so a valid
-- token (which records no failures) is never blocked by aggregate abuse.

create or replace function public._touch_token_attempt(p_purpose text, p_fingerprint text)
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
revoke all on function public._touch_token_attempt(text, text) from public, anon, authenticated;
grant execute on function public._touch_token_attempt(text, text) to service_role;

create or replace function public._record_token_failure(p_purpose text, p_fingerprint text)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
begin
  perform public._touch_token_attempt(p_purpose, p_fingerprint);
  -- Global per-purpose counter (sentinel fingerprint '*').
  perform public._touch_token_attempt(p_purpose, '*');
end;
$$;
revoke all on function public._record_token_failure(text, text) from public, anon, authenticated;
grant execute on function public._record_token_failure(text, text) to service_role;

create or replace function public._token_rate_exceeded(p_purpose text, p_fingerprint text)
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_fp_attempts integer;
  v_fp_window timestamptz;
  v_has_fp boolean;
  v_global_attempts integer;
  v_global_window timestamptz;
begin
  -- Per-fingerprint limit: 20 failures / 15 min.
  select attempts, window_start into v_fp_attempts, v_fp_window
  from public.token_access_attempts
  where purpose = p_purpose and fingerprint = p_fingerprint;
  v_has_fp := found and v_fp_window > now() - interval '15 minutes';
  if v_has_fp and v_fp_attempts >= 20 then
    return true;
  end if;
  -- Global per-purpose limit: 100 failures / 15 min, but ONLY blocks a
  -- fingerprint that has itself failed in-window — a valid token (no failure
  -- record) is never blocked by aggregate abuse.
  if v_has_fp then
    select attempts, window_start into v_global_attempts, v_global_window
    from public.token_access_attempts
    where purpose = p_purpose and fingerprint = '*';
    if found and v_global_window > now() - interval '15 minutes'
       and v_global_attempts >= 100 then
      return true;
    end if;
  end if;
  return false;
end;
$$;
revoke all on function public._token_rate_exceeded(text, text) from public, anon, authenticated;
grant execute on function public._token_rate_exceeded(text, text) to service_role;
