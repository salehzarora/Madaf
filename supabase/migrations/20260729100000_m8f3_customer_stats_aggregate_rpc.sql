-- ═══════════════════════════════════════════════════════════════════════
-- M8F.3 — bounded, read-only CUSTOMER-STATISTICS aggregate RPC
--
-- Replaces the Customers page's full-Orders scan (it used to load EVERY order
-- into the app to compute per-store stats) with ONE bounded aggregate for just
-- the CURRENT page's customer ids. Returns one row per AUTHORIZED, VISIBLE
-- requested customer — including customers with zero orders — with exactly the
-- two statistics the Customers UI shows today:
--
--   • order_count   — number of orders LINKED to the customer
--                     (orders.customer_id = customers.id). Guest orders
--                     (customer_id IS NULL) are never joined, so never counted.
--                     ALL statuses count (matches the current app, which counts
--                     every linked order regardless of status).
--   • last_order_at — the most recent orders.created_at across those linked
--                     orders (all statuses); NULL when the customer has none.
--
-- No monetary metric exists in the current Customers stats contract, so none is
-- added (no money aggregation, no float, no Order-item/Product join).
--
-- BOUNDING: the id array is deduped + NULL-stripped and REJECTED if it exceeds
-- 100 (the admin page-size max) — never silently truncated. The app passes only
-- one page of ids (≤ 50), as a bounded ARRAY argument (RPC body, not a URL
-- `.in()` list), so the request and response sizes stay bounded.
--
-- SECURITY: SECURITY INVOKER — runs as the authenticated caller, so the
-- existing RLS SELECT policies are the authorization boundary:
--   • customers → can_access_customer (sales_rep sees only assigned stores);
--   • orders    → can_access_order    (sales_rep sees only assigned orders).
-- The base set is the VISIBLE customers relation restricted to the requested
-- ids (NOT rows fabricated from the input UUIDs), so an id the caller cannot
-- access simply yields no row, and a cross-tenant / unauthorized id is filtered
-- by RLS. p_tenant_id is server-derived (getReadContext) and applied as an
-- explicit belt-and-braces filter; it never authorizes by itself. No SECURITY
-- DEFINER, no service_role, no anon/PUBLIC execute. Additive: one function; no
-- table/policy/grant (other than this function) / data change; existing
-- (tenant_id, customer_id) index already supports the aggregate join.
-- ═══════════════════════════════════════════════════════════════════════

create or replace function public.get_customer_stats_for_ids(
  p_tenant_id uuid,
  p_customer_ids uuid[]
)
returns table (
  customer_id uuid,
  order_count bigint,
  last_order_at timestamptz
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_ids uuid[];
begin
  -- Normalize: dedupe + drop NULLs.
  select coalesce(array_agg(distinct x), '{}'::uuid[])
    into v_ids
  from unnest(coalesce(p_customer_ids, '{}'::uuid[])) as t(x)
  where x is not null;

  -- Bound: reject an oversized request rather than silently truncating.
  if coalesce(array_length(v_ids, 1), 0) > 100 then
    raise exception 'get_customer_stats_for_ids: at most 100 customer ids per call'
      using errcode = '22023';
  end if;

  -- Empty request → no rows (return_query over an empty base is safe).
  return query
  select
    c.id,
    count(o.id)::bigint as order_count,
    max(o.created_at) as last_order_at
  from public.customers c
  -- Aggregate directly from orders on the FK (tenant_id, customer_id) — no
  -- order_items / product join (which could multiply totals). RLS scopes both
  -- relations to what the caller may see (can_access_customer / can_access_order).
  left join public.orders o
    on o.tenant_id = c.tenant_id
   and o.customer_id = c.id
  where c.tenant_id = p_tenant_id
    and c.id = any (v_ids)
  group by c.id;
end;
$$;

comment on function public.get_customer_stats_for_ids(uuid, uuid[]) is
  'M8F.3 read-only per-customer order stats for a BOUNDED id array (deduped, '
  'max 100). Returns one row per AUTHORIZED, visible requested customer (incl. '
  'zero-order → order_count 0, last_order_at NULL): order_count (linked orders, '
  'all statuses; guest/customer_id-NULL excluded) + last_order_at (max '
  'created_at). SECURITY INVOKER — RLS (can_access_customer/can_access_order) is '
  'the authorization boundary; p_tenant_id is server-derived belt-and-braces. No '
  'money metric, no item/product join, no unbounded tenant-wide aggregate.';

-- Least privilege: authenticated only (reads run through the authenticated,
-- cookie-bound client under RLS). Never anon/PUBLIC; no service_role path.
revoke all on function public.get_customer_stats_for_ids(uuid, uuid[]) from public, anon;
grant execute on function public.get_customer_stats_for_ids(uuid, uuid[]) to authenticated;
