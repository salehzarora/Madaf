-- ═══════════════════════════════════════════════════════════════════════
-- Madaf M8B.3 — link a GUEST order to an EXISTING customer (owner/admin)
--
-- M7I's create_customer_from_order promotes a guest order's snapshot into a
-- NEW customers row. When the store already exists (duplicate-phone warning,
-- M8B), the admin should instead LINK the order to the existing customer —
-- without creating a duplicate. Mirrors create_customer_from_order's guards:
-- owner/admin via authorize_tenant, same-tenant order + customer, only
-- unlinked (guest) orders, FOR UPDATE against double-link races. The guest
-- customer_snapshot is PRESERVED (it documents what the buyer typed).
--
-- Local stack only; apply to hosted staging with `supabase db push`.
-- ═══════════════════════════════════════════════════════════════════════

create or replace function public.link_order_to_customer(
  p_tenant_id uuid,
  p_order_id uuid,
  p_customer_id uuid
)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_tenant uuid;
  v_existing uuid;
begin
  v_tenant := public.authorize_tenant(p_tenant_id, array['owner', 'admin']::public.tenant_role[]);

  select o.customer_id into v_existing
  from public.orders o
  where o.id = p_order_id and o.tenant_id = v_tenant
  for update;
  if not found then
    raise exception 'link_order_to_customer: order unknown or another tenant'
      using errcode = '22023';
  end if;
  if v_existing is not null then
    raise exception 'link_order_to_customer: order is already linked to a customer'
      using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.customers c
    where c.id = p_customer_id and c.tenant_id = v_tenant
  ) then
    raise exception 'link_order_to_customer: customer unknown or another tenant'
      using errcode = '22023';
  end if;

  update public.orders
     set customer_id = p_customer_id, updated_at = now()
   where id = p_order_id;
end;
$$;
revoke all on function public.link_order_to_customer(uuid, uuid, uuid) from public, anon;
grant execute on function public.link_order_to_customer(uuid, uuid, uuid)
  to authenticated, service_role;
