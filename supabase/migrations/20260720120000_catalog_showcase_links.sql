-- ═══════════════════════════════════════════════════════════════════════
-- Madaf M7H.3 — product-SHOWCASE (view-only) tokenized links
--
-- A supplier sends a "view products" link to a PROSPECTIVE customer. The
-- visitor browses the tenant's catalog (images, search, filters) but CANNOT
-- place an order — there is no cart/checkout and no customer context. To buy,
-- they must request a store account (a signup link) from the supplier.
--
-- Security mirrors customer_signup_links / customer_access_links exactly:
--   - token_hash only (raw token returned once, never stored),
--   - owner/admin create/revoke via authorize_tenant with explicit p_tenant_id,
--   - anon reads the catalog ONLY via get_showcase_catalog after in-DB token
--     resolution, rate-limited (purpose 'showcase_catalog'),
--   - RLS: owner/admin read; RPC-only writes; token_hash NOT column-readable;
--     NO anon table access; NO global product exposure.
--
-- No catalog is exposed without a valid showcase token (or a valid shop token).
-- Local stack only; apply to hosted staging with `supabase db push`.
-- ═══════════════════════════════════════════════════════════════════════

create table public.catalog_showcase_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  token_hash text not null unique,
  token_preview text,
  label text,
  expires_at timestamptz,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index catalog_showcase_links_tenant_idx
  on public.catalog_showcase_links (tenant_id, created_at desc);

create trigger catalog_showcase_links_set_updated_at
  before update on public.catalog_showcase_links
  for each row execute function public.set_updated_at();

alter table public.catalog_showcase_links enable row level security;
revoke all on public.catalog_showcase_links from anon, authenticated;
grant select (id, tenant_id, token_preview, label, expires_at, revoked_at,
              last_used_at, created_by, created_at, updated_at)
  on public.catalog_showcase_links to authenticated;
grant select, insert, update, delete on public.catalog_showcase_links to service_role;

create policy "showcase_links: owner/admin read"
  on public.catalog_showcase_links for select to authenticated
  using (public.has_tenant_role(tenant_id, array['owner', 'admin']::public.tenant_role[]));

-- ── create / revoke (owner/admin) ────────────────────────────────────────

create or replace function public.insert_catalog_showcase_link(
  p_tenant_id uuid,
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
    raise exception 'insert_catalog_showcase_link: invalid token hash' using errcode = '22023';
  end if;
  insert into public.catalog_showcase_links
    (tenant_id, token_hash, token_preview, label, expires_at, created_by)
  values
    (v_tenant, p_token_hash,
     nullif(trim(coalesce(p_token_preview, '')), ''),
     nullif(trim(coalesce(p_label, '')), ''),
     p_expires_at, (select auth.uid()))
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.insert_catalog_showcase_link(uuid, text, text, text, timestamptz) from public, anon;
grant execute on function public.insert_catalog_showcase_link(uuid, text, text, text, timestamptz) to authenticated, service_role;

create or replace function public.revoke_catalog_showcase_link(
  p_tenant_id uuid,
  p_link_id uuid
)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  v_tenant := public.authorize_tenant(p_tenant_id, array['owner', 'admin']::public.tenant_role[]);
  update public.catalog_showcase_links l
     set revoked_at = coalesce(l.revoked_at, now())
   where l.id = p_link_id and l.tenant_id = v_tenant;
  if not found then
    raise exception 'revoke_catalog_showcase_link: link is unknown or belongs to another tenant'
      using errcode = '22023';
  end if;
  return p_link_id;
end;
$$;
revoke all on function public.revoke_catalog_showcase_link(uuid, uuid) from public, anon;
grant execute on function public.revoke_catalog_showcase_link(uuid, uuid) to authenticated, service_role;

-- ── _resolve_showcase_token — PRIVATE (service_role only) ─────────────────

create or replace function public._resolve_showcase_token(p_raw_token text)
returns table (tenant_id uuid, link_id uuid)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_link public.catalog_showcase_links%rowtype;
  v_hash text;
begin
  if p_raw_token is null or length(p_raw_token) < 16 then
    raise exception 'invalid token' using errcode = '22023';
  end if;
  v_hash := encode(sha256(convert_to(p_raw_token, 'UTF8')), 'hex');
  select * into v_link from public.catalog_showcase_links l where l.token_hash = v_hash;
  if not found then
    raise exception 'link not found' using errcode = 'P0002';
  end if;
  if v_link.revoked_at is not null then
    raise exception 'link revoked' using errcode = 'P0003';
  end if;
  if v_link.expires_at is not null and v_link.expires_at <= now() then
    raise exception 'link expired' using errcode = 'P0004';
  end if;
  return query select v_link.tenant_id, v_link.id;
end;
$$;
revoke all on function public._resolve_showcase_token(text) from public, anon, authenticated;
grant execute on function public._resolve_showcase_token(text) to service_role;

-- ── get_showcase_catalog(raw_token) → jsonb (anon, view-only, rate-limited)─
-- Returns the tenant's active catalog (NO customer, NO ordering). Mirrors
-- get_token_catalog minus the customer block.

create or replace function public.get_showcase_catalog(p_token text)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_tenant uuid;
  v_link uuid;
  v_result jsonb;
  v_fp text := encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex');
begin
  if public._token_rate_exceeded('showcase_catalog', v_fp) then
    return null;
  end if;
  begin
    select tenant_id, link_id into v_tenant, v_link
    from public._resolve_showcase_token(p_token);
  exception when others then
    perform public._record_token_failure('showcase_catalog', v_fp);
    return null;
  end;

  update public.catalog_showcase_links set last_used_at = now() where id = v_link;

  select jsonb_build_object(
    'tenant', (
      select jsonb_build_object('name_ar', t.name_ar, 'name_he', t.name_he, 'name_en', t.name_en)
      from public.tenants t where t.id = v_tenant
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
revoke all on function public.get_showcase_catalog(text) from public;
grant execute on function public.get_showcase_catalog(text) to anon, authenticated, service_role;
