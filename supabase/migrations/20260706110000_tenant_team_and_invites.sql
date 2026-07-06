-- ═══════════════════════════════════════════════════════════════════════
-- Madaf M4B — tenant team management: invitations + membership RPCs
--
-- M4A shipped auth + roles but left tenant_users writable DIRECTLY by
-- authenticated owner/admin (M1.1 policies), with NO last-owner protection
-- (the M1.1 comment explicitly deferred it to "M4") and no server-side
-- validation — an owner could demote/remove the last owner and orphan the
-- tenant, and role changes were unvalidated raw table writes.
--
-- This migration:
--   1. LOCKS tenant_users writes (drop the direct insert/update/delete
--      policies + revoke the grants) — memberships now change ONLY through
--      validated SECURITY DEFINER RPCs, mirroring M3A.1 / M3B.1.
--   2. Adds tenant_invitations (tokenized, hash-only, grant-locked exactly
--      like customer_access_links in M4A/M4A.1).
--   3. Adds the membership/invite RPCs:
--        list_tenant_members, create_tenant_invite, revoke_tenant_invite,
--        accept_tenant_invite, update_tenant_member_role,
--        remove_tenant_member.
--
-- Guarantees enforced by the RPCs: tenant derived from membership (never a
-- client tenant_id); owner/admin gates; roles limited to admin/sales_rep
-- for invites & role changes (no owner grants outside onboarding); no
-- self-role-change; last-owner protection; invite acceptance verifies the
-- caller's email; the raw token is hashed server-side so a stored hash is
-- never a usable credential. create_tenant_with_owner (M4A, SECURITY
-- DEFINER) still onboards the first owner and is unaffected by the grant
-- revocation.
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1. Lock tenant_users direct writes ───────────────────────────────────
-- SELECT policy stays (a user reads their own membership; owner/admin read
-- the whole roster). Writes go through the RPCs below.
drop policy if exists "tenant_users: owners/admins can add members" on public.tenant_users;
drop policy if exists "tenant_users: owners/admins can change roles" on public.tenant_users;
drop policy if exists "tenant_users: owners/admins can remove members" on public.tenant_users;

revoke insert, update, delete on public.tenant_users from authenticated;
-- Belt-and-braces (M3A.1 already stripped these on the tables that existed
-- then; tenant_users pre-existed but re-assert for clarity/future-proofing).
revoke truncate, references, trigger, maintain on public.tenant_users from anon, authenticated;

comment on table public.tenant_users is
  'Tenant memberships (role: owner/admin/sales_rep). READ-ONLY at the table level for authenticated (own row + owner/admin roster). Writes go EXCLUSIVELY through create_tenant_with_owner (onboarding) and the M4B RPCs accept_tenant_invite / update_tenant_member_role / remove_tenant_member, which enforce owner/admin gates, valid roles, no self-promotion and last-owner protection.';

-- ── 2. tenant_invitations ────────────────────────────────────────────────

create table public.tenant_invitations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  email text not null,
  -- Owner invites are NOT issued in M4B (owner is set only at onboarding);
  -- the CHECK makes that structural.
  role public.tenant_role not null,
  -- SHA-256 hex of the raw token — the raw token is NEVER stored and is
  -- returned only once at creation time.
  token_hash text not null unique,
  token_preview text,
  expires_at timestamptz,
  accepted_at timestamptz,
  revoked_at timestamptz,
  invited_by uuid references auth.users (id) on delete set null,
  accepted_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenant_invitations_role_not_owner check (role in ('admin', 'sales_rep')),
  constraint tenant_invitations_email_len check (char_length(email) between 3 and 254)
);

comment on table public.tenant_invitations is
  'Tokenized tenant-team invitations. Only token_hash is stored (never column-readable by members); owner/admin read their tenant''s invites via a column-scoped SELECT + RLS; writes go EXCLUSIVELY through create_tenant_invite / revoke_tenant_invite / accept_tenant_invite. No anon access; no owner-role invites (M4B).';

create index tenant_invitations_tenant_idx
  on public.tenant_invitations (tenant_id);

create trigger tenant_invitations_set_updated_at
  before update on public.tenant_invitations
  for each row execute function public.set_updated_at();

alter table public.tenant_invitations enable row level security;

-- Grants: mirror customer_access_links (M4A.1). anon gets nothing; members
-- (owner/admin, via the policy) may read every column EXCEPT token_hash; no
-- INSERT/UPDATE/DELETE; no TRUNCATE/REFERENCES/TRIGGER/MAINTAIN.
revoke all on public.tenant_invitations from anon, authenticated;
revoke truncate, references, trigger, maintain
  on public.tenant_invitations from anon, authenticated;
grant select (
  id, tenant_id, email, role, token_preview, expires_at,
  accepted_at, revoked_at, invited_by, accepted_by, created_at, updated_at
) on public.tenant_invitations to authenticated;
grant select, insert, update, delete on public.tenant_invitations to service_role;

create policy "tenant_invitations: owners/admins can read"
  on public.tenant_invitations for select to authenticated
  using (public.has_tenant_role(tenant_id, array['owner', 'admin']::public.tenant_role[]));

-- ── 3a. list_tenant_members — roster with emails (owner/admin) ────────────
-- authenticated cannot read auth.users, so emails come through this
-- SECURITY DEFINER function, gated to the caller's own tenant + owner/admin.
create or replace function public.list_tenant_members()
returns table (user_id uuid, email text, role public.tenant_role, created_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  v_tenant := public.authorize_tenant(null, array['owner', 'admin']::public.tenant_role[]);
  return query
    select tu.user_id, u.email::text, tu.role, tu.created_at
    from public.tenant_users tu
    join auth.users u on u.id = tu.user_id
    where tu.tenant_id = v_tenant
    order by tu.created_at;
end;
$$;
revoke all on function public.list_tenant_members() from public, anon;
grant execute on function public.list_tenant_members() to authenticated, service_role;

-- ── 3b. create_tenant_invite (owner/admin) ───────────────────────────────
create or replace function public.create_tenant_invite(
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
  v_tenant := public.authorize_tenant(null, array['owner', 'admin']::public.tenant_role[]);
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
revoke all on function public.create_tenant_invite(text, public.tenant_role, text, text, timestamptz) from public, anon;
grant execute on function public.create_tenant_invite(text, public.tenant_role, text, text, timestamptz) to authenticated, service_role;

-- ── 3c. revoke_tenant_invite (owner/admin) ───────────────────────────────
create or replace function public.revoke_tenant_invite(p_invite_id uuid)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  v_tenant := public.authorize_tenant(null, array['owner', 'admin']::public.tenant_role[]);
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
revoke all on function public.revoke_tenant_invite(uuid) from public, anon;
grant execute on function public.revoke_tenant_invite(uuid) to authenticated, service_role;

-- ── 3d. accept_tenant_invite (authenticated; email-verified) ─────────────
-- Takes the RAW token and hashes it here, so the stored hash is never a
-- usable credential. The caller's auth email must match the invite email.
-- Inserts the membership; the tenant_users unique(user_id) constraint
-- (M4A single-membership) surfaces as a clean "already a member" error.
--
-- SQLSTATEs use the Madaf custom class 'MDF' so callers can distinguish
-- cases, and so WHEN OTHERS catches them (unlike the built-in P0004 =
-- assert_failure, which OTHERS deliberately skips):
--   MDF02 not found · MDF03 revoked · MDF04 expired · MDF05 already accepted
--   MDF06 email mismatch · MDF07 already a member of a tenant
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
    raise exception 'accept_tenant_invite: you already belong to a tenant (multi-tenant membership is a future phase)'
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

-- ── 3e. update_tenant_member_role (owner only) ───────────────────────────
create or replace function public.update_tenant_member_role(
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
  v_tenant := public.authorize_tenant(null, array['owner']::public.tenant_role[]);
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
revoke all on function public.update_tenant_member_role(uuid, public.tenant_role) from public, anon;
grant execute on function public.update_tenant_member_role(uuid, public.tenant_role) to authenticated, service_role;

-- ── 3f. remove_tenant_member (owner only) ────────────────────────────────
create or replace function public.remove_tenant_member(p_user_id uuid)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_tenant uuid;
  v_current public.tenant_role;
begin
  v_tenant := public.authorize_tenant(null, array['owner']::public.tenant_role[]);
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
revoke all on function public.remove_tenant_member(uuid) from public, anon;
grant execute on function public.remove_tenant_member(uuid) to authenticated, service_role;
