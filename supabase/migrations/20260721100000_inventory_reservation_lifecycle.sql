-- ═══════════════════════════════════════════════════════════════════════
-- Madaf M7I.2 — inventory RESERVATION lifecycle (reserve on confirm, not deliver)
--
-- M7H deducted stock only when an order reached 'delivered'. The correct model
-- (3 business stages): New (no stock change) → Confirmed/Preparing (reserve =
-- deduct) → Delivered (no further change). Cancelling a RESERVED order restores
-- the stock. All done via the append-only order_inventory_movements ledger with
-- new reasons — the ledger stays the source of truth for what an order has
-- consumed, so edits (M7I.3) reconcile against it too.
--
-- Reasons: order_reserved (−qty on confirm/preparing), order_edit_adjustment
-- (±delta on edit, M7I.3), order_reservation_released (+qty on cancel-restore).
--
-- The M7H strict unique (tenant_id, order_id, product_id, reason) blocked more
-- than one adjustment per product, so it is replaced by two PARTIAL uniques
-- (reserve-once, release-once) that still guarantee idempotency while allowing
-- multiple edit adjustments.
--
-- Owner/admin only (unchanged gate); no anon/customer path. Local stack only;
-- apply to hosted staging with `supabase db push`.
-- ═══════════════════════════════════════════════════════════════════════

-- Replace the strict unique with per-reason idempotency guards.
alter table public.order_inventory_movements
  drop constraint order_inventory_movements_tenant_id_order_id_product_id_rea_key;

create unique index order_inv_reserve_once
  on public.order_inventory_movements (tenant_id, order_id, product_id)
  where reason = 'order_reserved';
create unique index order_inv_release_once
  on public.order_inventory_movements (tenant_id, order_id, product_id)
  where reason = 'order_reservation_released';

-- ── update_order_status — reserve on confirm/preparing, restore on cancel ──
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
  v_line record;
  v_avail integer;
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

  -- RESERVE on entering confirmed/preparing, once (M7I.2). Blocks on
  -- insufficient stock so the order stays at its previous stage.
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
  -- NET currently-reserved amount per product (reserve + any edit adjustments).
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

  return query select p_order_id, v_current, p_new_status;
end;
$$;

comment on function public.update_order_status(uuid, uuid, public.order_status) is
  'Authenticated order-status transition (owner/admin). Reserves inventory once on entering confirmed/preparing; restores once on cancel-after-reserve; delivered is a no-op (M7I.2).';

revoke all on function public.update_order_status(uuid, uuid, public.order_status)
  from public, anon;
grant execute on function public.update_order_status(uuid, uuid, public.order_status)
  to authenticated, service_role;
