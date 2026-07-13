-- ═══════════════════════════════════════════════════════════════════════
-- M8H.1 — Order lifecycle AUDIT FOUNDATION
--
-- Turns the existing public.audit_events table into a transactional source of
-- truth for ORDER lifecycle actions, exactly as M8G.2 did for customers. The
-- Order Timeline (M8H.2) will READ these rows; nothing is reconstructed.
--
-- MUTATION INVENTORY (verified from the live catalog — orders grants
-- `authenticated` SELECT only, so these SECURITY DEFINER RPCs are the ONLY
-- write paths):
--   creation (3 entry points, one shared private core _order_create_core):
--     • create_order_request            — authenticated (owner/admin/sales_rep)
--     • create_order_request_from_token — anon, private Shop link (rate-limited)
--     • create_order_from_showcase_token— anon, Showcase guest (rate-limited)
--   edit:            update_order_items      (owner/admin; reconciles reserves)
--   status machine:  update_order_status     (owner/admin; reserve/restore once)
--   linking:         link_order_to_customer, create_customer_from_order
--   documents:       create_order_document   — does NOT write orders → no event
--
-- TAXONOMY (closed, 4 keys — one meaning each, no overlap, no "Other"):
--   order.created          one per successfully created order (any channel)
--   order.updated          one per EFFECTIVE line/notes edit (no-op → none)
--   order.status_changed   one per real status transition (Strategy A:
--                          from_status/to_status enums + inventory_effect)
--   order.customer_linked  a previously-unlinked order gained a customer
--
-- STATUS STRATEGY A (single event + from/to) was chosen over per-transition
-- keys: the real machine is a 5-value enum with a small transition matrix, the
-- UI already maps statuses (OrderStatusBadge / dict.status.*), and 8 distinct
-- keys would merely re-encode the enum without adding meaning.
--
-- LEDGER NON-DUPLICATION. Two specialized ledgers already exist and are LEFT
-- UNTOUCHED — the audit event records the BUSINESS transition only:
--   • order_inventory_movements — authoritative stock-quantity ledger. The audit
--     event carries a safe inventory_effect enum (none|reserved|restored) and
--     NEVER quantities, product ids, or stock levels.
--   • order_status_history (orders_log_status_change trigger) — the specialized
--     status ledger. Unchanged; the audit event is the Timeline-facing event.
--   No inventory or status-history row is duplicated into audit_events.
--
-- DUAL-ENTITY LINKING. Linking an order to a customer is ONE business action
-- that legitimately belongs to TWO timelines. M8G.2's customer.order_linked
-- (entity=customer) is preserved byte-for-byte; M8H.1 adds order.customer_linked
-- (entity=order). Each row serves exactly ONE timeline (the Customer Timeline
-- filters entity_type='customer', the Order Timeline filters 'order'), so
-- neither timeline shows the action twice. Without the order-side row the Order
-- Timeline would silently omit a material change of buyer.
--
-- ACTOR / INITIATOR. actor_user_id stays honest: auth.uid() (NULL on the anon
-- token paths). A NULL actor does NOT mean "System" — a closed initiator_kind
-- enum (authenticated_user | customer_link | showcase_guest) is recorded in
-- metadata by the authoritative RPC, so the UI can distinguish the channels
-- honestly. The helper REFUSES a token-channel event carrying an authenticated
-- actor, so an operator can never be recorded as a guest.
--
-- Additive: one private helper + audit-only bodies on the 7 active producers +
-- an additive Order clause on the audit_events SELECT policy. No status/enum
-- change, no backfill, no historical reconstruction, no inventory-math change,
-- no signature/return/security/grant/rate-limit change, no new index (M8G.3's
-- (tenant_id, entity_type, entity_id, created_at DESC, id DESC) is generic and
-- already serves the entity-scoped Order query).
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1. Private Order audit helper ─────────────────────────────────────────
-- SECURITY INVOKER (like M8G.2's customer helper): it holds no privileges of
-- its own and is executable by NO client role — it is reachable only from the
-- SECURITY DEFINER producer RPCs below, which run as the owner. Closed event
-- allowlist, entity_type hardcoded to 'order', actor from auth.uid(), metadata
-- must be a bounded JSON OBJECT whose keys are allowlisted PER EVENT TYPE (so
-- no producer — and certainly no client — can smuggle a PII/token/price key in).

create function public._log_order_audit_event(
  p_tenant_id uuid,
  p_event_type text,
  p_order_id uuid,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_meta jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_allowed text[];
  v_key text;
  v_initiator text;
begin
  if p_tenant_id is null then
    raise exception '_log_order_audit_event: tenant is required' using errcode = '22023';
  end if;
  if p_order_id is null then
    raise exception '_log_order_audit_event: order id is required' using errcode = '22023';
  end if;

  -- Closed allowlist — an unknown/typo'd type raises rather than silently
  -- becoming an "Other" event.
  if p_event_type not in (
    'order.created', 'order.updated', 'order.status_changed', 'order.customer_linked'
  ) then
    raise exception '_log_order_audit_event: unknown order event type %', p_event_type
      using errcode = '22023';
  end if;

  -- Metadata must be a bounded JSON OBJECT (never an array/scalar/unbounded blob).
  if jsonb_typeof(v_meta) <> 'object' then
    raise exception '_log_order_audit_event: metadata must be a JSON object'
      using errcode = '22023';
  end if;
  if length(v_meta::text) > 4000 then
    raise exception '_log_order_audit_event: metadata exceeds the size bound'
      using errcode = '22023';
  end if;

  -- Per-event-type KEY allowlist. Anything else (a token, a price, a name, a
  -- snapshot, an item array, a future stray key) is rejected outright.
  v_allowed := case p_event_type
    when 'order.created' then
      array['source', 'initiator_kind', 'initial_status', 'customer_kind', 'item_count']
    when 'order.updated' then
      array['changed_fields', 'item_count_before', 'item_count_after']
    when 'order.status_changed' then
      array['from_status', 'to_status', 'inventory_effect']
    when 'order.customer_linked' then
      array['link_kind']
  end;
  for v_key in select jsonb_object_keys(v_meta) loop
    if not (v_key = any (v_allowed)) then
      raise exception '_log_order_audit_event: metadata key % is not allowed for %',
        v_key, p_event_type using errcode = '22023';
    end if;
  end loop;

  -- Honest initiator: the anon token channels must NEVER be recorded with an
  -- authenticated actor (an operator can never masquerade as a guest), and the
  -- kind itself is a closed enum.
  v_initiator := v_meta ->> 'initiator_kind';
  if v_initiator is not null then
    if v_initiator not in ('authenticated_user', 'customer_link', 'showcase_guest') then
      raise exception '_log_order_audit_event: unknown initiator kind %', v_initiator
        using errcode = '22023';
    end if;
    if v_initiator in ('customer_link', 'showcase_guest')
       and (select auth.uid()) is not null then
      raise exception '_log_order_audit_event: % events cannot carry an authenticated actor',
        v_initiator using errcode = '22023';
    end if;
  end if;

  insert into public.audit_events
    (tenant_id, actor_user_id, event_type, entity_type, entity_id, metadata)
  values
    (p_tenant_id, (select auth.uid()), p_event_type, 'order', p_order_id, v_meta);
end;
$$;

comment on function public._log_order_audit_event(uuid, text, uuid, jsonb) is
  'M8H.1 — PRIVATE transactional Order audit producer. Closed 4-event allowlist, '
  'entity_type=order, actor=auth.uid() (NULL on anon token paths), metadata must '
  'be a bounded JSON object with per-event allowlisted keys. Callable ONLY from '
  'the SECURITY DEFINER Order RPCs; no client role may execute it.';

revoke all on function public._log_order_audit_event(uuid, text, uuid, jsonb)
  from public, anon, authenticated;

-- ── 2. audit_events SELECT policy — ADDITIVE Order clause ─────────────────
-- The existing Customer clause is reproduced VERBATIM and a new Order clause is
-- AND-ed on. Because each clause is vacuous for the other entity type:
--   • customer rows behave EXACTLY as before (M8G.2 semantics preserved);
--   • non-customer/non-order rows keep plain tenant-member visibility;
--   • order rows now additionally require can_access_order — and FAIL CLOSED on
--     a NULL entity_id (can_access_order returns true for owner/admin regardless
--     of the id, so the explicit NOT NULL guard is what closes that hole).
-- sales_rep therefore sees Order events only for orders already visible to them
-- (their assigned customers'); guest/unlinked orders stay owner/admin-only.

drop policy if exists "audit_events: members read; customer rows rep-scoped"
  on public.audit_events;

create policy "audit_events: members read; customer + order rows scoped"
  on public.audit_events
  for select
  to authenticated
  using (
    public.is_tenant_member(tenant_id)
    and (
      entity_type <> 'customer'
      or public.can_access_customer(tenant_id, entity_id)
    )
    and (
      entity_type <> 'order'
      or (entity_id is not null and public.can_access_order(tenant_id, entity_id))
    )
  );

-- ═══════════════════════════════════════════════════════════════════════
-- 3. PRODUCERS — the 7 active Order mutation RPCs, replaced with IDENTICAL
--    signatures / return types / security modes / search_paths / grants /
--    authorization / rate limiting / inventory math / error behavior. The ONLY
--    change in each body is the transactional audit insert (and the minimal
--    locals needed to derive it). _order_create_core is deliberately NOT
--    touched: the event is emitted by each ENTRY POINT so every channel records
--    its own honest initiator, and one creation can never emit twice.
-- ═══════════════════════════════════════════════════════════════════════

-- 3a. create_order_request — authenticated creation (owner/admin/sales_rep).
create or replace function public.create_order_request(
  p_tenant_id uuid,
  p_items jsonb,
  p_customer_id uuid default null,
  p_notes text default null,
  p_source public.order_source default 'sales_visit'
)
returns table (order_id uuid, order_number text)
language plpgsql security definer set search_path = ''
as $$
declare
  v_tenant uuid;
  v_order_id uuid;
  v_order_number text;
  v_item_count integer;
begin
  -- Tenant derived + role checked from membership (or service_role).
  v_tenant := public.authorize_tenant(
    p_tenant_id,
    array['owner', 'admin', 'sales_rep']::public.tenant_role[]);
  -- Token/remote sources may only be created by the token flow, not here.
  if p_source = 'remote_customer' then
    raise exception 'create_order_request: remote_customer orders come only from a shop link'
      using errcode = '22023';
  end if;
  -- M4D: a sales_rep may create orders ONLY for a customer assigned to them.
  -- owner/admin (and the trusted service_role) are unaffected. There is no
  -- fall-back to "all customers" for an unassigned rep.
  if public.has_tenant_role(v_tenant, array['sales_rep']::public.tenant_role[]) then
    if p_customer_id is null then
      raise exception 'create_order_request: a sales rep must order for an assigned customer'
        using errcode = '42501';
    end if;
    if not public.can_access_customer(v_tenant, p_customer_id) then
      raise exception 'create_order_request: customer is not assigned to this sales rep'
        using errcode = '42501';
    end if;
  end if;

  select o.order_id, o.order_number into v_order_id, v_order_number
  from public._order_create_core(
    v_tenant, p_items, p_customer_id, p_notes, coalesce(p_source, 'sales_visit')) o;

  -- M8H.1: ONE order.created. Safe channel facts only — no items, prices,
  -- totals, notes, customer name/snapshot or order_number.
  select count(distinct (elem ->> 'product_id')) into v_item_count
  from jsonb_array_elements(p_items) as elem;
  perform public._log_order_audit_event(
    v_tenant, 'order.created', v_order_id,
    jsonb_build_object(
      'source', coalesce(p_source, 'sales_visit')::text,
      'initiator_kind', 'authenticated_user',
      'initial_status', 'new',
      'customer_kind', case when p_customer_id is null then 'none' else 'existing' end,
      'item_count', v_item_count));

  return query select v_order_id, v_order_number;
end;
$$;

-- 3b. create_order_request_from_token — private Shop link (anon, rate-limited).
create or replace function public.create_order_request_from_token(
  p_token text,
  p_items jsonb,
  p_notes text default null
)
returns table (order_number text)
language plpgsql security definer set search_path = ''
as $$
declare
  v_tenant uuid;
  v_customer uuid;
  v_link uuid;
  v_order_id uuid;
  v_public_ref text;
  v_item_count integer;
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
  exception
    when sqlstate 'P0005' then
      -- Deactivated store (M8C): valid token, not a probing failure — deny
      -- (null order) WITHOUT recording it.
      return query select null::text;
      return;
    when others then
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

  -- M8H.1: ONE order.created, initiator = the private customer-link channel.
  -- actor_user_id stays NULL (no authenticated user); the raw token, its hash,
  -- the link id, the shop URL and the customer's identity NEVER enter metadata.
  select count(distinct (elem ->> 'product_id')) into v_item_count
  from jsonb_array_elements(p_items) as elem;
  perform public._log_order_audit_event(
    v_tenant, 'order.created', v_order_id,
    jsonb_build_object(
      'source', 'remote_customer',
      'initiator_kind', 'customer_link',
      'initial_status', 'new',
      'customer_kind', 'existing',
      'item_count', v_item_count));

  return query select v_public_ref;
end;
$$;

-- 3c. create_order_from_showcase_token — Showcase guest order (anon, limited).
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
language plpgsql security definer set search_path = ''
as $$
declare
  v_tenant uuid;
  v_link uuid;
  v_order_id uuid;
  v_public_ref text;
  v_item_count integer;
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

  -- M8H.1: ONE order.created, initiator = the Showcase guest channel. The guest
  -- SNAPSHOT (name / contact / phone / email / address / city) and the token are
  -- NEVER copied into metadata — only the safe channel facts.
  select count(distinct (elem ->> 'product_id')) into v_item_count
  from jsonb_array_elements(p_items) as elem;
  perform public._log_order_audit_event(
    v_tenant, 'order.created', v_order_id,
    jsonb_build_object(
      'source', 'remote_customer',
      'initiator_kind', 'showcase_guest',
      'initial_status', 'new',
      'customer_kind', 'guest',
      'item_count', v_item_count));

  return query select v_public_ref;
end;
$$;

-- 3d. update_order_status — the ONLY status-transition path (owner/admin).
create or replace function public.update_order_status(
  p_tenant_id uuid,
  p_order_id uuid,
  p_new_status public.order_status
)
returns table (order_id uuid, old_status public.order_status, new_status public.order_status)
language plpgsql security definer set search_path = ''
as $$
declare
  v_tenant uuid;
  v_current public.order_status;
  v_allowed public.order_status[];
  v_line record;
  v_avail integer;
  v_reserved_before boolean;
  v_released_before boolean;
  v_effect text;
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

  -- Requested status == current status: an effective NO-OP. Unchanged response,
  -- no mutation — and therefore NO audit event.
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

  -- Ledger state BEFORE any reconciliation — lets us derive an HONEST
  -- inventory_effect (a movement row was actually written) rather than guessing.
  v_reserved_before := exists (
    select 1 from public.order_inventory_movements m
    where m.tenant_id = v_tenant and m.order_id = p_order_id and m.reason = 'order_reserved');
  v_released_before := exists (
    select 1 from public.order_inventory_movements m
    where m.tenant_id = v_tenant and m.order_id = p_order_id
      and m.reason = 'order_reservation_released');

  update public.orders o set status = p_new_status where o.id = p_order_id;

  -- RESERVE on entering confirmed/preparing, once (M7I.2). Blocks on
  -- insufficient stock so the order stays at its previous stage.
  if p_new_status in ('confirmed', 'preparing')
     and not exists (
       select 1 from public.order_inventory_movements m
       where m.tenant_id = v_tenant and m.order_id = p_order_id
         and m.reason = 'order_reserved'
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
        continue; -- untracked product: nothing to reserve
      end if;
      if v_avail < v_line.qty then
        raise exception 'update_order_status: insufficient stock for product % (have %, need %)',
          v_line.pid, v_avail, v_line.qty using errcode = 'MDF30';
      end if;
      update public.inventory_items
         set quantity_available = quantity_available - v_line.qty, updated_at = now()
       where tenant_id = v_tenant and product_id = v_line.pid;
      insert into public.order_inventory_movements
        (tenant_id, order_id, product_id, quantity_delta, reason, created_by)
      values
        (v_tenant, p_order_id, v_line.pid, -v_line.qty, 'order_reserved', (select auth.uid()));
    end loop;
  end if;

  -- RESTORE on cancel IF reserved and not yet released (once). Restores the
  -- NET currently-reserved amount per product (reserve + any edit adjustments).
  if p_new_status = 'cancelled'
     and exists (
       select 1 from public.order_inventory_movements m
       where m.tenant_id = v_tenant and m.order_id = p_order_id and m.reason = 'order_reserved'
     )
     and not exists (
       select 1 from public.order_inventory_movements m
       where m.tenant_id = v_tenant and m.order_id = p_order_id and m.reason = 'order_reservation_released'
     ) then
    for v_line in
      select m.product_id as pid, -sum(m.quantity_delta)::integer as qty
      from public.order_inventory_movements m
      where m.tenant_id = v_tenant and m.order_id = p_order_id
        and m.reason in ('order_reserved', 'order_edit_adjustment')
      group by m.product_id
      having -sum(m.quantity_delta) > 0
    loop
      update public.inventory_items
         set quantity_available = quantity_available + v_line.qty, updated_at = now()
       where tenant_id = v_tenant and product_id = v_line.pid;
      insert into public.order_inventory_movements
        (tenant_id, order_id, product_id, quantity_delta, reason, created_by)
      values
        (v_tenant, p_order_id, v_line.pid, v_line.qty, 'order_reservation_released', (select auth.uid()));
    end loop;
  end if;

  -- M8H.1: ONE order.status_changed, written AFTER the status update and the
  -- inventory reconciliation have both succeeded — so an MDF30 stock failure
  -- rolls the status, the movements AND this event back together. The effect is
  -- derived from what the ledger ACTUALLY recorded (an all-untracked order
  -- reserves nothing → 'none'). No quantities/products/totals ever leave here.
  v_effect := case
    when not v_reserved_before and exists (
      select 1 from public.order_inventory_movements m
      where m.tenant_id = v_tenant and m.order_id = p_order_id and m.reason = 'order_reserved')
      then 'reserved'
    when not v_released_before and exists (
      select 1 from public.order_inventory_movements m
      where m.tenant_id = v_tenant and m.order_id = p_order_id
        and m.reason = 'order_reservation_released')
      then 'restored'
    else 'none'
  end;
  perform public._log_order_audit_event(
    v_tenant, 'order.status_changed', p_order_id,
    jsonb_build_object(
      'from_status', v_current::text,
      'to_status', p_new_status::text,
      'inventory_effect', v_effect));

  return query select p_order_id, v_current, p_new_status;
end;
$$;

-- 3e. update_order_items — the ONLY order edit path (owner/admin).
create or replace function public.update_order_items(
  p_tenant_id uuid,
  p_order_id uuid,
  p_items jsonb,
  p_notes text default null
)
returns table (order_id uuid, order_number text)
language plpgsql security definer set search_path = ''
as $$
declare
  v_tenant uuid;
  v_status public.order_status;
  v_reserved boolean;
  v_item_count integer;
  v_valid_count integer;
  v_inserted integer;
  v_subtotal numeric(12,2);
  v_vat_total numeric(12,2);
  v_number text;
  v_line record;
  v_avail integer;
  v_notes_before text;
  v_notes_after text;
  v_items_before jsonb;
  v_items_after jsonb;
  v_count_before integer;
  v_changed text[] := array[]::text[];
begin
  v_tenant := public.authorize_tenant(
    p_tenant_id, array['owner', 'admin']::public.tenant_role[]);

  -- Validate items exactly like _order_create_core.
  if p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 then
    raise exception 'update_order_items: items must be a non-empty array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) > 200 then
    raise exception 'update_order_items: too many lines (max 200)' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_items) as elem
    where (elem ->> 'product_id')::uuid is null
       or (elem ->> 'quantity')::integer is null
       or (elem ->> 'quantity')::integer <= 0
       or (elem ->> 'quantity')::integer > 9999
  ) then
    raise exception 'update_order_items: each line needs a product_id and a quantity between 1 and 9999'
      using errcode = '22023';
  end if;

  -- Lock the order; enforce status rules. (notes captured for the effective-
  -- change derivation below — the VALUE never enters metadata.)
  select o.status, o.order_number, o.notes into v_status, v_number, v_notes_before
  from public.orders o
  where o.id = p_order_id and o.tenant_id = v_tenant
  for update;
  if not found then
    raise exception 'update_order_items: order % is unknown or belongs to another tenant', p_order_id
      using errcode = '22023';
  end if;
  if v_status in ('delivered', 'cancelled') then
    raise exception 'update_order_items: a % order cannot be edited', v_status
      using errcode = 'MDF31';
  end if;

  -- Products must be active + own-tenant (aggregate by product).
  with lines as (
    select (elem ->> 'product_id')::uuid as product_id,
           sum((elem ->> 'quantity')::integer)::integer as quantity
    from jsonb_array_elements(p_items) as elem
    group by 1
  )
  select count(*),
         count(*) filter (
           where exists (
             select 1 from public.products p
             where p.id = lines.product_id and p.tenant_id = p_tenant_id and p.is_active))
  into v_item_count, v_valid_count
  from lines;
  if v_valid_count <> v_item_count then
    raise exception 'update_order_items: one or more products are unknown, inactive, or belong to another tenant'
      using errcode = '22023';
  end if;

  -- BEFORE state (product_id → quantity) purely to decide whether this edit is
  -- EFFECTIVE. The existing write behavior below is unchanged (the lines are
  -- always re-snapshotted and updated_at always bumps) — only the AUDIT is
  -- change-gated, so a resubmission of identical lines records no event.
  select coalesce(jsonb_object_agg(s.pid::text, s.qty), '{}'::jsonb), count(*)
  into v_items_before, v_count_before
  from (
    select oi.product_id as pid, sum(oi.quantity)::integer as qty
    from public.order_items oi
    where oi.order_id = p_order_id and oi.product_id is not null
    group by oi.product_id
  ) s;
  select coalesce(jsonb_object_agg(t.pid::text, t.qty), '{}'::jsonb)
  into v_items_after
  from (
    select (elem ->> 'product_id')::uuid as pid,
           sum((elem ->> 'quantity')::integer)::integer as qty
    from jsonb_array_elements(p_items) as elem
    group by 1
  ) t;

  v_reserved := exists (
    select 1 from public.order_inventory_movements m
    where m.tenant_id = v_tenant and m.order_id = p_order_id and m.reason = 'order_reserved');

  -- Reconcile stock against the ledger if the order is reserved. Per product
  -- across the union of currently-reserved and newly-requested lines:
  --   delta = new_qty - net_reserved; deduct/restore by delta.
  if v_reserved then
    for v_line in
      with newq as (
        select (elem ->> 'product_id')::uuid as pid, sum((elem ->> 'quantity')::integer)::integer as qty
        from jsonb_array_elements(p_items) as elem group by 1
      ),
      resq as (
        select m.product_id as pid, -sum(m.quantity_delta)::integer as qty
        from public.order_inventory_movements m
        where m.tenant_id = v_tenant and m.order_id = p_order_id
          and m.reason in ('order_reserved', 'order_edit_adjustment')
        group by m.product_id
      )
      select coalesce(n.pid, r.pid) as pid,
             coalesce(n.qty, 0) - coalesce(r.qty, 0) as delta
      from newq n full outer join resq r on r.pid = n.pid
      where coalesce(n.qty, 0) - coalesce(r.qty, 0) <> 0
    loop
      select inv.quantity_available into v_avail
      from public.inventory_items inv
      where inv.tenant_id = v_tenant and inv.product_id = v_line.pid
      for update;
      if not found then
        continue; -- untracked product: no reconciliation
      end if;
      if v_line.delta > 0 and v_avail < v_line.delta then
        raise exception 'update_order_items: insufficient stock for product % (have %, need % more)',
          v_line.pid, v_avail, v_line.delta using errcode = 'MDF30';
      end if;
      -- delta>0 deducts; delta<0 restores.
      update public.inventory_items
         set quantity_available = quantity_available - v_line.delta, updated_at = now()
       where tenant_id = v_tenant and product_id = v_line.pid;
      insert into public.order_inventory_movements
        (tenant_id, order_id, product_id, quantity_delta, reason, created_by)
      values
        (v_tenant, p_order_id, v_line.pid, -v_line.delta, 'order_edit_adjustment', (select auth.uid()));
    end loop;
  end if;

  -- Replace the lines (re-snapshot from live products, like create). Qualify
  -- the column — order_id is also a RETURNS TABLE out-variable here.
  delete from public.order_items oi where oi.order_id = p_order_id;
  with lines as (
    select (elem ->> 'product_id')::uuid as product_id,
           sum((elem ->> 'quantity')::integer)::integer as quantity
    from jsonb_array_elements(p_items) as elem
    group by 1
  )
  insert into public.order_items
    (tenant_id, order_id, product_id,
     product_name_snapshot, manufacturer_name_snapshot,
     package_unit_snapshot, package_quantity_snapshot,
     quantity, unit_price_snapshot, vat_rate_snapshot,
     line_subtotal, line_vat, line_total)
  select
    p_tenant_id, p_order_id, p.id,
    jsonb_build_object('ar', p.name_ar, 'he', p.name_he, 'en', p.name_en),
    case when m.id is null then null else jsonb_build_object(
      'ar', m.name_ar, 'he', m.name_he, 'en', m.name_en) end,
    p.package_unit, p.package_quantity, l.quantity, p.wholesale_price, p.vat_rate,
    round(l.quantity * p.wholesale_price, 2),
    round(round(l.quantity * p.wholesale_price, 2) * p.vat_rate, 2),
    round(l.quantity * p.wholesale_price, 2)
      + round(round(l.quantity * p.wholesale_price, 2) * p.vat_rate, 2)
  from lines l
  join public.products p on p.id = l.product_id and p.tenant_id = p_tenant_id and p.is_active
  left join public.manufacturers m on m.id = p.manufacturer_id;

  get diagnostics v_inserted = row_count;
  if v_inserted <> v_item_count then
    raise exception 'update_order_items: catalog changed while editing — please retry' using errcode = '40001';
  end if;

  select sum(i.line_subtotal), round(sum(i.line_subtotal * i.vat_rate_snapshot), 2)
  into v_subtotal, v_vat_total
  from public.order_items i where i.order_id = p_order_id;

  update public.orders o
     set subtotal = v_subtotal, vat_total = v_vat_total, total = v_subtotal + v_vat_total,
         notes = case when p_notes is null then o.notes else nullif(trim(p_notes), '') end,
         updated_at = now()
   where o.id = p_order_id;

  -- M8H.1: ONE order.updated — but ONLY for an EFFECTIVE change. A resubmission
  -- of the identical lines/notes records nothing. changed_fields is derived from
  -- authoritative old/new state (never from a client-supplied list); the notes
  -- TEXT, product ids, quantities, prices and totals never enter metadata.
  v_notes_after := case when p_notes is null then v_notes_before else nullif(trim(p_notes), '') end;
  if v_items_before is distinct from v_items_after then
    v_changed := array_append(v_changed, 'items');
  end if;
  if v_notes_before is distinct from v_notes_after then
    v_changed := array_append(v_changed, 'notes');
  end if;
  if array_length(v_changed, 1) > 0 then
    perform public._log_order_audit_event(
      v_tenant, 'order.updated', p_order_id,
      jsonb_build_object('changed_fields', to_jsonb(v_changed))
      || case when v_items_before is distinct from v_items_after
           then jsonb_build_object(
                  'item_count_before', v_count_before,
                  'item_count_after', v_item_count)
           else '{}'::jsonb end);
  end if;

  return query select p_order_id, v_number;
end;
$$;

-- 3f. link_order_to_customer — link an unlinked order to an EXISTING customer.
create or replace function public.link_order_to_customer(
  p_tenant_id uuid,
  p_order_id uuid,
  p_customer_id uuid
)
returns void
language plpgsql security definer set search_path = ''
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

  -- M8G.2: customer.order_linked (entity = the customer). Order id + prior
  -- linkage state only — NEVER the guest snapshot. Origin is NOT changed.
  perform public._log_customer_audit_event(
    v_tenant, 'customer.order_linked', p_customer_id,
    jsonb_build_object('order_id', p_order_id, 'previous_linkage', 'unlinked'));

  -- M8H.1: the SAME business action, recorded once for the ORDER entity so the
  -- Order Timeline is not silently missing a change of buyer. Distinct entity →
  -- each row appears in exactly ONE timeline; this is not duplication.
  perform public._log_order_audit_event(
    v_tenant, 'order.customer_linked', p_order_id,
    jsonb_build_object('link_kind', 'existing_customer'));
end;
$$;

-- 3g. create_customer_from_order — promote a guest order's store to a customer.
create or replace function public.create_customer_from_order(
  p_tenant_id uuid,
  p_order_id uuid
)
returns uuid
language plpgsql security definer set search_path = ''
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

  insert into public.customers
    (tenant_id, name, contact_name, phone,
     city_ar, city_he, city_en, address, customer_type, notes, origin)
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
       then 'Email: ' || (v_snap ->> 'email') else null end,
     'guest_conversion')
  returning id into v_customer_id;

  update public.orders set customer_id = v_customer_id, updated_at = now()
   where id = p_order_id;

  -- M8G.2: ONE customer.created event (origin guest_conversion + safe source
  -- order id). The guest SNAPSHOT (name/phone/address) is NEVER copied here.
  perform public._log_customer_audit_event(
    v_tenant, 'customer.created', v_customer_id,
    jsonb_build_object('origin', 'guest_conversion', 'source_order_id', p_order_id));

  -- M8H.1: this order also GAINED a customer — recorded once for the ORDER
  -- entity (link_kind distinguishes it from linking an existing customer). The
  -- guest snapshot and the new customer's identity never enter order metadata.
  perform public._log_order_audit_event(
    v_tenant, 'order.customer_linked', p_order_id,
    jsonb_build_object('link_kind', 'guest_conversion'));

  return v_customer_id;
end;
$$;
