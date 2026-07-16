-- ═══════════════════════════════════════════════════════════════════════
-- M8I.1 — Product lifecycle AUDIT FOUNDATION (PILOT-OPS-AUDIT-001, Phase 1)
--
-- Turns the existing public.audit_events table into a transactional source of
-- truth for PRODUCT lifecycle actions, exactly as M8G.2 did for customers and
-- M8H.1 for orders. The read-only Product Timeline (this same phase) READS these
-- rows on the owner/admin Product edit page; nothing is reconstructed and no
-- historical event is backfilled.
--
-- MUTATION INVENTORY (verified from the live catalog — products grants
-- `authenticated` SELECT only, so these SECURITY DEFINER RPCs are the ONLY write
-- paths; sales_rep is excluded by authorize_tenant([owner,admin])):
--   creation:  create_product        (owner/admin; may also create an inventory
--                                     row via upsert_inventory_item)
--   edit:      update_product        (owner/admin; full overwrite, description
--                                     keys preserved when absent)
--   lifecycle: set_product_active    (owner/admin; is_active toggle)
--   upsert_inventory_item is CALLED BY create/update_product but is NOT touched
--     here and emits NO event — Inventory audit is Phase 2.
--
-- TAXONOMY (closed, 4 keys — one meaning each, no overlap, no "Other"):
--   product.created       one per successfully created product
--   product.updated       one per EFFECTIVE ordinary-field edit (no-op → none);
--                         changed_fields is a KEY allowlist, never the VALUES
--   product.activated     is_active false → true (via update_product OR
--                         set_product_active)
--   product.deactivated   is_active true → false
--
-- is_active is NEVER a changed_fields key: an activation is a distinct,
-- first-class lifecycle event. A single update_product call that changes ordinary
-- fields AND flips is_active therefore emits at most TWO events (one product.updated
-- + one lifecycle) — each describing a genuinely different thing, each once.
--
-- METADATA SAFETY. No event carries a product name, localized name/description,
-- price, VAT, SKU, barcode, image_url, storage path, token, raw row or raw JSON.
-- product.updated stores ONLY the changed-field KEY array (localized name columns
-- normalize to the single key `name`; the localized descriptions to `description`
-- and gated on key presence so an omitted description is never a change; the
-- package tuple to `package`; image_url to `image`). Lifecycle events store ONLY
-- the safe {before_active, after_active}
-- booleans. The DB helper enforces a per-event key allowlist so no producer — and
-- certainly no client — can smuggle a value-bearing key in.
--
-- SINGLE-WAREHOUSE / MULTI-TENANT. Each tenant is one independent supplier with
-- one physical warehouse; there are no branches. A product event's scope is
-- tenant + product + actor + timestamp only — NO branch/warehouse-location scope.
-- Cross-tenant reads/writes fail closed (RLS + authorize_tenant).
--
-- Additive: one private helper + audit-only bodies on the 3 active Product
-- producers (signatures / return types / security modes / search_path / grants /
-- authorization / description-preservation / inventory calls all PRESERVED — the
-- only additions are the transactional audit inserts and, for update/lifecycle,
-- a safe before-capture + change diff) + an additive Product clause on the
-- audit_events SELECT policy (owner/admin only). No table/column change, no new
-- index (the M8G.3 generic (tenant_id, entity_type, entity_id, created_at desc,
-- id desc) index already serves the entity-scoped Product query), no backfill,
-- no destructive SQL, no data loss.
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1. Private Product audit helper ───────────────────────────────────────
-- SECURITY INVOKER (like the M8G.2 customer / M8H.1 order helpers): it holds no
-- privileges of its own and is executable by NO client role — reachable only from
-- the SECURITY DEFINER Product RPCs below, which run as the table owner. Closed
-- 4-event allowlist, entity_type hardcoded to 'product', actor from auth.uid()
-- (never a parameter), metadata must be a bounded JSON OBJECT whose keys are
-- allowlisted PER EVENT TYPE (so no value-bearing key can ever be written).
create function public._log_product_audit_event(
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
    raise exception '_log_product_audit_event: tenant is required' using errcode = '22023';
  end if;
  if p_product_id is null then
    raise exception '_log_product_audit_event: product id is required' using errcode = '22023';
  end if;

  -- Closed allowlist — an unknown/typo'd type raises rather than silently
  -- becoming an "Other" event.
  if p_event_type not in (
    'product.created', 'product.updated', 'product.activated', 'product.deactivated'
  ) then
    raise exception '_log_product_audit_event: unknown product event type %', p_event_type
      using errcode = '22023';
  end if;

  -- Metadata must be a bounded JSON OBJECT (never an array/scalar/unbounded blob).
  if jsonb_typeof(v_meta) <> 'object' then
    raise exception '_log_product_audit_event: metadata must be a JSON object'
      using errcode = '22023';
  end if;
  if length(v_meta::text) > 4000 then
    raise exception '_log_product_audit_event: metadata exceeds the size bound'
      using errcode = '22023';
  end if;

  -- Per-event-type KEY allowlist. Anything else (a name, a price, an image url, a
  -- raw payload, a future stray key) is rejected outright.
  v_allowed := case p_event_type
    when 'product.created' then array['created']
    when 'product.updated' then array['changed_fields']
    when 'product.activated' then array['before_active', 'after_active']
    when 'product.deactivated' then array['before_active', 'after_active']
  end;
  for v_key in select jsonb_object_keys(v_meta) loop
    if not (v_key = any (v_allowed)) then
      raise exception '_log_product_audit_event: metadata key % is not allowed for %',
        v_key, p_event_type using errcode = '22023';
    end if;
  end loop;

  insert into public.audit_events
    (tenant_id, actor_user_id, event_type, entity_type, entity_id, metadata)
  values
    (p_tenant_id, (select auth.uid()), p_event_type, 'product', p_product_id, v_meta);
end;
$$;

comment on function public._log_product_audit_event(uuid, text, uuid, jsonb) is
  'M8I.1 — PRIVATE transactional Product audit producer. Closed 4-event allowlist, '
  'entity_type=product, actor=auth.uid(), metadata must be a bounded JSON object with '
  'per-event allowlisted keys (changed_fields KEYS only; safe before/after booleans). '
  'Callable ONLY from the SECURITY DEFINER Product RPCs; no client role may execute it.';

revoke all on function public._log_product_audit_event(uuid, text, uuid, jsonb)
  from public, anon, authenticated;

-- ── 2. audit_events SELECT policy — ADDITIVE Product clause ────────────────
-- The existing Customer and Order clauses are reproduced VERBATIM and a new
-- Product clause is AND-ed on. Because each clause is vacuous for the other
-- entity types:
--   • customer rows behave EXACTLY as before (M8G.2 semantics preserved);
--   • order rows behave EXACTLY as before (M8H.1 semantics preserved);
--   • non-customer/non-order/non-product rows keep plain tenant-member visibility;
--   • product rows now additionally require owner/admin — a sales_rep (who cannot
--     mutate the catalog) gets NO product audit history, at the DB, not just in
--     the hidden UI. owner/admin retain tenant-wide product visibility.
drop policy if exists "audit_events: members read; customer + order rows scoped"
  on public.audit_events;

create policy "audit_events: members read; customer/order/product rows scoped"
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
  );

-- ═══════════════════════════════════════════════════════════════════════
-- 3. PRODUCERS — the 3 active Product mutation RPCs, replaced with IDENTICAL
--    signatures / return types / security modes / search_paths / grants /
--    authorization / validation / unique-SKU handling / description preservation /
--    inventory calls. The ONLY change in each body is the transactional audit
--    insert (and, for update/lifecycle, a safe before-capture + change diff).
-- ═══════════════════════════════════════════════════════════════════════

-- 3a. create_product — owner/admin creation → ONE product.created.
-- Base body reproduced verbatim from 20260705170000_auth_and_private_links.sql:450;
-- only the transactional audit insert is added before RETURN.
create or replace function public.create_product(
  p_tenant_id uuid,
  p_product jsonb,
  p_inventory jsonb default null
)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v record;
  v_product_id uuid;
begin
  p_tenant_id := public.authorize_tenant(p_tenant_id, array['owner', 'admin']::public.tenant_role[]);
  select * into v from public.validate_product_payload(p_tenant_id, p_product);
  begin
    insert into public.products
      (tenant_id, manufacturer_id, category_id, sku, barcode,
       name_ar, name_he, name_en, description_ar, description_he, description_en,
       package_unit, package_quantity, base_unit, unit_size,
       wholesale_price, vat_rate, image_url, track_expiry, is_active)
    values
      (p_tenant_id, v.manufacturer_id, v.category_id, v.sku, v.barcode,
       v.name_ar, v.name_he, v.name_en, v.description_ar, v.description_he, v.description_en,
       v.package_unit, v.package_quantity, v.base_unit, v.unit_size,
       v.wholesale_price, v.vat_rate, v.image_url, v.track_expiry, v.is_active)
    returning id into v_product_id;
  exception when unique_violation then
    raise exception 'create_product: a product with this SKU already exists in this tenant'
      using errcode = '22023';
  end;
  if p_inventory is not null then
    -- Initial inventory row (unchanged behavior). NO inventory audit event in
    -- Phase 1 — Inventory audit is Phase 2.
    perform public.upsert_inventory_item(p_tenant_id, v_product_id, p_inventory);
  end if;

  -- M8I.1: ONE product.created inside the same transaction (empty safe metadata —
  -- no product name/price/sku/image is recorded). If the creation rolls back, the
  -- event rolls back with it; a failed creation writes no event.
  perform public._log_product_audit_event(
    p_tenant_id, 'product.created', v_product_id, '{}'::jsonb);
  return v_product_id;
end;
$$;
revoke all on function public.create_product(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.create_product(uuid, jsonb, jsonb) to authenticated, service_role;

-- 3b. update_product — owner/admin edit → ONE change-gated product.updated
--     (ordinary KEYS only) + a SEPARATE lifecycle event when is_active flips.
-- Base body reproduced verbatim from 20260722120000_preserve_descriptions_on_
-- product_update.sql:23 (description preservation intact); the additions are a
-- locked before-capture, the change diff, and the transactional audit inserts.
create or replace function public.update_product(
  p_tenant_id uuid,
  p_product_id uuid,
  p_product jsonb,
  p_inventory jsonb default null
)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v record;
  v_old public.products%rowtype;
  v_changed text[] := array[]::text[];
begin
  p_tenant_id := public.authorize_tenant(p_tenant_id, array['owner', 'admin']::public.tenant_role[]);

  -- Capture the prior row (locked) BEFORE validating/updating, so the audit diff
  -- records ONLY fields that actually changed — never the VALUES. This lock also
  -- serves as the existence + tenant check (replacing the prior EXISTS probe).
  select * into v_old
  from public.products p
  where p.id = p_product_id and p.tenant_id = p_tenant_id
  for update;
  if not found then
    raise exception 'update_product: product is unknown or belongs to another tenant'
      using errcode = '22023';
  end if;

  select * into v from public.validate_product_payload(p_tenant_id, p_product);
  begin
    update public.products p set
      manufacturer_id = v.manufacturer_id, category_id = v.category_id,
      sku = v.sku, barcode = v.barcode,
      name_ar = v.name_ar, name_he = v.name_he, name_en = v.name_en,
      -- Preserve descriptions the payload doesn't carry (M8A): the admin
      -- form has no description inputs, and a full overwrite silently
      -- destroyed values set elsewhere.
      description_ar = case when p_product ? 'description_ar' then v.description_ar else p.description_ar end,
      description_he = case when p_product ? 'description_he' then v.description_he else p.description_he end,
      description_en = case when p_product ? 'description_en' then v.description_en else p.description_en end,
      package_unit = v.package_unit, package_quantity = v.package_quantity,
      base_unit = v.base_unit, unit_size = v.unit_size,
      wholesale_price = v.wholesale_price, vat_rate = v.vat_rate,
      image_url = v.image_url, track_expiry = v.track_expiry, is_active = v.is_active
    where p.id = p_product_id and p.tenant_id = p_tenant_id;
  exception when unique_violation then
    raise exception 'update_product: a product with this SKU already exists in this tenant'
      using errcode = '22023';
  end;
  if p_inventory is not null then
    -- Inventory config/quantity set (unchanged behavior). NO inventory audit
    -- event in Phase 1 — Inventory audit is Phase 2. An inventory-only edit
    -- (no ordinary product field changed, no is_active flip) records NO product
    -- event, by the change gate below.
    perform public.upsert_inventory_item(p_tenant_id, p_product_id, p_inventory);
  end if;

  -- M8I.1: derive the ORDINARY changed_fields (KEY allowlist only; VALUES are
  -- never stored). Localized name columns normalize to the single key `name`; the
  -- localized descriptions to `description`; the package tuple to `package`;
  -- image_url to `image`. is_active is intentionally EXCLUDED here — it maps to a
  -- distinct lifecycle event below.
  if v_old.name_ar is distinct from v.name_ar
     or v_old.name_he is distinct from v.name_he
     or v_old.name_en is distinct from v.name_en then v_changed := array_append(v_changed, 'name'); end if;
  -- Descriptions are change-gated on KEY PRESENCE: the UPDATE preserves an omitted
  -- description (M8A), so an omitted key is never a change, an explicitly-supplied
  -- different value IS, and several localized descriptions changing collapse to the
  -- single logical key `description`. The VALUE/text is never recorded.
  if (p_product ? 'description_ar' and v_old.description_ar is distinct from v.description_ar)
     or (p_product ? 'description_he' and v_old.description_he is distinct from v.description_he)
     or (p_product ? 'description_en' and v_old.description_en is distinct from v.description_en)
     then v_changed := array_append(v_changed, 'description'); end if;
  if v_old.sku is distinct from v.sku then v_changed := array_append(v_changed, 'sku'); end if;
  if v_old.barcode is distinct from v.barcode then v_changed := array_append(v_changed, 'barcode'); end if;
  if v_old.manufacturer_id is distinct from v.manufacturer_id then v_changed := array_append(v_changed, 'manufacturer'); end if;
  if v_old.category_id is distinct from v.category_id then v_changed := array_append(v_changed, 'category'); end if;
  if v_old.package_unit is distinct from v.package_unit
     or v_old.package_quantity is distinct from v.package_quantity
     or v_old.base_unit is distinct from v.base_unit then v_changed := array_append(v_changed, 'package'); end if;
  if v_old.unit_size is distinct from v.unit_size then v_changed := array_append(v_changed, 'unit_size'); end if;
  if v_old.wholesale_price is distinct from v.wholesale_price then v_changed := array_append(v_changed, 'wholesale_price'); end if;
  if v_old.vat_rate is distinct from v.vat_rate then v_changed := array_append(v_changed, 'vat_rate'); end if;
  if v_old.track_expiry is distinct from v.track_expiry then v_changed := array_append(v_changed, 'track_expiry'); end if;
  if v_old.image_url is distinct from v.image_url then v_changed := array_append(v_changed, 'image'); end if;

  -- No effective ordinary change → no misleading event (the UPDATE still ran to
  -- preserve the existing response + updated_at behavior).
  if array_length(v_changed, 1) is not null then
    perform public._log_product_audit_event(
      p_tenant_id, 'product.updated', p_product_id,
      jsonb_build_object('changed_fields', to_jsonb(v_changed)));
  end if;

  -- Separate lifecycle event when the active state actually flipped — recorded
  -- once, as a first-class activated/deactivated event (never a changed_fields key).
  if v_old.is_active is distinct from v.is_active then
    perform public._log_product_audit_event(
      p_tenant_id,
      case when v.is_active then 'product.activated' else 'product.deactivated' end,
      p_product_id,
      jsonb_build_object('before_active', v_old.is_active, 'after_active', v.is_active));
  end if;

  return p_product_id;
end;
$$;
revoke all on function public.update_product(uuid, uuid, jsonb, jsonb) from public, anon;
grant execute on function public.update_product(uuid, uuid, jsonb, jsonb) to authenticated, service_role;

-- 3c. set_product_active — owner/admin is_active toggle → ONE lifecycle event
--     only when the state actually changes.
-- Base body reproduced from 20260705170000_auth_and_private_links.sql:533; the
-- blind UPDATE + post-hoc NOT FOUND check becomes a locked before-capture (same
-- error, same coalesce no-op semantics) + the transactional audit insert.
create or replace function public.set_product_active(
  p_tenant_id uuid,
  p_product_id uuid,
  p_is_active boolean
)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_before boolean;
  v_after boolean;
begin
  p_tenant_id := public.authorize_tenant(p_tenant_id, array['owner', 'admin']::public.tenant_role[]);

  -- Capture the prior state (locked) to gate the event on a REAL transition; this
  -- also serves as the existence + tenant check.
  select p.is_active into v_before
  from public.products p
  where p.id = p_product_id and p.tenant_id = p_tenant_id
  for update;
  if not found then
    raise exception 'set_product_active: product is unknown or belongs to another tenant'
      using errcode = '22023';
  end if;

  -- Preserve the original coalesce semantics: a NULL p_is_active is a no-op.
  v_after := coalesce(p_is_active, v_before);

  update public.products p
     set is_active = v_after
   where p.id = p_product_id and p.tenant_id = p_tenant_id;

  -- Requesting the already-current state → no event.
  if v_before is distinct from v_after then
    perform public._log_product_audit_event(
      p_tenant_id,
      case when v_after then 'product.activated' else 'product.deactivated' end,
      p_product_id,
      jsonb_build_object('before_active', v_before, 'after_active', v_after));
  end if;
  return p_product_id;
end;
$$;
revoke all on function public.set_product_active(uuid, uuid, boolean) from public, anon;
grant execute on function public.set_product_active(uuid, uuid, boolean) to authenticated, service_role;
