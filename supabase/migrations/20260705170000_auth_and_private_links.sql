-- ═══════════════════════════════════════════════════════════════════════
-- Madaf M4A — authenticated access + private shop links
--
-- Evolves the M3 write RPCs from "service-role only" to authenticated,
-- membership-derived authorization, and adds the private (tokenized)
-- shop-link foundation. Direct table writes stay blocked (M3A.1/M3B.1);
-- authenticated users get EXECUTE only on validated RPCs that derive the
-- tenant from tenant_users and check the role in-function.
--
-- Authorization model (see docs/AUTH_AND_ACCESS_MODEL.md):
--   authorize_tenant(p_tenant_id, roles[]) → the caller's effective tenant
--     - service_role: must name an existing tenant (local-dev/bootstrap),
--       not membership-checked;
--     - authenticated: tenant is DERIVED from the caller's tenant_users
--       membership; a client-supplied tenant must match it; role must be
--       one of `roles`; NEVER trusts a client tenant_id;
--     - anyone else (anon): denied.
--   M4A assumes a single membership per user (multi-tenant selection = M4B).
--
-- Private shop links: opaque tokens; only the SHA-256 hash is stored;
-- anon resolves/reads/orders ONLY through SECURITY DEFINER functions that
-- validate the token — there is no anon table access and no public
-- catalog policy. Token orders are source = 'remote_customer'. No
-- documents/invoices are created anywhere here.
-- ═══════════════════════════════════════════════════════════════════════

-- ── authorize_tenant ──────────────────────────────────────────────────────

create or replace function public.authorize_tenant(
  p_tenant_id uuid,
  p_roles public.tenant_role[]
)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text := coalesce((select auth.jwt() ->> 'role'), '');
  v_uid uuid := (select auth.uid());
  v_member_tenant uuid;
  v_member_role public.tenant_role;
begin
  -- Trusted service role (local-dev bootstrap / SECURITY DEFINER internals
  -- that pass an explicit tenant). Must still name an existing tenant.
  if v_role = 'service_role' then
    if p_tenant_id is null
       or not exists (select 1 from public.tenants t where t.id = p_tenant_id) then
      raise exception 'authorize_tenant: service role must pass an existing tenant'
        using errcode = '22023';
    end if;
    return p_tenant_id;
  end if;

  if v_uid is null then
    raise exception 'authorize_tenant: authentication required'
      using errcode = '42501';
  end if;

  -- Tenant is DERIVED from membership — never from the client.
  select tu.tenant_id, tu.role into v_member_tenant, v_member_role
  from public.tenant_users tu
  where tu.user_id = v_uid
  order by tu.created_at
  limit 1;
  if v_member_tenant is null then
    raise exception 'authorize_tenant: caller has no tenant membership'
      using errcode = '42501';
  end if;

  -- A client-supplied tenant_id must match the caller's own tenant.
  if p_tenant_id is not null and p_tenant_id <> v_member_tenant then
    raise exception 'authorize_tenant: cross-tenant access denied'
      using errcode = '42501';
  end if;

  if not (v_member_role = any (p_roles)) then
    raise exception 'authorize_tenant: role % is not permitted for this action', v_member_role
      using errcode = '42501';
  end if;

  return v_member_tenant;
end;
$$;

comment on function public.authorize_tenant(uuid, public.tenant_role[]) is
  'Resolves the caller''s effective tenant (from tenant_users for authenticated users; an explicit existing tenant for service_role) and enforces the allowed roles. Never trusts a client tenant_id.';

revoke all on function public.authorize_tenant(uuid, public.tenant_role[]) from public, anon;
grant execute on function public.authorize_tenant(uuid, public.tenant_role[]) to authenticated, service_role;

-- ── current_membership — app helper for the auth/tenant context ───────────

create or replace function public.current_membership()
returns table (tenant_id uuid, role public.tenant_role)
language sql
stable
security definer
set search_path = ''
as $$
  select tu.tenant_id, tu.role
  from public.tenant_users tu
  where tu.user_id = (select auth.uid())
  order by tu.created_at
  limit 1;
$$;

comment on function public.current_membership() is
  'The calling authenticated user''s (single) tenant membership, or no rows.';

revoke all on function public.current_membership() from public, anon;
grant execute on function public.current_membership() to authenticated, service_role;

-- Enforce the M4A single-membership invariant at the schema level: a user
-- belongs to at most one tenant. This is also the race backstop for
-- create_tenant_with_owner (its check-then-insert is otherwise a TOCTOU
-- window under READ COMMITTED). M4B, which introduces multi-tenant
-- membership, will drop this deliberately.
alter table public.tenant_users
  add constraint tenant_users_single_membership_uniq unique (user_id);

-- ── create_tenant_with_owner — minimal onboarding ────────────────────────
-- A freshly signed-up authenticated user with NO membership creates their
-- tenant and becomes its owner, atomically. Refuses if the user already
-- belongs to a tenant (M4A is single-membership).

create or replace function public.create_tenant_with_owner(
  p_name_ar text,
  p_name_he text,
  p_name_en text,
  p_default_locale public.locale_code default 'he'
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_tenant_id uuid;
  v_ar text := nullif(trim(coalesce(p_name_ar, '')), '');
  v_he text := nullif(trim(coalesce(p_name_he, '')), '');
  v_en text := nullif(trim(coalesce(p_name_en, '')), '');
begin
  if v_uid is null then
    raise exception 'create_tenant_with_owner: authentication required'
      using errcode = '42501';
  end if;
  if exists (select 1 from public.tenant_users tu where tu.user_id = v_uid) then
    raise exception 'create_tenant_with_owner: user already belongs to a tenant'
      using errcode = '42501';
  end if;
  if v_ar is null or v_he is null or v_en is null then
    raise exception 'create_tenant_with_owner: name_ar, name_he and name_en are required'
      using errcode = '22023';
  end if;
  if greatest(length(v_ar), length(v_he), length(v_en)) > 200 then
    raise exception 'create_tenant_with_owner: names must be 200 characters or fewer'
      using errcode = '22023';
  end if;

  insert into public.tenants (name_ar, name_he, name_en, default_locale, document_locale)
  values (v_ar, v_he, v_en, p_default_locale, p_default_locale)
  returning id into v_tenant_id;

  insert into public.tenant_users (tenant_id, user_id, role)
  values (v_tenant_id, v_uid, 'owner');

  return v_tenant_id;
exception
  -- Concurrent onboarding (two tabs / double submit) loses the race on the
  -- unique(user_id) backstop; surface it as the same clean "already a
  -- member" error instead of a raw constraint violation. The whole function
  -- is one transaction, so the just-inserted tenant rolls back too — no
  -- orphan tenant is left behind.
  when unique_violation then
    raise exception 'create_tenant_with_owner: user already belongs to a tenant'
      using errcode = '42501';
end;
$$;

comment on function public.create_tenant_with_owner(text, text, text, public.locale_code) is
  'Onboarding: a membership-less authenticated user creates a tenant and becomes its owner (atomic). M4A is single-membership.';

revoke all on function public.create_tenant_with_owner(text, text, text, public.locale_code) from public, anon;
grant execute on function public.create_tenant_with_owner(text, text, text, public.locale_code) to authenticated, service_role;

-- ── _order_create_core — gate-free order insert (PRIVATE) ─────────────────
-- The validated order body extracted from M3A's create_order_request, with
-- the auth gate REMOVED and the order number drawn inline (so the token
-- flow, which runs as anon, can create orders without hitting the
-- authenticated-only next_order_number). EXECUTE is revoked from everyone:
-- it is reachable only through the SECURITY DEFINER wrappers below, which
-- have already authorized the caller and resolved the tenant.

create or replace function public._order_create_core(
  p_tenant_id uuid,
  p_items jsonb,
  p_customer_id uuid,
  p_notes text,
  p_source public.order_source
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
$$;

comment on function public._order_create_core(uuid, jsonb, uuid, text, public.order_source) is
  'PRIVATE order-insert core (no auth gate). Reachable only via the SECURITY DEFINER order wrappers, which authorize the caller first.';

revoke all on function public._order_create_core(uuid, jsonb, uuid, text, public.order_source)
  from public, anon, authenticated;
grant execute on function public._order_create_core(uuid, jsonb, uuid, text, public.order_source)
  to service_role;

-- ── create_order_request — now authenticated (owner/admin/sales_rep) ──────

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
  v_tenant uuid;
begin
  -- Tenant derived + role checked from membership (or service_role).
  v_tenant := public.authorize_tenant(
    p_tenant_id,
    array['owner', 'admin', 'sales_rep']::public.tenant_role[]);
  -- Token/remote sources may only be created by the token flow, not here.
  if p_source = 'remote_customer' then
    raise exception 'create_order_request: remote_customer orders come only from a shop link'
      using errcode = '22023';
  end if;
  return query
    select * from public._order_create_core(
      v_tenant, p_items, p_customer_id, p_notes, coalesce(p_source, 'sales_visit'));
end;
$$;

comment on function public.create_order_request(uuid, jsonb, uuid, text, public.order_source) is
  'Authenticated checkout (owner/admin/sales_rep). Tenant derived from membership; all money computed server-side; source may not be remote_customer.';

revoke all on function public.create_order_request(uuid, jsonb, uuid, text, public.order_source)
  from public, anon;
grant execute on function public.create_order_request(uuid, jsonb, uuid, text, public.order_source)
  to authenticated, service_role;

-- ── update_order_status — now authenticated (owner/admin) ─────────────────

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
  v_tenant uuid;
  v_current public.order_status;
  v_allowed public.order_status[];
begin
  v_tenant := public.authorize_tenant(
    p_tenant_id, array['owner', 'admin']::public.tenant_role[]);

  select o.status into v_current
  from public.orders o
  where o.id = p_order_id and o.tenant_id = v_tenant
  for update;
  if not found then
    raise exception 'update_order_status: order % is unknown or belongs to another tenant', p_order_id
      using errcode = '22023';
  end if;

  if p_new_status = v_current then
    return query select p_order_id, v_current, v_current;
    return;
  end if;

  v_allowed := case v_current
    when 'new' then array['confirmed', 'cancelled']::public.order_status[]
    when 'confirmed' then array['preparing', 'cancelled']::public.order_status[]
    when 'preparing' then array['delivered', 'cancelled']::public.order_status[]
    else array[]::public.order_status[]
  end;
  if not (p_new_status = any (v_allowed)) then
    raise exception 'update_order_status: invalid transition % -> %', v_current, p_new_status
      using errcode = '23514';
  end if;

  update public.orders o set status = p_new_status where o.id = p_order_id;
  return query select p_order_id, v_current, p_new_status;
end;
$$;

comment on function public.update_order_status(uuid, uuid, public.order_status) is
  'Authenticated order-status transition (owner/admin). Tenant derived from membership; history via trigger.';

revoke all on function public.update_order_status(uuid, uuid, public.order_status)
  from public, anon;
grant execute on function public.update_order_status(uuid, uuid, public.order_status)
  to authenticated, service_role;

-- ── Catalog RPCs — now authenticated (owner/admin only) ───────────────────
-- Re-declared from M3B with the service-role gate replaced by
-- authorize_tenant([owner,admin]); the tenant is derived from membership.
-- sales_rep is intentionally excluded — reps cannot mutate the catalog.
-- Bodies are otherwise identical to 20260705150000.

create or replace function public.create_product(
  p_tenant_id uuid,
  p_product jsonb,
  p_inventory jsonb default null
)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v record;
  v_product_id uuid;
begin
  p_tenant_id := public.authorize_tenant(p_tenant_id, array['owner', 'admin']::public.tenant_role[]);
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
    perform public.upsert_inventory_item(p_tenant_id, v_product_id, p_inventory);
  end if;
  return v_product_id;
end;
$$;
revoke all on function public.create_product(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.create_product(uuid, jsonb, jsonb) to authenticated, service_role;

create or replace function public.update_product(
  p_tenant_id uuid,
  p_product_id uuid,
  p_product jsonb,
  p_inventory jsonb default null
)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v record;
begin
  p_tenant_id := public.authorize_tenant(p_tenant_id, array['owner', 'admin']::public.tenant_role[]);
  if not exists (
    select 1 from public.products p where p.id = p_product_id and p.tenant_id = p_tenant_id
  ) then
    raise exception 'update_product: product is unknown or belongs to another tenant'
      using errcode = '22023';
  end if;
  select * into v from public.validate_product_payload(p_tenant_id, p_product);
  begin
    update public.products p set
      manufacturer_id = v.manufacturer_id, category_id = v.category_id,
      sku = v.sku, barcode = v.barcode,
      name_ar = v.name_ar, name_he = v.name_he, name_en = v.name_en,
      description_ar = v.description_ar, description_he = v.description_he, description_en = v.description_en,
      package_unit = v.package_unit, package_quantity = v.package_quantity,
      base_unit = v.base_unit, unit_size = v.unit_size,
      wholesale_price = v.wholesale_price, vat_rate = v.vat_rate,
      image_url = v.image_url, track_expiry = v.track_expiry, is_active = v.is_active
    where p.id = p_product_id and p.tenant_id = p_tenant_id;
  exception when unique_violation then
    raise exception 'update_product: a product with this SKU already exists in this tenant'
      using errcode = '22023';
  end;
  if p_inventory is not null then
    perform public.upsert_inventory_item(p_tenant_id, p_product_id, p_inventory);
  end if;
  return p_product_id;
end;
$$;
revoke all on function public.update_product(uuid, uuid, jsonb, jsonb) from public, anon;
grant execute on function public.update_product(uuid, uuid, jsonb, jsonb) to authenticated, service_role;

create or replace function public.set_product_active(
  p_tenant_id uuid,
  p_product_id uuid,
  p_is_active boolean
)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
begin
  p_tenant_id := public.authorize_tenant(p_tenant_id, array['owner', 'admin']::public.tenant_role[]);
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
revoke all on function public.set_product_active(uuid, uuid, boolean) from public, anon;
grant execute on function public.set_product_active(uuid, uuid, boolean) to authenticated, service_role;

create or replace function public.upsert_inventory_item(
  p_tenant_id uuid,
  p_product_id uuid,
  p_inventory jsonb
)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_quantity integer;
  v_threshold integer;
  v_location text;
  v_expiry date;
  v_id uuid;
begin
  p_tenant_id := public.authorize_tenant(p_tenant_id, array['owner', 'admin']::public.tenant_role[]);
  if not exists (
    select 1 from public.products p where p.id = p_product_id and p.tenant_id = p_tenant_id
  ) then
    raise exception 'upsert_inventory_item: product is unknown or belongs to another tenant'
      using errcode = '22023';
  end if;
  v_quantity := coalesce((p_inventory ->> 'quantity_available')::integer, 0);
  if v_quantity < 0 or v_quantity > 100000000 then
    raise exception 'inventory: quantity_available must be between 0 and 100000000' using errcode = '22023';
  end if;
  v_threshold := coalesce((p_inventory ->> 'low_stock_threshold')::integer, 10);
  if v_threshold < 0 or v_threshold > 100000000 then
    raise exception 'inventory: low_stock_threshold must be 0 or greater' using errcode = '22023';
  end if;
  v_location := nullif(trim(coalesce(p_inventory ->> 'warehouse_location', '')), '');
  if coalesce(length(v_location), 0) > 40 then
    raise exception 'inventory: warehouse_location must be 40 characters or fewer' using errcode = '22023';
  end if;
  v_expiry := nullif(p_inventory ->> 'expiry_date', '')::date;

  insert into public.inventory_items
    (tenant_id, product_id, quantity_available, low_stock_threshold, warehouse_location, expiry_date)
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
revoke all on function public.upsert_inventory_item(uuid, uuid, jsonb) from public, anon;
grant execute on function public.upsert_inventory_item(uuid, uuid, jsonb) to authenticated, service_role;

create or replace function public.create_manufacturer(
  p_tenant_id uuid,
  p_name_ar text, p_name_he text, p_name_en text,
  p_logo_url text default null, p_sort_order integer default 0
)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_id uuid;
  v_ar text := nullif(trim(coalesce(p_name_ar, '')), '');
  v_he text := nullif(trim(coalesce(p_name_he, '')), '');
  v_en text := nullif(trim(coalesce(p_name_en, '')), '');
  v_logo text := nullif(trim(coalesce(p_logo_url, '')), '');
begin
  p_tenant_id := public.authorize_tenant(p_tenant_id, array['owner', 'admin']::public.tenant_role[]);
  if v_ar is null or v_he is null or v_en is null then
    raise exception 'manufacturer: name_ar, name_he and name_en are required' using errcode = '22023';
  end if;
  if greatest(length(v_ar), length(v_he), length(v_en)) > 200 or coalesce(length(v_logo), 0) > 500 then
    raise exception 'manufacturer: name (<=200) or logo_url (<=500) too long' using errcode = '22023';
  end if;
  insert into public.manufacturers (tenant_id, name_ar, name_he, name_en, logo_url, sort_order)
  values (p_tenant_id, v_ar, v_he, v_en, v_logo, coalesce(p_sort_order, 0))
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.create_manufacturer(uuid, text, text, text, text, integer) from public, anon;
grant execute on function public.create_manufacturer(uuid, text, text, text, text, integer) to authenticated, service_role;

create or replace function public.update_manufacturer(
  p_tenant_id uuid, p_manufacturer_id uuid,
  p_name_ar text, p_name_he text, p_name_en text,
  p_logo_url text default null, p_sort_order integer default null
)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_ar text := nullif(trim(coalesce(p_name_ar, '')), '');
  v_he text := nullif(trim(coalesce(p_name_he, '')), '');
  v_en text := nullif(trim(coalesce(p_name_en, '')), '');
  v_logo text := nullif(trim(coalesce(p_logo_url, '')), '');
begin
  p_tenant_id := public.authorize_tenant(p_tenant_id, array['owner', 'admin']::public.tenant_role[]);
  if not exists (
    select 1 from public.manufacturers m where m.id = p_manufacturer_id and m.tenant_id = p_tenant_id
  ) then
    raise exception 'update_manufacturer: manufacturer is unknown or belongs to another tenant'
      using errcode = '22023';
  end if;
  if v_ar is null or v_he is null or v_en is null then
    raise exception 'manufacturer: name_ar, name_he and name_en are required' using errcode = '22023';
  end if;
  if greatest(length(v_ar), length(v_he), length(v_en)) > 200 or coalesce(length(v_logo), 0) > 500 then
    raise exception 'manufacturer: name (<=200) or logo_url (<=500) too long' using errcode = '22023';
  end if;
  update public.manufacturers m set
    name_ar = v_ar, name_he = v_he, name_en = v_en, logo_url = v_logo,
    sort_order = coalesce(p_sort_order, m.sort_order)
  where m.id = p_manufacturer_id and m.tenant_id = p_tenant_id;
  return p_manufacturer_id;
end;
$$;
revoke all on function public.update_manufacturer(uuid, uuid, text, text, text, text, integer) from public, anon;
grant execute on function public.update_manufacturer(uuid, uuid, text, text, text, text, integer) to authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════
-- Private shop links (tokenized customer access)
-- ═══════════════════════════════════════════════════════════════════════

create table public.customer_access_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  customer_id uuid not null,
  -- SHA-256 hex of the raw token — the raw token is NEVER stored and is
  -- returned only once at creation time.
  token_hash text not null unique,
  -- A short, non-secret hint (e.g. last 4 chars) for the admin list.
  token_preview text,
  label text,
  expires_at timestamptz,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Composite FK: the link's customer must belong to the link's tenant.
  foreign key (tenant_id, customer_id)
    references public.customers (tenant_id, id) on delete cascade
);

comment on table public.customer_access_links is
  'Tokenized private shop links. Only token_hash is stored; anon resolves/reads/orders exclusively through SECURITY DEFINER token functions — no anon table access, no public catalog policy.';

create index customer_access_links_tenant_customer_idx
  on public.customer_access_links (tenant_id, customer_id);

create trigger customer_access_links_set_updated_at
  before update on public.customer_access_links
  for each row execute function public.set_updated_at();

alter table public.customer_access_links enable row level security;

-- Members may READ their tenant's links (to list/manage in admin), but
-- NOT the token_hash column: it is never shown in the UI, and — since the
-- resolver hashes the raw token server-side — a leaked hash must not be a
-- usable credential (column-scoped grant = defense in depth on top of that).
-- No direct write policies or grants — creation/revocation go through the
-- RPCs below. anon gets nothing (token lookups are SECURITY DEFINER only).
grant select (
  id, tenant_id, customer_id, token_preview, label,
  expires_at, revoked_at, last_used_at, created_by, created_at, updated_at
) on public.customer_access_links to authenticated;
grant select, insert, update, delete on public.customer_access_links to service_role;

create policy "customer_access_links: members can read"
  on public.customer_access_links for select to authenticated
  using (public.is_tenant_member(tenant_id));

-- ── insert / revoke (authenticated owner/admin) ───────────────────────────

create or replace function public.insert_customer_access_link(
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
  -- Tenant derived from membership; owner/admin only.
  v_tenant := public.authorize_tenant(null, array['owner', 'admin']::public.tenant_role[]);
  if p_token_hash is null or length(p_token_hash) < 32 or length(p_token_hash) > 128 then
    raise exception 'insert_customer_access_link: invalid token hash' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.customers c where c.id = p_customer_id and c.tenant_id = v_tenant
  ) then
    raise exception 'insert_customer_access_link: customer is unknown or belongs to another tenant'
      using errcode = '22023';
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
revoke all on function public.insert_customer_access_link(uuid, text, text, text, timestamptz) from public, anon;
grant execute on function public.insert_customer_access_link(uuid, text, text, text, timestamptz) to authenticated, service_role;

create or replace function public.revoke_customer_access_link(p_link_id uuid)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  v_tenant := public.authorize_tenant(null, array['owner', 'admin']::public.tenant_role[]);
  update public.customer_access_links l
     set revoked_at = coalesce(l.revoked_at, now())
   where l.id = p_link_id and l.tenant_id = v_tenant;
  if not found then
    raise exception 'revoke_customer_access_link: link is unknown or belongs to another tenant'
      using errcode = '22023';
  end if;
  return p_link_id;
end;
$$;
revoke all on function public.revoke_customer_access_link(uuid) from public, anon;
grant execute on function public.revoke_customer_access_link(uuid) to authenticated, service_role;

-- ── _resolve_token — PRIVATE token validation ─────────────────────────────
-- Takes the RAW token and hashes it HERE (SHA-256), so the stored
-- token_hash is never a usable credential: a leaked/backed-up hash cannot
-- be replayed against the anon token RPCs, because the caller must present
-- a preimage. Returns the (tenant, customer) for a valid, non-revoked,
-- non-expired token, else raises. Reachable only via the anon-facing
-- token functions.

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
  return query select v_link.tenant_id, v_link.customer_id, v_link.id;
end;
$$;
revoke all on function public._resolve_token(text) from public, anon, authenticated;
grant execute on function public._resolve_token(text) to service_role;

-- ── get_token_catalog(raw_token) → jsonb  (anon, token-scoped) ────────────
-- Validates the RAW token (hashed inside _resolve_token) and returns ONLY
-- that tenant's active catalog plus the linked customer + tenant identity.
-- No RLS product policy for anon exists; this is the only way a shop reads
-- a catalog. The response reveals neither tenant_id nor customer_id.

create or replace function public.get_token_catalog(p_token text)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_tenant uuid;
  v_customer uuid;
  v_link uuid;
  v_result jsonb;
begin
  select tenant_id, customer_id, link_id into v_tenant, v_customer, v_link
  from public._resolve_token(p_token);

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
$$;
revoke all on function public.get_token_catalog(text) from public;
grant execute on function public.get_token_catalog(text) to anon, authenticated, service_role;

-- ── create_order_request_from_token — token order submit (anon) ───────────
-- The shop submits an order for its linked customer only. Tenant + customer
-- come from the token; the shop can never set tenant_id/customer_id. All
-- money is computed server-side; source is 'remote_customer'.

create or replace function public.create_order_request_from_token(
  p_token text,
  p_items jsonb,
  p_notes text default null
)
returns table (order_number text)
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_tenant uuid;
  v_customer uuid;
  v_link uuid;
  v_order_number text;
begin
  select tenant_id, customer_id, link_id into v_tenant, v_customer, v_link
  from public._resolve_token(p_token);

  select o.order_number into v_order_number
  from public._order_create_core(v_tenant, p_items, v_customer, p_notes, 'remote_customer') o;

  update public.customer_access_links set last_used_at = now() where id = v_link;
  return query select v_order_number;
end;
$$;
revoke all on function public.create_order_request_from_token(text, jsonb, text) from public;
grant execute on function public.create_order_request_from_token(text, jsonb, text) to anon, authenticated, service_role;
