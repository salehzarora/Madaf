-- ═══════════════════════════════════════════════════════════════════════
-- PILOT-OPS-AUDIT-008 — Operational hardening (deterministic inventory lock
-- order + audit unknown-entity default-deny)
--
-- (1) DETERMINISTIC INVENTORY LOCK ORDER. update_order_status (reserve on
-- confirm/preparing, restore on cancel) and update_order_items (edit-time
-- reconciliation) both lock/mutate MULTIPLE inventory_items rows in a loop whose
-- driving query used `group by product_id` with NO `order by` — so two concurrent
-- order operations touching the same >=2 products could acquire inventory_items
-- row locks in OPPOSITE product order and deadlock (SQLSTATE 40P01). This redefines
-- both functions VERBATIM except for adding `order by <product_id>` to every
-- inventory-locking/mutating loop, so EVERY competing path acquires inventory_items
-- locks in one global ascending product_id order. Signatures / return types /
-- SECURITY DEFINER / search_path / grants / authorization / tenant+product
-- validation / money+VAT snapshots / reservation-once/release-once idempotency /
-- MDF30/MDF31/23514/40001 error codes / audit events / transactionality are all
-- PRESERVED. No advisory locks, no retries, no sleeps, no partial commits.
-- create_order_request/_order_create_core are NOT touched — order creation writes
-- the order at status 'new' and reserves NO stock (set-based inserts, no
-- inventory_items lock), so they carry no inversion.
--
-- (2) AUDIT UNKNOWN-ENTITY DEFAULT-DENY. The single audit_events SELECT policy
-- scopes eight known entity_types; any OTHER (unknown/future) entity_type fell
-- through to the base is_tenant_member clause and would be visible to a sales_rep.
-- No production producer emits an unscoped type and clients cannot INSERT, so this
-- is latent — but this AND-s a final default-deny clause so an unknown entity_type
-- additionally requires owner/admin. All eight known-entity clauses are reproduced
-- VERBATIM (their behavior is unchanged); only unknown types are tightened.
--
-- ADDITIVE ONLY: redefinition of two order RPCs (unchanged public contract) + one
-- SELECT-policy hardening. No table/column create/drop, no TRUNCATE, no data
-- mutation/backfill, no history repair, no new grants, no unrelated redefinitions.
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1a. update_order_status — deterministic ascending product_id lock order ──
-- Base: 20260802100000 (M8H.1). ONLY change vs that definition: `order by
-- oi.product_id` on the RESERVE loop and `order by m.product_id` on the RESTORE
-- loop, so inventory_items row locks are always taken in ascending product_id.
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
  -- insufficient stock so the order stays at its previous stage. Products are
  -- reserved in ascending product_id order (M8I.7 deterministic lock order).
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
      order by oi.product_id
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
  -- NET currently-reserved amount per product (reserve + any edit adjustments),
  -- in ascending product_id order (M8I.7 deterministic lock order).
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
      order by m.product_id
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

revoke all on function public.update_order_status(uuid, uuid, public.order_status)
  from public, anon;
grant execute on function public.update_order_status(uuid, uuid, public.order_status)
  to authenticated, service_role;

-- ── 1b. update_order_items — deterministic ascending product_id lock order ──
-- Base: 20260802100000 (M8H.1). ONLY change vs that definition: `order by pid`
-- on the edit-reconciliation loop, so inventory_items row locks are always taken
-- in ascending product_id — matching update_order_status.
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
  --   delta = new_qty - net_reserved; deduct/restore by delta. Products are
  -- locked in ascending product_id order (M8I.7 deterministic lock order).
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
      order by coalesce(n.pid, r.pid)
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

revoke all on function public.update_order_items(uuid, uuid, jsonb, text) from public, anon;
grant execute on function public.update_order_items(uuid, uuid, jsonb, text) to authenticated, service_role;

-- ── 2. audit_events SELECT policy — unknown-entity DEFAULT-DENY ─────────────
-- The eight known-entity clauses are reproduced VERBATIM (their reader scoping is
-- unchanged); a final clause additionally requires owner/admin for any entity_type
-- NOT in the known set, so an unknown/future type is never visible to a sales_rep,
-- non-member, anonymous, or other tenant. Single SELECT policy; no competing
-- permissive policy; INSERT behavior + producers unchanged.
drop policy if exists "audit_events: members read; entity rows scoped" on public.audit_events;

create policy "audit_events: members read; entity rows scoped"
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
    and (
      entity_type <> 'team'
      or public.has_tenant_role(tenant_id, array['owner', 'admin']::public.tenant_role[])
    )
    and (
      entity_type <> 'settings'
      or public.has_tenant_role(tenant_id, array['owner', 'admin']::public.tenant_role[])
    )
    and (
      entity_type <> 'sales_rep_assignment'
      or public.has_tenant_role(tenant_id, array['owner', 'admin']::public.tenant_role[])
    )
    and (
      entity_type <> 'customer_signup_request'
      or public.has_tenant_role(tenant_id, array['owner', 'admin']::public.tenant_role[])
    )
    -- DEFAULT-DENY: any entity_type OUTSIDE the known set additionally requires
    -- owner/admin, so an unknown/future type is never sales_rep/non-member visible.
    and (
      entity_type in ('customer', 'order', 'product', 'inventory', 'team',
                      'settings', 'sales_rep_assignment', 'customer_signup_request')
      or public.has_tenant_role(tenant_id, array['owner', 'admin']::public.tenant_role[])
    )
  );

-- ═══════════════════════════════════════════════════════════════════════
-- PILOT-OPS-AUDIT-008-FIX1 — Order submission idempotency + onboarding
-- serialization (the two confirmed P2 defects). Appended to the SAME unmerged,
-- unapplied feature migration. ADDITIVE ONLY: one private claim table + three
-- private helpers, redefinition of the three PUBLIC order-creation wrappers to
-- require a client submission key (the private _order_create_core engine is NOT
-- touched), and a per-auth-user row lock in create_tenant_with_owner. No
-- business-row mutation, no backfill, no history repair, no advisory locks.
-- ═══════════════════════════════════════════════════════════════════════

-- ── 3. Private order-submission idempotency ─────────────────────────────────
-- 3a. Claim table — ONE authoritative claim per (tenant_id, channel,
-- submission_key). The unique PK is the concurrency serialization point (a
-- second same-key INSERT blocks on the index until the first txn ends). Locked
-- exactly like public.token_access_attempts: RLS ON with NO policies, all client
-- privileges revoked, service_role-only DML; reachable ONLY through the SECURITY
-- DEFINER order wrappers. Stores only a SERVER-computed request fingerprint and
-- the resulting order_id — never a raw token, request payload or caller PII.
create table public.order_submission_claims (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  channel text not null,
  submission_key uuid not null,
  request_fingerprint text not null,
  order_id uuid,
  created_at timestamptz not null default now(),
  constraint order_submission_claims_pkey primary key (tenant_id, channel, submission_key),
  constraint order_submission_claims_channel_chk
    check (channel in ('authenticated', 'shop_token', 'showcase')),
  -- Tenant-safe composite FK: the linked order must belong to the SAME tenant.
  constraint order_submission_claims_order_fk
    foreign key (tenant_id, order_id) references public.orders (tenant_id, id) on delete cascade
);

comment on table public.order_submission_claims is
  'Order-submission idempotency claims (PILOT-OPS-AUDIT-008-FIX1). One row per (tenant_id, channel, submission_key); the unique PK serializes concurrent same-key creation and makes exact retries return the original order. Stores only a server-computed SHA-256 request fingerprint + the resulting order_id — never a token, request payload or PII. Written exclusively by the SECURITY DEFINER order wrappers; no anon/authenticated access.';

alter table public.order_submission_claims enable row level security;
revoke all on public.order_submission_claims from anon, authenticated;
revoke truncate, references, trigger, maintain
  on public.order_submission_claims from anon, authenticated;
grant select, insert, update, delete on public.order_submission_claims to service_role;

-- 3b. Canonical order-line normalization: product_id → summed quantity, ordered
-- ascending, so the fingerprint is independent of input line order / duplicate
-- lines / whitespace. Crash-proof against malformed input (non-array, missing
-- product_id, non-integer/oversized quantity) so the fingerprint is computed
-- BEFORE _order_create_core without ever masking its friendly validation errors.
create function public._normalize_order_lines(p_items jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    (select jsonb_agg(jsonb_build_object('p', pid, 'q', q) order by pid)
     from (
       select (elem ->> 'product_id') as pid,
              sum(case when (elem ->> 'quantity') ~ '^[0-9]{1,6}$'
                       then (elem ->> 'quantity')::integer else 0 end) as q
       from jsonb_array_elements(
              case when jsonb_typeof(p_items) = 'array' then p_items else '[]'::jsonb end) as elem
       where coalesce(elem ->> 'product_id', '') <> ''
       group by 1
     ) s),
    '[]'::jsonb);
$$;
revoke all on function public._normalize_order_lines(jsonb) from public, anon, authenticated;
grant execute on function public._normalize_order_lines(jsonb) to service_role;

-- 3c. Server-authoritative request fingerprint — a deterministic SHA-256 over a
-- canonical jsonb context the wrapper builds from RESOLVED (never client-trusted)
-- identity + normalized lines. jsonb sorts object keys, so ::text is canonical.
create function public._order_submission_fingerprint(p_context jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(p_context::text, 'UTF8')), 'hex');
$$;
revoke all on function public._order_submission_fingerprint(jsonb) from public, anon, authenticated;
grant execute on function public._order_submission_fingerprint(jsonb) to service_role;

-- 3d. Claim contract — the concurrency-safe change gate. Returns
-- (existing_order_id, is_new). WINNER: inserts the claim (row-locked until commit)
-- and returns is_new=true; the caller then creates the order and links order_id in
-- the SAME transaction. LOSER (concurrent or later same key): the INSERT blocks on
-- the unique index until the winner's txn ends — commit → unique_violation → read
-- the committed claim (fingerprint match → return its order_id, is_new=false;
-- mismatch → MDF40); rollback → the INSERT succeeds and this caller becomes the
-- winner. So one order per key, exact retries return it, changed payloads conflict,
-- and a rolled-back winner leaves NO orphan claim (the claim insert rolls back with it).
create function public._claim_order_submission(
  p_tenant uuid,
  p_channel text,
  p_submission_key uuid,
  p_fingerprint text
)
returns table (existing_order_id uuid, is_new boolean)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_fp text;
  v_oid uuid;
begin
  if p_submission_key is null then
    raise exception 'order idempotency: a submission key is required' using errcode = '22023';
  end if;
  if p_channel not in ('authenticated', 'shop_token', 'showcase') then
    raise exception 'order idempotency: unknown submission channel' using errcode = '22023';
  end if;
  loop
    begin
      insert into public.order_submission_claims
        (tenant_id, channel, submission_key, request_fingerprint)
      values (p_tenant, p_channel, p_submission_key, p_fingerprint);
      return query select null::uuid, true;   -- winner
      return;
    exception when unique_violation then
      -- A concurrent same-key claim existed; our INSERT blocked on the unique
      -- index until that txn COMMITTED (a rollback would have let our INSERT win),
      -- so a committed claim is now visible.
      select request_fingerprint, order_id into v_fp, v_oid
      from public.order_submission_claims
      where tenant_id = p_tenant and channel = p_channel and submission_key = p_submission_key;
      if not found then
        continue;  -- committed claim already gone (order deleted → FK cascade); retry as winner
      end if;
      if v_fp is distinct from p_fingerprint then
        raise exception 'order idempotency: submission key reused with a different request'
          using errcode = 'MDF40';
      end if;
      return query select v_oid, false;  -- idempotent hit
      return;
    end;
  end loop;
end;
$$;
revoke all on function public._claim_order_submission(uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public._claim_order_submission(uuid, text, uuid, text) to service_role;

-- ── 4. Idempotent order-creation wrappers ───────────────────────────────────
-- Each of the three public wrappers is redefined VERBATIM from its M8H.1 body
-- (20260802100000) except: (a) a required trailing p_submission_key, (b) the
-- claim call before _order_create_core, (c) an early idempotent-return of the
-- original order. The old (keyless, non-idempotent) signatures are DROPPED so no
-- browser-callable bypass remains. All other behavior — authorization, sales_rep
-- scoping, token resolution, rate limiting, guest snapshot, server-authoritative
-- money/VAT (in the untouched _order_create_core), order_number/public_ref, and
-- the single order.created audit — is preserved. Grants are re-asserted identically.

-- 4a. create_order_request — authenticated (owner/admin/sales_rep).
drop function if exists public.create_order_request(uuid, jsonb, uuid, text, public.order_source);
create function public.create_order_request(
  p_tenant_id uuid,
  p_items jsonb,
  p_customer_id uuid default null,
  p_notes text default null,
  p_source public.order_source default 'sales_visit',
  p_submission_key uuid default null
)
returns table (order_id uuid, order_number text)
language plpgsql security definer set search_path = ''
as $$
declare
  v_tenant uuid;
  v_order_id uuid;
  v_order_number text;
  v_item_count integer;
  v_existing uuid;
  v_is_new boolean;
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

  -- FIX1: authoritative DB-backed idempotency (required key; no non-idempotent
  -- path). The fingerprint binds tenant + actor + customer + source + notes +
  -- normalized lines, so an exact retry returns the same order and the same key
  -- with a DIFFERENT payload raises MDF40.
  select c.existing_order_id, c.is_new into v_existing, v_is_new
  from public._claim_order_submission(
    v_tenant, 'authenticated', p_submission_key,
    public._order_submission_fingerprint(jsonb_build_object(
      'channel', 'authenticated',
      'tenant', v_tenant,
      'actor', (select auth.uid()),
      'customer', p_customer_id,
      'source', coalesce(p_source, 'sales_visit')::text,
      'notes', nullif(btrim(coalesce(p_notes, '')), ''),
      'lines', public._normalize_order_lines(p_items)))) c;
  if not v_is_new then
    select o.order_number into v_order_number
    from public.orders o where o.id = v_existing and o.tenant_id = v_tenant;
    return query select v_existing, v_order_number;  -- idempotent hit: create/audit nothing
    return;
  end if;

  select o.order_id, o.order_number into v_order_id, v_order_number
  from public._order_create_core(
    v_tenant, p_items, p_customer_id, p_notes, coalesce(p_source, 'sales_visit')) o;

  update public.order_submission_claims set order_id = v_order_id
   where tenant_id = v_tenant and channel = 'authenticated' and submission_key = p_submission_key;

  -- M8H.1: ONE order.created. Safe channel facts only — no items, prices,
  -- totals, notes, customer name/snapshot, order_number, or submission key.
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
revoke all on function public.create_order_request(uuid, jsonb, uuid, text, public.order_source, uuid)
  from public, anon;
grant execute on function public.create_order_request(uuid, jsonb, uuid, text, public.order_source, uuid)
  to authenticated, service_role;

-- 4b. create_order_request_from_token — private Shop link (anon, rate-limited).
drop function if exists public.create_order_request_from_token(text, jsonb, text);
create function public.create_order_request_from_token(
  p_token text,
  p_items jsonb,
  p_notes text default null,
  p_submission_key uuid default null
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
  v_existing uuid;
  v_is_new boolean;
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
      return query select null::text;
      return;
    when others then
      perform public._record_token_failure('shop_order', v_fp);
      return query select null::text;
      return;
  end;

  -- Token is valid past here. FIX1 idempotency (raises MDF40 on a changed payload
  -- reusing the key; content-level, not rate-limited). Context binds the resolved
  -- tenant + customer + link, so a foreign token cannot retrieve this order.
  select c.existing_order_id, c.is_new into v_existing, v_is_new
  from public._claim_order_submission(
    v_tenant, 'shop_token', p_submission_key,
    public._order_submission_fingerprint(jsonb_build_object(
      'channel', 'shop_token',
      'tenant', v_tenant,
      'customer', v_customer,
      'link', v_link,
      'notes', nullif(btrim(coalesce(p_notes, '')), ''),
      'lines', public._normalize_order_lines(p_items)))) c;
  if not v_is_new then
    select o.public_ref into v_public_ref
    from public.orders o where o.id = v_existing and o.tenant_id = v_tenant;
    return query select v_public_ref;  -- idempotent hit
    return;
  end if;

  select o.order_id into v_order_id
  from public._order_create_core(v_tenant, p_items, v_customer, p_notes, 'remote_customer') o;

  update public.order_submission_claims set order_id = v_order_id
   where tenant_id = v_tenant and channel = 'shop_token' and submission_key = p_submission_key;

  -- Customer sees the random public reference, NOT the internal sequence (M7E).
  select public_ref into v_public_ref from public.orders where id = v_order_id;

  update public.customer_access_links set last_used_at = now() where id = v_link;

  -- M8H.1: ONE order.created, initiator = the private customer-link channel.
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
revoke all on function public.create_order_request_from_token(text, jsonb, text, uuid) from public;
grant execute on function public.create_order_request_from_token(text, jsonb, text, uuid)
  to anon, authenticated, service_role;

-- 4c. create_order_from_showcase_token — Showcase guest order (anon, limited).
drop function if exists public.create_order_from_showcase_token(
  text, jsonb, text, text, text, text, text, text, text, text, text);
create function public.create_order_from_showcase_token(
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
  p_notes text default null,
  p_submission_key uuid default null
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
  v_existing uuid;
  v_is_new boolean;
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

  -- FIX1 idempotency. The guest snapshot IS part of the resulting order, so it is
  -- bound into the fingerprint (a changed store detail + reused key raises MDF40).
  select c.existing_order_id, c.is_new into v_existing, v_is_new
  from public._claim_order_submission(
    v_tenant, 'showcase', p_submission_key,
    public._order_submission_fingerprint(jsonb_build_object(
      'channel', 'showcase',
      'tenant', v_tenant,
      'link', v_link,
      'guest', jsonb_build_object(
        'name', v_name,
        'contact', nullif(trim(coalesce(p_contact_name, '')), ''),
        'phone', nullif(trim(coalesce(p_phone, '')), ''),
        'email', v_email,
        'city', jsonb_build_object(
          'ar', nullif(trim(coalesce(p_city_ar, '')), ''),
          'he', nullif(trim(coalesce(p_city_he, '')), ''),
          'en', nullif(trim(coalesce(p_city_en, '')), '')),
        'address', nullif(trim(coalesce(p_address, '')), '')),
      'notes', nullif(btrim(coalesce(p_notes, '')), ''),
      'lines', public._normalize_order_lines(p_items)))) c;
  if not v_is_new then
    select o.public_ref into v_public_ref
    from public.orders o where o.id = v_existing and o.tenant_id = v_tenant;
    return query select v_public_ref;  -- idempotent hit
    return;
  end if;

  -- Create the order (customer NULL) — all money server-side, real products.
  select o.order_id into v_order_id
  from public._order_create_core(v_tenant, p_items, null, p_notes, 'remote_customer') o;

  update public.order_submission_claims set order_id = v_order_id
   where tenant_id = v_tenant and channel = 'showcase' and submission_key = p_submission_key;

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

  -- M8H.1: ONE order.created, initiator = the Showcase guest channel.
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
revoke all on function public.create_order_from_showcase_token(
  text, jsonb, text, text, text, text, text, text, text, text, text, uuid) from public;
grant execute on function public.create_order_from_showcase_token(
  text, jsonb, text, text, text, text, text, text, text, text, text, uuid)
  to anon, authenticated, service_role;

-- ── 5. Onboarding serialization — per-auth-user row lock ─────────────────────
-- create_tenant_with_owner redefined VERBATIM from M7D.1 (20260715100000) except:
-- it now takes a FOR UPDATE lock on the caller's OWN auth.users row BEFORE the
-- membership check. Two concurrent same-user self-onboards serialize on that row
-- (the loser proceeds only after the winner commits and then sees the winner's
-- membership → 42501), so exactly one tenant + one owner membership is created.
-- Different users lock different rows and never block each other. M4C dropped the
-- unique(user_id) backstop (multi-tenant via invites), so this lock — not a
-- broad constraint — is the approved serialization. Signature / return / DEFINER /
-- search_path / grants / validation / starter categories are all preserved.
create or replace function public.create_tenant_with_owner(
  p_name_ar text,
  p_name_he text,
  p_name_en text,
  p_default_locale public.locale_code default 'he'
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_tenant_id uuid;
  v_ar text := nullif(trim(coalesce(p_name_ar, '')), '');
  v_he text := nullif(trim(coalesce(p_name_he, '')), '');
  v_en text := nullif(trim(coalesce(p_name_en, '')), '');
  v_locked uuid;
begin
  if v_uid is null then
    raise exception 'create_tenant_with_owner: authentication required'
      using errcode = '42501';
  end if;

  -- FIX1: serialize concurrent self-onboarding for THIS auth user on the user's
  -- OWN auth.users row. Two simultaneous calls block here; the loser continues
  -- only after the winner commits, so the membership recheck below is authoritative
  -- (it sees the winner's membership). Different users lock different rows.
  select id into v_locked from auth.users where id = v_uid for update;
  if not found then
    raise exception 'create_tenant_with_owner: authenticated user not found'
      using errcode = '42501';
  end if;

  -- Membership recheck UNDER the lock (previously a pre-lock, racy check).
  if exists (select 1 from public.tenant_users tu where tu.user_id = v_uid) then
    raise exception 'create_tenant_with_owner: user already belongs to a tenant'
      using errcode = '42501';
  end if;
  if v_ar is null or v_he is null or v_en is null then
    raise exception 'create_tenant_with_owner: name_ar, name_he and name_en are required'
      using errcode = '22023';
  end if;
  if greatest(length(v_ar), length(v_he), length(v_en)) > 200 then
    raise exception 'create_tenant_with_owner: names must be 200 characters or fewer'
      using errcode = '22023';
  end if;

  insert into public.tenants (name_ar, name_he, name_en, default_locale, document_locale)
  values (v_ar, v_he, v_en, p_default_locale, p_default_locale)
  returning id into v_tenant_id;

  insert into public.tenant_users (tenant_id, user_id, role)
  values (v_tenant_id, v_uid, 'owner');

  -- Starter category taxonomy for the new tenant (mirrors supabase/seed.sql).
  insert into public.categories
    (tenant_id, name_ar, name_he, name_en, icon, color_hue, sort_order)
  values
    (v_tenant_id, 'مشروبات', 'משקאות', 'Drinks', '🥤', 197, 1),
    (v_tenant_id, 'سناكات وحلويات', 'חטיפים ומתוקים', 'Snacks & Sweets', '🥨', 28, 2),
    (v_tenant_id, 'قهوة وشاي', 'קפה ותה', 'Coffee & Tea', '☕', 25, 3),
    (v_tenant_id, 'معلبات ومواد جافة', 'שימורים ויבשים', 'Canned & Pantry', '🥫', 8, 4),
    (v_tenant_id, 'ألبان', 'מוצרי חלב', 'Dairy', '🥛', 210, 5),
    (v_tenant_id, 'تنظيف ومستهلكات', 'ניקיון וחד־פעמי', 'Cleaning', '🧼', 168, 6);

  return v_tenant_id;
exception
  -- Backstop for any residual unique conflict (e.g. the tenant_users PK); the
  -- whole function is one transaction, so the just-inserted tenant rolls back too.
  when unique_violation then
    raise exception 'create_tenant_with_owner: user already belongs to a tenant'
      using errcode = '42501';
end;
$$;

comment on function public.create_tenant_with_owner(text, text, text, public.locale_code) is
  'Onboarding: a membership-less authenticated user creates a tenant and becomes its owner (atomic). M4A single-membership; M7D.1 seeds starter categories; PILOT-OPS-AUDIT-008-FIX1 serializes concurrent same-user onboarding via a FOR UPDATE lock on the caller''s auth.users row so a real race creates exactly one tenant.';

-- Grants preserved by the redefinition — re-assert defensively.
revoke all on function public.create_tenant_with_owner(text, text, text, public.locale_code) from public, anon;
grant execute on function public.create_tenant_with_owner(text, text, text, public.locale_code) to authenticated, service_role;
