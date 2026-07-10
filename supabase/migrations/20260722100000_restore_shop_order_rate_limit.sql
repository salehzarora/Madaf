-- ═══════════════════════════════════════════════════════════════════════
-- Madaf M8A.1 — restore the anonymous-token rate limiter on the shop
-- order-submit RPC.
--
-- REGRESSION: M7E (20260716100000_order_public_ref.sql) redefined
-- create_order_request_from_token to return the customer-facing public_ref,
-- but dropped the M4D rate-limiter calls (_token_rate_exceeded /
-- _record_token_failure) in the process — leaving the only anonymous WRITE
-- endpoint unthrottled against token probing. Every sibling anon RPC
-- (get_token_catalog, get_showcase_catalog, submit_customer_signup_request,
-- create_order_from_showcase_token) kept its limiter.
--
-- This migration re-declares the function with BOTH behaviors:
--   - M4D rate limiting: over-limit → null (no order row, no info leak);
--     resolution failure → counted via _record_token_failure, then null.
--     Valid tokens are never blocked; order-CONTENT errors (bad items) are
--     NOT rate-limited (they surface to the caller as before).
--   - M7E return value: the customer-facing public_ref (never the internal
--     sequential number).
--
-- Local stack only; apply to hosted staging with `supabase db push`.
-- ═══════════════════════════════════════════════════════════════════════

create or replace function public.create_order_request_from_token(
  p_token text,
  p_items jsonb,
  p_notes text default null
)
returns table (order_number text)
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_tenant uuid;
  v_customer uuid;
  v_link uuid;
  v_order_id uuid;
  v_public_ref text;
  v_fp text := encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex');
begin
  -- Over the limit → deny (no order row). App treats a null ref as failure.
  if public._token_rate_exceeded('shop_order', v_fp) then
    return query select null::text;
    return;
  end if;

  -- Resolve; on failure RECORD + return null (normal return so the counter
  -- commits). Order-content errors below are NOT rate-limited.
  begin
    select tenant_id, customer_id, link_id into v_tenant, v_customer, v_link
    from public._resolve_token(p_token);
  exception when others then
    perform public._record_token_failure('shop_order', v_fp);
    return query select null::text;
    return;
  end;

  -- Token is valid past here.
  select o.order_id into v_order_id
  from public._order_create_core(v_tenant, p_items, v_customer, p_notes, 'remote_customer') o;

  -- Customer sees the random public reference, NOT the internal sequence (M7E).
  select public_ref into v_public_ref from public.orders where id = v_order_id;

  update public.customer_access_links set last_used_at = now() where id = v_link;
  return query select v_public_ref;
end;
$$;
revoke all on function public.create_order_request_from_token(text, jsonb, text) from public;
grant execute on function public.create_order_request_from_token(text, jsonb, text)
  to anon, authenticated, service_role;
