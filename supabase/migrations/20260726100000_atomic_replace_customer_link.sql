-- ═══════════════════════════════════════════════════════════════════════
-- Madaf M8E.2 — ATOMIC private shop-link replacement
--
-- BUG: issuing a store's private link did the replacement in TWO independent
-- transactions — revoke_customer_access_links_for_customer THEN
-- insert_customer_access_link. If the revoke committed but the insert failed,
-- the store was left with NO usable link. Two concurrent "generate" requests
-- could also both revoke before either inserted, leaving inconsistent or
-- multiple active links.
--
-- FIX: one SECURITY DEFINER RPC that does the whole replacement in a SINGLE
-- transaction:
--   1. authorize the caller (owner/admin) and DERIVE the tenant from
--      membership via authorize_tenant (never client-trusted);
--   2. lock the customer row FOR UPDATE so concurrent replacements for the
--      SAME customer SERIALIZE (the second waits, then re-checks + revokes +
--      inserts under its own lock → exactly one active link wins);
--   3. re-check customer existence/tenant + active state UNDER the lock
--      (a deactivated store gets no new credential — MDF33);
--   4. revoke every currently-active link for the customer;
--   5. insert the new hash-only link row;
--   6. return the new (non-secret) row.
-- Either the revoke AND the insert commit together, or NEITHER does — there is
-- no committed state where all old links are revoked but no replacement exists.
--
-- ADDITIVE: the older insert_customer_access_link /
-- revoke_customer_access_links_for_customer RPCs are LEFT IN PLACE (still
-- granted, still valid) — this migration only ADDS the atomic path. Only
-- token_hash + a short preview are stored; the raw token is never persisted.
-- Local stack only; apply to hosted staging with `supabase db push`.
-- ═══════════════════════════════════════════════════════════════════════

create or replace function public.replace_customer_access_link(
  p_tenant_id uuid,
  p_customer_id uuid,
  p_token_hash text,
  p_token_preview text default null,
  p_label text default null,
  p_expires_at timestamptz default null
)
returns table (
  id uuid,
  token_preview text,
  label text,
  expires_at timestamptz,
  created_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_customer public.customers%rowtype;
  v_id uuid;
begin
  -- Owner/admin only; tenant DERIVED from membership (or an explicit existing
  -- tenant for service_role). Never trusts a client-supplied tenant_id.
  v_tenant := public.authorize_tenant(
    p_tenant_id, array['owner', 'admin']::public.tenant_role[]);

  if p_token_hash is null or length(p_token_hash) < 32 or length(p_token_hash) > 128 then
    raise exception 'replace_customer_access_link: invalid token hash' using errcode = '22023';
  end if;

  -- Serialize concurrent replacements for the SAME customer: FOR UPDATE makes a
  -- second caller block here until the first commits, so the final state always
  -- has exactly one intended active link (last writer wins) — never several.
  select * into v_customer
  from public.customers c
  where c.id = p_customer_id and c.tenant_id = v_tenant
  for update;
  if not found then
    raise exception 'replace_customer_access_link: customer is unknown or belongs to another tenant'
      using errcode = '22023';
  end if;

  -- Re-check state UNDER the lock: a deactivated store gets NO new credential
  -- (MDF33). No links are revoked when this fails — the whole tx rolls back.
  if not v_customer.is_active then
    raise exception 'replace_customer_access_link: customer % is deactivated (inactive)', p_customer_id
      using errcode = 'MDF33';
  end if;

  -- Revoke every currently-active link, then insert the replacement — both in
  -- THIS transaction. A failure of either rolls back the whole thing.
  update public.customer_access_links l
     set revoked_at = now()
   where l.tenant_id = v_tenant
     and l.customer_id = p_customer_id
     and l.revoked_at is null;

  insert into public.customer_access_links
    (tenant_id, customer_id, token_hash, token_preview, label, expires_at, created_by)
  values
    (v_tenant, p_customer_id, p_token_hash,
     nullif(trim(coalesce(p_token_preview, '')), ''),
     nullif(trim(coalesce(p_label, '')), ''),
     p_expires_at, (select auth.uid()))
  returning customer_access_links.id into v_id;

  return query
    select l.id, l.token_preview, l.label, l.expires_at, l.created_at
    from public.customer_access_links l
    where l.id = v_id;
end;
$$;

comment on function public.replace_customer_access_link(uuid, uuid, text, text, text, timestamptz) is
  'Atomically replace a customer''s private shop link (M8E.2): authorize owner/admin, lock the customer row, re-check active state (MDF33), revoke ALL active links, insert the new hash-only link — all in ONE transaction so revoke+insert commit together or not at all. Concurrent replacements for the same customer serialize on the customer lock, leaving exactly one active link.';

revoke all on function public.replace_customer_access_link(uuid, uuid, text, text, text, timestamptz)
  from public, anon;
grant execute on function public.replace_customer_access_link(uuid, uuid, text, text, text, timestamptz)
  to authenticated, service_role;
