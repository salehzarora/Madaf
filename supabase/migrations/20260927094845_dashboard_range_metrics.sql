-- ADMIN-DASHBOARD-STYLE-006B. Bounded read-only selected-period analytics.
-- No table, policy, protected-write RPC, inventory or auth changes. Existing
-- get_dashboard_metrics remains the current-state/backlog source unchanged.
-- Temporal resolves tenant calendar/DST boundaries on the server; SQL validates
-- those edges independently. Caller-supplied tenant/edges confer no authority.
create function public.get_dashboard_period_metrics(p_tenant_id uuid, p_boundaries timestamptz[])
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  n integer := cardinality(p_boundaries);
  result jsonb;
begin
  if n is null or n < 2 or n > 94 or array_ndims(p_boundaries) <> 1
     or array_lower(p_boundaries, 1) <> 1 then
    raise exception 'Invalid dashboard bucket count' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(p_boundaries) b where b is null or not isfinite(b))
     or p_boundaries[n] - p_boundaries[1] > interval '367 days'
     or exists (select 1 from generate_series(1, n - 1) i where p_boundaries[i + 1] <= p_boundaries[i]) then
    raise exception 'Invalid dashboard range' using errcode = '22023';
  end if;
  with o as materialized (
    select id, status, customer_id, subtotal, created_at
    from public.orders
    where tenant_id = p_tenant_id and created_at >= p_boundaries[1] and created_at < p_boundaries[n]
  ), live as (select * from o where status <> 'cancelled'),
  buckets as (
    select i, p_boundaries[i] as start_at, p_boundaries[i + 1] as end_at,
      count(o.id) filter (where status = 'new') as new_count,
      count(o.id) filter (where status in ('new', 'confirmed', 'preparing')) as open_count,
      count(o.id) filter (where status <> 'cancelled') as live_count,
      coalesce(sum(subtotal) filter (where status <> 'cancelled'), 0) as revenue
    from generate_series(1, n - 1) i
    left join o on o.created_at >= p_boundaries[i] and o.created_at < p_boundaries[i + 1]
    group by i
  ), top_products as (
    select p.id, p.name_ar, p.name_he, p.name_en, sum(i.line_subtotal) as revenue
    from public.order_items i join live l on l.id = i.order_id
    join public.products p on p.id = i.product_id and p.tenant_id = p_tenant_id
    where i.tenant_id = p_tenant_id
    group by p.id order by revenue desc, p.id limit 5
  ), top_shops as (
    select c.id, c.name, sum(l.subtotal) as total, count(*) as count
    from live l join public.customers c on c.id = l.customer_id and c.tenant_id = p_tenant_id
    group by c.id order by total desc, c.id limit 4
  )
  select jsonb_build_object(
    'statusCounts', (select jsonb_build_object('new', count(*) filter (where status = 'new'),
      'confirmed', count(*) filter (where status = 'confirmed'), 'preparing', count(*) filter (where status = 'preparing'),
      'delivered', count(*) filter (where status = 'delivered'), 'cancelled', count(*) filter (where status = 'cancelled')) from o),
    'totalOrders', (select count(*) from o), 'count', (select count(*) from live),
    'revenue', (select coalesce(sum(subtotal), 0) from live),
    'buckets', (select jsonb_agg(jsonb_build_object('start', start_at, 'end', end_at, 'new', new_count, 'open', open_count, 'count', live_count, 'revenue', revenue) order by i) from buckets),
    'topProducts', (select coalesce(jsonb_agg(jsonb_build_object('productId', id, 'name', jsonb_build_object('ar', name_ar, 'he', name_he, 'en', name_en), 'revenue', revenue) order by revenue desc, id), '[]'::jsonb) from top_products),
    'topShops', (select coalesce(jsonb_agg(jsonb_build_object('customerId', id, 'name', name, 'total', total, 'count', count) order by total desc, id), '[]'::jsonb) from top_shops)
  ) into result;
  return result;
end;
$$;
revoke all on function public.get_dashboard_period_metrics(uuid, timestamptz[]) from public, anon;
grant execute on function public.get_dashboard_period_metrics(uuid, timestamptz[]) to authenticated;
comment on function public.get_dashboard_period_metrics(uuid, timestamptz[]) is
  '006B bounded selected-period analytics: <=93 buckets, top5 products/top4 shops. Creation-time cohorts with CURRENT status, not historical backlog. Stored ex-VAT amounts. SECURITY INVOKER, existing tenant/assignment RLS. 367-day maximum elapsed span accommodates DST.';
