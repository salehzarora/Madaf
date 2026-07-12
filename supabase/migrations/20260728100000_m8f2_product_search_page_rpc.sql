-- ═══════════════════════════════════════════════════════════════════════
-- M8F.2 — secure, read-only product SEARCH + PAGINATION RPC
--
-- Solves both remaining M8F.2 blockers with ONE additive, RLS-preserving
-- function:
--
--   1. COMPLETE free-text search across the product's own fields AND the
--      manufacturer/brand name, via a real SQL LEFT JOIN — expressed as
--      `product-field match OR manufacturer-name match`. This replaces the
--      rejected PostgREST `manufacturer_id.in.(…all matching ids…)` fold-in,
--      whose URL grew with the match set. Here the OR is a JOIN predicate, so
--      the request size is independent of the number of matching brands.
--
--   2. EXACT deterministic SKU ordering shared by Supabase and Mock:
--        (nullif(btrim(sku),'') is null),          -- blank/NULL SKUs last
--        nullif(btrim(sku),'') collate "C" asc,     -- byte order (not locale)
--        id asc                                     -- unique tie-breaker
--      `COLLATE "C"` pins the ordering to byte order in EVERY environment
--      (the DB default is en_US.UTF-8), so the Mock UTF-8 byte comparator
--      matches it for every application-valid SKU.
--
-- The RPC returns ONE metadata row (even for zero matches): the exact
-- total_count, the normalized page/page_size/total_pages, and the ORDERED
-- product_ids for the current page ONLY (bounded by the page size ≤ 100). The
-- application fetches detail rows for just those ids afterwards. No signed
-- image URLs, no unbounded id collection.
--
-- SECURITY: SECURITY INVOKER — it runs as the authenticated caller, so the
-- existing RLS SELECT policies on products + manufacturers
-- (`is_tenant_member(tenant_id)`) are the authorization boundary. p_tenant_id
-- is server-derived (getDataContext) and applied as an explicit belt-and-braces
-- filter; it never authorizes by itself — an authenticated user passing a
-- tenant they are not a member of gets ZERO rows (RLS). No SECURITY DEFINER, no
-- service_role, no anon/PUBLIC execute. Additive: creates one function; touches
-- no table, policy, grant (other than this function), or existing migration.
-- ═══════════════════════════════════════════════════════════════════════

create or replace function public.search_product_page_ids(
  p_tenant_id uuid,
  p_search text default '',
  p_category_id uuid default null,
  p_manufacturer_id uuid default null,
  p_status text default 'all',
  p_page integer default 1,
  p_page_size integer default 50
)
returns table (
  total_count bigint,
  page integer,
  page_size integer,
  total_pages integer,
  product_ids uuid[]
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  -- Literal, case-insensitive substring term (no wildcard operators): lowered
  -- and space-trimmed. Empty term ⇒ no search predicate.
  v_term text := lower(btrim(coalesce(p_search, '')));
  v_status text := lower(coalesce(nullif(btrim(p_status), ''), 'all'));
  v_page_size integer := least(greatest(coalesce(p_page_size, 50), 1), 100);
  v_page integer := greatest(coalesce(p_page, 1), 1);
begin
  if v_status not in ('all', 'active', 'inactive') then
    v_status := 'all';
  end if;

  return query
  with matched as (
    -- RLS scopes products + manufacturers to the caller's tenant(s); the
    -- explicit p.tenant_id filter narrows to the SELECTED tenant. The LEFT JOIN
    -- keeps products whose brand does not match (or is absent) so an own-field
    -- match is never dropped. The manufacturer join is FK-composite
    -- (tenant_id, id) so it can never cross tenants.
    select
      p.id,
      nullif(btrim(p.sku), '') as sku_key
    from public.products p
    left join public.manufacturers m
      on m.tenant_id = p.tenant_id and m.id = p.manufacturer_id
    where p.tenant_id = p_tenant_id
      and (p_category_id is null or p.category_id = p_category_id)
      and (p_manufacturer_id is null or p.manufacturer_id = p_manufacturer_id)
      and (
        v_status = 'all'
        or (v_status = 'active' and p.is_active = true)
        or (v_status = 'inactive' and p.is_active = false)
      )
      and (
        v_term = ''
        or strpos(lower(p.name_ar), v_term) > 0
        or strpos(lower(p.name_he), v_term) > 0
        or strpos(lower(p.name_en), v_term) > 0
        or strpos(lower(coalesce(p.sku, '')), v_term) > 0
        or strpos(lower(coalesce(p.barcode, '')), v_term) > 0
        or strpos(lower(coalesce(m.name_ar, '')), v_term) > 0
        or strpos(lower(coalesce(m.name_he, '')), v_term) > 0
        or strpos(lower(coalesce(m.name_en, '')), v_term) > 0
      )
  ),
  ranked as (
    select
      id,
      count(*) over () as match_total,
      row_number() over (
        order by (sku_key is null), sku_key collate "C" asc, id asc
      ) as rn
    from matched
  ),
  meta as (
    -- One row ALWAYS (aggregate over possibly-empty ranked). Aliases avoid the
    -- RETURNS TABLE column names (total_count/page/total_pages) to prevent a
    -- plpgsql variable/column ambiguity.
    select
      coalesce(max(match_total), 0) as tot,
      greatest(1, ((coalesce(max(match_total), 0) + v_page_size - 1) / v_page_size)::integer) as tot_pages
    from ranked
  ),
  pageinfo as (
    -- Clamp an out-of-range page to the last valid page.
    select
      tot,
      tot_pages,
      least(greatest(v_page, 1), tot_pages) as cur_page
    from meta
  ),
  page_rows as (
    select r.id, r.rn
    from ranked r
    cross join pageinfo pi
    where r.rn > (pi.cur_page - 1) * v_page_size
      and r.rn <= pi.cur_page * v_page_size
  )
  select
    pi.tot,
    pi.cur_page,
    v_page_size,
    pi.tot_pages,
    coalesce(
      (select array_agg(pr.id order by pr.rn) from page_rows pr),
      '{}'::uuid[]
    )
  from pageinfo pi;
end;
$$;

comment on function public.search_product_page_ids(uuid, text, uuid, uuid, text, integer, integer) is
  'M8F.2 read-only product search+pagination. SECURITY INVOKER (RLS is the '
  'authorization boundary; p_tenant_id is server-derived belt-and-braces). '
  'Free-text = product name ar/he/en + sku + barcode OR manufacturer name '
  'ar/he/en (literal case-insensitive substring, via a tenant-safe LEFT JOIN). '
  'Filters: category, manufacturer, status. Deterministic order (blank/NULL sku '
  'last, then sku COLLATE "C" asc, then id asc). Returns exact total_count + '
  'normalized page/size/total_pages + the current page''s ordered product_ids '
  '(bounded). Never returns an unbounded id set or signed images.';

-- Least privilege: authenticated only (reads run through the authenticated,
-- cookie-bound client under RLS). Never anon/PUBLIC; no service_role path.
revoke all on function public.search_product_page_ids(uuid, text, uuid, uuid, text, integer, integer) from public, anon;
grant execute on function public.search_product_page_ids(uuid, text, uuid, uuid, text, integer, integer) to authenticated;
