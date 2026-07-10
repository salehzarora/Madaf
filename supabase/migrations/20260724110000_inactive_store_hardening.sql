-- ═══════════════════════════════════════════════════════════════════════
-- Madaf M8C.3 (follow-up) — inactive-store hardening + rate-limiter fix
--
-- Review follow-ups to 20260724100000:
--   1/2. get_token_catalog + create_order_request_from_token: a deactivated
--        store's link raises P0005 in _resolve_token; the wrappers used to
--        count that as a token FAILURE (their `when others` handler), which
--        could rate-limit a legitimate buyer past reactivation. They now
--        special-case P0005 and deny WITHOUT recording a failure.
--   3.   _order_create_core: block a new order for an INACTIVE customer on
--        ANY channel (MDF34) — closes the admin/sales-visit path at the
--        single shared insert. Guest orders (customer_id NULL) unaffected.
--
-- Bodies are the live definitions transformed by a script (no hand-copy).
-- Local stack only; apply to hosted staging with `supabase db push`.
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_token_catalog(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant uuid;
  v_customer uuid;
  v_link uuid;
  v_result jsonb;
  v_fp text := encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex');
begin
  -- Over the failure limit for this token fingerprint → deny (null). The app
  -- shows the same neutral "link no longer valid" screen as any bad token.
  if public._token_rate_exceeded('shop_catalog', v_fp) then
    return null;
  end if;
  -- Resolve; on failure RECORD the attempt and RETURN NULL (a normal return
  -- so the counter write commits — re-raising would roll it back).
  begin
    select tenant_id, customer_id, link_id into v_tenant, v_customer, v_link
    from public._resolve_token(p_token);
  exception
    when sqlstate 'P0005' then
      -- Deactivated store (M8C): the token IS a valid credential, so this is
      -- not a probing failure — deny with a neutral null WITHOUT counting it,
      -- so a legit buyer is never rate-limited past reactivation.
      return null;
    when others then
      perform public._record_token_failure('shop_catalog', v_fp);
      return null;
  end;

  update public.customer_access_links set last_used_at = now() where id = v_link;

  select jsonb_build_object(
    'tenant', (
      select jsonb_build_object('name_ar', t.name_ar, 'name_he', t.name_he, 'name_en', t.name_en)
      from public.tenants t where t.id = v_tenant
    ),
    'customer', (
      select jsonb_build_object('name', c.name, 'city_ar', c.city_ar, 'city_he', c.city_he, 'city_en', c.city_en)
      from public.customers c where c.id = v_customer
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
$function$;

CREATE OR REPLACE FUNCTION public.create_order_request_from_token(p_token text, p_items jsonb, p_notes text DEFAULT NULL::text)
 RETURNS TABLE(order_number text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant uuid;
  v_customer uuid;
  v_link uuid;
  v_order_id uuid;
  v_public_ref text;
  v_fp text := encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex');
begin
  -- Over the limit → deny (no order row). App treats a null ref as failure.
  if public._token_rate_exceeded('shop_order', v_fp) then
    return query select null::text;
    return;
  end if;

  -- Resolve; on failure RECORD + return null (normal return so the counter
  -- commits). Order-content errors below are NOT rate-limited.
  begin
    select tenant_id, customer_id, link_id into v_tenant, v_customer, v_link
    from public._resolve_token(p_token);
  exception
    when sqlstate 'P0005' then
      -- Deactivated store (M8C): valid token, not a probing failure — deny
      -- (null order) WITHOUT recording it.
      return query select null::text;
      return;
    when others then
      perform public._record_token_failure('shop_order', v_fp);
      return query select null::text;
      return;
  end;

  -- Token is valid past here.
  select o.order_id into v_order_id
  from public._order_create_core(v_tenant, p_items, v_customer, p_notes, 'remote_customer') o;

  -- Customer sees the random public reference, NOT the internal sequence (M7E).
  select public_ref into v_public_ref from public.orders where id = v_order_id;

  update public.customer_access_links set last_used_at = now() where id = v_link;
  return query select v_public_ref;
end;
$function$;

CREATE OR REPLACE FUNCTION public._order_create_core(p_tenant_id uuid, p_items jsonb, p_customer_id uuid, p_notes text, p_source order_source)
 RETURNS TABLE(order_id uuid, order_number text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_order_id uuid;
  v_order_number text;
  v_customer public.customers%rowtype;
  v_item_count integer;
  v_valid_count integer;
  v_inserted integer;
  v_subtotal numeric(12,2);
  v_vat_total numeric(12,2);
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 then
    raise exception 'order: items must be a non-empty array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) > 200 then
    raise exception 'order: too many lines (max 200)' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_items) as elem
    where (elem ->> 'product_id')::uuid is null
       or (elem ->> 'quantity')::integer is null
       or (elem ->> 'quantity')::integer <= 0
       or (elem ->> 'quantity')::integer > 9999
  ) then
    raise exception 'order: each line needs a product_id and a quantity between 1 and 9999'
      using errcode = '22023';
  end if;

  with lines as (
    select (elem ->> 'product_id')::uuid as product_id,
           sum((elem ->> 'quantity')::integer)::integer as quantity
    from jsonb_array_elements(p_items) as elem
    group by 1
  )
  select count(*),
         count(*) filter (
           where quantity between 1 and 9999
             and exists (
               select 1 from public.products p
               where p.id = lines.product_id
                 and p.tenant_id = p_tenant_id
                 and p.is_active
             )
         )
  into v_item_count, v_valid_count
  from lines;
  if v_valid_count <> v_item_count then
    raise exception 'order: one or more products are unknown, inactive, over the 9999-package limit, or belong to another tenant'
      using errcode = '22023';
  end if;

  if p_customer_id is not null then
    select * into v_customer
    from public.customers c
    where c.id = p_customer_id and c.tenant_id = p_tenant_id;
    if not found then
      raise exception 'order: customer % is unknown or belongs to another tenant', p_customer_id
        using errcode = '22023';
    end if;
    -- M8C: a deactivated store gets NO new orders through ANY channel. The
    -- token path is already blocked upstream (_resolve_token); this closes
    -- the admin/sales-visit path at the single shared insert. History stays.
    if not v_customer.is_active then
      raise exception 'order: customer % is deactivated', p_customer_id
        using errcode = 'MDF34';
    end if;
  end if;

  -- Atomic human order number (inline; same logic as next_order_number).
  update public.tenants
     set order_seq = order_seq + 1
   where id = p_tenant_id
  returning 'MDF-' || order_seq::text into v_order_number;

  insert into public.orders
    (tenant_id, customer_id, customer_snapshot, order_number, status, notes, source)
  values
    (p_tenant_id,
     p_customer_id,
     case when p_customer_id is null then null else jsonb_build_object(
       'name', v_customer.name,
       'city', jsonb_build_object('ar', v_customer.city_ar, 'he', v_customer.city_he, 'en', v_customer.city_en),
       'phone', v_customer.phone,
       'contact_name', v_customer.contact_name) end,
     v_order_number, 'new', nullif(trim(coalesce(p_notes, '')), ''), p_source)
  returning id into v_order_id;

  with lines as (
    select (elem ->> 'product_id')::uuid as product_id,
           sum((elem ->> 'quantity')::integer)::integer as quantity
    from jsonb_array_elements(p_items) as elem
    group by 1
  )
  insert into public.order_items
    (tenant_id, order_id, product_id,
     product_name_snapshot, manufacturer_name_snapshot,
     package_unit_snapshot, package_quantity_snapshot,
     quantity, unit_price_snapshot, vat_rate_snapshot,
     line_subtotal, line_vat, line_total)
  select
    p_tenant_id, v_order_id, p.id,
    jsonb_build_object('ar', p.name_ar, 'he', p.name_he, 'en', p.name_en),
    case when m.id is null then null else jsonb_build_object(
      'ar', m.name_ar, 'he', m.name_he, 'en', m.name_en) end,
    p.package_unit, p.package_quantity, l.quantity, p.wholesale_price, p.vat_rate,
    round(l.quantity * p.wholesale_price, 2),
    round(round(l.quantity * p.wholesale_price, 2) * p.vat_rate, 2),
    round(l.quantity * p.wholesale_price, 2)
      + round(round(l.quantity * p.wholesale_price, 2) * p.vat_rate, 2)
  from lines l
  join public.products p
    on p.id = l.product_id and p.tenant_id = p_tenant_id and p.is_active
  left join public.manufacturers m on m.id = p.manufacturer_id;

  get diagnostics v_inserted = row_count;
  if v_inserted <> v_item_count then
    raise exception 'order: catalog changed while ordering — please retry'
      using errcode = '40001';
  end if;

  select sum(i.line_subtotal), round(sum(i.line_subtotal * i.vat_rate_snapshot), 2)
  into v_subtotal, v_vat_total
  from public.order_items i where i.order_id = v_order_id;

  update public.orders o
     set subtotal = v_subtotal, vat_total = v_vat_total, total = v_subtotal + v_vat_total
   where o.id = v_order_id;

  return query select v_order_id, v_order_number;
end;
$function$;
