-- ═══════════════════════════════════════════════════════════════════════
-- M8G.3 — bounded actor-label lookup for the Customer Timeline
--
-- The Timeline resolves each event actor's display label (email). The prior
-- data layer bounded the RESULT to the page's ≤50 distinct actors, but the only
-- authorized email source, list_tenant_members(p_tenant_id), still reads the
-- ENTIRE tenant roster and the projection happened AFTERWARD in TypeScript.
-- Filtering after an unbounded read is not a bounded query.
--
-- This adds a genuinely bounded, owner/admin-gated lookup that joins ONLY the
-- requested (≤50, deduped, non-null) actor ids to the CURRENT tenant's
-- membership + auth.users, returning at most those rows. `auth.users` is not
-- client-readable, so — exactly like list_tenant_members — this is a minimal
-- SECURITY DEFINER function; owner/admin gating + tenant validation reuse
-- authorize_tenant (the client-supplied tenant is trusted only if the caller is
-- an owner/admin member of it). Membership = a row in tenant_users (the same
-- "current member" semantics list_tenant_members uses; there is no status flag).
--
-- Additive: ONE function + its grants. No change to any existing table, policy,
-- RLS, grant, producer, index, taxonomy, or data; no backfill; no migration is
-- edited. list_tenant_members is left UNTOUCHED (still used by the team roster).
-- ═══════════════════════════════════════════════════════════════════════

create function public.get_timeline_actor_labels_for_ids(
  p_tenant_id uuid,
  p_actor_user_ids uuid[]
)
returns table (actor_user_id uuid, actor_email text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_count integer;
begin
  -- Owner/admin gate + tenant validation. authorize_tenant raises 42501 for a
  -- sales_rep, a non-member, or a cross-tenant attempt, and accepts p_tenant_id
  -- ONLY when it is one of the CALLER's own owner/admin memberships — so the
  -- client-supplied tenant can never authorize by itself. Named actor labels are
  -- owner/admin-only, matching the existing team-roster visibility boundary.
  v_tenant := public.authorize_tenant(
    p_tenant_id, array['owner', 'admin']::public.tenant_role[]);

  -- Bound the input BEFORE any read: a Timeline page is ≤50 rows, so its distinct
  -- actor set is ≤50. Count DISTINCT non-null ids (duplicates/nulls never inflate
  -- the request) and reject an oversized request rather than silently expanding.
  select count(*)
    into v_count
  from (
    select distinct t.uid
    from unnest(p_actor_user_ids) as t(uid)
    where t.uid is not null
  ) d;
  if v_count > 50 then
    raise exception
      'get_timeline_actor_labels_for_ids: at most 50 distinct actor ids (got %)', v_count
      using errcode = '22023';
  end if;

  -- Resolve ONLY the requested ids that are CURRENT members of this tenant. The
  -- join drives FROM the ≤50 requested ids INTO the tenant_users PK
  -- (tenant_id, user_id) and the auth.users PK — no full-roster scan, no
  -- list_tenant_members. A non-member / cross-tenant / unknown / removed id
  -- simply produces no row (never a fabricated one). At most 50 rows are
  -- returned, and only actor_user_id + email — no role, tenant, or auth metadata.
  return query
  select tu.user_id, u.email::text
  from (
    select distinct t.uid as user_id
    from unnest(p_actor_user_ids) as t(uid)
    where t.uid is not null
  ) req
  join public.tenant_users tu
    on tu.tenant_id = v_tenant and tu.user_id = req.user_id
  join auth.users u on u.id = tu.user_id;
end;
$$;

comment on function public.get_timeline_actor_labels_for_ids(uuid, uuid[]) is
  'M8G.3 — bounded Customer Timeline actor-label lookup. Owner/admin only '
  '(via authorize_tenant); returns actor_user_id + email for ONLY the requested '
  '(≤50, deduped, non-null) ids that are current members of the NAMED tenant. No '
  'full-roster read; cross-tenant / non-member / unknown ids resolve to nothing.';

-- Least privilege: PUBLIC + anon cannot execute; only authenticated may, and only
-- through the internal owner/admin authorize_tenant check. service_role is NOT
-- granted — this RPC is only ever invoked by an authenticated owner/admin.
revoke all on function public.get_timeline_actor_labels_for_ids(uuid, uuid[])
  from public, anon;
grant execute on function public.get_timeline_actor_labels_for_ids(uuid, uuid[])
  to authenticated;
