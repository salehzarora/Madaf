-- ═══════════════════════════════════════════════════════════════════════
-- Madaf M7I.1 — guest ordering from a product-showcase link
--
-- A prospective (unknown) store opens /showcase/<token>, browses, adds to cart,
-- and submits an order request WITH its store details — no login, no account.
-- The order lands with customer_id = NULL and the store details in
-- customer_snapshot (guest = true), source 'remote_customer' (reused; no enum
-- change). The warehouse owner then sees the requested items + store details
-- and can create a permanent customer from it (create_customer_from_order) or
-- keep it as a one-time order.
--
-- Security mirrors the shop token order + showcase catalog:
--   - anon submit ONLY via this SECURITY DEFINER RPC after in-DB token
--     resolution (_resolve_showcase_token), rate-limited ('showcase_order'),
--   - tenant comes from the token; the visitor cannot set tenant_id/customer_id,
--   - all money is computed server-side by _order_create_core (real products),
--   - the customer sees the PUBLIC ref only (never the internal number),
--   - NO inventory is reserved (order is 'new' until an admin confirms).
--
-- Local stack only; apply to hosted staging with `supabase db push`.
-- ═══════════════════════════════════════════════════════════════════════

-- ── Anon: submit a guest order via a valid showcase token ─────────────────

create or replace function public.create_order_from_showcase_token(
  p_token text,
  p_items jsonb,
  p_store_name text,
  p_contact_name text default null,
  p_phone text default null,
  p_email text default null,
  p_city_ar text default null,
  p_city_he text default null,
  p_city_en text default null,
  p_address text default null,
  p_notes text default null
)
returns table (order_number text)
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_tenant uuid;
  v_link uuid;
  v_order_id uuid;
  v_public_ref text;
  v_fp text := encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex');
  v_name text := nullif(trim(coalesce(p_store_name, '')), '');
  v_email text := nullif(trim(coalesce(p_email, '')), '');
begin
  -- Same rate limiter as the showcase catalog (resolution failures only).
  if public._token_rate_exceeded('showcase_order', v_fp) then
    return;
  end if;
  begin
    select tenant_id, link_id into v_tenant, v_link
    from public._resolve_showcase_token(p_token);
  exception when others then
    perform public._record_token_failure('showcase_order', v_fp);
    return;
  end;

  -- Store details (content errors are NOT rate-limited).
  if v_name is null then
    raise exception 'guest order: store name is required' using errcode = '22023';
  end if;
  if length(v_name) > 200
     or coalesce(length(trim(p_contact_name)), 0) > 200
     or coalesce(length(trim(p_phone)), 0) > 40
     or coalesce(length(v_email), 0) > 254
     or greatest(coalesce(length(trim(p_city_ar)), 0), coalesce(length(trim(p_city_he)), 0),
                 coalesce(length(trim(p_city_en)), 0)) > 120
     or coalesce(length(trim(p_address)), 0) > 300 then
    raise exception 'guest order: a field exceeds its maximum length' using errcode = '22023';
  end if;
  if v_email is not null and v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'guest order: invalid email' using errcode = '22023';
  end if;

  -- Create the order (customer NULL) — all money server-side, real products.
  select o.order_id into v_order_id
  from public._order_create_core(v_tenant, p_items, null, p_notes, 'remote_customer') o;

  -- Attach the guest store details as the buyer snapshot (guest = true).
  update public.orders
     set customer_snapshot = jsonb_build_object(
           'name', v_name,
           'contact_name', nullif(trim(coalesce(p_contact_name, '')), ''),
           'phone', nullif(trim(coalesce(p_phone, '')), ''),
           'email', v_email,
           'address', nullif(trim(coalesce(p_address, '')), ''),
           'city', jsonb_build_object(
             'ar', nullif(trim(coalesce(p_city_ar, '')), ''),
             'he', nullif(trim(coalesce(p_city_he, '')), ''),
             'en', nullif(trim(coalesce(p_city_en, '')), '')),
           'guest', true)
   where id = v_order_id;

  update public.catalog_showcase_links set last_used_at = now() where id = v_link;

  select public_ref into v_public_ref from public.orders where id = v_order_id;
  return query select v_public_ref;
end;
$$;
revoke all on function public.create_order_from_showcase_token(
  text, jsonb, text, text, text, text, text, text, text, text, text) from public;
grant execute on function public.create_order_from_showcase_token(
  text, jsonb, text, text, text, text, text, text, text, text, text)
  to anon, authenticated, service_role;

-- ── Owner/admin: promote a guest order's store to a permanent customer ────

create or replace function public.create_customer_from_order(
  p_tenant_id uuid,
  p_order_id uuid
)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_tenant uuid;
  v_snap jsonb;
  v_existing uuid;
  v_customer_id uuid;
  v_name text;
begin
  v_tenant := public.authorize_tenant(p_tenant_id, array['owner', 'admin']::public.tenant_role[]);

  select o.customer_id, o.customer_snapshot into v_existing, v_snap
  from public.orders o
  where o.id = p_order_id and o.tenant_id = v_tenant
  for update;
  if not found then
    raise exception 'create_customer_from_order: order unknown or another tenant' using errcode = '22023';
  end if;
  if v_existing is not null then
    raise exception 'create_customer_from_order: order is already linked to a customer' using errcode = '22023';
  end if;
  v_name := nullif(trim(coalesce(v_snap ->> 'name', '')), '');
  if v_name is null then
    raise exception 'create_customer_from_order: order has no store details to create a customer from' using errcode = '22023';
  end if;

  -- Same column list as create_customer (M7F.2), sourced from the snapshot.
  insert into public.customers
    (tenant_id, name, contact_name, phone,
     city_ar, city_he, city_en, address, customer_type, notes)
  values
    (v_tenant, v_name,
     nullif(trim(coalesce(v_snap ->> 'contact_name', '')), ''),
     nullif(trim(coalesce(v_snap ->> 'phone', '')), ''),
     nullif(trim(coalesce(v_snap #>> '{city,ar}', '')), ''),
     nullif(trim(coalesce(v_snap #>> '{city,he}', '')), ''),
     nullif(trim(coalesce(v_snap #>> '{city,en}', '')), ''),
     nullif(trim(coalesce(v_snap ->> 'address', '')), ''),
     'grocery',
     case when nullif(trim(coalesce(v_snap ->> 'email', '')), '') is not null
       then 'Email: ' || (v_snap ->> 'email') else null end)
  returning id into v_customer_id;

  -- Link the order to the new customer.
  update public.orders set customer_id = v_customer_id, updated_at = now()
   where id = p_order_id;
  return v_customer_id;
end;
$$;
revoke all on function public.create_customer_from_order(uuid, uuid) from public, anon;
grant execute on function public.create_customer_from_order(uuid, uuid) to authenticated, service_role;
