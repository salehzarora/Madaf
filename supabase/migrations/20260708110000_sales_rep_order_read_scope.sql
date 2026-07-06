-- ═══════════════════════════════════════════════════════════════════════
-- Madaf M4D.1 — enforce sales_rep ORDER-READ scoping
--
-- M4D scoped the customers table + order CREATION for sales_rep, but order
-- READS stayed member-wide: a rep could still list every tenant order and,
-- through the order/document `customer_snapshot`, learn the names of
-- UNASSIGNED customers. M4D.1 closes that.
--
--   can_access_order(tenant, order) — owner/admin: any order in the tenant;
--   sales_rep: only orders whose customer is assigned to them
--   (sales_rep_customers). A null-customer (walk-in) order is owner/admin
--   only. Non-member / wrong tenant → false.
--
-- It re-scopes the SELECT policies on orders, order_items,
-- order_status_history and documents (all of which previously used
-- is_tenant_member). owner/admin behaviour is unchanged; anon stays denied;
-- direct writes stay blocked (M3A.1); the SECURITY DEFINER order/token RPCs
-- bypass RLS and are unaffected, so order creation and the tokenized shop
-- flow keep working.
-- ═══════════════════════════════════════════════════════════════════════

-- ── can_access_order — the sales_rep order-visibility predicate ───────────
-- SECURITY DEFINER so it reads orders / sales_rep_customers past their RLS
-- (no policy recursion). owner/admin short-circuit to true; a sales_rep sees
-- an order only when its customer is assigned to them in the same tenant.
create or replace function public.can_access_order(
  p_tenant_id uuid,
  p_order_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if public.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.tenant_role[]) then
    return true;
  end if;
  return exists (
    select 1
    from public.orders o
    join public.sales_rep_customers a
      on a.tenant_id = o.tenant_id
     and a.customer_id = o.customer_id
    where o.tenant_id = p_tenant_id
      and o.id = p_order_id
      and a.user_id = (select auth.uid())
  );
end;
$$;

comment on function public.can_access_order(uuid, uuid) is
  'True when the caller may READ the given order of the given tenant: owner/admin → any order; sales_rep → only orders whose customer is assigned to them (sales_rep_customers). Null-customer (walk-in) orders are owner/admin only. Basis of M4D.1 order-read scoping (orders/order_items/order_status_history/documents SELECT policies).';

revoke all on function public.can_access_order(uuid, uuid) from public, anon;
grant execute on function public.can_access_order(uuid, uuid) to authenticated, service_role;

-- ── Re-scope the order-related SELECT policies ───────────────────────────
-- Each previously read is_tenant_member(tenant_id) (any member). Now a rep
-- sees only rows tied to an accessible order. Writes are already locked
-- (M3A.1: orders/order_items are read-only for authenticated; history +
-- documents are read-only for everyone), so only SELECT changes.

drop policy "orders: members can read" on public.orders;
create policy "orders: read (owner/admin all, rep assigned)"
  on public.orders for select to authenticated
  using (public.can_access_order(tenant_id, id));

drop policy "order_items: members can read" on public.order_items;
create policy "order_items: read (owner/admin all, rep assigned)"
  on public.order_items for select to authenticated
  using (public.can_access_order(tenant_id, order_id));

drop policy "order_status_history: members can read" on public.order_status_history;
create policy "order_status_history: read (owner/admin all, rep assigned)"
  on public.order_status_history for select to authenticated
  using (public.can_access_order(tenant_id, order_id));

drop policy "documents: members can read" on public.documents;
create policy "documents: read (owner/admin all, rep assigned)"
  on public.documents for select to authenticated
  using (public.can_access_order(tenant_id, order_id));
