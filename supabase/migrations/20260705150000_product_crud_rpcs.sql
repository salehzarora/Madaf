-- ═══════════════════════════════════════════════════════════════════════
-- Madaf M3B — product / manufacturer / inventory write RPCs
--
-- Admin catalog writes, all SERVICE-ROLE ONLY in this phase (same access
-- model as the M3A order RPCs): called from the server-only data layer
-- with the local-dev service-role key. No grants for anon/authenticated —
-- M4 replaces the service-role calls with authenticated, RLS-scoped flows.
--
-- Every RPC:
--   - is SECURITY DEFINER with search_path = '' (all refs qualified),
--   - validates tenant ownership of the row AND of every referenced
--     parent (category/manufacturer/product) — cross-tenant attachment is
--     refused here AND blocked structurally by the composite FKs,
--   - validates prices / VAT / quantities / text lengths / SKU-barcode
--     uniqueness, never trusts client-side derived values,
--   - returns the affected row id.
--
-- No documents or invoices are touched. Product `availability` remains
-- DERIVED from inventory (never stored).
-- ═══════════════════════════════════════════════════════════════════════

-- ── shared guards ─────────────────────────────────────────────────────────

create or replace function public.assert_service_role(p_fn text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception '%: service-role only until the M4 auth milestone', p_fn
      using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.assert_service_role(text) from public, anon, authenticated;
grant execute on function public.assert_service_role(text) to service_role;

-- Validates a product jsonb payload against the tenant and returns the
-- normalized column values. Shared by create_product / update_product.
-- Raises 22023 on any invalid field. Empty-string optionals become NULL.
create or replace function public.validate_product_payload(
  p_tenant_id uuid,
  p_product jsonb
)
returns table (
  name_ar text, name_he text, name_en text,
  description_ar text, description_he text, description_en text,
  category_id uuid, manufacturer_id uuid,
  sku text, barcode text,
  package_unit public.package_unit, package_quantity integer,
  base_unit public.base_unit, unit_size text,
  wholesale_price numeric, vat_rate numeric,
  image_url text, track_expiry boolean, is_active boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_category_id uuid;
  v_manufacturer_id uuid;
begin
  name_ar := nullif(trim(coalesce(p_product ->> 'name_ar', '')), '');
  name_he := nullif(trim(coalesce(p_product ->> 'name_he', '')), '');
  name_en := nullif(trim(coalesce(p_product ->> 'name_en', '')), '');
  if name_ar is null or name_he is null or name_en is null then
    raise exception 'product: name_ar, name_he and name_en are required'
      using errcode = '22023';
  end if;
  if greatest(length(name_ar), length(name_he), length(name_en)) > 200 then
    raise exception 'product: names must be 200 characters or fewer'
      using errcode = '22023';
  end if;

  description_ar := nullif(p_product ->> 'description_ar', '');
  description_he := nullif(p_product ->> 'description_he', '');
  description_en := nullif(p_product ->> 'description_en', '');
  if greatest(
       coalesce(length(description_ar), 0),
       coalesce(length(description_he), 0),
       coalesce(length(description_en), 0)) > 2000 then
    raise exception 'product: descriptions must be 2000 characters or fewer'
      using errcode = '22023';
  end if;

  -- Category is required and must belong to the tenant.
  v_category_id := nullif(p_product ->> 'category_id', '')::uuid;
  if v_category_id is null then
    raise exception 'product: category_id is required' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.categories c
    where c.id = v_category_id and c.tenant_id = p_tenant_id
  ) then
    raise exception 'product: category is unknown or belongs to another tenant'
      using errcode = '22023';
  end if;
  category_id := v_category_id;

  -- Manufacturer is optional; when present it must belong to the tenant.
  v_manufacturer_id := nullif(p_product ->> 'manufacturer_id', '')::uuid;
  if v_manufacturer_id is not null and not exists (
    select 1 from public.manufacturers m
    where m.id = v_manufacturer_id and m.tenant_id = p_tenant_id
  ) then
    raise exception 'product: manufacturer is unknown or belongs to another tenant'
      using errcode = '22023';
  end if;
  manufacturer_id := v_manufacturer_id;

  sku := nullif(trim(coalesce(p_product ->> 'sku', '')), '');
  barcode := nullif(trim(coalesce(p_product ->> 'barcode', '')), '');
  if coalesce(length(sku), 0) > 64 or coalesce(length(barcode), 0) > 64 then
    raise exception 'product: sku and barcode must be 64 characters or fewer'
      using errcode = '22023';
  end if;

  package_unit := coalesce(nullif(p_product ->> 'package_unit', ''), 'carton')::public.package_unit;
  base_unit := coalesce(nullif(p_product ->> 'base_unit', ''), 'units')::public.base_unit;

  package_quantity := coalesce((p_product ->> 'package_quantity')::integer, 1);
  if package_quantity < 1 or package_quantity > 100000 then
    raise exception 'product: package_quantity must be between 1 and 100000'
      using errcode = '22023';
  end if;

  unit_size := nullif(trim(coalesce(p_product ->> 'unit_size', '')), '');
  if coalesce(length(unit_size), 0) > 40 then
    raise exception 'product: unit_size must be 40 characters or fewer'
      using errcode = '22023';
  end if;

  wholesale_price := (p_product ->> 'wholesale_price')::numeric;
  if wholesale_price is null or wholesale_price < 0 or wholesale_price > 9999999 then
    raise exception 'product: wholesale_price must be between 0 and 9999999'
      using errcode = '22023';
  end if;

  vat_rate := coalesce((p_product ->> 'vat_rate')::numeric, 0.18);
  if vat_rate < 0 or vat_rate >= 1 then
    raise exception 'product: vat_rate must be between 0 and 1 (exclusive)'
      using errcode = '22023';
  end if;

  image_url := nullif(trim(coalesce(p_product ->> 'image_url', '')), '');
  if coalesce(length(image_url), 0) > 500 then
    raise exception 'product: image_url must be 500 characters or fewer'
      using errcode = '22023';
  end if;

  track_expiry := coalesce((p_product ->> 'track_expiry')::boolean, false);
  is_active := coalesce((p_product ->> 'is_active')::boolean, true);
  return next;
end;
$$;

revoke all on function public.validate_product_payload(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.validate_product_payload(uuid, jsonb) to service_role;

-- ── create_product ────────────────────────────────────────────────────────
-- Creates the product and (optionally) its inventory row atomically.
-- p_inventory: {quantity_available, low_stock_threshold, warehouse_location,
--               expiry_date} — omit for no inventory row.

create or replace function public.create_product(
  p_tenant_id uuid,
  p_product jsonb,
  p_inventory jsonb default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v record;
  v_product_id uuid;
begin
  perform public.assert_service_role('create_product');
  if not exists (select 1 from public.tenants t where t.id = p_tenant_id) then
    raise exception 'create_product: unknown tenant %', p_tenant_id using errcode = '22023';
  end if;

  select * into v from public.validate_product_payload(p_tenant_id, p_product);

  begin
    insert into public.products
      (tenant_id, manufacturer_id, category_id, sku, barcode,
       name_ar, name_he, name_en, description_ar, description_he, description_en,
       package_unit, package_quantity, base_unit, unit_size,
       wholesale_price, vat_rate, image_url, track_expiry, is_active)
    values
      (p_tenant_id, v.manufacturer_id, v.category_id, v.sku, v.barcode,
       v.name_ar, v.name_he, v.name_en, v.description_ar, v.description_he, v.description_en,
       v.package_unit, v.package_quantity, v.base_unit, v.unit_size,
       v.wholesale_price, v.vat_rate, v.image_url, v.track_expiry, v.is_active)
    returning id into v_product_id;
  exception when unique_violation then
    raise exception 'create_product: a product with this SKU already exists in this tenant'
      using errcode = '22023';
  end;

  if p_inventory is not null then
    perform public.upsert_inventory_item(
      p_tenant_id, v_product_id, p_inventory);
  end if;

  return v_product_id;
end;
$$;

revoke all on function public.create_product(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.create_product(uuid, jsonb, jsonb) to service_role;

-- ── update_product ────────────────────────────────────────────────────────
-- Full-object update (the edit form submits every field); optionally
-- upserts inventory too. The product must belong to the tenant.

create or replace function public.update_product(
  p_tenant_id uuid,
  p_product_id uuid,
  p_product jsonb,
  p_inventory jsonb default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v record;
begin
  perform public.assert_service_role('update_product');
  if not exists (
    select 1 from public.products p
    where p.id = p_product_id and p.tenant_id = p_tenant_id
  ) then
    raise exception 'update_product: product is unknown or belongs to another tenant'
      using errcode = '22023';
  end if;

  select * into v from public.validate_product_payload(p_tenant_id, p_product);

  begin
    update public.products p set
      manufacturer_id = v.manufacturer_id,
      category_id = v.category_id,
      sku = v.sku,
      barcode = v.barcode,
      name_ar = v.name_ar, name_he = v.name_he, name_en = v.name_en,
      description_ar = v.description_ar,
      description_he = v.description_he,
      description_en = v.description_en,
      package_unit = v.package_unit,
      package_quantity = v.package_quantity,
      base_unit = v.base_unit,
      unit_size = v.unit_size,
      wholesale_price = v.wholesale_price,
      vat_rate = v.vat_rate,
      image_url = v.image_url,
      track_expiry = v.track_expiry,
      is_active = v.is_active
    where p.id = p_product_id and p.tenant_id = p_tenant_id;
  exception when unique_violation then
    raise exception 'update_product: a product with this SKU already exists in this tenant'
      using errcode = '22023';
  end;

  if p_inventory is not null then
    perform public.upsert_inventory_item(
      p_tenant_id, p_product_id, p_inventory);
  end if;

  return p_product_id;
end;
$$;

revoke all on function public.update_product(uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.update_product(uuid, uuid, jsonb, jsonb) to service_role;

-- ── set_product_active ────────────────────────────────────────────────────

create or replace function public.set_product_active(
  p_tenant_id uuid,
  p_product_id uuid,
  p_is_active boolean
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform public.assert_service_role('set_product_active');
  update public.products p
     set is_active = coalesce(p_is_active, p.is_active)
   where p.id = p_product_id and p.tenant_id = p_tenant_id;
  if not found then
    raise exception 'set_product_active: product is unknown or belongs to another tenant'
      using errcode = '22023';
  end if;
  return p_product_id;
end;
$$;

revoke all on function public.set_product_active(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.set_product_active(uuid, uuid, boolean) to service_role;

-- ── upsert_inventory_item ─────────────────────────────────────────────────
-- p_inventory: {quantity_available, low_stock_threshold, warehouse_location,
--               expiry_date}. The product must belong to the tenant; the
-- composite FK also enforces that. No negative stock.

create or replace function public.upsert_inventory_item(
  p_tenant_id uuid,
  p_product_id uuid,
  p_inventory jsonb
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_quantity integer;
  v_threshold integer;
  v_location text;
  v_expiry date;
  v_id uuid;
begin
  perform public.assert_service_role('upsert_inventory_item');
  if not exists (
    select 1 from public.products p
    where p.id = p_product_id and p.tenant_id = p_tenant_id
  ) then
    raise exception 'upsert_inventory_item: product is unknown or belongs to another tenant'
      using errcode = '22023';
  end if;

  v_quantity := coalesce((p_inventory ->> 'quantity_available')::integer, 0);
  if v_quantity < 0 or v_quantity > 100000000 then
    raise exception 'inventory: quantity_available must be between 0 and 100000000'
      using errcode = '22023';
  end if;
  v_threshold := coalesce((p_inventory ->> 'low_stock_threshold')::integer, 10);
  if v_threshold < 0 or v_threshold > 100000000 then
    raise exception 'inventory: low_stock_threshold must be 0 or greater'
      using errcode = '22023';
  end if;
  v_location := nullif(trim(coalesce(p_inventory ->> 'warehouse_location', '')), '');
  if coalesce(length(v_location), 0) > 40 then
    raise exception 'inventory: warehouse_location must be 40 characters or fewer'
      using errcode = '22023';
  end if;
  v_expiry := nullif(p_inventory ->> 'expiry_date', '')::date;

  insert into public.inventory_items
    (tenant_id, product_id, quantity_available, low_stock_threshold,
     warehouse_location, expiry_date)
  values
    (p_tenant_id, p_product_id, v_quantity, v_threshold, v_location, v_expiry)
  on conflict (tenant_id, product_id) do update set
    quantity_available = excluded.quantity_available,
    low_stock_threshold = excluded.low_stock_threshold,
    warehouse_location = excluded.warehouse_location,
    expiry_date = excluded.expiry_date
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.upsert_inventory_item(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.upsert_inventory_item(uuid, uuid, jsonb) to service_role;

-- ── create_manufacturer / update_manufacturer ────────────────────────────

create or replace function public.create_manufacturer(
  p_tenant_id uuid,
  p_name_ar text,
  p_name_he text,
  p_name_en text,
  p_logo_url text default null,
  p_sort_order integer default 0
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_ar text := nullif(trim(coalesce(p_name_ar, '')), '');
  v_he text := nullif(trim(coalesce(p_name_he, '')), '');
  v_en text := nullif(trim(coalesce(p_name_en, '')), '');
  v_logo text := nullif(trim(coalesce(p_logo_url, '')), '');
begin
  perform public.assert_service_role('create_manufacturer');
  if not exists (select 1 from public.tenants t where t.id = p_tenant_id) then
    raise exception 'create_manufacturer: unknown tenant %', p_tenant_id using errcode = '22023';
  end if;
  if v_ar is null or v_he is null or v_en is null then
    raise exception 'manufacturer: name_ar, name_he and name_en are required'
      using errcode = '22023';
  end if;
  if greatest(length(v_ar), length(v_he), length(v_en)) > 200
     or coalesce(length(v_logo), 0) > 500 then
    raise exception 'manufacturer: name (<=200) or logo_url (<=500) too long'
      using errcode = '22023';
  end if;

  insert into public.manufacturers
    (tenant_id, name_ar, name_he, name_en, logo_url, sort_order)
  values
    (p_tenant_id, v_ar, v_he, v_en, v_logo, coalesce(p_sort_order, 0))
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.create_manufacturer(uuid, text, text, text, text, integer) from public, anon, authenticated;
grant execute on function public.create_manufacturer(uuid, text, text, text, text, integer) to service_role;

create or replace function public.update_manufacturer(
  p_tenant_id uuid,
  p_manufacturer_id uuid,
  p_name_ar text,
  p_name_he text,
  p_name_en text,
  p_logo_url text default null,
  p_sort_order integer default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_ar text := nullif(trim(coalesce(p_name_ar, '')), '');
  v_he text := nullif(trim(coalesce(p_name_he, '')), '');
  v_en text := nullif(trim(coalesce(p_name_en, '')), '');
  v_logo text := nullif(trim(coalesce(p_logo_url, '')), '');
begin
  perform public.assert_service_role('update_manufacturer');
  if not exists (
    select 1 from public.manufacturers m
    where m.id = p_manufacturer_id and m.tenant_id = p_tenant_id
  ) then
    raise exception 'update_manufacturer: manufacturer is unknown or belongs to another tenant'
      using errcode = '22023';
  end if;
  if v_ar is null or v_he is null or v_en is null then
    raise exception 'manufacturer: name_ar, name_he and name_en are required'
      using errcode = '22023';
  end if;
  if greatest(length(v_ar), length(v_he), length(v_en)) > 200
     or coalesce(length(v_logo), 0) > 500 then
    raise exception 'manufacturer: name (<=200) or logo_url (<=500) too long'
      using errcode = '22023';
  end if;

  update public.manufacturers m set
    name_ar = v_ar, name_he = v_he, name_en = v_en,
    logo_url = v_logo,
    sort_order = coalesce(p_sort_order, m.sort_order)
  where m.id = p_manufacturer_id and m.tenant_id = p_tenant_id;
  return p_manufacturer_id;
end;
$$;

revoke all on function public.update_manufacturer(uuid, uuid, text, text, text, text, integer) from public, anon, authenticated;
grant execute on function public.update_manufacturer(uuid, uuid, text, text, text, text, integer) to service_role;
