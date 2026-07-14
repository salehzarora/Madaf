-- ═══════════════════════════════════════════════════════════════════════
-- PILOT-READINESS-BATCH-C · C1 — bounded, read-only DASHBOARD METRICS RPC
--
-- The admin dashboard used to load the ENTIRE order history (every order + its
-- order_items) with `listOrders()` and aggregate every KPI/chart in the page
-- component. Once a tenant exceeds the PostgREST max_rows ceiling (1000), that
-- read is silently truncated to the newest 1000 orders, so all-time totals
-- (status donut, top products/shops, revenue) become quietly WRONG. This RPC
-- replaces that full-history scan with ONE bounded aggregate that returns only
-- the computed values the dashboard shows — never a row list, never all orders,
-- never all order_items into app memory.
--
-- METRICS (reproduced EXACTLY from the current page — no new metric, no changed
-- definition):
--   • status_counts        — count per order status (ALL statuses incl. cancelled)
--   • total_orders         — count of all orders (status-donut total)
--   • today {count,revenue}, month {count,revenue}
--                          — non-cancelled orders whose TENANT-LOCAL day / month
--                            equals p_now's; revenue = SUM(orders.subtotal) ex-VAT
--   • guest_pending        — status=new, customer_id NULL, snapshot.guest true
--   • trend                — the last 14 TENANT-LOCAL days that HAVE non-cancelled
--                            orders: [{day, total=SUM(subtotal)}] ascending
--   • top_products (≤5)    — by SUM(order_items.line_subtotal), non-cancelled
--   • top_shops (≤4)       — by SUM(subtotal), non-cancelled, linked customer only
--   • active_product_count, active_shop_count
--   • low_stock {count, out_of_stock_count, items(≤4)}
--                          — inventory_items of ACTIVE products where
--                            quantity_available < COALESCE(low_stock_threshold,10)
--
-- MONEY: revenue sums the STORED `orders.subtotal` / `order_items.line_subtotal`
-- (numeric(12,2), ex-VAT) — the SAME value the page recomputed in JS
-- (quantity * unit_price already rounded to line_subtotal at order creation). No
-- floating point, no VAT, no total. Result carries numeric, not float.
--
-- TIMEZONE: tenant-local calendar boundaries via `AT TIME ZONE p_time_zone`
-- (validated against pg_timezone_names; unknown → UTC, mirroring
-- resolveTenantTimeZone), so `today`/`month`/`trend` match the M8H.2 tenant-zone
-- contract exactly (never raw UTC calendar days). p_now defaults to now() and is
-- passed explicitly by tests for determinism.
--
-- SECURITY: SECURITY INVOKER — runs as the authenticated caller, so the EXISTING
-- RLS SELECT policies are the authorization boundary and each role sees EXACTLY
-- what its full-list reads showed today:
--   • orders → can_access_order, order_items → owner/admin all / rep assigned,
--     customers → can_access_customer, products/inventory_items → members read.
-- A sales_rep therefore gets metrics scoped to their assigned-customer orders,
-- unchanged from before. p_tenant_id is server-derived (getReadContext) and
-- applied as a belt-and-braces filter; it never authorizes by itself. No SECURITY
-- DEFINER, no service_role, no anon/PUBLIC execute, no client-trusted tenant.
-- Additive: ONE function; no table/policy/grant (other than this function) /
-- data change.
-- ═══════════════════════════════════════════════════════════════════════

create or replace function public.get_dashboard_metrics(
  p_tenant_id uuid,
  p_time_zone text,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_tz text;
  v_today date;
  v_result jsonb;
begin
  -- Resolve the tenant zone defensively: a name PostgreSQL does not know falls
  -- back to UTC (mirrors resolveTenantTimeZone), so AT TIME ZONE never errors.
  v_tz := coalesce(nullif(p_time_zone, ''), 'UTC');
  if not exists (
    select 1 from pg_catalog.pg_timezone_names z where z.name = v_tz
  ) then
    v_tz := 'UTC';
  end if;
  v_today := (p_now at time zone v_tz)::date;

  with o as (
    -- One AT TIME ZONE per order → the tenant-LOCAL calendar day, reused below.
    select
      ord.id,
      ord.status,
      ord.customer_id,
      ord.customer_snapshot,
      ord.subtotal,
      (ord.created_at at time zone v_tz)::date as local_day
    from public.orders ord
    where ord.tenant_id = p_tenant_id
  ),
  live as (
    select * from o where status <> 'cancelled'
  ),
  status_agg as (
    select
      jsonb_build_object(
        'new',       count(*) filter (where status = 'new'),
        'confirmed', count(*) filter (where status = 'confirmed'),
        'preparing', count(*) filter (where status = 'preparing'),
        'delivered', count(*) filter (where status = 'delivered'),
        'cancelled', count(*) filter (where status = 'cancelled')
      ) as counts,
      count(*) as total
    from o
  ),
  today_agg as (
    select count(*) as cnt, coalesce(sum(subtotal), 0) as revenue
    from live where local_day = v_today
  ),
  month_agg as (
    select count(*) as cnt, coalesce(sum(subtotal), 0) as revenue
    from live
    where date_trunc('month', local_day) = date_trunc('month', v_today)
  ),
  guest_agg as (
    select count(*) as cnt
    from o
    where status = 'new'
      and customer_id is null
      and coalesce((customer_snapshot ->> 'guest')::boolean, false)
  ),
  trend_agg as (
    select coalesce(
      jsonb_agg(jsonb_build_object('day', d, 'total', total) order by d),
      '[]'::jsonb
    ) as days
    from (
      select local_day as d, sum(subtotal) as total
      from live
      group by local_day
      order by local_day desc
      limit 14
    ) t
  ),
  top_products_agg as (
    -- product_id is a deterministic secondary key so an exact revenue tie has a
    -- stable top-5 selection + order (the old JS stable sort had one too).
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'product_id', product_id,
          'name_ar', name_ar, 'name_he', name_he, 'name_en', name_en,
          'revenue', rev
        ) order by rev desc, product_id
      ), '[]'::jsonb
    ) as items
    from (
      select
        i.product_id,
        sum(i.line_subtotal) as rev,
        max(p.name_ar) as name_ar,
        max(p.name_he) as name_he,
        max(p.name_en) as name_en
      from public.order_items i
      join live l on l.id = i.order_id
      join public.products p on p.id = i.product_id
      group by i.product_id
      order by rev desc, i.product_id
      limit 5
    ) tp
  ),
  top_shops_agg as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'customer_id', customer_id,
          'name', name,
          'total', total,
          'count', cnt
        ) order by total desc, customer_id
      ), '[]'::jsonb
    ) as items
    from (
      select
        l.customer_id,
        sum(l.subtotal) as total,
        count(*) as cnt,
        max(c.name) as name
      from live l
      join public.customers c on c.id = l.customer_id
      group by l.customer_id
      order by total desc, l.customer_id
      limit 4
    ) ts
  ),
  product_counts as (
    select count(*) filter (where is_active) as active_products
    from public.products
    where tenant_id = p_tenant_id
  ),
  shop_counts as (
    select count(*) filter (where is_active) as active_shops
    from public.customers
    where tenant_id = p_tenant_id
  ),
  low as (
    select
      i.product_id,
      i.warehouse_location,
      i.quantity_available,
      coalesce(i.low_stock_threshold, 10) as threshold,
      p.name_ar, p.name_he, p.name_en
    from public.inventory_items i
    join public.products p
      on p.id = i.product_id and p.tenant_id = i.tenant_id
    where i.tenant_id = p_tenant_id
      and p.is_active
      and i.quantity_available < coalesce(i.low_stock_threshold, 10)
  ),
  low_stock_agg as (
    select
      (select count(*) from low) as cnt,
      (select count(*) from low where quantity_available = 0) as out_cnt,
      coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'product_id', product_id,
            'name_ar', name_ar, 'name_he', name_he, 'name_en', name_en,
            'location', warehouse_location,
            'stock', quantity_available,
            'threshold', threshold
          ) order by warehouse_location
        )
        from (select * from low order by warehouse_location limit 4) w
      ), '[]'::jsonb) as items
  )
  select jsonb_build_object(
    'status_counts', (select counts from status_agg),
    'total_orders', (select total from status_agg),
    'today', (select jsonb_build_object('count', cnt, 'revenue', revenue) from today_agg),
    'month', (select jsonb_build_object('count', cnt, 'revenue', revenue) from month_agg),
    'guest_pending', (select cnt from guest_agg),
    'trend', (select days from trend_agg),
    'top_products', (select items from top_products_agg),
    'top_shops', (select items from top_shops_agg),
    'active_product_count', (select active_products from product_counts),
    'active_shop_count', (select active_shops from shop_counts),
    'low_stock', jsonb_build_object(
      'count', (select cnt from low_stock_agg),
      'out_of_stock_count', (select out_cnt from low_stock_agg),
      'items', (select items from low_stock_agg)
    )
  ) into v_result;

  return v_result;
end;
$$;

comment on function public.get_dashboard_metrics(uuid, text, timestamptz) is
  'PILOT-C1 read-only bounded dashboard aggregate. Returns ONE jsonb of the '
  'computed KPIs/charts (status counts, today/month count+ex-VAT revenue, guest '
  'pending, 14-day trend, top 5 products, top 4 shops, active product/shop '
  'counts, low-stock summary) — never an order/order_items row list. Money = '
  'SUM(orders.subtotal / order_items.line_subtotal) numeric ex-VAT. Dates are '
  'tenant-local via AT TIME ZONE p_time_zone (invalid → UTC). SECURITY INVOKER — '
  'RLS (can_access_order/customer, order_items read scope, members-read) is the '
  'authorization boundary, so each role sees exactly what its old full-list read '
  'showed; p_tenant_id is server-derived belt-and-braces. No full-history scan.';

-- Least privilege: authenticated only (reads run through the authenticated,
-- cookie-bound client under RLS). Never anon/PUBLIC; no service_role path.
revoke all on function public.get_dashboard_metrics(uuid, text, timestamptz) from public, anon;
grant execute on function public.get_dashboard_metrics(uuid, text, timestamptz) to authenticated;
