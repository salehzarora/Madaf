-- ═══════════════════════════════════════════════════════════════════════
-- PILOT-OPS-AUDIT-003 — TEAM & ACCESS AUDIT (M8I.3)
--
-- Transactional audit for the five REAL internal Team/Access mutations, a
-- bounded owner/admin Team Activity stream, honest post-removal target identity
-- via a normalized target_email snapshot, and proportional deterministic locking
-- that closes the accept-vs-revoke race and the last-owner concurrency race.
--
-- WHAT IS AUDITED (closed 5-event vocabulary, entity_type = 'team'):
--   team.member_invited     — a tenant_invitations row was inserted.
--   team.invitation_revoked — a pending invite really transitioned to revoked.
--   team.member_joined      — an invite was accepted (membership + accepted).
--   team.role_changed       — an effective role change (update/promote/demote).
--   team.member_removed      — a membership row was hard-deleted.
-- Every event stores ONE unified metadata key `target_email` (lower(trim), ≤254),
-- resolved INSIDE the producer from an authoritative source (never a caller
-- payload, never a new public parameter):
--   invited  → the normalized/validated invitation email used for the INSERT;
--   revoked  → email from the LOCKED invitation row;
--   joined   → email from the LOCKED invitation row (after email verification);
--   role     → auth.users.email for the LOCKED target membership;
--   removed  → auth.users.email captured BEFORE deleting the LOCKED membership.
-- Members always have an email (email-based auth + accept_tenant_invite's email
-- match invariant), so the snapshot always resolves — matching how
-- list_tenant_members / get_timeline_actor_labels_for_ids already read
-- auth.users.email inside SECURITY DEFINER.
--
-- SECRETS NEVER STORED: token / token_hash / token_preview / acceptance URL /
-- JWT / session / password / raw auth metadata / email body / backend error /
-- raw request. The helper's per-event key allowlist rejects anything else.
--
-- CONCURRENCY: accept_tenant_invite / revoke_tenant_invite lock the invitation
-- row FOR UPDATE (serialize accept-vs-revoke; re-revoke and duplicate accept
-- become clean no-ops). The four owner-sensitive RPCs acquire the SAME lock set
-- — this tenant's owner rows PLUS the target row — in ascending user_id order
-- (LockRows above Sort ⇒ locks are taken in sorted order), so a global lock
-- order prevents deadlock and two owners can never concurrently demote/remove
-- each other to zero owners. No aggregate count(*) FOR UPDATE, no retry loop.
--
-- SINGLE-WAREHOUSE / MULTI-TENANT: one tenant = one independent supplier. Team
-- state is per-tenant; cross-tenant reads/writes fail closed (RLS +
-- authorize_tenant). No branches, no multi-warehouse, no custom roles.
--
-- ADDITIVE: one private helper + a redefinition of the seven LATEST-effective
-- Team RPCs (M4B → M4C → M4D; signatures / return types / DEFINER / search_path
-- / grants / authorization / stable error semantics PRESERVED) + one additive
-- Team clause on the audit_events SELECT policy + one tenant-wide Team index. No
-- table/column change, no backfill, no historical event, no destructive SQL.
-- create_tenant_with_owner (platform onboarding) and all customer/order/product/
-- inventory producers are NOT touched.
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1. Private Team audit helper ──────────────────────────────────────────
-- SECURITY INVOKER (like the customer/order/product/inventory helpers): no
-- privileges of its own, executable by NO client role — reachable only from the
-- SECURITY DEFINER Team RPCs below (which run as the table owner and so may
-- insert). Closed 5-event allowlist, entity_type hardcoded to 'team', actor from
-- auth.uid(), metadata a bounded JSON object whose keys are allowlisted per event
-- type and whose values are shape/enum/normalization checked — so no
-- token/secret/PII-shaped or unnormalized value can ever be recorded.
create function public._log_team_audit_event(
  p_tenant_id uuid,
  p_event_type text,
  p_entity_id uuid,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_meta jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_allowed text[];
  v_key text;
  v_email text;
  v_role text;
begin
  if p_tenant_id is null then
    raise exception '_log_team_audit_event: tenant is required' using errcode = '22023';
  end if;
  if p_entity_id is null then
    raise exception '_log_team_audit_event: entity id is required' using errcode = '22023';
  end if;

  -- Closed allowlist — an unknown/typo'd type raises rather than silently
  -- becoming an "Other" event.
  if p_event_type not in (
    'team.member_invited', 'team.invitation_revoked', 'team.member_joined',
    'team.role_changed', 'team.member_removed'
  ) then
    raise exception '_log_team_audit_event: unknown team event type %', p_event_type
      using errcode = '22023';
  end if;

  -- Metadata must be a bounded JSON OBJECT (never an array/scalar/unbounded blob).
  if jsonb_typeof(v_meta) <> 'object' then
    raise exception '_log_team_audit_event: metadata must be a JSON object'
      using errcode = '22023';
  end if;
  if length(v_meta::text) > 4000 then
    raise exception '_log_team_audit_event: metadata exceeds the size bound'
      using errcode = '22023';
  end if;

  -- Per-event-type KEY allowlist. A token/hash/preview/url/jwt/session/... key is
  -- rejected outright (it is not on any allowlist).
  v_allowed := case p_event_type
    when 'team.role_changed' then array['target_email', 'from_role', 'to_role']
    else array['target_email', 'role']
  end;
  for v_key in select jsonb_object_keys(v_meta) loop
    if not (v_key = any (v_allowed)) then
      raise exception '_log_team_audit_event: metadata key % is not allowed for %',
        v_key, p_event_type using errcode = '22023';
    end if;
  end loop;

  -- target_email is REQUIRED on EVERY event and must be a normalized, bounded
  -- string (lower(trim), 3..254). This is the stable post-removal display value.
  if jsonb_typeof(v_meta -> 'target_email') <> 'string' then
    raise exception '_log_team_audit_event: target_email must be a string'
      using errcode = '22023';
  end if;
  v_email := v_meta ->> 'target_email';
  if v_email is null or char_length(v_email) < 3 or char_length(v_email) > 254
     or v_email <> lower(btrim(v_email)) then
    raise exception '_log_team_audit_event: target_email is missing or not normalized'
      using errcode = '22023';
  end if;

  -- Role enum validation for whichever role keys the event carries.
  if p_event_type = 'team.role_changed' then
    if jsonb_typeof(v_meta -> 'from_role') <> 'string'
       or jsonb_typeof(v_meta -> 'to_role') <> 'string' then
      raise exception '_log_team_audit_event: from_role/to_role must be strings'
        using errcode = '22023';
    end if;
    if (v_meta ->> 'from_role') not in ('owner', 'admin', 'sales_rep')
       or (v_meta ->> 'to_role') not in ('owner', 'admin', 'sales_rep') then
      raise exception '_log_team_audit_event: role values must be owner/admin/sales_rep'
        using errcode = '22023';
    end if;
  else
    if jsonb_typeof(v_meta -> 'role') <> 'string' then
      raise exception '_log_team_audit_event: role must be a string' using errcode = '22023';
    end if;
    v_role := v_meta ->> 'role';
    -- Invitations/joins carry only admin|sales_rep (owner is never invited);
    -- a removal may carry any current role, including owner.
    if p_event_type in ('team.member_invited', 'team.invitation_revoked', 'team.member_joined') then
      if v_role not in ('admin', 'sales_rep') then
        raise exception '_log_team_audit_event: invite/join role must be admin or sales_rep'
          using errcode = '22023';
      end if;
    else -- team.member_removed
      if v_role not in ('owner', 'admin', 'sales_rep') then
        raise exception '_log_team_audit_event: removed role must be owner/admin/sales_rep'
          using errcode = '22023';
      end if;
    end if;
  end if;

  insert into public.audit_events
    (tenant_id, actor_user_id, event_type, entity_type, entity_id, metadata)
  values
    (p_tenant_id, (select auth.uid()), p_event_type, 'team', p_entity_id, v_meta);
end;
$$;

comment on function public._log_team_audit_event(uuid, text, uuid, jsonb) is
  'M8I.3 — PRIVATE transactional Team/Access audit producer. Closed 5-event '
  'allowlist (team.member_invited/invitation_revoked/member_joined/role_changed/'
  'member_removed), entity_type=team, actor=auth.uid(), metadata a bounded JSON '
  'object with per-event allowlisted keys, an enum-checked role, and a normalized '
  '(lower/trim, <=254) target_email. Callable ONLY from the Team RPCs; no client '
  'role may execute it, and authenticated holds no INSERT on audit_events anyway.';

revoke all on function public._log_team_audit_event(uuid, text, uuid, jsonb)
  from public, anon, authenticated;

-- ── 2. audit_events SELECT policy — ADDITIVE Team clause ───────────────────
-- The customer / order / product / inventory clauses are reproduced VERBATIM and
-- a Team clause is AND-ed on. Each clause is vacuous for the other entity types,
-- so those rows behave EXACTLY as before; a 'team' row additionally requires
-- owner/admin — a sales_rep gets NO Team activity, at the DB, not just the UI.
-- Renamed to a concise identifier (well under 63 bytes) to avoid the truncation
-- the long M8I.2 name incurred.
drop policy if exists "audit_events: members read; customer/order/product/inventory rows scoped"
  on public.audit_events;

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
  );

-- ── 3. Tenant-wide Team Timeline index (PARTIAL) ───────────────────────────
-- The Team Activity stream is TENANT-WIDE (all entity_type='team' rows, mixed
-- entity_ids), unlike the per-entity customer/order/product/inventory reads. The
-- existing (tenant_id, entity_type, entity_id, created_at desc, id desc) index
-- cannot order the tenant-wide read (entity_id sits before created_at). A PARTIAL
-- index on (tenant_id, created_at desc, id desc) WHERE entity_type='team' serves
--   WHERE tenant_id=$1 AND entity_type='team' ORDER BY created_at DESC, id DESC
-- as a keyset range scan — and, being partial, it is NEVER a candidate for the
-- per-entity customer/order/product/inventory reads (their entity_type <> 'team'),
-- so it cannot perturb their existing index plans. Smaller than a full composite.
-- No equivalent index exists.
create index audit_events_tenant_type_time_idx
  on public.audit_events (tenant_id, created_at desc, id desc)
  where entity_type = 'team';

comment on index public.audit_events_tenant_type_time_idx is
  'M8I.3 - partial index (entity_type=team) supporting the tenant-wide Team '
  'Activity read ordered created_at DESC, id DESC as a keyset range scan; partial '
  'so it never competes for the per-entity audit timeline reads.';

-- ═══════════════════════════════════════════════════════════════════════
-- REDEFINE THE SEVEN LATEST-EFFECTIVE TEAM RPCs
-- Signatures / return types / DEFINER / search_path / grants / authorization /
-- validation / stable error semantics PRESERVED. Added: FOR UPDATE locking,
-- change/no-op gates, authoritative target_email resolution, and exactly-once
-- transactional audit.
-- ═══════════════════════════════════════════════════════════════════════

-- ── 3a. create_tenant_invite (owner/admin) → team.member_invited ───────────
-- Base: 20260707100000 (M4C). Unchanged behavior + one member_invited event.
create or replace function public.create_tenant_invite(
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
  -- One member_invited per successful invitation row (duplicate pending invites
  -- to the same email remain allowed and each has its own event).
  perform public._log_team_audit_event(
    v_tenant, 'team.member_invited', v_id,
    jsonb_build_object('target_email', v_email, 'role', p_role::text));
  return v_id;
end;
$$;
revoke all on function public.create_tenant_invite(uuid, text, public.tenant_role, text, text, timestamptz) from public, anon;
grant execute on function public.create_tenant_invite(uuid, text, public.tenant_role, text, text, timestamptz) to authenticated, service_role;

-- ── 3b. revoke_tenant_invite (owner/admin) → team.invitation_revoked ───────
-- Base: 20260707100000 (M4C). Lock the invitation row, then change-gate: only a
-- real pending→revoked transition mutates and emits. Re-revoke is an idempotent
-- no-op (no event); an accepted invite is still refused; behavior preserved.
create or replace function public.revoke_tenant_invite(p_tenant_id uuid, p_invite_id uuid)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_tenant uuid;
  v_inv public.tenant_invitations%rowtype;
begin
  v_tenant := public.authorize_tenant(p_tenant_id, array['owner', 'admin']::public.tenant_role[]);
  select * into v_inv
  from public.tenant_invitations i
  where i.id = p_invite_id and i.tenant_id = v_tenant
  for update;
  if not found then
    raise exception 'revoke_tenant_invite: invite is unknown or belongs to another tenant'
      using errcode = '22023';
  end if;
  if v_inv.accepted_at is not null then
    raise exception 'revoke_tenant_invite: invite is already accepted'
      using errcode = '22023';
  end if;
  -- Real transition only: a still-pending invite → revoked (+ one event). An
  -- already-revoked invite returns success with NO mutation and NO second event.
  if v_inv.revoked_at is null then
    update public.tenant_invitations i set revoked_at = now() where i.id = p_invite_id;
    perform public._log_team_audit_event(
      v_tenant, 'team.invitation_revoked', p_invite_id,
      jsonb_build_object('target_email', v_inv.email, 'role', v_inv.role::text));
  end if;
  return p_invite_id;
end;
$$;
revoke all on function public.revoke_tenant_invite(uuid, uuid) from public, anon;
grant execute on function public.revoke_tenant_invite(uuid, uuid) to authenticated, service_role;

-- ── 3c. accept_tenant_invite (authenticated; email-verified) → member_joined ─
-- Base: 20260707100000 (M4C). Lock the invitation row FOR UPDATE before checking
-- state, so accept serializes with a concurrent revoke and a duplicate accept
-- cannot double-join or double-log. Email match + membership insert + accepted
-- mark preserved; one member_joined on success.
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

-- ── 3d. update_tenant_member_role (owner only) → team.role_changed ─────────
-- Base: 20260707100000 (M4C). Deterministic lock (owner rows + target, ascending
-- user_id), reload the LOCKED target role, no-op guard, last-owner protection
-- from a fresh count under the lock, then one role_changed with an honest
-- from_role → to_role and the authoritative target email.
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
  -- No-op: the effective role does not change → no UPDATE, no event.
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

-- ── 3e. remove_tenant_member (owner only) → team.member_removed ────────────
-- Base: 20260707100000 (M4C). Deterministic lock, last-owner protection from a
-- fresh locked count, capture target email + role BEFORE the hard delete, then
-- one member_removed. Self-removal remains allowed only when another owner
-- remains (no self-guard, preserved).
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
  delete from public.tenant_users where tenant_id = v_tenant and user_id = p_user_id;
  perform public._log_team_audit_event(
    v_tenant, 'team.member_removed', p_user_id,
    jsonb_build_object('target_email', v_email, 'role', v_current::text));
end;
$$;
revoke all on function public.remove_tenant_member(uuid, uuid) from public, anon;
grant execute on function public.remove_tenant_member(uuid, uuid) to authenticated, service_role;

-- ── 3f. promote_tenant_owner (owner only) → team.role_changed (to owner) ───
-- Base: 20260708100000 (M4D). Deterministic lock, honest from_role from the
-- locked row, then one role_changed with to_role='owner' (a privileged grant).
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

-- ── 3g. demote_tenant_owner (owner only) → team.role_changed (from owner) ──
-- Base: 20260708100000 (M4D). Deterministic lock, last-owner protection from a
-- fresh locked count (self-demotion allowed only while another owner remains),
-- then one role_changed with from_role='owner'.
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
