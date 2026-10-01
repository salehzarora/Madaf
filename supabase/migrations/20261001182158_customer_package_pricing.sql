-- Customer package pricing V1. Inert until service-controlled activation.
-- No historical prices are backfilled. No new order creation path is added.
alter table public.products add column package_contract_revision bigint not null default 1
  check (package_contract_revision > 0);

create function public._advance_package_contract() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.package_contract_revision := 1;
  elsif row(new.package_unit, new.package_quantity, new.base_unit, nullif(btrim(new.unit_size), ''))
    is distinct from row(old.package_unit, old.package_quantity, old.base_unit, nullif(btrim(old.unit_size), '')) then
    new.package_contract_revision := old.package_contract_revision + 1;
  else
    new.package_contract_revision := old.package_contract_revision;
  end if;
  return new;
end;
$$;
create trigger products_package_contract before insert or update on public.products
for each row execute function public._advance_package_contract();

create table public.tenant_pricing_state (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  mode text not null default 'disabled' check (mode in ('disabled', 'active', 'paused')),
  epoch bigint not null default 1 check (epoch > 0),
  updated_at timestamptz not null default now()
);
alter table public.tenant_pricing_state enable row level security;
revoke all on public.tenant_pricing_state from public, anon, authenticated, service_role;
grant select on public.tenant_pricing_state to service_role;
insert into public.tenant_pricing_state(tenant_id) select id from public.tenants;
create function public._provision_pricing_state() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.tenant_pricing_state(tenant_id) values (new.id);
  return new;
end;
$$;
create trigger tenants_pricing_state after insert on public.tenants
for each row execute function public._provision_pricing_state();

create function public.set_tenant_pricing_state(p_tenant_id uuid, p_mode text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_state public.tenant_pricing_state;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'pricing: service-controlled state' using errcode = '42501';
  end if;
  select * into v_state from public.tenant_pricing_state where tenant_id = p_tenant_id for update;
  if not found or p_mode is null or p_mode not in ('disabled', 'active', 'paused')
    or (p_mode = 'disabled' and v_state.mode <> 'disabled') then
    raise exception 'pricing: invalid state transition' using errcode = '22023';
  end if;
  if v_state.mode <> p_mode then
    update public.tenant_pricing_state set mode = p_mode, epoch = epoch + 1, updated_at = now()
    where tenant_id = p_tenant_id;
  end if;
end;
$$;
revoke all on function public.set_tenant_pricing_state(uuid, text) from public, anon, authenticated;
grant execute on function public.set_tenant_pricing_state(uuid, text) to service_role;

create table public.customer_product_prices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  customer_id uuid not null,
  product_id uuid not null,
  package_price numeric(12,2) not null check (package_price between 0.01 and 9999999.00),
  enabled boolean not null default true,
  revision bigint not null default 1 check (revision > 0),
  package_contract_revision bigint not null check (package_contract_revision > 0),
  package_unit public.package_unit not null,
  package_quantity integer not null check (package_quantity > 0),
  base_unit public.base_unit not null,
  unit_size text,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, customer_id, product_id),
  foreign key (tenant_id, customer_id) references public.customers(tenant_id, id) on delete restrict,
  foreign key (tenant_id, product_id) references public.products(tenant_id, id) on delete restrict
);
create index customer_product_prices_product on public.customer_product_prices(tenant_id, product_id);
alter table public.customer_product_prices enable row level security;
revoke all on public.customer_product_prices from public, anon, authenticated, service_role;
grant select on public.customer_product_prices to service_role;

alter table public.order_items
  add column pricing_source_snapshot text check (pricing_source_snapshot in ('base', 'customer_agreement')),
  add column pricing_agreement_id_snapshot uuid,
  add column pricing_agreement_revision_snapshot bigint,
  add column package_contract_revision_snapshot bigint,
  add column base_unit_snapshot public.base_unit,
  add column unit_size_snapshot text;
-- Provenance deliberately has no FK to mutable agreements; saved history survives removal.

create function public._pricing_state(p_tenant uuid) returns public.tenant_pricing_state
language plpgsql security invoker set search_path = '' as $$
declare v public.tenant_pricing_state;
begin
  select * into v from public.tenant_pricing_state where tenant_id = p_tenant for share;
  if not found then raise exception 'pricing: unavailable' using errcode = 'MDF50'; end if;
  return v;
end;
$$;

create function public._pricing_customer(p_tenant uuid, p_customer uuid) returns void
language plpgsql security invoker set search_path = '' as $$
begin
  if p_customer is not null and not exists (
    select 1 from public.customers where tenant_id = p_tenant and id = p_customer and is_active
  ) then raise exception 'pricing: customer unavailable' using errcode = '42501'; end if;
end;
$$;

create function public._pricing_actor(p_tenant uuid, p_customer uuid) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare v uuid;
begin
  v := public.authorize_tenant(p_tenant, array['owner','admin','sales_rep']::public.tenant_role[]);
  if public.has_tenant_role(v, array['sales_rep']::public.tenant_role[])
    and (p_customer is null or not public.can_access_customer(v, p_customer)) then
    raise exception 'pricing: customer access denied' using errcode = '42501';
  end if;
  perform public._pricing_customer(v, p_customer);
  return v;
end;
$$;

create function public._log_customer_price(p_tenant uuid, p_id uuid, p_action text) returns void
language plpgsql security invoker set search_path = '' as $$
begin
  if p_action is null or p_action not in ('set', 'reconfirmed', 'removed') then
    raise exception 'pricing: invalid audit event' using errcode = '22023';
  end if;
  insert into public.audit_events(tenant_id, actor_user_id, event_type, entity_type, entity_id, metadata)
  values(p_tenant, auth.uid(), 'customer_price.' || p_action, 'customer_price', p_id, '{}'::jsonb);
end;
$$;

create function public.manage_customer_product_price(
  p_tenant_id uuid, p_customer_id uuid, p_product_id uuid, p_action text,
  p_expected_revision bigint, p_package_revision bigint, p_price text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid; v_product public.products; v_old public.customer_product_prices;
  v_price numeric; v_exists boolean; v_id uuid;
begin
  v_tenant := public.authorize_tenant(p_tenant_id, array['owner','admin']::public.tenant_role[]);
  perform public._pricing_state(v_tenant); -- Management is allowed while disabled/paused.
  perform public._pricing_customer(v_tenant, p_customer_id);
  if p_customer_id is null or p_action is null or p_action not in ('set','reconfirm','remove')
    or p_expected_revision is null or p_expected_revision < 0 then
    raise exception 'pricing: invalid agreement operation' using errcode = '22023';
  end if;
  -- The product is the anchor even when no agreement row exists yet.
  select * into v_product from public.products
  where tenant_id = v_tenant and id = p_product_id for no key update;
  if not found then raise exception 'pricing: unknown product' using errcode = '42501'; end if;
  perform public.authorize_tenant(v_tenant, array['owner','admin']::public.tenant_role[]);
  perform public._pricing_customer(v_tenant, p_customer_id);
  if p_package_revision is distinct from v_product.package_contract_revision then
    raise exception 'pricing: reviewed package changed; refresh' using errcode = 'MDF51';
  end if;
  select * into v_old from public.customer_product_prices
  where tenant_id = v_tenant and customer_id = p_customer_id and product_id = p_product_id;
  v_exists := found;
  if coalesce(v_old.revision, 0) <> p_expected_revision then
    raise exception 'pricing: agreement changed; refresh' using errcode = 'MDF51';
  end if;
  if p_action = 'remove' then
    if not v_exists or not v_old.enabled then return jsonb_build_object('revision', coalesce(v_old.revision,0)); end if;
    update public.customer_product_prices set enabled = false, revision = revision + 1,
      updated_by = auth.uid(), updated_at = now() where id = v_old.id returning id into v_id;
  else
    if p_price is null or p_price !~ '^[0-9]+(\.[0-9]{1,2})?$' or length(p_price) > 16 then
      raise exception 'pricing: exact positive decimal required' using errcode = '22023';
    end if;
    v_price := p_price::numeric;
    if v_price < 0.01 or v_price > 9999999.00 then
      raise exception 'pricing: price out of range' using errcode = '22023';
    end if;
    if p_action = 'reconfirm' and (not v_exists or not v_old.enabled) then
      raise exception 'pricing: no enabled agreement to reconfirm' using errcode = '22023';
    end if;
    if v_exists and v_old.enabled and (v_old.package_contract_revision <> v_product.package_contract_revision
      or row(v_old.package_unit,v_old.package_quantity,v_old.base_unit,v_old.unit_size)
        is distinct from row(v_product.package_unit,v_product.package_quantity,v_product.base_unit,nullif(btrim(v_product.unit_size),'')))
      and p_action <> 'reconfirm' then
      raise exception 'pricing: stale package requires reconfirmation' using errcode = 'MDF52';
    end if;
    if v_exists and v_old.enabled and v_old.package_price = v_price
      and v_old.package_contract_revision = v_product.package_contract_revision
      and row(v_old.package_unit,v_old.package_quantity,v_old.base_unit,v_old.unit_size)
        is not distinct from row(v_product.package_unit,v_product.package_quantity,v_product.base_unit,nullif(btrim(v_product.unit_size),'')) then
      return jsonb_build_object('revision', v_old.revision);
    end if;
    insert into public.customer_product_prices(tenant_id, customer_id, product_id, package_price,
      package_contract_revision, package_unit, package_quantity, base_unit, unit_size, created_by, updated_by)
    values(v_tenant, p_customer_id, p_product_id, v_price, v_product.package_contract_revision,
      v_product.package_unit, v_product.package_quantity, v_product.base_unit, nullif(btrim(v_product.unit_size), ''), auth.uid(), auth.uid())
    on conflict (tenant_id, customer_id, product_id) do update set
      package_price = excluded.package_price, enabled = true, revision = customer_product_prices.revision + 1,
      package_contract_revision = excluded.package_contract_revision, package_unit = excluded.package_unit,
      package_quantity = excluded.package_quantity, base_unit = excluded.base_unit, unit_size = excluded.unit_size,
      updated_by = auth.uid(), updated_at = now() returning id into v_id;
  end if;
  perform public._log_customer_price(v_tenant, v_id,
    case p_action when 'remove' then 'removed' when 'reconfirm' then 'reconfirmed' else 'set' end);
  return (select jsonb_build_object('revision', revision) from public.customer_product_prices where id = v_id);
end;
$$;

create function public.list_customer_product_prices(p_tenant_id uuid, p_customer_id uuid, p_search text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_tenant uuid; v_state public.tenant_pricing_state;
begin
  v_tenant := public.authorize_tenant(p_tenant_id, array['owner','admin']::public.tenant_role[]);
  v_state := public._pricing_state(v_tenant);
  perform public.authorize_tenant(v_tenant, array['owner','admin']::public.tenant_role[]);
  perform public._pricing_customer(v_tenant, p_customer_id);
  if p_customer_id is null or p_search is null or length(p_search) > 100 then
    raise exception 'pricing: invalid search' using errcode = '22023';
  end if;
  return jsonb_build_object('mode', v_state.mode, 'products', coalesce((select jsonb_agg(x.data) from (
    select jsonb_build_object('id', p.id, 'name', jsonb_build_object('ar',p.name_ar,'he',p.name_he,'en',p.name_en),
      'packageUnit', p.package_unit, 'packageQuantity', p.package_quantity, 'baseUnit', p.base_unit, 'unitSize', p.unit_size,
      'basePrice', p.wholesale_price::text, 'price', a.package_price::text, 'revision', coalesce(a.revision,0), 'packageRevision', p.package_contract_revision,
      'status', case when a.id is null then 'base' when not a.enabled then 'removed'
        when (a.package_contract_revision <> p.package_contract_revision or row(a.package_unit,a.package_quantity,a.base_unit,a.unit_size) is distinct from row(p.package_unit,p.package_quantity,p.base_unit,nullif(btrim(p.unit_size),''))) then 'stale_package' else 'customer_agreement' end) data
    from public.products p left join public.customer_product_prices a
      on a.tenant_id = p.tenant_id and a.product_id = p.id and a.customer_id = p_customer_id
    where p.tenant_id = v_tenant and p.is_active and (p_search = '' or
      strpos(lower(concat_ws(' ',p.name_ar,p.name_he,p.name_en,p.sku)),lower(p_search)) > 0)
    order by p.name_he, p.id limit 50
  ) x), '[]'::jsonb));
end;
$$;

-- Private projection: caller has authenticated the scope and taken the state
-- lock (and an order lock for edits). Product locks are sorted and shared.
create function public._effective_product_prices(p_tenant uuid, p_customer uuid, p_ids uuid[], p_mode text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_result jsonb;
begin
  if p_ids is null or cardinality(p_ids) > 200 or array_position(p_ids, null) is not null then
    raise exception 'pricing: at most 200 product ids' using errcode = '22023';
  end if;
  perform p.id from public.products p where p.tenant_id = p_tenant and p.id = any(p_ids) order by p.id for share;
  select coalesce(jsonb_agg(jsonb_build_object(
    'product_id', ids.id, 'status', case when p.id is null or not p.is_active then 'unavailable'
      when p_mode = 'paused' then 'paused'
      when p_mode = 'active' and a.enabled and (a.package_contract_revision <> p.package_contract_revision or row(a.package_unit,a.package_quantity,a.base_unit,a.unit_size) is distinct from row(p.package_unit,p.package_quantity,p.base_unit,nullif(btrim(p.unit_size),''))) then 'stale_package'
      when p_mode = 'active' and a.enabled then 'customer_agreement' else 'base' end,
    'price', case when p_mode = 'active' and a.enabled then a.package_price else p.wholesale_price end,
    'vat', p.vat_rate, 'package_unit', p.package_unit, 'package_quantity', p.package_quantity,
    'base_unit', p.base_unit, 'unit_size', nullif(btrim(p.unit_size), ''), 'package_revision', p.package_contract_revision,
    'agreement_id', case when p_mode = 'active' then a.id end,
    'agreement_revision', case when p_mode = 'active' then a.revision end,
    'agreement_enabled', case when p_mode = 'active' then a.enabled end,
    'name', jsonb_build_object('ar',p.name_ar,'he',p.name_he,'en',p.name_en),
    'manufacturer', case when m.id is not null then jsonb_build_object('ar',m.name_ar,'he',m.name_he,'en',m.name_en) end
  ) order by ids.id), '[]'::jsonb) into v_result
  from (select distinct unnest(p_ids) id) ids
  left join public.products p on p.tenant_id = p_tenant and p.id = ids.id
  left join public.manufacturers m on m.id = p.manufacturer_id
  left join public.customer_product_prices a on a.tenant_id = p_tenant and a.customer_id = p_customer and a.product_id = ids.id;
  return v_result;
end;
$$;

-- Public pricing responses contain effective terms only; agreement records remain private.
create function public._public_prices(p_prices jsonb) returns jsonb
language sql security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('product_id',e->'product_id','status',e->'status',
    'price',case when e->>'status' in ('base','customer_agreement') then e->>'price' end,
    'vat',case when e->>'status' in ('base','customer_agreement') then e->>'vat' end)), '[]'::jsonb)
  from jsonb_array_elements(p_prices) e;
$$;
create function public._public_quote(p_projection jsonb) returns jsonb
language sql security invoker set search_path = '' as $$
  select jsonb_build_object('quote',p_projection->'quote','mode',p_projection->'mode',
    'unchangedItems',p_projection->'unchangedItems',
    'headers',jsonb_build_object('subtotal',p_projection#>>'{headers,subtotal}',
      'vat',p_projection#>>'{headers,vat}','total',p_projection#>>'{headers,total}'),
    'lines',coalesce((select jsonb_agg(jsonb_build_object(
    'product_id',e->'product_id','quantity',e->'quantity','unit_price_snapshot',e->>'unit_price_snapshot',
    'vat_rate_snapshot',e->>'vat_rate_snapshot','line_subtotal',e->>'line_subtotal',
    'line_vat',e->>'line_vat','line_total',e->>'line_total')) from jsonb_array_elements(p_projection->'lines') e),'[]'::jsonb));
$$;
create function public._pricing_token_scope(p_token text,p_showcase boolean,p_order boolean)
returns table(tenant_id uuid,customer_id uuid,link_id uuid)
language plpgsql security invoker set search_path = '' as $$
declare v_fp text := encode(sha256(convert_to(coalesce(p_token,''),'UTF8')),'hex');
  v_purpose text := (case when p_showcase then 'showcase' else 'shop' end) || (case when p_order then '_order' else '_catalog' end);
begin
  if public._token_rate_exceeded(v_purpose,v_fp) then return; end if;
  begin
    if p_showcase then return query select r.tenant_id,null::uuid,r.link_id from public._resolve_showcase_token(p_token) r;
    else return query select r.tenant_id,r.customer_id,r.link_id from public._resolve_token(p_token) r; end if;
  exception when sqlstate 'P0005' then return;
    when others then perform public._record_token_failure(v_purpose,v_fp); return;
  end;
end;
$$;
revoke all on function public._public_prices(jsonb),public._public_quote(jsonb),public._pricing_token_scope(text,boolean,boolean)
from public,anon,authenticated,service_role;

create function public.resolve_customer_prices(p_tenant_id uuid, p_customer_id uuid, p_product_ids uuid[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v uuid; s public.tenant_pricing_state; prices jsonb;
begin
  v := public._pricing_actor(p_tenant_id, p_customer_id);
  s := public._pricing_state(v);
  prices := public._effective_product_prices(v,p_customer_id,p_product_ids,s.mode);
  perform public._pricing_actor(v,p_customer_id);
  return jsonb_build_object('mode',s.mode,'prices',public._public_prices(prices));
end;
$$;

create function public.resolve_token_prices(p_token text, p_product_ids uuid[], p_showcase boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v uuid; c uuid; s public.tenant_pricing_state; prices jsonb;
begin
  select tenant_id,customer_id into v,c from public._pricing_token_scope(p_token,p_showcase,false);
  if v is null then return null; end if;
  s := public._pricing_state(v);
  prices := public._effective_product_prices(v,c,p_product_ids,s.mode);
  if p_showcase then perform 1 from public._resolve_showcase_token(p_token);
  else perform 1 from public._resolve_token(p_token); end if;
  return jsonb_build_object('mode',s.mode,'prices',public._public_prices(prices));
end;
$$;

-- Public grants are explicit; private helpers cannot be called through PostgREST.
revoke all on function public._advance_package_contract(), public._provision_pricing_state(),
  public._pricing_state(uuid), public._pricing_customer(uuid,uuid), public._pricing_actor(uuid,uuid),
  public._log_customer_price(uuid,uuid,text), public._effective_product_prices(uuid,uuid,uuid[],text)
  from public, anon, authenticated, service_role;
revoke all on function public.manage_customer_product_price(uuid,uuid,uuid,text,bigint,bigint,text),
  public.list_customer_product_prices(uuid,uuid,text), public.resolve_customer_prices(uuid,uuid,uuid[]) from public, anon;
grant execute on function public.manage_customer_product_price(uuid,uuid,uuid,text,bigint,bigint,text),
  public.list_customer_product_prices(uuid,uuid,text), public.resolve_customer_prices(uuid,uuid,uuid[]) to authenticated;
revoke all on function public.resolve_token_prices(text,uuid[],boolean) from public;
grant execute on function public.resolve_token_prices(text,uuid[],boolean) to anon, authenticated;

create function public._pricing_projection(
  p_tenant uuid, p_customer uuid, p_items jsonb, p_context jsonb,
  p_state public.tenant_pricing_state, p_order uuid default null
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_ids uuid[]; v_prices jsonb; v_lines jsonb := '[]'::jsonb;
  v_line jsonb; v_price jsonb; v_old public.order_items; v_order public.orders;
  v_qty integer; v_pid uuid; v_unit numeric; v_vat numeric; v_sub numeric; v_tax numeric;
  v_headers jsonb; v_existing jsonb; v_same boolean := false; v_digest text; n record;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 200 then
    raise exception 'pricing: 1 to 200 lines required' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_items) e where
      coalesce(e->>'quantity','') !~ '^[0-9]+$' or length(e->>'quantity') > 4
      or (e->>'quantity')::integer not between 1 and 9999 or (e->>'product_id')::uuid is null) then
    raise exception 'pricing: invalid quantity' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_items) e group by (e->>'product_id')::uuid
      having sum((e->>'quantity')::integer) > 9999) then
    raise exception 'pricing: aggregate quantity exceeds 9999' using errcode = '22023';
  end if;
  if p_order is null then perform public._pricing_customer(p_tenant,p_customer); end if;
  if p_order is not null then
    select * into v_order from public.orders where tenant_id = p_tenant and id = p_order;
    if not found or v_order.status in ('delivered','cancelled') then
      raise exception 'pricing: order cannot be edited' using errcode = 'MDF31';
    end if;
    if exists(select 1 from public.order_items where order_id = p_order and product_id is null)
      or exists(select 1 from public.order_items where order_id = p_order group by product_id having count(*) > 1) then
      raise exception 'pricing: historical lines cannot be represented safely' using errcode = '22023';
    end if;
    select jsonb_agg(to_jsonb(i) order by i.product_id) into v_existing from public.order_items i where i.order_id = p_order;
    select coalesce(jsonb_object_agg(x.id::text,x.qty),'{}'::jsonb) =
      (select coalesce(jsonb_object_agg(i.product_id::text,i.quantity),'{}'::jsonb)
       from public.order_items i where i.order_id = p_order)
    into v_same from (select (e->>'product_id')::uuid id, sum((e->>'quantity')::integer) qty
      from jsonb_array_elements(p_items) e group by 1) x;
  end if;
  if p_state.mode = 'paused' and not v_same then
    raise exception 'pricing: ordering paused' using errcode = 'MDF53';
  end if;
  select array_agg(distinct id order by id) into v_ids from (
    select (e->>'product_id')::uuid id from jsonb_array_elements(p_items) e
    union select i.product_id from public.order_items i where i.order_id = p_order
  ) ids;
  -- Old/new union can exceed the public resolver's 200-result bound; lock all
  -- involved rows first, then resolve only the <=200 requested products.
  perform p.id from public.products p where p.tenant_id = p_tenant and p.id = any(v_ids) order by p.id for share;
  select array_agg(distinct (e->>'product_id')::uuid order by (e->>'product_id')::uuid)
    into v_ids from jsonb_array_elements(p_items) e;
  v_prices := public._effective_product_prices(p_tenant,p_customer,v_ids,p_state.mode);
  for n in select (e->>'product_id')::uuid id, sum((e->>'quantity')::integer)::integer qty
    from jsonb_array_elements(p_items) e group by 1 order by 1
  loop
    v_pid := n.id; v_qty := n.qty;
    select e into v_price from jsonb_array_elements(v_prices) e where (e->>'product_id')::uuid = v_pid;
    if v_price->>'status' = 'unavailable' then
      raise exception 'pricing: product unavailable' using errcode = '22023';
    end if;
    select * into v_old from public.order_items where order_id = p_order and product_id = v_pid;
    if found then
      v_line := to_jsonb(v_old);
      v_unit := v_old.unit_price_snapshot; v_vat := v_old.vat_rate_snapshot;
      if v_qty = v_old.quantity then
        -- Preserve legacy recorded amounts on unchanged retained lines.
        v_sub := v_old.line_subtotal; v_tax := v_old.line_vat;
      else
        if v_old.package_unit_snapshot::text is distinct from v_price->>'package_unit'
          or v_old.package_quantity_snapshot is distinct from (v_price->>'package_quantity')::integer then
          raise exception 'pricing: saved package differs from current inventory package' using errcode = '22023';
        end if;
        v_sub := round(v_qty * v_unit,2); v_tax := round(v_sub * v_vat,2);
      end if;
    else
      if v_price->>'status' = 'stale_package' then
        raise exception 'pricing: stale package requires reconfirmation' using errcode = 'MDF52';
      end if;
      v_unit := (v_price->>'price')::numeric; v_vat := (v_price->>'vat')::numeric;
      v_sub := round(v_qty * v_unit,2); v_tax := round(v_sub * v_vat,2);
      v_line := jsonb_build_object('product_id',v_pid,'product_name_snapshot',v_price->'name',
        'manufacturer_name_snapshot',v_price->'manufacturer','package_unit_snapshot',v_price->'package_unit',
        'package_quantity_snapshot',v_price->'package_quantity','unit_price_snapshot',v_unit,'vat_rate_snapshot',v_vat,
        'pricing_source_snapshot',v_price->>'status','pricing_agreement_id_snapshot',
          case when v_price->>'status' = 'customer_agreement' then v_price->'agreement_id' end,
        'pricing_agreement_revision_snapshot',case when v_price->>'status' = 'customer_agreement' then v_price->'agreement_revision' end,
        'package_contract_revision_snapshot',v_price->'package_revision','base_unit_snapshot',v_price->'base_unit',
        'unit_size_snapshot',v_price->'unit_size');
    end if;
    if v_sub > 9999999999.99 or v_tax > 9999999999.99 or v_sub + v_tax > 9999999999.99 then
      raise exception 'pricing: monetary total exceeds storage range' using errcode = '22003';
    end if;
    v_line := v_line || jsonb_build_object('quantity',v_qty,'line_subtotal',v_sub,'line_vat',v_tax,
      'line_total',case when v_old.id is not null and v_qty = v_old.quantity then v_old.line_total else v_sub + v_tax end);
    v_lines := v_lines || jsonb_build_array(v_line);
  end loop;
  select jsonb_build_object('subtotal',sum((e->>'line_subtotal')::numeric),
    'vat',sum((e->>'line_vat')::numeric),'total',sum((e->>'line_total')::numeric)) into v_headers
  from jsonb_array_elements(v_lines) e;
  if v_same then
    v_headers := jsonb_build_object('subtotal',v_order.subtotal,'vat',v_order.vat_total,'total',v_order.total);
  end if;
  if exists(select 1 from jsonb_each_text(v_headers) h where h.value::numeric > 9999999999.99) then
    raise exception 'pricing: monetary total exceeds storage range' using errcode = '22003';
  end if;
  v_digest := public._order_submission_fingerprint(jsonb_build_object('version',1,'context',p_context,
    'tenant',p_tenant,'customer',p_customer,'epoch',p_state.epoch,'mode',p_state.mode,
    'order',p_order,'order_version',v_order.updated_at,'old_lines',v_existing,
    'terms',v_prices,'lines',v_lines,'headers',v_headers));
  return jsonb_build_object('quote',jsonb_build_object('version',1,'digest',v_digest),'mode',p_state.mode,
    'lines',v_lines,'headers',v_headers,'unchangedItems',v_same);
end;
$$;

create function public._check_pricing_quote(p_quote jsonb, p_projection jsonb) returns void
language plpgsql security invoker set search_path = '' as $$
begin
  if p_quote->>'mode' = 'replay_only' then
    raise exception 'pricing: no committed replay; review current quote' using errcode = 'MDF54';
  end if;
  if p_projection->>'mode' = 'disabled' and p_quote is null then return; end if;
  if p_quote is null or jsonb_typeof(p_quote) <> 'object'
    or p_quote->'version' is distinct from '1'::jsonb
    or coalesce(p_quote->>'digest','') !~ '^[a-f0-9]{64}$'
    or p_quote is distinct from p_projection->'quote' then
    raise exception 'pricing: quote changed; review and confirm' using errcode = 'MDF55';
  end if;
end;
$$;

create function public.quote_customer_order(p_tenant_id uuid, p_items jsonb,
  p_customer_id uuid default null, p_order_id uuid default null, p_source public.order_source default 'sales_visit')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v uuid; c uuid := p_customer_id; s public.tenant_pricing_state; projection jsonb;
begin
  if p_order_id is not null then
    v := public.authorize_tenant(p_tenant_id,array['owner','admin']::public.tenant_role[]);
    s := public._pricing_state(v);
    select customer_id into c from public.orders where tenant_id = v and id = p_order_id for share;
    if not found then raise exception 'pricing: order unavailable' using errcode = '42501'; end if;
  else
    v := public._pricing_actor(p_tenant_id,c);
    if p_source = 'remote_customer' then raise exception 'pricing: invalid source' using errcode = '22023'; end if;
    s := public._pricing_state(v);
  end if;
  projection := public._pricing_projection(v,c,p_items,jsonb_build_object('channel',case when p_order_id is null then 'authenticated' else 'edit' end,
    'actor',auth.uid(),'source',coalesce(p_source,'sales_visit')),s,p_order_id);
  if p_order_id is null then perform public._pricing_actor(v,c);
  else perform public.authorize_tenant(v,array['owner','admin']::public.tenant_role[]); end if;
  return public._public_quote(projection);
end;
$$;

create function public.quote_token_order(p_token text, p_items jsonb, p_showcase boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v uuid; c uuid; l uuid; s public.tenant_pricing_state; projection jsonb;
begin
  select tenant_id,customer_id,link_id into v,c,l from public._pricing_token_scope(p_token,p_showcase,true);
  if v is null then return null; end if;
  s := public._pricing_state(v);
  projection := public._pricing_projection(v,c,p_items,jsonb_build_object('channel',case when p_showcase then 'showcase' else 'shop_token' end,'link',l),s);
  if p_showcase then perform 1 from public._resolve_showcase_token(p_token);
  else perform 1 from public._resolve_token(p_token); end if;
  return public._public_quote(projection);
end;
$$;

revoke all on function public._pricing_projection(uuid,uuid,jsonb,jsonb,public.tenant_pricing_state,uuid),
  public._check_pricing_quote(jsonb,jsonb) from public, anon, authenticated, service_role;
revoke all on function public.quote_customer_order(uuid,jsonb,uuid,uuid,public.order_source) from public, anon;
grant execute on function public.quote_customer_order(uuid,jsonb,uuid,uuid,public.order_source) to authenticated;
revoke all on function public.quote_token_order(text,jsonb,boolean) from public;
grant execute on function public.quote_token_order(text,jsonb,boolean) to anon, authenticated;

-- Existing write paths, extended in place.
drop function public._order_create_core(uuid,jsonb,uuid,text,public.order_source);
CREATE OR REPLACE FUNCTION public._order_create_core(p_tenant_id uuid, p_items jsonb, p_customer_id uuid, p_notes text, p_source public.order_source, p_resolved jsonb)
 RETURNS TABLE(order_id uuid, order_number text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_resolved jsonb := p_resolved;
  v_order_id uuid;
  v_order_number text;
  v_customer public.customers%rowtype;
  v_item_count integer;
  v_valid_count integer;
  v_inserted integer;
  v_subtotal numeric(12,2);
  v_vat_total numeric(12,2);
  v_total numeric(12,2);
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

  insert into public.order_items
    (tenant_id, order_id, product_id, product_name_snapshot, manufacturer_name_snapshot,
     package_unit_snapshot, package_quantity_snapshot, quantity, unit_price_snapshot,
     vat_rate_snapshot, line_subtotal, line_vat, line_total, pricing_source_snapshot,
     pricing_agreement_id_snapshot, pricing_agreement_revision_snapshot,
     package_contract_revision_snapshot, base_unit_snapshot, unit_size_snapshot)
  select p_tenant_id, v_order_id, i.product_id, i.product_name_snapshot, i.manufacturer_name_snapshot,
    i.package_unit_snapshot, i.package_quantity_snapshot, i.quantity, i.unit_price_snapshot,
    i.vat_rate_snapshot, i.line_subtotal, i.line_vat, i.line_total, i.pricing_source_snapshot,
    i.pricing_agreement_id_snapshot, i.pricing_agreement_revision_snapshot,
    i.package_contract_revision_snapshot, i.base_unit_snapshot, i.unit_size_snapshot
  from jsonb_populate_recordset(null::public.order_items, v_resolved->'lines') i;

  get diagnostics v_inserted = row_count;
  if v_inserted <> v_item_count then
    raise exception 'order: catalog changed while ordering — please retry'
      using errcode = '40001';
  end if;

  select sum(i.line_subtotal), sum(i.line_vat), sum(i.line_total)
  into v_subtotal, v_vat_total, v_total
  from public.order_items i where i.order_id = v_order_id;

  update public.orders o
     set subtotal = v_subtotal, vat_total = v_vat_total, total = v_total
   where o.id = v_order_id;

  return query select v_order_id, v_order_number;
end;
$function$;


revoke all on function public._order_create_core(uuid,jsonb,uuid,text,public.order_source,jsonb) from public,anon,authenticated,service_role;

-- 4a. create_order_request — authenticated (owner/admin/sales_rep).
drop function if exists public.create_order_request(uuid, jsonb, uuid, text, public.order_source, uuid);
create function public.create_order_request(
  p_tenant_id uuid,
  p_items jsonb,
  p_customer_id uuid default null,
  p_notes text default null,
  p_source public.order_source default 'sales_visit',
  p_submission_key uuid default null,
  p_quote jsonb default null
)
returns table (order_id uuid, order_number text)
language plpgsql security definer set search_path = ''
as $$
declare
  v_state public.tenant_pricing_state;
  v_resolved jsonb;
  v_tenant uuid;
  v_order_id uuid;
  v_order_number text;
  v_item_count integer;
  v_existing uuid;
  v_is_new boolean;
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
  -- M4D: a sales_rep may create orders ONLY for a customer assigned to them.
  if public.has_tenant_role(v_tenant, array['sales_rep']::public.tenant_role[]) then
    if p_customer_id is null then
      raise exception 'create_order_request: a sales rep must order for an assigned customer'
        using errcode = '42501';
    end if;
    if not public.can_access_customer(v_tenant, p_customer_id) then
      raise exception 'create_order_request: customer is not assigned to this sales rep'
        using errcode = '42501';
    end if;
  end if;

  -- FIX1: authoritative DB-backed idempotency (required key; no non-idempotent
  -- path). The fingerprint binds tenant + actor + customer + source + notes +
  -- normalized lines, so an exact retry returns the same order and the same key
  -- with a DIFFERENT payload raises MDF40.
  select c.existing_order_id, c.is_new into v_existing, v_is_new
  from public._claim_order_submission(
    v_tenant, 'authenticated', p_submission_key,
    public._order_submission_fingerprint(jsonb_build_object(
      'channel', 'authenticated',
      'tenant', v_tenant,
      'actor', (select auth.uid()),
      'customer', p_customer_id,
      'source', coalesce(p_source, 'sales_visit')::text,
      'notes', nullif(btrim(coalesce(p_notes, '')), ''),
      'lines', public._normalize_order_lines(p_items)))) c;
  if not v_is_new then
    -- A duplicate claim may wait for the first transaction. Replay is still
    -- subject to current membership/assignment, but not fresh pricing state.
    perform public.authorize_tenant(v_tenant, array['owner','admin','sales_rep']::public.tenant_role[]);
    if public.has_tenant_role(v_tenant, array['sales_rep']::public.tenant_role[])
      and (p_customer_id is null or not public.can_access_customer(v_tenant,p_customer_id)) then
      raise exception 'create_order_request: customer access denied' using errcode = '42501';
    end if;
    select o.order_number into v_order_number
    from public.orders o where o.id = v_existing and o.tenant_id = v_tenant;
    return query select v_existing, v_order_number;  -- idempotent hit: create/audit nothing
    return;
  end if;

  if p_quote->>'mode' = 'replay_only' then
    raise exception 'pricing: no committed replay' using errcode = 'MDF54';
  end if;
  perform public._pricing_actor(v_tenant,p_customer_id);
  v_state := public._pricing_state(v_tenant);
  v_resolved := public._pricing_projection(v_tenant,p_customer_id,p_items,
    jsonb_build_object('channel','authenticated','actor',auth.uid(),'source',coalesce(p_source,'sales_visit')),v_state);
  perform public._check_pricing_quote(p_quote,v_resolved);
  perform public._pricing_actor(v_tenant,p_customer_id);
  select o.order_id, o.order_number into v_order_id, v_order_number
  from public._order_create_core(
    v_tenant, p_items, p_customer_id, p_notes, coalesce(p_source, 'sales_visit'),v_resolved) o;

  update public.order_submission_claims set order_id = v_order_id
   where tenant_id = v_tenant and channel = 'authenticated' and submission_key = p_submission_key;

  -- M8H.1: ONE order.created. Safe channel facts only — no items, prices,
  -- totals, notes, customer name/snapshot, order_number, or submission key.
  select count(distinct (elem ->> 'product_id')) into v_item_count
  from jsonb_array_elements(p_items) as elem;
  perform public._log_order_audit_event(
    v_tenant, 'order.created', v_order_id,
    jsonb_build_object(
      'source', coalesce(p_source, 'sales_visit')::text,
      'initiator_kind', 'authenticated_user',
      'initial_status', 'new',
      'customer_kind', case when p_customer_id is null then 'none' else 'existing' end,
      'item_count', v_item_count));

  return query select v_order_id, v_order_number;
end;
$$;
revoke all on function public.create_order_request(uuid, jsonb, uuid, text, public.order_source, uuid, jsonb)
  from public, anon;
grant execute on function public.create_order_request(uuid, jsonb, uuid, text, public.order_source, uuid, jsonb)
  to authenticated, service_role;

-- 4b. create_order_request_from_token — private Shop link (anon, rate-limited).
drop function if exists public.create_order_request_from_token(text, jsonb, text, uuid);
create function public.create_order_request_from_token(
  p_token text,
  p_items jsonb,
  p_notes text default null,
  p_submission_key uuid default null,
  p_quote jsonb default null
)
returns table (order_number text)
language plpgsql security definer set search_path = ''
as $$
declare
  v_state public.tenant_pricing_state;
  v_resolved jsonb;
  v_tenant uuid;
  v_customer uuid;
  v_link uuid;
  v_order_id uuid;
  v_public_ref text;
  v_item_count integer;
  v_existing uuid;
  v_is_new boolean;
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
      return query select null::text;
      return;
    when others then
      perform public._record_token_failure('shop_order', v_fp);
      return query select null::text;
      return;
  end;

  -- Token is valid past here. FIX1 idempotency (raises MDF40 on a changed payload
  -- reusing the key; content-level, not rate-limited). Context binds the resolved
  -- tenant + customer + link, so a foreign token cannot retrieve this order.
  select c.existing_order_id, c.is_new into v_existing, v_is_new
  from public._claim_order_submission(
    v_tenant, 'shop_token', p_submission_key,
    public._order_submission_fingerprint(jsonb_build_object(
      'channel', 'shop_token',
      'tenant', v_tenant,
      'customer', v_customer,
      'link', v_link,
      'notes', nullif(btrim(coalesce(p_notes, '')), ''),
      'lines', public._normalize_order_lines(p_items)))) c;
  if not v_is_new then
    if not exists (select 1 from public._pricing_token_scope(p_token,false,true) s
      where s.tenant_id=v_tenant and s.customer_id=v_customer and s.link_id=v_link) then
      return query select null::text;
      return;
    end if;
    select o.public_ref into v_public_ref
    from public.orders o where o.id = v_existing and o.tenant_id = v_tenant;
    return query select v_public_ref;  -- idempotent hit
    return;
  end if;

  if p_quote->>'mode' = 'replay_only' then
    raise exception 'pricing: no committed replay' using errcode = 'MDF54';
  end if;
  v_state := public._pricing_state(v_tenant);
  v_resolved := public._pricing_projection(v_tenant,v_customer,p_items,
    jsonb_build_object('channel','shop_token','link',v_link),v_state);
  perform public._check_pricing_quote(p_quote,v_resolved);
  perform 1 from public._resolve_token(p_token); -- Recheck after waiting for locks.
  select o.order_id into v_order_id
  from public._order_create_core(v_tenant, p_items, v_customer, p_notes, 'remote_customer',v_resolved) o;

  update public.order_submission_claims set order_id = v_order_id
   where tenant_id = v_tenant and channel = 'shop_token' and submission_key = p_submission_key;

  -- Customer sees the random public reference, NOT the internal sequence (M7E).
  select public_ref into v_public_ref from public.orders where id = v_order_id;

  update public.customer_access_links set last_used_at = now() where id = v_link;

  -- M8H.1: ONE order.created, initiator = the private customer-link channel.
  select count(distinct (elem ->> 'product_id')) into v_item_count
  from jsonb_array_elements(p_items) as elem;
  perform public._log_order_audit_event(
    v_tenant, 'order.created', v_order_id,
    jsonb_build_object(
      'source', 'remote_customer',
      'initiator_kind', 'customer_link',
      'initial_status', 'new',
      'customer_kind', 'existing',
      'item_count', v_item_count));

  return query select v_public_ref;
end;
$$;
revoke all on function public.create_order_request_from_token(text, jsonb, text, uuid, jsonb) from public;
grant execute on function public.create_order_request_from_token(text, jsonb, text, uuid, jsonb)
  to anon, authenticated, service_role;

-- 4c. create_order_from_showcase_token — Showcase guest order (anon, limited).
drop function if exists public.create_order_from_showcase_token(
  text, jsonb, text, text, text, text, text, text, text, text, text, uuid);
create function public.create_order_from_showcase_token(
  p_token text,
  p_items jsonb,
  p_store_name text,
  p_contact_name text default null,
  p_phone text default null,
  p_email text default null,
  p_city_ar text default null,
  p_city_he text default null,
  p_city_en text default null,
  p_address text default null,
  p_notes text default null,
  p_submission_key uuid default null,
  p_quote jsonb default null
)
returns table (order_number text)
language plpgsql security definer set search_path = ''
as $$
declare
  v_state public.tenant_pricing_state;
  v_resolved jsonb;
  v_tenant uuid;
  v_link uuid;
  v_order_id uuid;
  v_public_ref text;
  v_item_count integer;
  v_existing uuid;
  v_is_new boolean;
  v_fp text := encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex');
  v_name text := nullif(trim(coalesce(p_store_name, '')), '');
  v_email text := nullif(trim(coalesce(p_email, '')), '');
begin
  -- Same rate limiter as the showcase catalog (resolution failures only).
  if public._token_rate_exceeded('showcase_order', v_fp) then
    return;
  end if;
  begin
    select tenant_id, link_id into v_tenant, v_link
    from public._resolve_showcase_token(p_token);
  exception when others then
    perform public._record_token_failure('showcase_order', v_fp);
    return;
  end;

  -- Store details (content errors are NOT rate-limited).
  if v_name is null then
    raise exception 'guest order: store name is required' using errcode = '22023';
  end if;
  if length(v_name) > 200
     or coalesce(length(trim(p_contact_name)), 0) > 200
     or coalesce(length(trim(p_phone)), 0) > 40
     or coalesce(length(v_email), 0) > 254
     or greatest(coalesce(length(trim(p_city_ar)), 0), coalesce(length(trim(p_city_he)), 0),
                 coalesce(length(trim(p_city_en)), 0)) > 120
     or coalesce(length(trim(p_address)), 0) > 300 then
    raise exception 'guest order: a field exceeds its maximum length' using errcode = '22023';
  end if;
  if v_email is not null and v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'guest order: invalid email' using errcode = '22023';
  end if;

  -- FIX1 idempotency. The guest snapshot IS part of the resulting order, so it is
  -- bound into the fingerprint (a changed store detail + reused key raises MDF40).
  select c.existing_order_id, c.is_new into v_existing, v_is_new
  from public._claim_order_submission(
    v_tenant, 'showcase', p_submission_key,
    public._order_submission_fingerprint(jsonb_build_object(
      'channel', 'showcase',
      'tenant', v_tenant,
      'link', v_link,
      'guest', jsonb_build_object(
        'name', v_name,
        'contact', nullif(trim(coalesce(p_contact_name, '')), ''),
        'phone', nullif(trim(coalesce(p_phone, '')), ''),
        'email', v_email,
        'city', jsonb_build_object(
          'ar', nullif(trim(coalesce(p_city_ar, '')), ''),
          'he', nullif(trim(coalesce(p_city_he, '')), ''),
          'en', nullif(trim(coalesce(p_city_en, '')), '')),
        'address', nullif(trim(coalesce(p_address, '')), '')),
      'notes', nullif(btrim(coalesce(p_notes, '')), ''),
      'lines', public._normalize_order_lines(p_items)))) c;
  if not v_is_new then
    if not exists (select 1 from public._pricing_token_scope(p_token,true,true) s
      where s.tenant_id=v_tenant and s.link_id=v_link) then
      return query select null::text;
      return;
    end if;
    select o.public_ref into v_public_ref
    from public.orders o where o.id = v_existing and o.tenant_id = v_tenant;
    return query select v_public_ref;  -- idempotent hit
    return;
  end if;

  -- Create the order (customer NULL) — all money server-side, real products.
  if p_quote->>'mode' = 'replay_only' then
    raise exception 'pricing: no committed replay' using errcode = 'MDF54';
  end if;
  v_state := public._pricing_state(v_tenant);
  v_resolved := public._pricing_projection(v_tenant,null,p_items,
    jsonb_build_object('channel','showcase','link',v_link),v_state);
  perform public._check_pricing_quote(p_quote,v_resolved);
  perform 1 from public._resolve_showcase_token(p_token); -- Recheck after waiting for locks.
  select o.order_id into v_order_id
  from public._order_create_core(v_tenant, p_items, null, p_notes, 'remote_customer',v_resolved) o;

  update public.order_submission_claims set order_id = v_order_id
   where tenant_id = v_tenant and channel = 'showcase' and submission_key = p_submission_key;

  -- Attach the guest store details as the buyer snapshot (guest = true).
  update public.orders
     set customer_snapshot = jsonb_build_object(
           'name', v_name,
           'contact_name', nullif(trim(coalesce(p_contact_name, '')), ''),
           'phone', nullif(trim(coalesce(p_phone, '')), ''),
           'email', v_email,
           'address', nullif(trim(coalesce(p_address, '')), ''),
           'city', jsonb_build_object(
             'ar', nullif(trim(coalesce(p_city_ar, '')), ''),
             'he', nullif(trim(coalesce(p_city_he, '')), ''),
             'en', nullif(trim(coalesce(p_city_en, '')), '')),
           'guest', true)
   where id = v_order_id;

  update public.catalog_showcase_links set last_used_at = now() where id = v_link;

  select public_ref into v_public_ref from public.orders where id = v_order_id;

  -- M8H.1: ONE order.created, initiator = the Showcase guest channel.
  select count(distinct (elem ->> 'product_id')) into v_item_count
  from jsonb_array_elements(p_items) as elem;
  perform public._log_order_audit_event(
    v_tenant, 'order.created', v_order_id,
    jsonb_build_object(
      'source', 'remote_customer',
      'initiator_kind', 'showcase_guest',
      'initial_status', 'new',
      'customer_kind', 'guest',
      'item_count', v_item_count));

  return query select v_public_ref;
end;
$$;
revoke all on function public.create_order_from_showcase_token(
  text, jsonb, text, text, text, text, text, text, text, text, text, uuid, jsonb) from public;
grant execute on function public.create_order_from_showcase_token(
  text, jsonb, text, text, text, text, text, text, text, text, text, uuid, jsonb)
  to anon, authenticated, service_role;


drop function public.update_order_items(uuid,uuid,jsonb,text);
create or replace function public.update_order_items(
  p_tenant_id uuid,
  p_order_id uuid,
  p_items jsonb,
  p_notes text default null,
  p_quote jsonb default null
)
returns table (order_id uuid, order_number text)
language plpgsql security definer set search_path = ''
as $$
declare
  v_state public.tenant_pricing_state;
  v_resolved jsonb;
  v_customer uuid;
  v_tenant uuid;
  v_status public.order_status;
  v_reserved boolean;
  v_item_count integer;
  v_valid_count integer;
  v_inserted integer;
  v_subtotal numeric(12,2);
  v_vat_total numeric(12,2);
  v_total numeric(12,2);
  v_number text;
  v_line record;
  v_avail integer;
  v_notes_before text;
  v_notes_after text;
  v_items_before jsonb;
  v_items_after jsonb;
  v_count_before integer;
  v_changed text[] := array[]::text[];
begin
  v_tenant := public.authorize_tenant(
    p_tenant_id, array['owner', 'admin']::public.tenant_role[]);
  v_state := public._pricing_state(v_tenant);

  -- Validate items exactly like _order_create_core.
  if p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 then
    raise exception 'update_order_items: items must be a non-empty array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) > 200 then
    raise exception 'update_order_items: too many lines (max 200)' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_items) as elem
    where (elem ->> 'product_id')::uuid is null
       or (elem ->> 'quantity')::integer is null
       or (elem ->> 'quantity')::integer <= 0
       or (elem ->> 'quantity')::integer > 9999
  ) then
    raise exception 'update_order_items: each line needs a product_id and a quantity between 1 and 9999'
      using errcode = '22023';
  end if;

  -- Lock the order; enforce status rules. (notes captured for the effective-
  -- change derivation below — the VALUE never enters metadata.)
  select o.status, o.order_number, o.notes into v_status, v_number, v_notes_before
  from public.orders o
  where o.id = p_order_id and o.tenant_id = v_tenant
  for update;
  if not found then
    raise exception 'update_order_items: order % is unknown or belongs to another tenant', p_order_id
      using errcode = '22023';
  end if;
  if v_status in ('delivered', 'cancelled') then
    raise exception 'update_order_items: a % order cannot be edited', v_status
      using errcode = 'MDF31';
  end if;

  -- Products must be active + own-tenant (aggregate by product).
  with lines as (
    select (elem ->> 'product_id')::uuid as product_id,
           sum((elem ->> 'quantity')::integer)::integer as quantity
    from jsonb_array_elements(p_items) as elem
    group by 1
  )
  select count(*),
         count(*) filter (
           where quantity between 1 and 9999 and exists (
             select 1 from public.products p
             where p.id = lines.product_id and p.tenant_id = p_tenant_id and p.is_active))
  into v_item_count, v_valid_count
  from lines;
  if v_valid_count <> v_item_count then
    raise exception 'update_order_items: one or more products are unknown, inactive, over the aggregate 9999-package limit, or belong to another tenant'
      using errcode = '22023';
  end if;

  -- Reject historical line sets that the product-keyed input cannot represent.
  if exists (select 1 from public.order_items oi where oi.order_id = p_order_id and oi.product_id is null)
     or exists (select 1 from public.order_items oi where oi.order_id = p_order_id
                group by oi.product_id having count(*) > 1) then
    raise exception 'update_order_items: historical lines cannot be represented safely' using errcode = '22023';
  end if;

  -- Compare normalized quantities/notes before any item or inventory mutation.
  select coalesce(jsonb_object_agg(s.pid::text, s.qty), '{}'::jsonb), count(*)
  into v_items_before, v_count_before
  from (
    select oi.product_id as pid, sum(oi.quantity)::integer as qty
    from public.order_items oi
    where oi.order_id = p_order_id and oi.product_id is not null
    group by oi.product_id
  ) s;
  select coalesce(jsonb_object_agg(t.pid::text, t.qty), '{}'::jsonb)
  into v_items_after
  from (
    select (elem ->> 'product_id')::uuid as pid,
           sum((elem ->> 'quantity')::integer)::integer as qty
    from jsonb_array_elements(p_items) as elem
    group by 1
  ) t;

  select customer_id into v_customer from public.orders where id = p_order_id;
  v_resolved := public._pricing_projection(v_tenant,v_customer,p_items,
    jsonb_build_object('channel','edit','actor',auth.uid(),'source','sales_visit'),v_state,p_order_id);
  perform public.authorize_tenant(v_tenant, array['owner','admin']::public.tenant_role[]);
  -- Paused notes-only/no-op remains available without repricing.
  if v_state.mode <> 'paused' then perform public._check_pricing_quote(p_quote,v_resolved); end if;
  v_notes_after := case when p_notes is null then v_notes_before else nullif(trim(p_notes), '') end;
  if v_items_before is not distinct from v_items_after then
    if v_notes_before is distinct from v_notes_after then
      update public.orders o set notes = v_notes_after, updated_at = now() where o.id = p_order_id;
      perform public._log_order_audit_event(v_tenant, 'order.updated', p_order_id,
        jsonb_build_object('changed_fields', jsonb_build_array('notes')));
    end if;
    -- Preserve even legacy header totals and every line on identical/notes saves.
    return query select p_order_id, v_number;
    return;
  end if;

  -- Stabilize package compatibility and new-line terms. Existing product writes
  -- lock product before inventory; preserve that order, using shared row locks.
  perform p.id from public.products p
  where p.tenant_id = v_tenant and (
    v_items_after ? p.id::text or exists (
      select 1 from public.order_items oi where oi.order_id = p_order_id and oi.product_id = p.id))
  order by p.id for share;
  if exists (select 1 from jsonb_each(v_items_after) n
             left join public.products p on p.id = n.key::uuid and p.tenant_id = v_tenant and p.is_active
             where p.id is null) then
    raise exception 'update_order_items: catalog changed while editing' using errcode = '40001';
  end if;

  v_reserved := exists (
    select 1 from public.order_inventory_movements m
    where m.tenant_id = v_tenant and m.order_id = p_order_id and m.reason = 'order_reserved');

  -- No conversion of saved package counts into a different current package.
  -- Quantity changes are guarded even before reservation. For tracked reserved
  -- lines use the actual ledger delta, including tracking added after confirmation.
  if exists (
    select 1 from public.order_items oi
    join public.products p on p.id = oi.product_id and p.tenant_id = v_tenant
    left join jsonb_each(v_items_after) n on n.key = oi.product_id::text
    where oi.order_id = p_order_id
      and ((n.key is not null and n.value::text::integer <> oi.quantity)
        or (v_reserved and exists (
          select 1 from public.inventory_items inv
          where inv.tenant_id = v_tenant and inv.product_id = oi.product_id)
          and coalesce(n.value::text::integer, 0) <> coalesce((
            select -sum(m.quantity_delta)::integer
            from public.order_inventory_movements m
            where m.tenant_id = v_tenant and m.order_id = p_order_id
              and m.product_id = oi.product_id
              and m.reason in ('order_reserved', 'order_edit_adjustment')), 0)))
      and (oi.package_unit_snapshot is distinct from p.package_unit
           or oi.package_quantity_snapshot is distinct from p.package_quantity)
  ) then
    raise exception 'update_order_items: saved package differs from current inventory package' using errcode = '22023';
  end if;

  -- Reconcile stock against the ledger if the order is reserved. Per product
  -- across the union of currently-reserved and newly-requested lines:
  --   delta = new_qty - net_reserved; deduct/restore by delta. Products are
  -- locked in ascending product_id order (M8I.7 deterministic lock order).
  if v_reserved then
    for v_line in
      with newq as (
        select (elem ->> 'product_id')::uuid as pid, sum((elem ->> 'quantity')::integer)::integer as qty
        from jsonb_array_elements(p_items) as elem group by 1
      ),
      resq as (
        select m.product_id as pid, -sum(m.quantity_delta)::integer as qty
        from public.order_inventory_movements m
        where m.tenant_id = v_tenant and m.order_id = p_order_id
          and m.reason in ('order_reserved', 'order_edit_adjustment')
        group by m.product_id
      )
      select coalesce(n.pid, r.pid) as pid,
             coalesce(n.qty, 0) - coalesce(r.qty, 0) as delta
      from newq n full outer join resq r on r.pid = n.pid
      where coalesce(n.qty, 0) - coalesce(r.qty, 0) <> 0
      order by coalesce(n.pid, r.pid)
    loop
      select inv.quantity_available into v_avail
      from public.inventory_items inv
      where inv.tenant_id = v_tenant and inv.product_id = v_line.pid
      for update;
      if not found then
        continue; -- untracked product: no reconciliation
      end if;
      -- Tracking can be initialized after the early guard (the inventory FK's
      -- KEY SHARE lock is compatible with our product SHARE lock). Recheck every
      -- actual nonzero reservation delta after locking the inventory row, while
      -- the retained terms and current package are both stable.
      if exists (
        select 1 from public.order_items oi
        join public.products p on p.id = oi.product_id and p.tenant_id = v_tenant
        where oi.order_id = p_order_id and oi.product_id = v_line.pid
          and (oi.package_unit_snapshot is distinct from p.package_unit
               or oi.package_quantity_snapshot is distinct from p.package_quantity)
      ) then
        raise exception 'update_order_items: saved package differs from current inventory package' using errcode = '22023';
      end if;
      if v_line.delta > 0 and v_avail < v_line.delta then
        raise exception 'update_order_items: insufficient stock for product % (have %, need % more)',
          v_line.pid, v_avail, v_line.delta using errcode = 'MDF30';
      end if;
      -- delta>0 deducts; delta<0 restores.
      update public.inventory_items
         set quantity_available = quantity_available - v_line.delta, updated_at = now()
       where tenant_id = v_tenant and product_id = v_line.pid;
      insert into public.order_inventory_movements
        (tenant_id, order_id, product_id, quantity_delta, reason, created_by)
      values
        (v_tenant, p_order_id, v_line.pid, -v_line.delta, 'order_edit_adjustment', (select auth.uid()));
    end loop;
  end if;

  -- Retained lines keep identity, name, manufacturer, package, price and VAT.
  update public.order_items oi
  set quantity = n.value::text::integer,
      line_subtotal = round(n.value::text::integer * oi.unit_price_snapshot, 2),
      line_vat = round(round(n.value::text::integer * oi.unit_price_snapshot, 2) * oi.vat_rate_snapshot, 2),
      line_total = round(n.value::text::integer * oi.unit_price_snapshot, 2)
                   + round(round(n.value::text::integer * oi.unit_price_snapshot, 2) * oi.vat_rate_snapshot, 2)
  from jsonb_each(v_items_after) n
  where oi.order_id = p_order_id and oi.product_id = n.key::uuid
    and oi.quantity is distinct from n.value::text::integer;

  delete from public.order_items oi
  where oi.order_id = p_order_id and not (v_items_after ? oi.product_id::text);

  -- New lines use the exact locked projection; retained snapshots stay untouched.
  insert into public.order_items
    (tenant_id, order_id, product_id, product_name_snapshot, manufacturer_name_snapshot,
     package_unit_snapshot, package_quantity_snapshot, quantity, unit_price_snapshot,
     vat_rate_snapshot, line_subtotal, line_vat, line_total, pricing_source_snapshot,
     pricing_agreement_id_snapshot, pricing_agreement_revision_snapshot,
     package_contract_revision_snapshot, base_unit_snapshot, unit_size_snapshot)
  select v_tenant, p_order_id, i.product_id, i.product_name_snapshot, i.manufacturer_name_snapshot,
    i.package_unit_snapshot, i.package_quantity_snapshot, i.quantity, i.unit_price_snapshot,
    i.vat_rate_snapshot, i.line_subtotal, i.line_vat, i.line_total, i.pricing_source_snapshot,
    i.pricing_agreement_id_snapshot, i.pricing_agreement_revision_snapshot,
    i.package_contract_revision_snapshot, i.base_unit_snapshot, i.unit_size_snapshot
  from jsonb_populate_recordset(null::public.order_items, v_resolved->'lines') i
  where not exists (select 1 from public.order_items oi where oi.order_id = p_order_id and oi.product_id = i.product_id);

  select count(*) into v_inserted from public.order_items oi where oi.order_id = p_order_id;
  if v_inserted <> v_item_count then
    raise exception 'update_order_items: catalog changed while editing' using errcode = '40001';
  end if;

  select sum(i.line_subtotal), sum(i.line_vat), sum(i.line_total)
  into v_subtotal, v_vat_total, v_total
  from public.order_items i where i.order_id = p_order_id;

  update public.orders o
     set subtotal = v_subtotal, vat_total = v_vat_total, total = v_total,
         notes = case when p_notes is null then o.notes else nullif(trim(p_notes), '') end,
         updated_at = now()
   where o.id = p_order_id;

  -- M8H.1: ONE order.updated — but ONLY for an EFFECTIVE change. A resubmission
  -- of the identical lines/notes records nothing. changed_fields is derived from
  -- authoritative old/new state (never from a client-supplied list); the notes
  -- TEXT, product ids, quantities, prices and totals never enter metadata.
  v_notes_after := case when p_notes is null then v_notes_before else nullif(trim(p_notes), '') end;
  if v_items_before is distinct from v_items_after then
    v_changed := array_append(v_changed, 'items');
  end if;
  if v_notes_before is distinct from v_notes_after then
    v_changed := array_append(v_changed, 'notes');
  end if;
  if array_length(v_changed, 1) > 0 then
    perform public._log_order_audit_event(
      v_tenant, 'order.updated', p_order_id,
      jsonb_build_object('changed_fields', to_jsonb(v_changed))
      || case when v_items_before is distinct from v_items_after
           then jsonb_build_object(
                  'item_count_before', v_count_before,
                  'item_count_after', v_item_count)
           else '{}'::jsonb end);
  end if;

  return query select p_order_id, v_number;
end;
$$;

revoke all on function public.update_order_items(uuid, uuid, jsonb, text, jsonb) from public, anon;
grant execute on function public.update_order_items(uuid, uuid, jsonb, text, jsonb) to authenticated, service_role;
