-- ═══════════════════════════════════════════════════════════════════════
-- PILOT-OPS-AUDIT-005 — SALES REP CUSTOMER ASSIGNMENT AUDIT (M8I.5)
--
-- Transactional audit for the two REAL assignment mutations (manual assign /
-- unassign), immediate DB-level closure of the removed/role-away stale-access
-- gap, and transactional lifecycle cleanup so a legacy assignment row can NEVER
-- silently reactivate.
--
-- WHAT IS AUDITED (closed 2-event vocabulary, entity_type='sales_rep_assignment',
-- entity_id = the affected customer_id):
--   sales_rep_assignment.created  — assign_customer_to_rep inserted a new pair.
--   sales_rep_assignment.removed  — a pair was deleted (manual unassign, or
--                                   lifecycle cleanup: member removal, role change
--                                   into/out of sales_rep, or membership rejoin).
-- source ∈ {manual, member_removed, role_changed, member_joined} (created is
-- always 'manual'). Each event carries rep_user_id + bounded rep_email + bounded
-- customer_name snapshots so the row stays legible after the member or customer
-- is gone. No token/JWT/session/PII beyond the two bounded snapshots.
--
-- STALE-ACCESS CLOSURE. can_access_customer / can_access_order now require, for a
-- sales_rep, BOTH a matching sales_rep_customers row AND a CURRENT tenant_users
-- membership with role='sales_rep' in the same tenant. A removed member, a member
-- whose role moved away from sales_rep, or a legacy orphan row therefore fails
-- closed immediately — no JWT/session refresh needed. owner/admin stay tenant-wide.
--
-- NO SILENT REACTIVATION. Any transition where sales_rep is on either side (exit
-- OR entry), any member removal, and any membership (re)join first PURGES the
-- target's assignments in the same transaction, emitting one removed event per
-- row, before the role/membership mutation and its single existing Team event.
--
-- GLOBAL LOCK ORDER (deadlock-free two-phase): authorize → lock the target's
-- tenant_users membership row (or the existing owner-set/target Team lock, or the
-- invitation row for a join) → lock affected customer rows ascending by
-- customer_id → mutate assignments → emit assignment events (ascending
-- customer_id) → mutate role/membership → emit the existing Team event last. No
-- operation locks a customer before its membership/invitation lock; customers are
-- always locked ascending; no advisory locks, no retries.
--
-- ADDITIVE: two private helpers + a redefinition of the two assignment RPCs, the
-- two access predicates, and the five lifecycle RPCs capable of a sales_rep
-- entry/exit/removal/join (signatures / return types / DEFINER / search_path /
-- grants / authorization / last-owner protection / error contracts PRESERVED) +
-- one additive sales_rep_assignment clause on the audit_events SELECT policy + one
-- partial index. No table/column drop, no bulk delete of existing assignment rows,
-- no backfill, no historical event, no row rewrite at migration time.
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1. Private Sales-Rep-Assignment audit helper ──────────────────────────
-- SECURITY INVOKER (like the customer/product/inventory/team/settings helpers):
-- callable only from the SECURITY DEFINER producers below; revoked from every
-- client role. Closed 2-event allowlist, entity_type='sales_rep_assignment',
-- actor auth.uid(), entity_id = the affected customer_id (required, non-null).
-- STRICT metadata: EXACTLY the four keys rep_user_id (uuid), rep_email
-- (lower/trimmed, 1..254), customer_name (trimmed, 1..200) and source (per-event
-- allowlist). Any missing / unknown / oversized / malformed value is rejected.
create function public._log_sales_rep_assignment_audit_event(
  p_tenant_id uuid,
  p_event_type text,
  p_entity_id uuid,
  p_metadata jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_meta jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_rep_user_id text;
  v_rep_email text;
  v_customer_name text;
  v_source text;
begin
  if p_tenant_id is null then
    raise exception '_log_sales_rep_assignment_audit_event: tenant is required' using errcode = '22023';
  end if;
  if p_entity_id is null then
    raise exception '_log_sales_rep_assignment_audit_event: entity id (customer) is required' using errcode = '22023';
  end if;

  if p_event_type not in ('sales_rep_assignment.created', 'sales_rep_assignment.removed') then
    raise exception '_log_sales_rep_assignment_audit_event: unknown event type %', p_event_type
      using errcode = '22023';
  end if;

  if jsonb_typeof(v_meta) <> 'object' then
    raise exception '_log_sales_rep_assignment_audit_event: metadata must be a JSON object' using errcode = '22023';
  end if;
  if length(v_meta::text) > 4000 then
    raise exception '_log_sales_rep_assignment_audit_event: metadata exceeds the size bound' using errcode = '22023';
  end if;

  -- EXACTLY the four required keys — no missing, no unknown extras.
  if (select count(*) from jsonb_object_keys(v_meta)) <> 4
     or not (v_meta ? 'rep_user_id') or not (v_meta ? 'rep_email')
     or not (v_meta ? 'customer_name') or not (v_meta ? 'source') then
    raise exception '_log_sales_rep_assignment_audit_event: metadata must contain exactly rep_user_id, rep_email, customer_name, source'
      using errcode = '22023';
  end if;

  -- rep_user_id: a JSON string that is a valid UUID (stable id; never rendered raw).
  if jsonb_typeof(v_meta -> 'rep_user_id') <> 'string' then
    raise exception '_log_sales_rep_assignment_audit_event: rep_user_id must be a string' using errcode = '22023';
  end if;
  v_rep_user_id := v_meta ->> 'rep_user_id';
  begin
    perform v_rep_user_id::uuid;
  exception when invalid_text_representation then
    raise exception '_log_sales_rep_assignment_audit_event: rep_user_id must be a UUID' using errcode = '22023';
  end;

  -- rep_email: a normalized, bounded, non-empty string (server snapshot).
  if jsonb_typeof(v_meta -> 'rep_email') <> 'string' then
    raise exception '_log_sales_rep_assignment_audit_event: rep_email must be a string' using errcode = '22023';
  end if;
  v_rep_email := v_meta ->> 'rep_email';
  if v_rep_email is null or char_length(v_rep_email) = 0 or char_length(v_rep_email) > 254
     or v_rep_email <> lower(btrim(v_rep_email)) then
    raise exception '_log_sales_rep_assignment_audit_event: rep_email must be lower/trimmed and 1..254 chars'
      using errcode = '22023';
  end if;

  -- customer_name: a trimmed, bounded, non-empty string (server snapshot).
  if jsonb_typeof(v_meta -> 'customer_name') <> 'string' then
    raise exception '_log_sales_rep_assignment_audit_event: customer_name must be a string' using errcode = '22023';
  end if;
  v_customer_name := v_meta ->> 'customer_name';
  if v_customer_name is null or char_length(btrim(v_customer_name)) = 0 or char_length(v_customer_name) > 200
     or v_customer_name <> btrim(v_customer_name) then
    raise exception '_log_sales_rep_assignment_audit_event: customer_name must be trimmed and 1..200 chars'
      using errcode = '22023';
  end if;

  -- source: per-event closed allowlist.
  if jsonb_typeof(v_meta -> 'source') <> 'string' then
    raise exception '_log_sales_rep_assignment_audit_event: source must be a string' using errcode = '22023';
  end if;
  v_source := v_meta ->> 'source';
  if p_event_type = 'sales_rep_assignment.created' then
    if v_source <> 'manual' then
      raise exception '_log_sales_rep_assignment_audit_event: created source must be manual' using errcode = '22023';
    end if;
  else
    if v_source not in ('manual', 'member_removed', 'role_changed', 'member_joined') then
      raise exception '_log_sales_rep_assignment_audit_event: removed source is not allowed: %', v_source
        using errcode = '22023';
    end if;
  end if;

  insert into public.audit_events
    (tenant_id, actor_user_id, event_type, entity_type, entity_id, metadata)
  values
    (p_tenant_id, (select auth.uid()), p_event_type, 'sales_rep_assignment', p_entity_id, v_meta);
end;
$$;

comment on function public._log_sales_rep_assignment_audit_event(uuid, text, uuid, jsonb) is
  'M8I.5 — PRIVATE transactional Sales-Rep-Assignment audit producer. Closed 2-event allowlist '
  '(sales_rep_assignment.created / removed), entity_type=sales_rep_assignment, entity_id=customer_id, '
  'actor=auth.uid(). Metadata is EXACTLY {rep_user_id (uuid), rep_email (lower/trimmed 1..254), '
  'customer_name (trimmed 1..200), source}; source is manual for created and manual|member_removed|'
  'role_changed|member_joined for removed. Callable only from the assignment/lifecycle RPCs.';

revoke all on function public._log_sales_rep_assignment_audit_event(uuid, text, uuid, jsonb)
  from public, anon, authenticated;

-- ── 2. Private assignment-purge helper (lifecycle cleanup) ─────────────────
-- Removes EVERY assignment for one (tenant, user), emitting one removed event per
-- deleted row, under the approved lock order: the caller already holds the target
-- membership / owner-set / invitation lock; this locks the affected customer rows
-- ascending by customer_id (phase B), then snapshots + deletes + logs ascending.
-- SECURITY INVOKER — it runs as the owner of the SECURITY DEFINER caller (so it
-- reads/writes sales_rep_customers / customers past RLS), and is revoked from every
-- client role. p_rep_email is the caller's authoritative auth.users snapshot; a
-- NULL/blank email fails the audit helper and rolls the whole operation back
-- (identity is never invented). No-op (no rows) → no events.
create function public._purge_rep_assignments(
  p_tenant_id uuid,
  p_user_id uuid,
  p_rep_email text,
  p_source text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row record;
begin
  -- Phase B: lock the affected customer rows ascending by id (deterministic).
  perform 1
  from public.customers c
  where c.tenant_id = p_tenant_id
    and c.id in (
      select a.customer_id from public.sales_rep_customers a
      where a.tenant_id = p_tenant_id and a.user_id = p_user_id
    )
  order by c.id
  for update;

  -- Snapshot + delete + emit one removed event per row, ascending by customer_id.
  for v_row in
    select a.customer_id as customer_id, c.name as customer_name
    from public.sales_rep_customers a
    join public.customers c on c.tenant_id = a.tenant_id and c.id = a.customer_id
    where a.tenant_id = p_tenant_id and a.user_id = p_user_id
    order by a.customer_id
  loop
    delete from public.sales_rep_customers
     where tenant_id = p_tenant_id and user_id = p_user_id and customer_id = v_row.customer_id;
    perform public._log_sales_rep_assignment_audit_event(
      p_tenant_id, 'sales_rep_assignment.removed', v_row.customer_id,
      jsonb_build_object(
        'rep_user_id', p_user_id,
        'rep_email', p_rep_email,
        'customer_name', left(btrim(v_row.customer_name), 200),
        'source', p_source));
  end loop;
end;
$$;

comment on function public._purge_rep_assignments(uuid, uuid, text, text) is
  'M8I.5 — PRIVATE lifecycle cleanup: delete ALL sales_rep_customers for one '
  '(tenant, user) under the caller''s held membership/invitation lock, locking '
  'affected customers ascending, emitting one sales_rep_assignment.removed per row '
  '(the given source). No-op → no events. Callable only from the DEFINER lifecycle RPCs.';

revoke all on function public._purge_rep_assignments(uuid, uuid, text, text)
  from public, anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- REDEFINE THE TWO ASSIGNMENT RPCs (signatures / void return / DEFINER /
-- search_path / grants / authorization / error contracts PRESERVED)
-- ═══════════════════════════════════════════════════════════════════════

-- ── 3a. assign_customer_to_rep → sales_rep_assignment.created ──────────────
-- Base: 20260707100000 (M4C). Adds the lock order (membership → customer),
-- authoritative snapshots, and one transactional created event ONLY when a new
-- row is inserted. Duplicate pair → ON CONFLICT DO NOTHING → no event, void return.
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
  v_role public.tenant_role;
  v_customer_name text;
  v_rep_email text;
  v_inserted boolean;
begin
  v_tenant := public.authorize_tenant(p_tenant_id, array['owner', 'admin']::public.tenant_role[]);

  -- Lock the target membership row FIRST and verify the role UNDER the lock.
  select tu.role into v_role from public.tenant_users tu
   where tu.tenant_id = v_tenant and tu.user_id = p_user_id
   for update;
  if not found or v_role <> 'sales_rep' then
    raise exception 'assign_customer_to_rep: target is not a sales_rep of this tenant'
      using errcode = '22023';
  end if;

  -- Then lock the customer row (serialization point + name snapshot).
  select c.name into v_customer_name from public.customers c
   where c.id = p_customer_id and c.tenant_id = v_tenant
   for update;
  if not found then
    raise exception 'assign_customer_to_rep: customer is unknown or belongs to another tenant'
      using errcode = '22023';
  end if;

  select lower(btrim(u.email::text)) into v_rep_email from auth.users u where u.id = p_user_id;

  insert into public.sales_rep_customers (tenant_id, user_id, customer_id, assigned_by)
  values (v_tenant, p_user_id, p_customer_id, (select auth.uid()))
  on conflict (tenant_id, user_id, customer_id) do nothing
  returning true into v_inserted;

  if coalesce(v_inserted, false) then
    perform public._log_sales_rep_assignment_audit_event(
      v_tenant, 'sales_rep_assignment.created', p_customer_id,
      jsonb_build_object(
        'rep_user_id', p_user_id,
        'rep_email', v_rep_email,
        'customer_name', left(btrim(v_customer_name), 200),
        'source', 'manual'));
  end if;
end;
$$;

comment on function public.assign_customer_to_rep(uuid, uuid, uuid) is
  'M4C/M8I.5: owner/admin assign a customer to a tenant sales_rep. Locks the target '
  'membership (role verified under lock) then the customer row, inserts the pair '
  '(ON CONFLICT DO NOTHING) and emits one transactional sales_rep_assignment.created '
  '(source=manual) ONLY when a new row is inserted. Duplicate → no event.';

revoke all on function public.assign_customer_to_rep(uuid, uuid, uuid) from public, anon;
grant execute on function public.assign_customer_to_rep(uuid, uuid, uuid) to authenticated, service_role;

-- ── 3b. unassign_customer_from_rep → sales_rep_assignment.removed ──────────
-- Base: 20260707100000 (M4C). Locks the membership row if present (no-op for a
-- legacy orphan), then the customer row, deletes the pair and emits one removed
-- event (source=manual) ONLY when a row was deleted. For an orphan (no membership)
-- the customer row is the serialization point and rep_email is resolved from
-- auth.users; a NULL email fails and rolls back rather than inventing an identity.
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
  v_customer_name text;
  v_rep_email text;
  v_deleted boolean;
begin
  v_tenant := public.authorize_tenant(p_tenant_id, array['owner', 'admin']::public.tenant_role[]);

  -- Lock the target membership row FIRST if it exists (orphan → locks nothing).
  perform 1 from public.tenant_users tu
   where tu.tenant_id = v_tenant and tu.user_id = p_user_id
   for update;

  -- Then lock the customer row (serialization point + name snapshot). A missing
  -- customer means no such assignment can exist (FK) → the delete is a no-op.
  select c.name into v_customer_name from public.customers c
   where c.id = p_customer_id and c.tenant_id = v_tenant
   for update;

  select lower(btrim(u.email::text)) into v_rep_email from auth.users u where u.id = p_user_id;

  delete from public.sales_rep_customers
   where tenant_id = v_tenant and user_id = p_user_id and customer_id = p_customer_id
   returning true into v_deleted;

  if coalesce(v_deleted, false) then
    if v_rep_email is null then
      raise exception 'unassign_customer_from_rep: cannot resolve the representative identity for the audit record'
        using errcode = '22023';
    end if;
    perform public._log_sales_rep_assignment_audit_event(
      v_tenant, 'sales_rep_assignment.removed', p_customer_id,
      jsonb_build_object(
        'rep_user_id', p_user_id,
        'rep_email', v_rep_email,
        'customer_name', left(btrim(v_customer_name), 200),
        'source', 'manual'));
  end if;
end;
$$;

comment on function public.unassign_customer_from_rep(uuid, uuid, uuid) is
  'M4C/M8I.5: owner/admin unassign a customer from a rep. Locks the membership row '
  'if present (no-op for a legacy orphan) then the customer row, deletes the pair '
  'and emits one transactional sales_rep_assignment.removed (source=manual) ONLY '
  'when a row was deleted. Missing pair → no event.';

revoke all on function public.unassign_customer_from_rep(uuid, uuid, uuid) from public, anon;
grant execute on function public.unassign_customer_from_rep(uuid, uuid, uuid) to authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════
-- HARDEN THE ACCESS PREDICATES — require CURRENT sales_rep membership
-- (signatures / return types / DEFINER / search_path / grants / owner-admin
-- behavior PRESERVED; the customers/orders/... SELECT policies are unchanged —
-- they keep calling these predicates)
-- ═══════════════════════════════════════════════════════════════════════

-- ── 4a. can_access_customer (M4D → M8I.5) ─────────────────────────────────
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
  -- A sales_rep needs BOTH a matching assignment AND a current sales_rep
  -- membership in the same tenant — a removed member / role-away member / legacy
  -- orphan row therefore fails closed immediately (no JWT refresh needed).
  return exists (
    select 1
    from public.sales_rep_customers a
    join public.tenant_users tu
      on tu.tenant_id = a.tenant_id
     and tu.user_id = a.user_id
    where a.tenant_id = p_tenant_id
      and a.user_id = (select auth.uid())
      and a.customer_id = p_customer_id
      and tu.role = 'sales_rep'
  );
end;
$$;

comment on function public.can_access_customer(uuid, uuid) is
  'True when the caller may act on the given customer of the given tenant: owner/admin '
  '→ any customer; sales_rep → only assigned customers AND only while a CURRENT '
  'tenant_users sales_rep membership exists (M8I.5 stale-access closure). Basis of '
  'the customers RLS + order creation.';

revoke all on function public.can_access_customer(uuid, uuid) from public, anon;
grant execute on function public.can_access_customer(uuid, uuid) to authenticated, service_role;

-- ── 4b. can_access_order (M4D.1 → M8I.5) ──────────────────────────────────
create or replace function public.can_access_order(
  p_tenant_id uuid,
  p_order_id uuid
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
    select 1
    from public.orders o
    join public.sales_rep_customers a
      on a.tenant_id = o.tenant_id
     and a.customer_id = o.customer_id
    join public.tenant_users tu
      on tu.tenant_id = a.tenant_id
     and tu.user_id = a.user_id
    where o.tenant_id = p_tenant_id
      and o.id = p_order_id
      and a.user_id = (select auth.uid())
      and tu.role = 'sales_rep'
  );
end;
$$;

comment on function public.can_access_order(uuid, uuid) is
  'True when the caller may READ the given order of the given tenant: owner/admin → '
  'any order; sales_rep → only orders whose customer is assigned to them AND only '
  'while a CURRENT tenant_users sales_rep membership exists (M8I.5 stale-access '
  'closure). Null-customer (walk-in) orders are owner/admin only. Basis of the '
  'orders/order_items/order_status_history/documents SELECT policies.';

revoke all on function public.can_access_order(uuid, uuid) from public, anon;
grant execute on function public.can_access_order(uuid, uuid) to authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════
-- REDEFINE THE FIVE LIFECYCLE RPCs capable of a sales_rep entry / exit /
-- removal / join. Each keeps its exact signature / return / DEFINER /
-- search_path / grants / authorization / last-owner protection / owner-set lock
-- / single existing Team event, and inserts the transactional assignment purge
-- (assignment removed events FIRST, ascending customer_id; the Team event LAST).
-- demote_tenant_owner is included because owner→sales_rep is a real entry.
-- ═══════════════════════════════════════════════════════════════════════

-- ── 5a. update_tenant_member_role (owner only) → team.role_changed ─────────
-- Base: 20260808100000 (M8I.3). Purges when sales_rep is on EITHER side of the
-- effective change (exit sales_rep→admin OR entry admin→sales_rep) → source
-- role_changed, before the UPDATE + the single team.role_changed.
create or replace function public.update_tenant_member_role(
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
  v_owner_count integer;
  v_email text;
begin
  v_tenant := public.authorize_tenant(p_tenant_id, array['owner']::public.tenant_role[]);
  if p_new_role not in ('admin', 'sales_rep') then
    raise exception 'update_tenant_member_role: role must be admin or sales_rep (owner transfer uses promote/demote)'
      using errcode = '22023';
  end if;
  if p_user_id = v_uid then
    raise exception 'update_tenant_member_role: you cannot change your own role' using errcode = '42501';
  end if;
  -- One consistent lock order across every owner-sensitive RPC.
  perform 1 from public.tenant_users
   where tenant_id = v_tenant and (role = 'owner' or user_id = p_user_id)
   order by user_id
   for update;
  select role into v_current from public.tenant_users
   where tenant_id = v_tenant and user_id = p_user_id;
  if not found then
    raise exception 'update_tenant_member_role: user is not a member of this tenant' using errcode = '22023';
  end if;
  -- No-op: the effective role does not change → no UPDATE, no event, no cleanup.
  if v_current = p_new_role then
    return;
  end if;
  -- Last-owner protection (demoting the only owner), from a fresh locked count.
  if v_current = 'owner' then
    select count(*) into v_owner_count from public.tenant_users
     where tenant_id = v_tenant and role = 'owner';
    if v_owner_count <= 1 then
      raise exception 'update_tenant_member_role: cannot demote the last owner' using errcode = '42501';
    end if;
  end if;
  select lower(btrim(u.email::text)) into v_email from auth.users u where u.id = p_user_id;
  -- Assignment cleanup when sales_rep is on either side (exit or entry).
  if v_current = 'sales_rep' or p_new_role = 'sales_rep' then
    perform public._purge_rep_assignments(v_tenant, p_user_id, v_email, 'role_changed');
  end if;
  update public.tenant_users set role = p_new_role
   where tenant_id = v_tenant and user_id = p_user_id;
  perform public._log_team_audit_event(
    v_tenant, 'team.role_changed', p_user_id,
    jsonb_build_object('target_email', v_email,
                       'from_role', v_current::text, 'to_role', p_new_role::text));
end;
$$;
revoke all on function public.update_tenant_member_role(uuid, uuid, public.tenant_role) from public, anon;
grant execute on function public.update_tenant_member_role(uuid, uuid, public.tenant_role) to authenticated, service_role;

-- ── 5b. remove_tenant_member (owner only) → team.member_removed ────────────
-- Base: 20260808100000 (M8I.3). Purges ALL of the removed user's assignments
-- (source member_removed) BEFORE the membership delete + the single
-- team.member_removed — catching current rep assignments AND any legacy orphans.
create or replace function public.remove_tenant_member(p_tenant_id uuid, p_user_id uuid)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_tenant uuid;
  v_current public.tenant_role;
  v_owner_count integer;
  v_email text;
begin
  v_tenant := public.authorize_tenant(p_tenant_id, array['owner']::public.tenant_role[]);
  perform 1 from public.tenant_users
   where tenant_id = v_tenant and (role = 'owner' or user_id = p_user_id)
   order by user_id
   for update;
  select role into v_current from public.tenant_users
   where tenant_id = v_tenant and user_id = p_user_id;
  if not found then
    raise exception 'remove_tenant_member: user is not a member of this tenant' using errcode = '22023';
  end if;
  if v_current = 'owner' then
    select count(*) into v_owner_count from public.tenant_users
     where tenant_id = v_tenant and role = 'owner';
    if v_owner_count <= 1 then
      raise exception 'remove_tenant_member: cannot remove the last owner' using errcode = '42501';
    end if;
  end if;
  -- Capture the authoritative snapshot BEFORE deleting (it is unrecoverable after).
  select lower(btrim(u.email::text)) into v_email from auth.users u where u.id = p_user_id;
  -- Assignment cleanup (member_removed) BEFORE the membership delete → no orphan.
  perform public._purge_rep_assignments(v_tenant, p_user_id, v_email, 'member_removed');
  delete from public.tenant_users where tenant_id = v_tenant and user_id = p_user_id;
  perform public._log_team_audit_event(
    v_tenant, 'team.member_removed', p_user_id,
    jsonb_build_object('target_email', v_email, 'role', v_current::text));
end;
$$;
revoke all on function public.remove_tenant_member(uuid, uuid) from public, anon;
grant execute on function public.remove_tenant_member(uuid, uuid) to authenticated, service_role;

-- ── 5c. promote_tenant_owner (owner only) → team.role_changed (to owner) ───
-- Base: 20260808100000 (M8I.3). sales_rep→owner is a sales_rep EXIT → purge
-- (source role_changed) before the UPDATE + the single team.role_changed.
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
  v_email text;
begin
  v_tenant := public.authorize_tenant(p_tenant_id, array['owner']::public.tenant_role[]);
  perform 1 from public.tenant_users
   where tenant_id = v_tenant and (role = 'owner' or user_id = p_user_id)
   order by user_id
   for update;
  select role into v_current from public.tenant_users
   where tenant_id = v_tenant and user_id = p_user_id;
  if not found then
    raise exception 'promote_tenant_owner: user is not a member of this tenant' using errcode = '22023';
  end if;
  if v_current = 'owner' then
    raise exception 'promote_tenant_owner: user is already an owner' using errcode = '22023';
  end if;
  select lower(btrim(u.email::text)) into v_email from auth.users u where u.id = p_user_id;
  if v_current = 'sales_rep' then
    perform public._purge_rep_assignments(v_tenant, p_user_id, v_email, 'role_changed');
  end if;
  update public.tenant_users set role = 'owner'
   where tenant_id = v_tenant and user_id = p_user_id;
  perform public._log_team_audit_event(
    v_tenant, 'team.role_changed', p_user_id,
    jsonb_build_object('target_email', v_email,
                       'from_role', v_current::text, 'to_role', 'owner'));
end;
$$;
revoke all on function public.promote_tenant_owner(uuid, uuid) from public, anon;
grant execute on function public.promote_tenant_owner(uuid, uuid) to authenticated, service_role;

-- ── 5d. demote_tenant_owner (owner only) → team.role_changed (from owner) ──
-- Base: 20260808100000 (M8I.3). owner→sales_rep is a sales_rep ENTRY → purge any
-- stale legacy rows (source role_changed) before the UPDATE + the single
-- team.role_changed, so a returning-to-sales_rep member starts with zero
-- inherited assignments.
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
  v_owner_count integer;
  v_email text;
begin
  v_tenant := public.authorize_tenant(p_tenant_id, array['owner']::public.tenant_role[]);
  if p_new_role not in ('admin', 'sales_rep') then
    raise exception 'demote_tenant_owner: new role must be admin or sales_rep' using errcode = '22023';
  end if;
  perform 1 from public.tenant_users
   where tenant_id = v_tenant and (role = 'owner' or user_id = p_user_id)
   order by user_id
   for update;
  select role into v_current from public.tenant_users
   where tenant_id = v_tenant and user_id = p_user_id;
  if not found then
    raise exception 'demote_tenant_owner: user is not a member of this tenant' using errcode = '22023';
  end if;
  if v_current <> 'owner' then
    raise exception 'demote_tenant_owner: user is not an owner' using errcode = '22023';
  end if;
  select count(*) into v_owner_count from public.tenant_users
   where tenant_id = v_tenant and role = 'owner';
  if v_owner_count <= 1 then
    raise exception 'demote_tenant_owner: cannot demote the last owner' using errcode = '42501';
  end if;
  select lower(btrim(u.email::text)) into v_email from auth.users u where u.id = p_user_id;
  if p_new_role = 'sales_rep' then
    perform public._purge_rep_assignments(v_tenant, p_user_id, v_email, 'role_changed');
  end if;
  update public.tenant_users set role = p_new_role
   where tenant_id = v_tenant and user_id = p_user_id;
  perform public._log_team_audit_event(
    v_tenant, 'team.role_changed', p_user_id,
    jsonb_build_object('target_email', v_email,
                       'from_role', 'owner', 'to_role', p_new_role::text));
end;
$$;
revoke all on function public.demote_tenant_owner(uuid, uuid, public.tenant_role) from public, anon;
grant execute on function public.demote_tenant_owner(uuid, uuid, public.tenant_role) to authenticated, service_role;

-- ── 5e. accept_tenant_invite → team.member_joined ─────────────────────────
-- Base: 20260808100000 (M8I.3). Under the existing invitation-row lock and after
-- the email match, purges any stale legacy assignments for the joining user
-- (source member_joined, regardless of invited role) BEFORE creating membership,
-- so a (re)joining member starts with zero inherited assignments and no created
-- event fires merely because the invited role is sales_rep. A failed/duplicate
-- acceptance rolls the cleanup + events back.
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
  select * into v_inv from public.tenant_invitations where token_hash = v_hash for update;
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

  -- Join cleanup: remove any stale legacy assignments for this (tenant, user)
  -- BEFORE creating membership (source member_joined). Uses the verified,
  -- normalized invitation email as the authoritative rep snapshot.
  perform public._purge_rep_assignments(v_inv.tenant_id, v_uid, lower(btrim(v_inv.email)), 'member_joined');

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

  -- The verified, normalized invitation email is the authoritative snapshot; it
  -- keeps the event legible even after the member is later removed.
  perform public._log_team_audit_event(
    v_inv.tenant_id, 'team.member_joined', v_uid,
    jsonb_build_object('target_email', v_inv.email, 'role', v_inv.role::text));

  return v_inv.tenant_id;
end;
$$;
revoke all on function public.accept_tenant_invite(text) from public, anon;
grant execute on function public.accept_tenant_invite(text) to authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════
-- AUDIT RLS + INDEX
-- ═══════════════════════════════════════════════════════════════════════

-- ── 6. audit_events SELECT policy — ADDITIVE sales_rep_assignment clause ───
-- The customer/order/product/inventory/team/settings clauses are reproduced
-- VERBATIM and a sales_rep_assignment clause is AND-ed on (owner/admin only).
-- Vacuous for other entity types; a sales_rep_assignment row additionally
-- requires owner/admin — a sales_rep never sees assignment activity, incl. its own.
drop policy if exists "audit_events: members read; entity rows scoped" on public.audit_events;

create policy "audit_events: members read; entity rows scoped"
  on public.audit_events
  for select
  to authenticated
  using (
    public.is_tenant_member(tenant_id)
    and (
      entity_type <> 'customer'
      or public.can_access_customer(tenant_id, entity_id)
    )
    and (
      entity_type <> 'order'
      or (entity_id is not null and public.can_access_order(tenant_id, entity_id))
    )
    and (
      entity_type <> 'product'
      or public.has_tenant_role(tenant_id, array['owner', 'admin']::public.tenant_role[])
    )
    and (
      entity_type <> 'inventory'
      or public.has_tenant_role(tenant_id, array['owner', 'admin']::public.tenant_role[])
    )
    and (
      entity_type <> 'team'
      or public.has_tenant_role(tenant_id, array['owner', 'admin']::public.tenant_role[])
    )
    and (
      entity_type <> 'settings'
      or public.has_tenant_role(tenant_id, array['owner', 'admin']::public.tenant_role[])
    )
    and (
      entity_type <> 'sales_rep_assignment'
      or public.has_tenant_role(tenant_id, array['owner', 'admin']::public.tenant_role[])
    )
  );

-- ── 7. Tenant-wide Assignment Timeline index (PARTIAL) ─────────────────────
-- Tenant-wide sales_rep_assignment stream. A partial index on (tenant_id,
-- created_at desc, id desc) WHERE entity_type='sales_rep_assignment' serves the
-- keyset read and, being partial, never competes for the per-entity audit reads.
-- No equivalent index exists.
create index audit_events_tenant_assignment_time_idx
  on public.audit_events (tenant_id, created_at desc, id desc)
  where entity_type = 'sales_rep_assignment';

comment on index public.audit_events_tenant_assignment_time_idx is
  'M8I.5 - partial index (entity_type=sales_rep_assignment) for the tenant-wide '
  'Assignment Activity read (created_at DESC, id DESC) as a keyset range scan; '
  'partial so it never competes for the per-entity audit timeline reads.';
