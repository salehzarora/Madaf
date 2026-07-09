-- ═══════════════════════════════════════════════════════════════════════
-- Madaf M7H.1 — revoke ALL active private shop links for a customer
--
-- BUG: "regenerate" revoked only the ONE clicked link row. customer_access_links
-- permits many simultaneously-active links per customer (only token_hash is
-- unique — no "one active link per customer" invariant), and the plain
-- "Generate" path never revokes prior links. So a store could hold several
-- active links, and regenerating one left the others resolving — the OLD copied
-- URL kept working. (_resolve_token / get_token_catalog correctly reject a
-- revoked link; the defect was scope: per-link revoke, not per-customer.)
--
-- FIX: a revoke-ALL-active-for-customer RPC. The app now revokes every active
-- link for the store before issuing a fresh one (both create and regenerate),
-- so a store always ends up with exactly one live link and every old URL stops
-- working immediately.
--
-- Owner/admin only, tenant DERIVED via authorize_tenant with an explicit
-- p_tenant_id (never client-trusted); scoped by customer_id so it can never
-- over-revoke across customers/tenants. Idempotent (only touches active rows).
-- Local stack only; apply to hosted staging with `supabase db push`.
-- ═══════════════════════════════════════════════════════════════════════

create or replace function public.revoke_customer_access_links_for_customer(
  p_tenant_id uuid,
  p_customer_id uuid
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_count integer;
begin
  v_tenant := public.authorize_tenant(
    p_tenant_id, array['owner', 'admin']::public.tenant_role[]);
  update public.customer_access_links l
     set revoked_at = now()
   where l.tenant_id = v_tenant
     and l.customer_id = p_customer_id
     and l.revoked_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.revoke_customer_access_links_for_customer(uuid, uuid) is
  'Revoke ALL currently-active private shop links for one customer (owner/admin, via authorize_tenant). Used to guarantee a store keeps exactly one live link when a new one is issued (M7H.1).';

revoke all on function public.revoke_customer_access_links_for_customer(uuid, uuid)
  from public, anon;
grant execute on function public.revoke_customer_access_links_for_customer(uuid, uuid)
  to authenticated, service_role;
