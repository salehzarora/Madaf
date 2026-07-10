-- ═══════════════════════════════════════════════════════════════════════
-- Madaf M8B.2 — manual stock adjustments (owner/admin) on the movements ledger
--
-- The order lifecycle (M7H/M7I) writes order-driven movements; the warehouse
-- also needs to CORRECT stock (physical count, damage, returns, supplier
-- delivery). This adds:
--   1. Ledger generalization: order_id becomes NULLABLE (manual movements
--      have no order; the composite FK passes on NULL) + an optional `note`
--      (free text, capped) for the human explanation.
--   2. adjust_inventory_stock RPC — the ONLY write path (no direct table
--      writes): owner/admin via authorize_tenant, tenant-scoped product,
--      allowlisted manual reason, row lock, NEGATIVE RESULT BLOCKED
--      (MDF32), ledger row with created_by, returns the new quantity.
--
-- A first adjustment for an untracked product CREATES its inventory row
-- (quantity starts at 0 + delta) — counting stock is how tracking begins.
-- sales_rep / anon cannot call it (grant is to authenticated but
-- authorize_tenant requires owner/admin); the ledger read policy stays
-- owner/admin.
--
-- Local stack only; apply to hosted staging with `supabase db push`.
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1. Ledger: allow order-less (manual) movements + a capped note ────────

alter table public.order_inventory_movements
  alter column order_id drop not null;

alter table public.order_inventory_movements
  add column note text
  constraint order_inventory_movements_note_len check (note is null or length(note) <= 500);

comment on column public.order_inventory_movements.note is
  'Optional human note for MANUAL adjustments (M8B). Order-driven movements leave it NULL.';

-- ── 2. Manual adjustment RPC ──────────────────────────────────────────────

create or replace function public.adjust_inventory_stock(
  p_tenant_id uuid,
  p_product_id uuid,
  p_delta integer,
  p_reason text,
  p_note text default null
)
returns integer
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_tenant uuid;
  v_qty integer;
  v_new integer;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
begin
  v_tenant := public.authorize_tenant(p_tenant_id, array['owner', 'admin']::public.tenant_role[]);

  if p_delta is null or p_delta = 0 or abs(p_delta) > 100000 then
    raise exception 'adjust_inventory_stock: delta must be a non-zero integer within ±100000'
      using errcode = '22023';
  end if;
  if p_reason is null or p_reason not in
    ('manual_stock_count', 'manual_damaged_goods', 'manual_returned_goods',
     'manual_supplier_delivery', 'manual_correction', 'manual_other') then
    raise exception 'adjust_inventory_stock: unknown adjustment reason'
      using errcode = '22023';
  end if;
  if v_note is not null and length(v_note) > 500 then
    raise exception 'adjust_inventory_stock: note exceeds 500 characters'
      using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.products p
    where p.id = p_product_id and p.tenant_id = v_tenant
  ) then
    raise exception 'adjust_inventory_stock: product is unknown or belongs to another tenant'
      using errcode = '22023';
  end if;

  -- First adjustment of an untracked product starts tracking it at 0.
  insert into public.inventory_items (tenant_id, product_id)
  values (v_tenant, p_product_id)
  on conflict (tenant_id, product_id) do nothing;

  select quantity_available into v_qty
  from public.inventory_items
  where tenant_id = v_tenant and product_id = p_product_id
  for update;

  v_new := v_qty + p_delta;
  if v_new < 0 then
    raise exception 'adjust_inventory_stock: stock cannot go below zero (have %, delta %)', v_qty, p_delta
      using errcode = 'MDF32';
  end if;

  update public.inventory_items
     set quantity_available = v_new, updated_at = now()
   where tenant_id = v_tenant and product_id = p_product_id;

  insert into public.order_inventory_movements
    (tenant_id, order_id, product_id, quantity_delta, reason, note, created_by)
  values
    (v_tenant, null, p_product_id, p_delta, p_reason, v_note, (select auth.uid()));

  return v_new;
end;
$$;
revoke all on function public.adjust_inventory_stock(uuid, uuid, integer, text, text) from public, anon;
grant execute on function public.adjust_inventory_stock(uuid, uuid, integer, text, text)
  to authenticated, service_role;
