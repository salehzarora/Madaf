-- ═══════════════════════════════════════════════════════════════════════
-- Madaf M8C.3 — customer/store ACTIVE lifecycle (deactivate without delete)
--
-- A supplier stops serving a store but must keep its history. This adds:
--   1. customers.is_active (default true — existing rows unaffected).
--   2. set_customer_active RPC — the ONLY write path (owner/admin via
--      authorize_tenant, tenant-scoped). No hard delete anywhere.
--   3. _resolve_token now REJECTS links whose customer is inactive
--      (errcode P0005) — an inactive store's private link can neither
--      browse the catalog nor submit orders. Reactivation restores both
--      instantly (no link changes needed). Showcase guest ordering is
--      untouched (it has no customer).
--   4. insert_customer_access_link refuses to mint a link for an inactive
--      customer (MDF33) — no new credentials for deactivated stores.
--
-- History is preserved: old orders/documents/movements keep their
-- customer_id; admin lists still show the store (marked inactive).
--
-- Local stack only; apply to hosted staging with `supabase db push`.
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1. Column ──────────────────────────────────────────────────────────────

alter table public.customers
  add column is_active boolean not null default true;

comment on column public.customers.is_active is
  'M8C lifecycle flag — false blocks the store''s private links (catalog + orders) and new link creation; history stays.';

-- ── 2. Owner/admin toggle ─────────────────────────────────────────────────

create or replace function public.set_customer_active(
  p_tenant_id uuid,
  p_customer_id uuid,
  p_active boolean
)
returns boolean
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  v_tenant := public.authorize_tenant(p_tenant_id, array['owner', 'admin']::public.tenant_role[]);
  if p_active is null then
    raise exception 'set_customer_active: p_active is required' using errcode = '22023';
  end if;

  update public.customers c
     set is_active = p_active, updated_at = now()
   where c.id = p_customer_id and c.tenant_id = v_tenant;
  if not found then
    raise exception 'set_customer_active: customer is unknown or belongs to another tenant'
      using errcode = '22023';
  end if;
  return p_active;
end;
$$;
revoke all on function public.set_customer_active(uuid, uuid, boolean) from public, anon;
grant execute on function public.set_customer_active(uuid, uuid, boolean)
  to authenticated, service_role;

-- ── 3. Private links of an INACTIVE store stop working ───────────────────
-- Same body as before + the is_active check; both get_token_catalog and
-- create_order_request_from_token resolve through here, so browsing AND
-- ordering are blocked in one place. STABLE, unchanged signature/grants.

create or replace function public._resolve_token(p_raw_token text)
returns table (tenant_id uuid, customer_id uuid, link_id uuid)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_link public.customer_access_links%rowtype;
  v_hash text;
begin
  -- Raw tokens are 32 random bytes as base64url (~43 chars); reject the
  -- obviously-too-short before hashing.
  if p_raw_token is null or length(p_raw_token) < 16 then
    raise exception 'invalid token' using errcode = '22023';
  end if;
  -- Same digest the app uses to store it: sha256 of the UTF-8 bytes, hex.
  v_hash := encode(sha256(convert_to(p_raw_token, 'UTF8')), 'hex');
  select * into v_link
  from public.customer_access_links l
  where l.token_hash = v_hash;
  if not found then
    raise exception 'link not found' using errcode = 'P0002';
  end if;
  if v_link.revoked_at is not null then
    raise exception 'link revoked' using errcode = 'P0003';
  end if;
  if v_link.expires_at is not null and v_link.expires_at <= now() then
    raise exception 'link expired' using errcode = 'P0004';
  end if;
  -- M8C: a deactivated store's links are dormant until reactivation.
  if not exists (
    select 1 from public.customers c
    where c.id = v_link.customer_id and c.is_active
  ) then
    raise exception 'customer inactive' using errcode = 'P0005';
  end if;
  return query select v_link.tenant_id, v_link.customer_id, v_link.id;
end;
$$;

-- ── 4. No new links for inactive stores ───────────────────────────────────

create or replace function public.insert_customer_access_link(
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
  -- M8C: deactivated stores get no new credentials.
  if not exists (
    select 1 from public.customers c
    where c.id = p_customer_id and c.tenant_id = v_tenant and c.is_active
  ) then
    raise exception 'insert_customer_access_link: customer is inactive'
      using errcode = 'MDF33';
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
