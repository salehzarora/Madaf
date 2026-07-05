-- ═══════════════════════════════════════════════════════════════════════
-- Madaf M3A — order write RPCs
--
-- Two atomic write paths, both SERVICE-ROLE ONLY in this phase:
--   create_order_request(...)  checkout → order + snapshotted lines
--   update_order_status(...)   admin pipeline with a validated transition
--
-- Access model: exactly like the M2 read path, these are called from the
-- server-only data layer with the local service-role key. No grants for
-- anon or authenticated — M4 replaces the service-role calls with
-- authenticated, RLS-scoped flows and revisits these grants.
--
-- Money rules (docs/DOCUMENTS_AND_INVOICES_GUIDE.md): all amounts are
-- ESTIMATES until legal invoicing (M6). Prices come from the products
-- table at call time — client-submitted prices/totals are never trusted.
-- No documents are created here: order documents/invoice drafts stay
-- seeded/read-only until M5.
-- ═══════════════════════════════════════════════════════════════════════

-- ── create_order_request ─────────────────────────────────────────────────
-- p_items: jsonb array of {"product_id": uuid, "quantity": int}.
-- Everything else (names, prices, VAT, totals) is resolved server-side.
-- Duplicate product_ids are merged by summing quantities.

create or replace function public.create_order_request(
  p_tenant_id uuid,
  p_items jsonb,
  p_customer_id uuid default null,
  p_notes text default null,
  p_source public.order_source default 'sales_visit'
)
returns table (order_id uuid, order_number text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
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
  -- Service-role only until M4 (mirrors next_order_number's gate).
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception 'create_order_request: service-role only until the M4 auth milestone'
      using errcode = '42501';
  end if;

  if not exists (select 1 from public.tenants t where t.id = p_tenant_id) then
    raise exception 'create_order_request: unknown tenant %', p_tenant_id
      using errcode = '22023';
  end if;

  -- Validate the items payload shape and bounds.
  if p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 then
    raise exception 'create_order_request: p_items must be a non-empty array'
      using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) > 200 then
    raise exception 'create_order_request: too many lines (max 200)'
      using errcode = '22023';
  end if;

  -- Per-element shape check (bad uuids abort with a cast error, which is
  -- loud and fine — the payload is built by our own server action).
  if exists (
    select 1
    from jsonb_array_elements(p_items) as elem
    where (elem ->> 'product_id')::uuid is null
       or (elem ->> 'quantity')::integer is null
       or (elem ->> 'quantity')::integer <= 0
       or (elem ->> 'quantity')::integer > 9999
  ) then
    raise exception 'create_order_request: each line needs a product_id and a quantity between 1 and 9999'
      using errcode = '22023';
  end if;

  -- Every product must belong to the tenant and be active (sellable).
  -- Duplicate product_ids merge by summing quantities — and the MERGED
  -- quantity must also respect the 1–9999 bound, or 200 × 9999 lines of
  -- the same product would collapse into one absurd line.
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
    raise exception 'create_order_request: one or more products are unknown, inactive, over the 9999-package limit, or belong to another tenant'
      using errcode = '22023';
  end if;

  -- Optional customer must belong to the tenant; snapshot the identity.
  if p_customer_id is not null then
    select * into v_customer
    from public.customers c
    where c.id = p_customer_id and c.tenant_id = p_tenant_id;
    if not found then
      raise exception 'create_order_request: customer % is unknown or belongs to another tenant', p_customer_id
        using errcode = '22023';
    end if;
  end if;

  v_order_number := public.next_order_number(p_tenant_id);

  -- Order first (status 'new' — the trigger writes the initial history
  -- row); totals are filled in after the lines exist.
  insert into public.orders
    (tenant_id, customer_id, customer_snapshot, order_number, status,
     notes, source)
  values
    (p_tenant_id,
     p_customer_id,
     case when p_customer_id is null then null else jsonb_build_object(
       'name', v_customer.name,
       'city', jsonb_build_object(
         'ar', v_customer.city_ar, 'he', v_customer.city_he,
         'en', v_customer.city_en),
       'phone', v_customer.phone,
       'contact_name', v_customer.contact_name) end,
     v_order_number,
     'new',
     nullif(trim(coalesce(p_notes, '')), ''),
     p_source)
  returning id into v_order_id;

  -- Lines with full snapshots; ALL money computed here from live product
  -- data. line_vat is per-line informational; order-level vat_total below
  -- is the authoritative estimate (rounded once, matching the UI).
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
    p_tenant_id,
    v_order_id,
    p.id,
    jsonb_build_object('ar', p.name_ar, 'he', p.name_he, 'en', p.name_en),
    case when m.id is null then null else jsonb_build_object(
      'ar', m.name_ar, 'he', m.name_he, 'en', m.name_en) end,
    p.package_unit,
    p.package_quantity,
    l.quantity,
    p.wholesale_price,
    p.vat_rate,
    round(l.quantity * p.wholesale_price, 2),
    round(round(l.quantity * p.wholesale_price, 2) * p.vat_rate, 2),
    round(l.quantity * p.wholesale_price, 2)
      + round(round(l.quantity * p.wholesale_price, 2) * p.vat_rate, 2)
  from lines l
  join public.products p
    on p.id = l.product_id
   and p.tenant_id = p_tenant_id
   and p.is_active
  left join public.manufacturers m on m.id = p.manufacturer_id;

  -- Statements run under READ COMMITTED: a product deleted/deactivated
  -- between the validation above and this insert would silently drop its
  -- line. Refuse partial orders outright.
  get diagnostics v_inserted = row_count;
  if v_inserted <> v_item_count then
    raise exception 'create_order_request: catalog changed while ordering — please retry'
      using errcode = '40001'; -- serialization_failure (retryable)
  end if;

  select
    sum(i.line_subtotal),
    round(sum(i.line_subtotal * i.vat_rate_snapshot), 2)
  into v_subtotal, v_vat_total
  from public.order_items i
  where i.order_id = v_order_id;

  update public.orders o
     set subtotal = v_subtotal,
         vat_total = v_vat_total,
         total = v_subtotal + v_vat_total
   where o.id = v_order_id;

  return query select v_order_id, v_order_number;
end;
$$;

comment on function public.create_order_request(uuid, jsonb, uuid, text, public.order_source) is
  'Atomic checkout: validates tenant/customer/products, computes all money server-side, draws the order number, inserts order + snapshotted lines. Service-role only until M4.';

revoke all on function public.create_order_request(uuid, jsonb, uuid, text, public.order_source)
  from public, anon, authenticated;
grant execute on function public.create_order_request(uuid, jsonb, uuid, text, public.order_source)
  to service_role;

-- ── update_order_status ──────────────────────────────────────────────────
-- Validated pipeline transitions:
--   new       → confirmed | cancelled
--   confirmed → preparing | cancelled
--   preparing → delivered | cancelled
--   delivered → (terminal)
--   cancelled → (terminal)
-- Setting the current status again is a no-op (idempotent double-click).
-- History rows come from the existing orders trigger.

create or replace function public.update_order_status(
  p_tenant_id uuid,
  p_order_id uuid,
  p_new_status public.order_status
)
returns table (order_id uuid, old_status public.order_status, new_status public.order_status)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_current public.order_status;
  v_allowed public.order_status[];
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception 'update_order_status: service-role only until the M4 auth milestone'
      using errcode = '42501';
  end if;

  select o.status into v_current
  from public.orders o
  where o.id = p_order_id and o.tenant_id = p_tenant_id
  for update;
  if not found then
    raise exception 'update_order_status: order % is unknown or belongs to another tenant', p_order_id
      using errcode = '22023';
  end if;

  if p_new_status = v_current then
    -- Idempotent: nothing to do, no history noise.
    return query select p_order_id, v_current, v_current;
    return;
  end if;

  v_allowed := case v_current
    when 'new' then array['confirmed', 'cancelled']::public.order_status[]
    when 'confirmed' then array['preparing', 'cancelled']::public.order_status[]
    when 'preparing' then array['delivered', 'cancelled']::public.order_status[]
    else array[]::public.order_status[] -- delivered / cancelled are terminal
  end;

  if not (p_new_status = any (v_allowed)) then
    raise exception 'update_order_status: invalid transition % -> %', v_current, p_new_status
      using errcode = '23514'; -- check_violation
  end if;

  update public.orders o
     set status = p_new_status
   where o.id = p_order_id;

  return query select p_order_id, v_current, p_new_status;
end;
$$;

comment on function public.update_order_status(uuid, uuid, public.order_status) is
  'Validated order-status pipeline transition (history via trigger). Service-role only until M4.';

revoke all on function public.update_order_status(uuid, uuid, public.order_status)
  from public, anon, authenticated;
grant execute on function public.update_order_status(uuid, uuid, public.order_status)
  to service_role;
