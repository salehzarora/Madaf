-- ORDER-FINANCIAL-INTEGRITY-001: saved terms, consistent totals, aggregate cap.
-- No historical backfill or contract/grant changes. All three creation wrappers
-- retain their existing authorization, rate limiting and committed-claim replay.

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

  select sum(i.line_subtotal), sum(i.line_vat), sum(i.line_total)
  into v_subtotal, v_vat_total, v_total
  from public.order_items i where i.order_id = v_order_id;

  update public.orders o
     set subtotal = v_subtotal, vat_total = v_vat_total, total = v_total
   where o.id = v_order_id;

  return query select v_order_id, v_order_number;
end;
$function$;

create or replace function public.update_order_items(
  p_tenant_id uuid,
  p_order_id uuid,
  p_items jsonb,
  p_notes text default null
)
returns table (order_id uuid, order_number text)
language plpgsql security definer set search_path = ''
as $$
declare
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

  -- Only genuinely new products use current authorized catalog terms.
  insert into public.order_items
    (tenant_id, order_id, product_id, product_name_snapshot, manufacturer_name_snapshot,
     package_unit_snapshot, package_quantity_snapshot, quantity, unit_price_snapshot,
     vat_rate_snapshot, line_subtotal, line_vat, line_total)
  select v_tenant, p_order_id, p.id,
    jsonb_build_object('ar', p.name_ar, 'he', p.name_he, 'en', p.name_en),
    case when m.id is null then null else jsonb_build_object('ar', m.name_ar, 'he', m.name_he, 'en', m.name_en) end,
    p.package_unit, p.package_quantity, n.value::text::integer, p.wholesale_price, p.vat_rate,
    round(n.value::text::integer * p.wholesale_price, 2),
    round(round(n.value::text::integer * p.wholesale_price, 2) * p.vat_rate, 2),
    round(n.value::text::integer * p.wholesale_price, 2)
      + round(round(n.value::text::integer * p.wholesale_price, 2) * p.vat_rate, 2)
  from jsonb_each(v_items_after) n
  join public.products p on p.id = n.key::uuid and p.tenant_id = v_tenant and p.is_active
  left join public.manufacturers m on m.id = p.manufacturer_id
  where not exists (select 1 from public.order_items oi where oi.order_id = p_order_id and oi.product_id = p.id);

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

revoke all on function public.update_order_items(uuid, uuid, jsonb, text) from public, anon;
grant execute on function public.update_order_items(uuid, uuid, jsonb, text) to authenticated, service_role;
