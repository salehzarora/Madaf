-- ═══════════════════════════════════════════════════════════════════════
-- Madaf M7H.4 — deduct inventory when an order is delivered
--
-- Today update_order_status only flips orders.status; stock is never consumed.
-- This deducts each order line's quantity from inventory_items when an order
-- transitions to 'delivered', EXACTLY ONCE, inside the same transaction as the
-- status change (so a failure rolls back both).
--
-- Rules:
--   - Fires on the transition INTO 'delivered' (preparing -> delivered).
--   - Idempotent: an append-only order_inventory_movements ledger records the
--     deduction; a second call (or reload) sees the existing rows and skips.
--     The FOR UPDATE lock on the order row (kept from the base RPC) also
--     serializes concurrent deliveries.
--   - Units match: order_items.quantity and inventory_items.quantity_available
--     are both in whole PACKAGES.
--   - Products with NO inventory_items row are untracked → skipped (no block).
--   - Insufficient stock BLOCKS delivery with a clear error (MDF30): the app
--     surfaces it and the order stays 'preparing'. (inventory_items has a
--     quantity_available >= 0 CHECK — negative stock is not allowed.)
--   - Status moving back out of 'delivered' does NOT auto-restore stock
--     (delivered is terminal in the transition table anyway); a manual
--     inventory adjustment is required — documented, chosen for safety.
--   - Owner/admin only (unchanged authorize_tenant gate); no anon/customer path.
--
-- Local stack only; apply to hosted staging with `supabase db push`.
-- ═══════════════════════════════════════════════════════════════════════

-- Append-only ledger: idempotency guard + minimal audit of stock consumption.
create table public.order_inventory_movements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  order_id uuid not null,
  product_id uuid,
  -- Negative = deducted from stock. One row per product per reason.
  quantity_delta integer not null,
  reason text not null default 'order_delivered',
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  -- Idempotency: at most one movement per (order, product, reason).
  unique (tenant_id, order_id, product_id, reason),
  foreign key (tenant_id, order_id)
    references public.orders (tenant_id, id) on delete cascade
);

create index order_inventory_movements_order_idx
  on public.order_inventory_movements (tenant_id, order_id);

-- RLS: owner/admin may READ (audit); writes ONLY inside the SECURITY DEFINER
-- RPC (which runs as owner and bypasses RLS). No anon access.
alter table public.order_inventory_movements enable row level security;
revoke all on public.order_inventory_movements from anon, authenticated;
grant select on public.order_inventory_movements to authenticated;
grant select, insert, update, delete on public.order_inventory_movements to service_role;

create policy "order_inventory_movements: owner/admin read"
  on public.order_inventory_movements for select to authenticated
  using (public.has_tenant_role(tenant_id, array['owner', 'admin']::public.tenant_role[]));

-- ── update_order_status — same signature/gate/transitions, now deducting ──
-- Base copied from 20260705170000_auth_and_private_links.sql:387-442; the only
-- addition is the delivered-transition deduction block before `return query`.
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

  -- M7H.4: consume stock on delivery, exactly once (ledger-guarded).
  if p_new_status = 'delivered'
     and not exists (
       select 1 from public.order_inventory_movements m
       where m.tenant_id = v_tenant and m.order_id = p_order_id
         and m.reason = 'order_delivered'
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
        continue; -- untracked product: nothing to deduct
      end if;
      if v_avail < v_line.qty then
        raise exception 'update_order_status: insufficient stock for product % (have %, need %)',
          v_line.pid, v_avail, v_line.qty using errcode = 'MDF30';
      end if;
      update public.inventory_items
         set quantity_available = quantity_available - v_line.qty,
             updated_at = now()
       where tenant_id = v_tenant and product_id = v_line.pid;
      insert into public.order_inventory_movements
        (tenant_id, order_id, product_id, quantity_delta, reason, created_by)
      values
        (v_tenant, p_order_id, v_line.pid, -v_line.qty, 'order_delivered', (select auth.uid()));
    end loop;
  end if;

  return query select p_order_id, v_current, p_new_status;
end;
$$;

comment on function public.update_order_status(uuid, uuid, public.order_status) is
  'Authenticated order-status transition (owner/admin). Tenant derived from membership; history via trigger. Deducts inventory once on transition to delivered (M7H.4).';

revoke all on function public.update_order_status(uuid, uuid, public.order_status)
  from public, anon;
grant execute on function public.update_order_status(uuid, uuid, public.order_status)
  to authenticated, service_role;
