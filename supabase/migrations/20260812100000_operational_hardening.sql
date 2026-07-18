-- ═══════════════════════════════════════════════════════════════════════
-- PILOT-OPS-AUDIT-008 — Operational hardening (deterministic inventory lock
-- order + audit unknown-entity default-deny)
--
-- (1) DETERMINISTIC INVENTORY LOCK ORDER. update_order_status (reserve on
-- confirm/preparing, restore on cancel) and update_order_items (edit-time
-- reconciliation) both lock/mutate MULTIPLE inventory_items rows in a loop whose
-- driving query used `group by product_id` with NO `order by` — so two concurrent
-- order operations touching the same >=2 products could acquire inventory_items
-- row locks in OPPOSITE product order and deadlock (SQLSTATE 40P01). This redefines
-- both functions VERBATIM except for adding `order by <product_id>` to every
-- inventory-locking/mutating loop, so EVERY competing path acquires inventory_items
-- locks in one global ascending product_id order. Signatures / return types /
-- SECURITY DEFINER / search_path / grants / authorization / tenant+product
-- validation / money+VAT snapshots / reservation-once/release-once idempotency /
-- MDF30/MDF31/23514/40001 error codes / audit events / transactionality are all
-- PRESERVED. No advisory locks, no retries, no sleeps, no partial commits.
-- create_order_request/_order_create_core are NOT touched — order creation writes
-- the order at status 'new' and reserves NO stock (set-based inserts, no
-- inventory_items lock), so they carry no inversion.
--
-- (2) AUDIT UNKNOWN-ENTITY DEFAULT-DENY. The single audit_events SELECT policy
-- scopes eight known entity_types; any OTHER (unknown/future) entity_type fell
-- through to the base is_tenant_member clause and would be visible to a sales_rep.
-- No production producer emits an unscoped type and clients cannot INSERT, so this
-- is latent — but this AND-s a final default-deny clause so an unknown entity_type
-- additionally requires owner/admin. All eight known-entity clauses are reproduced
-- VERBATIM (their behavior is unchanged); only unknown types are tightened.
--
-- ADDITIVE ONLY: redefinition of two order RPCs (unchanged public contract) + one
-- SELECT-policy hardening. No table/column create/drop, no TRUNCATE, no data
-- mutation/backfill, no history repair, no new grants, no unrelated redefinitions.
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1a. update_order_status — deterministic ascending product_id lock order ──
-- Base: 20260802100000 (M8H.1). ONLY change vs that definition: `order by
-- oi.product_id` on the RESERVE loop and `order by m.product_id` on the RESTORE
-- loop, so inventory_items row locks are always taken in ascending product_id.
create or replace function public.update_order_status(
  p_tenant_id uuid,
  p_order_id uuid,
  p_new_status public.order_status
)
returns table (order_id uuid, old_status public.order_status, new_status public.order_status)
language plpgsql security definer set search_path = ''
as $$
declare
  v_tenant uuid;
  v_current public.order_status;
  v_allowed public.order_status[];
  v_line record;
  v_avail integer;
  v_reserved_before boolean;
  v_released_before boolean;
  v_effect text;
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

  -- Requested status == current status: an effective NO-OP. Unchanged response,
  -- no mutation — and therefore NO audit event.
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

  -- Ledger state BEFORE any reconciliation — lets us derive an HONEST
  -- inventory_effect (a movement row was actually written) rather than guessing.
  v_reserved_before := exists (
    select 1 from public.order_inventory_movements m
    where m.tenant_id = v_tenant and m.order_id = p_order_id and m.reason = 'order_reserved');
  v_released_before := exists (
    select 1 from public.order_inventory_movements m
    where m.tenant_id = v_tenant and m.order_id = p_order_id
      and m.reason = 'order_reservation_released');

  update public.orders o set status = p_new_status where o.id = p_order_id;

  -- RESERVE on entering confirmed/preparing, once (M7I.2). Blocks on
  -- insufficient stock so the order stays at its previous stage. Products are
  -- reserved in ascending product_id order (M8I.7 deterministic lock order).
  if p_new_status in ('confirmed', 'preparing')
     and not exists (
       select 1 from public.order_inventory_movements m
       where m.tenant_id = v_tenant and m.order_id = p_order_id
         and m.reason = 'order_reserved'
     ) then
    for v_line in
      select oi.product_id as pid, sum(oi.quantity)::integer as qty
      from public.order_items oi
      where oi.order_id = p_order_id and oi.product_id is not null
      group by oi.product_id
      order by oi.product_id
    loop
      select inv.quantity_available into v_avail
      from public.inventory_items inv
      where inv.tenant_id = v_tenant and inv.product_id = v_line.pid
      for update;
      if not found then
        continue; -- untracked product: nothing to reserve
      end if;
      if v_avail < v_line.qty then
        raise exception 'update_order_status: insufficient stock for product % (have %, need %)',
          v_line.pid, v_avail, v_line.qty using errcode = 'MDF30';
      end if;
      update public.inventory_items
         set quantity_available = quantity_available - v_line.qty, updated_at = now()
       where tenant_id = v_tenant and product_id = v_line.pid;
      insert into public.order_inventory_movements
        (tenant_id, order_id, product_id, quantity_delta, reason, created_by)
      values
        (v_tenant, p_order_id, v_line.pid, -v_line.qty, 'order_reserved', (select auth.uid()));
    end loop;
  end if;

  -- RESTORE on cancel IF reserved and not yet released (once). Restores the
  -- NET currently-reserved amount per product (reserve + any edit adjustments),
  -- in ascending product_id order (M8I.7 deterministic lock order).
  if p_new_status = 'cancelled'
     and exists (
       select 1 from public.order_inventory_movements m
       where m.tenant_id = v_tenant and m.order_id = p_order_id and m.reason = 'order_reserved'
     )
     and not exists (
       select 1 from public.order_inventory_movements m
       where m.tenant_id = v_tenant and m.order_id = p_order_id and m.reason = 'order_reservation_released'
     ) then
    for v_line in
      select m.product_id as pid, -sum(m.quantity_delta)::integer as qty
      from public.order_inventory_movements m
      where m.tenant_id = v_tenant and m.order_id = p_order_id
        and m.reason in ('order_reserved', 'order_edit_adjustment')
      group by m.product_id
      having -sum(m.quantity_delta) > 0
      order by m.product_id
    loop
      update public.inventory_items
         set quantity_available = quantity_available + v_line.qty, updated_at = now()
       where tenant_id = v_tenant and product_id = v_line.pid;
      insert into public.order_inventory_movements
        (tenant_id, order_id, product_id, quantity_delta, reason, created_by)
      values
        (v_tenant, p_order_id, v_line.pid, v_line.qty, 'order_reservation_released', (select auth.uid()));
    end loop;
  end if;

  -- M8H.1: ONE order.status_changed, written AFTER the status update and the
  -- inventory reconciliation have both succeeded — so an MDF30 stock failure
  -- rolls the status, the movements AND this event back together. The effect is
  -- derived from what the ledger ACTUALLY recorded (an all-untracked order
  -- reserves nothing → 'none'). No quantities/products/totals ever leave here.
  v_effect := case
    when not v_reserved_before and exists (
      select 1 from public.order_inventory_movements m
      where m.tenant_id = v_tenant and m.order_id = p_order_id and m.reason = 'order_reserved')
      then 'reserved'
    when not v_released_before and exists (
      select 1 from public.order_inventory_movements m
      where m.tenant_id = v_tenant and m.order_id = p_order_id
        and m.reason = 'order_reservation_released')
      then 'restored'
    else 'none'
  end;
  perform public._log_order_audit_event(
    v_tenant, 'order.status_changed', p_order_id,
    jsonb_build_object(
      'from_status', v_current::text,
      'to_status', p_new_status::text,
      'inventory_effect', v_effect));

  return query select p_order_id, v_current, p_new_status;
end;
$$;

revoke all on function public.update_order_status(uuid, uuid, public.order_status)
  from public, anon;
grant execute on function public.update_order_status(uuid, uuid, public.order_status)
  to authenticated, service_role;

-- ── 1b. update_order_items — deterministic ascending product_id lock order ──
-- Base: 20260802100000 (M8H.1). ONLY change vs that definition: `order by pid`
-- on the edit-reconciliation loop, so inventory_items row locks are always taken
-- in ascending product_id — matching update_order_status.
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
           where exists (
             select 1 from public.products p
             where p.id = lines.product_id and p.tenant_id = p_tenant_id and p.is_active))
  into v_item_count, v_valid_count
  from lines;
  if v_valid_count <> v_item_count then
    raise exception 'update_order_items: one or more products are unknown, inactive, or belong to another tenant'
      using errcode = '22023';
  end if;

  -- BEFORE state (product_id → quantity) purely to decide whether this edit is
  -- EFFECTIVE. The existing write behavior below is unchanged (the lines are
  -- always re-snapshotted and updated_at always bumps) — only the AUDIT is
  -- change-gated, so a resubmission of identical lines records no event.
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

  v_reserved := exists (
    select 1 from public.order_inventory_movements m
    where m.tenant_id = v_tenant and m.order_id = p_order_id and m.reason = 'order_reserved');

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

  -- Replace the lines (re-snapshot from live products, like create). Qualify
  -- the column — order_id is also a RETURNS TABLE out-variable here.
  delete from public.order_items oi where oi.order_id = p_order_id;
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
    p_tenant_id, p_order_id, p.id,
    jsonb_build_object('ar', p.name_ar, 'he', p.name_he, 'en', p.name_en),
    case when m.id is null then null else jsonb_build_object(
      'ar', m.name_ar, 'he', m.name_he, 'en', m.name_en) end,
    p.package_unit, p.package_quantity, l.quantity, p.wholesale_price, p.vat_rate,
    round(l.quantity * p.wholesale_price, 2),
    round(round(l.quantity * p.wholesale_price, 2) * p.vat_rate, 2),
    round(l.quantity * p.wholesale_price, 2)
      + round(round(l.quantity * p.wholesale_price, 2) * p.vat_rate, 2)
  from lines l
  join public.products p on p.id = l.product_id and p.tenant_id = p_tenant_id and p.is_active
  left join public.manufacturers m on m.id = p.manufacturer_id;

  get diagnostics v_inserted = row_count;
  if v_inserted <> v_item_count then
    raise exception 'update_order_items: catalog changed while editing — please retry' using errcode = '40001';
  end if;

  select sum(i.line_subtotal), round(sum(i.line_subtotal * i.vat_rate_snapshot), 2)
  into v_subtotal, v_vat_total
  from public.order_items i where i.order_id = p_order_id;

  update public.orders o
     set subtotal = v_subtotal, vat_total = v_vat_total, total = v_subtotal + v_vat_total,
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

-- ── 2. audit_events SELECT policy — unknown-entity DEFAULT-DENY ─────────────
-- The eight known-entity clauses are reproduced VERBATIM (their reader scoping is
-- unchanged); a final clause additionally requires owner/admin for any entity_type
-- NOT in the known set, so an unknown/future type is never visible to a sales_rep,
-- non-member, anonymous, or other tenant. Single SELECT policy; no competing
-- permissive policy; INSERT behavior + producers unchanged.
drop policy if exists "audit_events: members read; entity rows scoped" on public.audit_events;

create policy "audit_events: members read; entity rows scoped"
  on public.audit_events
  for select
  to authenticated
  using (
    public.is_tenant_member(tenant_id)
    and (
      entity_type <> 'customer'
      or public.can_access_customer(tenant_id, entity_id)
    )
    and (
      entity_type <> 'order'
      or (entity_id is not null and public.can_access_order(tenant_id, entity_id))
    )
    and (
      entity_type <> 'product'
      or public.has_tenant_role(tenant_id, array['owner', 'admin']::public.tenant_role[])
    )
    and (
      entity_type <> 'inventory'
      or public.has_tenant_role(tenant_id, array['owner', 'admin']::public.tenant_role[])
    )
    and (
      entity_type <> 'team'
      or public.has_tenant_role(tenant_id, array['owner', 'admin']::public.tenant_role[])
    )
    and (
      entity_type <> 'settings'
      or public.has_tenant_role(tenant_id, array['owner', 'admin']::public.tenant_role[])
    )
    and (
      entity_type <> 'sales_rep_assignment'
      or public.has_tenant_role(tenant_id, array['owner', 'admin']::public.tenant_role[])
    )
    and (
      entity_type <> 'customer_signup_request'
      or public.has_tenant_role(tenant_id, array['owner', 'admin']::public.tenant_role[])
    )
    -- DEFAULT-DENY: any entity_type OUTSIDE the known set additionally requires
    -- owner/admin, so an unknown/future type is never sales_rep/non-member visible.
    and (
      entity_type in ('customer', 'order', 'product', 'inventory', 'team',
                      'settings', 'sales_rep_assignment', 'customer_signup_request')
      or public.has_tenant_role(tenant_id, array['owner', 'admin']::public.tenant_role[])
    )
  );
