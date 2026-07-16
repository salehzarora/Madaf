-- ═══════════════════════════════════════════════════════════════════════
-- M8I.2 — Inventory INTEGRITY + AUDIT FOUNDATION (PILOT-OPS-AUDIT-002)
--
-- Two coupled corrections to the Product inventory-setup path
-- (`upsert_inventory_item`, called inside create_product/update_product):
--
--   1. QUANTITY INTEGRITY. An existing inventory_items row's quantity_available
--      is now PRESERVED — the Product-form/setup path may NEVER overwrite a
--      balance maintained by the movement ledger (manual adjustment, supplier
--      delivery, damage, return, stock count, Order reserve/restore/edit). An
--      initial quantity is honored ONLY when the FIRST row is created. Post-
--      creation quantity changes remain the `order_inventory_movements` ledger's
--      job (adjust_inventory_stock / order RPCs — UNCHANGED). This is DB-enforced,
--      not UI-only: a stale / forged / direct / older caller cannot clobber a
--      newer balance.
--
--   2. TRANSACTIONAL AUDIT. Exactly the currently-untracked setup/configuration
--      changes get audit_events coverage, entity_type='inventory', in the SAME
--      transaction as the mutation:
--        inventory.created  — the first inventory_items row (tracking started);
--                             safe metadata {quantity, threshold} only.
--        inventory.updated  — an EFFECTIVE change to low_stock_threshold /
--                             warehouse_location / expiry_date on an EXISTING row;
--                             closed changed_fields (threshold|location|expiry) +
--                             safe before/after. NEVER quantity_available.
--      No inventory.quantity_set / inventory.adjusted. Manual adjustments and
--      order-driven stock are NOT duplicated here (they keep the ledger + order
--      audit + order_status_history).
--
-- SINGLE-WAREHOUSE / MULTI-TENANT. Each tenant is one independent supplier with
-- one physical warehouse; there are no branches. warehouse_location is a shelf/
-- aisle/rack inside that one warehouse — a bounded (≤40) text label, never a
-- branch/another warehouse, rendered only as escaped text. Event scope is
-- tenant + product + actor + timestamp. Cross-tenant fails closed (RLS +
-- authorize_tenant).
--
-- Additive: one private helper + a redefinition of the LATEST upsert_inventory_item
-- (20260705170000; signature / return / security mode / search_path / grants /
-- authorization / validation / error messages all PRESERVED — the changes are the
-- locked before-capture, quantity preservation on the existing-row path, and the
-- transactional audit inserts) + an additive Inventory clause on the audit_events
-- SELECT policy (owner/admin only). No table/column change, no new index (the
-- M8G.3 generic (tenant_id, entity_type, entity_id, created_at desc, id desc)
-- index already serves the entity-scoped Inventory query), no backfill, no
-- historical event, no destructive SQL. create_product / update_product /
-- adjust_inventory_stock / the order RPCs are NOT redefined.
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1. Private Inventory audit helper ─────────────────────────────────────
-- SECURITY INVOKER (like the customer/order/product helpers): no privileges of
-- its own, executable by NO client role — reachable only from the SECURITY
-- DEFINER upsert_inventory_item below. Closed 2-event allowlist, entity_type
-- hardcoded to 'inventory', actor from auth.uid(), metadata a bounded JSON object
-- whose keys are allowlisted per event type (so no quantity/PII/raw key leaks).
create function public._log_inventory_audit_event(
  p_tenant_id uuid,
  p_event_type text,
  p_product_id uuid,
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
begin
  if p_tenant_id is null then
    raise exception '_log_inventory_audit_event: tenant is required' using errcode = '22023';
  end if;
  if p_product_id is null then
    raise exception '_log_inventory_audit_event: product id is required' using errcode = '22023';
  end if;

  -- Closed allowlist — an unknown/typo'd type raises rather than silently
  -- becoming an "Other" event.
  if p_event_type not in ('inventory.created', 'inventory.updated') then
    raise exception '_log_inventory_audit_event: unknown inventory event type %', p_event_type
      using errcode = '22023';
  end if;

  -- Metadata must be a bounded JSON OBJECT (never an array/scalar/unbounded blob).
  if jsonb_typeof(v_meta) <> 'object' then
    raise exception '_log_inventory_audit_event: metadata must be a JSON object'
      using errcode = '22023';
  end if;
  if length(v_meta::text) > 4000 then
    raise exception '_log_inventory_audit_event: metadata exceeds the size bound'
      using errcode = '22023';
  end if;

  -- Per-event-type KEY allowlist. quantity_available is NEVER an allowed key on
  -- inventory.updated; a raw row / payload / name / token key is rejected outright.
  v_allowed := case p_event_type
    when 'inventory.created' then array['quantity', 'threshold']
    when 'inventory.updated' then array['changed_fields', 'threshold', 'location', 'expiry']
  end;
  for v_key in select jsonb_object_keys(v_meta) loop
    if not (v_key = any (v_allowed)) then
      raise exception '_log_inventory_audit_event: metadata key % is not allowed for %',
        v_key, p_event_type using errcode = '22023';
    end if;
  end loop;

  insert into public.audit_events
    (tenant_id, actor_user_id, event_type, entity_type, entity_id, metadata)
  values
    (p_tenant_id, (select auth.uid()), p_event_type, 'inventory', p_product_id, v_meta);
end;
$$;

comment on function public._log_inventory_audit_event(uuid, text, uuid, jsonb) is
  'M8I.2 — PRIVATE transactional Inventory audit producer. Closed 2-event allowlist '
  '(inventory.created / inventory.updated), entity_type=inventory, actor=auth.uid(), '
  'metadata a bounded JSON object with per-event allowlisted keys (never '
  'quantity_available on inventory.updated). Callable ONLY from upsert_inventory_item; '
  'no client role may execute it.';

revoke all on function public._log_inventory_audit_event(uuid, text, uuid, jsonb)
  from public, anon, authenticated;

-- ── 2. audit_events SELECT policy — ADDITIVE Inventory clause ──────────────
-- The customer / order / product clauses are reproduced VERBATIM and a new
-- Inventory clause is AND-ed on. Each clause is vacuous for the other entity
-- types, so customer/order/product rows behave EXACTLY as before, and inventory
-- rows now additionally require owner/admin — a sales_rep (who cannot mutate
-- inventory config) gets NO inventory audit history, at the DB, not just in the UI.
drop policy if exists "audit_events: members read; customer/order/product rows scoped"
  on public.audit_events;

create policy "audit_events: members read; customer/order/product/inventory rows scoped"
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
    and (
      entity_type <> 'product'
      or public.has_tenant_role(tenant_id, array['owner', 'admin']::public.tenant_role[])
    )
    and (
      entity_type <> 'inventory'
      or public.has_tenant_role(tenant_id, array['owner', 'admin']::public.tenant_role[])
    )
  );

-- ── 3. upsert_inventory_item — quantity integrity + transactional audit ────
-- Base reproduced from 20260705170000_auth_and_private_links.sql:556 (the LATEST
-- effective definition); signature / return / security / search_path / grants /
-- authorization / validation / error messages PRESERVED. The changes: a locked
-- before-capture; the first-row INSERT path (initial quantity honored → ONE
-- inventory.created); the existing-row path preserves quantity_available and
-- updates ONLY configuration fields (→ change-gated inventory.updated). A stale
-- submitted quantity is ignored — never overwrites a ledger-maintained balance,
-- never fabricates a movement, never emits an event on its own.
create or replace function public.upsert_inventory_item(
  p_tenant_id uuid,
  p_product_id uuid,
  p_inventory jsonb
)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_quantity integer;
  v_threshold integer;
  v_location text;
  v_expiry date;
  v_id uuid;
  v_old public.inventory_items%rowtype;
  v_changed text[] := array[]::text[];
  v_meta jsonb;
begin
  p_tenant_id := public.authorize_tenant(p_tenant_id, array['owner', 'admin']::public.tenant_role[]);
  if not exists (
    select 1 from public.products p where p.id = p_product_id and p.tenant_id = p_tenant_id
  ) then
    raise exception 'upsert_inventory_item: product is unknown or belongs to another tenant'
      using errcode = '22023';
  end if;

  -- Validate every supported field exactly as before (bounds/messages unchanged).
  v_quantity := coalesce((p_inventory ->> 'quantity_available')::integer, 0);
  if v_quantity < 0 or v_quantity > 100000000 then
    raise exception 'inventory: quantity_available must be between 0 and 100000000' using errcode = '22023';
  end if;
  v_threshold := coalesce((p_inventory ->> 'low_stock_threshold')::integer, 10);
  if v_threshold < 0 or v_threshold > 100000000 then
    raise exception 'inventory: low_stock_threshold must be 0 or greater' using errcode = '22023';
  end if;
  v_location := nullif(trim(coalesce(p_inventory ->> 'warehouse_location', '')), '');
  if coalesce(length(v_location), 0) > 40 then
    raise exception 'inventory: warehouse_location must be 40 characters or fewer' using errcode = '22023';
  end if;
  v_expiry := nullif(p_inventory ->> 'expiry_date', '')::date;

  -- Lock the existing row (if any) BEFORE deciding insert-vs-update, so the diff
  -- is honest and a concurrent config edit is serialized.
  select * into v_old
  from public.inventory_items i
  where i.tenant_id = p_tenant_id and i.product_id = p_product_id
  for update;

  if not found then
    -- FIRST ROW: create with the initial quantity + config. Race-safe: if a
    -- concurrent tx inserted first, ON CONFLICT DO NOTHING leaves v_id NULL and
    -- we fall through to the existing-row path — so no duplicate row, no duplicate
    -- inventory.created, and the earlier tx's quantity is preserved.
    insert into public.inventory_items
      (tenant_id, product_id, quantity_available, low_stock_threshold, warehouse_location, expiry_date)
    values
      (p_tenant_id, p_product_id, v_quantity, v_threshold, v_location, v_expiry)
    on conflict (tenant_id, product_id) do nothing
    returning id into v_id;

    if v_id is not null then
      -- THIS transaction created the first row → exactly ONE inventory.created,
      -- safe integer metadata only.
      perform public._log_inventory_audit_event(
        p_tenant_id, 'inventory.created', p_product_id,
        jsonb_build_object('quantity', v_quantity, 'threshold', v_threshold));
      return v_id;
    end if;

    -- A concurrent insert won: reload the now-existing row LOCKED and continue as
    -- the existing-row configuration path (quantity is NOT overwritten).
    select * into v_old
    from public.inventory_items i
    where i.tenant_id = p_tenant_id and i.product_id = p_product_id
    for update;
  end if;

  -- EXISTING ROW: preserve quantity_available; update ONLY configuration fields.
  -- A submitted quantity difference is IGNORED (it never overwrites a ledger-
  -- maintained balance) and never produces an event or a movement.
  update public.inventory_items i set
    low_stock_threshold = v_threshold,
    warehouse_location = v_location,
    expiry_date = v_expiry
  where i.tenant_id = p_tenant_id and i.product_id = p_product_id
  returning i.id into v_id;

  -- Change-gated diff on CONFIGURATION fields only (quantity is never compared or
  -- recorded here). Localized nothing — these are safe bounded scalars.
  if v_old.low_stock_threshold is distinct from v_threshold then
    v_changed := array_append(v_changed, 'threshold');
  end if;
  if v_old.warehouse_location is distinct from v_location then
    v_changed := array_append(v_changed, 'location');
  end if;
  if v_old.expiry_date is distinct from v_expiry then
    v_changed := array_append(v_changed, 'expiry');
  end if;

  -- No effective configuration change → no event (the UPDATE still ran, which is
  -- a no-op for unchanged values). One inventory.updated for a real change, with
  -- safe before/after ONLY for the fields that changed.
  if array_length(v_changed, 1) is not null then
    v_meta := jsonb_build_object('changed_fields', to_jsonb(v_changed));
    if v_old.low_stock_threshold is distinct from v_threshold then
      v_meta := v_meta || jsonb_build_object(
        'threshold', jsonb_build_object('from', v_old.low_stock_threshold, 'to', v_threshold));
    end if;
    if v_old.warehouse_location is distinct from v_location then
      v_meta := v_meta || jsonb_build_object(
        'location', jsonb_build_object('from', v_old.warehouse_location, 'to', v_location));
    end if;
    if v_old.expiry_date is distinct from v_expiry then
      v_meta := v_meta || jsonb_build_object(
        'expiry', jsonb_build_object('from', v_old.expiry_date, 'to', v_expiry));
    end if;
    perform public._log_inventory_audit_event(
      p_tenant_id, 'inventory.updated', p_product_id, v_meta);
  end if;

  return v_id;
end;
$$;
revoke all on function public.upsert_inventory_item(uuid, uuid, jsonb) from public, anon;
grant execute on function public.upsert_inventory_item(uuid, uuid, jsonb) to authenticated, service_role;
