-- ═══════════════════════════════════════════════════════════════════════
-- M8G.2 — Customer lifecycle AUDIT FOUNDATION
--
-- Turns the existing (producer-less) public.audit_events table into a
-- trustworthy, TRANSACTIONAL source of successful Customer lifecycle events.
-- Each approved Customer mutation RPC now writes EXACTLY ONE customer-category
-- audit row IN THE SAME TRANSACTION as the mutation — so the event commits iff
-- the mutation commits, and a rolled-back / rejected / no-op mutation writes no
-- misleading event.
--
-- The future Customer Timeline (M8G.3) consumes THIS source; it is NOT built
-- here. No historical/fake events are backfilled.
--
-- CLOSED taxonomy (validated by the helper — never an accidental 'Other'):
--   customer.created            — a customer row was created (origin metadata
--                                 says manual | signup | guest_conversion)
--   customer.updated            — an edit changed ≥1 field (change-gated)
--   customer.activated          — inactive → active
--   customer.deactivated        — active → inactive
--   customer.access_link.created  — a private link issued while none was active
--                                 (first issue OR re-issue after a revocation)
--   customer.access_link.rotated  — a private link issued while one was active
--                                 (the prior active link was revoked)
--   customer.access_link.revoked  — an active private link revoked
--   customer.order_linked       — a guest/unlinked order linked to the customer
--
-- SAFETY: audit_events stays SELECT-only for authenticated (no direct insert
-- grant/policy). Writes come ONLY from the SECURITY DEFINER mutation RPCs via a
-- PRIVATE helper that is revoked from public/anon/authenticated, derives the
-- actor from auth.uid() (never client-supplied), hard-qualifies schema, sets an
-- empty search_path, validates the event type against the closed list, and
-- bounds metadata size. No raw tokens / token hashes / URLs / full PII / guest
-- snapshot values are ever written. Category + sensitivity are DERIVED from the
-- event type in the app layer (no DB column needed).
--
-- Additive + one RLS TIGHTENING: a private helper, create-or-replace of 8
-- existing mutation RPCs (signatures / security mode / search_path / grants /
-- tenant+role checks / business results all PRESERVED — only the transactional
-- audit insert and, for update/activation, a safe before/after diff, are added),
-- and a STRICTER audit_events read policy so customer rows follow the M4D
-- sales_rep customer scope (strengthening, never weakening). No table/storage
-- change; no DROP/DELETE/TRUNCATE of data; no data loss; no origin change.
-- ═══════════════════════════════════════════════════════════════════════

-- ── Private audit helper (customer events only) ───────────────────────────
-- SECURITY INVOKER: it is only ever called from the SECURITY DEFINER mutation
-- RPCs (which already run as the table owner), so it inherits their privilege
-- to insert into audit_events. It is REVOKED from every client role, so no
-- authenticated/anon caller can invoke it directly to forge a row. Even if a
-- grant leaked, authenticated has no INSERT privilege on audit_events, so the
-- insert would still fail. Actor is auth.uid() (the original caller's JWT sub,
-- unchanged by SECURITY DEFINER), never a parameter.
create or replace function public._log_customer_audit_event(
  p_tenant_id uuid,
  p_event_type text,
  p_entity_id uuid,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
volatile
security invoker
set search_path = ''
as $$
begin
  if p_tenant_id is null then
    raise exception '_log_customer_audit_event: tenant is required' using errcode = '22023';
  end if;
  -- Closed allowlist — an unknown/typo'd type raises rather than silently
  -- becoming an "Other" event.
  if p_event_type not in (
    'customer.created', 'customer.updated', 'customer.activated',
    'customer.deactivated', 'customer.access_link.created',
    'customer.access_link.rotated', 'customer.access_link.revoked',
    'customer.order_linked'
  ) then
    raise exception '_log_customer_audit_event: unknown customer event type %', p_event_type
      using errcode = '22023';
  end if;
  -- Bounded metadata (defense-in-depth against unbounded JSON).
  if p_metadata is not null and length(p_metadata::text) > 4000 then
    raise exception '_log_customer_audit_event: metadata exceeds the size bound'
      using errcode = '22023';
  end if;
  insert into public.audit_events
    (tenant_id, actor_user_id, event_type, entity_type, entity_id, metadata)
  values
    (p_tenant_id, (select auth.uid()), p_event_type, 'customer', p_entity_id,
     coalesce(p_metadata, '{}'::jsonb));
end;
$$;

comment on function public._log_customer_audit_event(uuid, text, uuid, jsonb) is
  'M8G.2 PRIVATE transactional writer for customer-category audit_events. Called '
  'ONLY from the SECURITY DEFINER customer mutation RPCs; revoked from all client '
  'roles. Actor = auth.uid() (never client-supplied); closed event-type allowlist '
  '(no "Other"); bounded metadata; never logs tokens/URLs/full PII.';

revoke all on function public._log_customer_audit_event(uuid, text, uuid, jsonb)
  from public, anon, authenticated;

-- ── Read scoping: customer audit rows follow the M4D customer scope ────────
-- Before M8G.2, audit_events had NO customer-entity producers, so the M1
-- tenant-wide "members can read" policy exposed nothing per-customer. Now that
-- customer lifecycle rows exist, that policy would let a sales_rep read the
-- history (existence, event types, changed-field keys, link/order ids) of
-- customers it is NOT assigned to — violating the M4D rule that a sales_rep
-- sees ONLY assigned customers. TIGHTEN (never weaken) the read policy so a
-- CUSTOMER-category row is visible only when the caller can_access_customer it;
-- owner/admin keep tenant-wide visibility (can_access_customer is true for
-- them) and non-customer event rows keep the existing tenant-wide member read.
drop policy "audit_events: members can read" on public.audit_events;
create policy "audit_events: members read; customer rows rep-scoped"
  on public.audit_events for select to authenticated
  using (
    public.is_tenant_member(tenant_id)
    and (
      entity_type <> 'customer'
      or public.can_access_customer(tenant_id, entity_id)
    )
  );

-- ═══════════════════════════════════════════════════════════════════════
-- CREATE PATHS — one customer.created event each (origin in metadata).
-- Bodies reproduced verbatim from their M8G.1/M7F.2 definitions with ONLY the
-- transactional audit insert added; grants re-issued for defense-in-depth.
-- ═══════════════════════════════════════════════════════════════════════

-- ── create_customer → customer.created (origin manual) ────────────────────
create or replace function public.create_customer(
  p_tenant_id uuid,
  p_name text,
  p_contact_name text default null,
  p_phone text default null,
  p_city_ar text default null,
  p_city_he text default null,
  p_city_en text default null,
  p_address text default null,
  p_customer_type public.customer_type default 'grocery',
  p_notes text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_name text := nullif(trim(coalesce(p_name, '')), '');
  v_contact text := nullif(trim(coalesce(p_contact_name, '')), '');
  v_phone text := nullif(trim(coalesce(p_phone, '')), '');
  v_city_ar text := nullif(trim(coalesce(p_city_ar, '')), '');
  v_city_he text := nullif(trim(coalesce(p_city_he, '')), '');
  v_city_en text := nullif(trim(coalesce(p_city_en, '')), '');
  v_address text := nullif(trim(coalesce(p_address, '')), '');
  v_notes text := nullif(trim(coalesce(p_notes, '')), '');
begin
  p_tenant_id := public.authorize_tenant(
    p_tenant_id, array['owner', 'admin']::public.tenant_role[]);

  if v_name is null then
    raise exception 'customer: name is required' using errcode = '22023';
  end if;
  if length(v_name) > 200
     or coalesce(length(v_contact), 0) > 200
     or coalesce(length(v_phone), 0) > 40
     or greatest(coalesce(length(v_city_ar), 0),
                 coalesce(length(v_city_he), 0),
                 coalesce(length(v_city_en), 0)) > 120
     or coalesce(length(v_address), 0) > 300
     or coalesce(length(v_notes), 0) > 2000 then
    raise exception 'customer: a field exceeds its maximum length'
      using errcode = '22023';
  end if;

  insert into public.customers
    (tenant_id, name, contact_name, phone,
     city_ar, city_he, city_en, address, customer_type, notes, origin)
  values
    (p_tenant_id, v_name, v_contact, v_phone,
     v_city_ar, v_city_he, v_city_en, v_address,
     coalesce(p_customer_type, 'grocery'), v_notes, 'manual')
  returning id into v_id;

  -- M8G.2: one transactional customer.created event (origin from the operation).
  perform public._log_customer_audit_event(
    p_tenant_id, 'customer.created', v_id,
    jsonb_build_object('origin', 'manual',
                       'customer_type', coalesce(p_customer_type, 'grocery')::text));
  return v_id;
end;
$$;

revoke all on function public.create_customer(
  uuid, text, text, text, text, text, text, text, public.customer_type, text)
  from public, anon;
grant execute on function public.create_customer(
  uuid, text, text, text, text, text, text, text, public.customer_type, text)
  to authenticated, service_role;

-- ── approve_customer_signup_request → customer.created (origin signup) ────
create or replace function public.approve_customer_signup_request(
  p_tenant_id uuid,
  p_request_id uuid
)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_tenant uuid;
  v_req public.customer_signup_requests%rowtype;
  v_customer_id uuid;
  v_notes text;
begin
  v_tenant := public.authorize_tenant(p_tenant_id, array['owner', 'admin']::public.tenant_role[]);
  select * into v_req
  from public.customer_signup_requests r
  where r.id = p_request_id and r.tenant_id = v_tenant;
  if not found then
    raise exception 'approve_customer_signup_request: request unknown or another tenant'
      using errcode = '22023';
  end if;
  if v_req.approved_at is not null or v_req.rejected_at is not null then
    raise exception 'approve_customer_signup_request: request already reviewed'
      using errcode = '22023';
  end if;

  v_notes := case
    when v_req.email is not null and v_req.email <> ''
      then trim(both e'\n' from coalesce(v_req.notes, '') || e'\nEmail: ' || v_req.email)
    else v_req.notes
  end;

  insert into public.customers
    (tenant_id, name, contact_name, phone,
     city_ar, city_he, city_en, address, customer_type, notes, origin)
  values
    (v_tenant, v_req.name, v_req.contact_name, v_req.phone,
     v_req.city_ar, v_req.city_he, v_req.city_en, v_req.address, 'grocery', v_notes, 'signup')
  returning id into v_customer_id;

  update public.customer_signup_requests
     set approved_at = now(),
         approved_customer_id = v_customer_id,
         reviewed_by = (select auth.uid())
   where id = p_request_id;

  -- M8G.2: ONE customer.created event for the successful approval (origin
  -- signup + the safe request id). No separate signup.approved event — the
  -- business action is creating the customer.
  perform public._log_customer_audit_event(
    v_tenant, 'customer.created', v_customer_id,
    jsonb_build_object('origin', 'signup', 'signup_request_id', p_request_id));
  return v_customer_id;
end;
$$;

revoke all on function public.approve_customer_signup_request(uuid, uuid) from public, anon;
grant execute on function public.approve_customer_signup_request(uuid, uuid) to authenticated, service_role;

-- ── create_customer_from_order → customer.created (origin guest_conversion) ─
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
  return v_customer_id;
end;
$$;

revoke all on function public.create_customer_from_order(uuid, uuid) from public, anon;
grant execute on function public.create_customer_from_order(uuid, uuid) to authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════
-- UPDATE PATH — one change-gated customer.updated event (PII-redacted).
-- ═══════════════════════════════════════════════════════════════════════
create or replace function public.update_customer(
  p_tenant_id uuid,
  p_customer_id uuid,
  p_name text,
  p_contact_name text default null,
  p_phone text default null,
  p_city_ar text default null,
  p_city_he text default null,
  p_city_en text default null,
  p_address text default null,
  p_customer_type public.customer_type default 'grocery',
  p_notes text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_updated uuid;
  v_old public.customers%rowtype;
  v_new_type public.customer_type;
  v_changed text[] := array[]::text[];
  v_meta jsonb;
  v_name text := nullif(trim(coalesce(p_name, '')), '');
  v_contact text := nullif(trim(coalesce(p_contact_name, '')), '');
  v_phone text := nullif(trim(coalesce(p_phone, '')), '');
  v_city_ar text := nullif(trim(coalesce(p_city_ar, '')), '');
  v_city_he text := nullif(trim(coalesce(p_city_he, '')), '');
  v_city_en text := nullif(trim(coalesce(p_city_en, '')), '');
  v_address text := nullif(trim(coalesce(p_address, '')), '');
  v_notes text := nullif(trim(coalesce(p_notes, '')), '');
begin
  p_tenant_id := public.authorize_tenant(
    p_tenant_id, array['owner', 'admin']::public.tenant_role[]);

  if v_name is null then
    raise exception 'customer: name is required' using errcode = '22023';
  end if;
  if length(v_name) > 200
     or coalesce(length(v_contact), 0) > 200
     or coalesce(length(v_phone), 0) > 40
     or greatest(coalesce(length(v_city_ar), 0),
                 coalesce(length(v_city_he), 0),
                 coalesce(length(v_city_en), 0)) > 120
     or coalesce(length(v_address), 0) > 300
     or coalesce(length(v_notes), 0) > 2000 then
    raise exception 'customer: a field exceeds its maximum length'
      using errcode = '22023';
  end if;

  -- Capture the prior row (locked) so the audit diff records ONLY fields that
  -- actually changed — never the PII values themselves.
  select * into v_old
  from public.customers c
  where c.tenant_id = p_tenant_id and c.id = p_customer_id
  for update;
  if not found then
    raise exception 'customer: unknown customer or not in this tenant'
      using errcode = '22023';
  end if;
  v_new_type := coalesce(p_customer_type, v_old.customer_type);

  update public.customers
     set name = v_name,
         contact_name = v_contact,
         phone = v_phone,
         city_ar = v_city_ar,
         city_he = v_city_he,
         city_en = v_city_en,
         address = v_address,
         customer_type = v_new_type,
         notes = v_notes,
         updated_at = now()
   where tenant_id = p_tenant_id
     and id = p_customer_id
  returning id into v_updated;

  -- Change-gated diff (allowlist of field KEYS; PII values are never stored).
  -- array_append keeps the element type unambiguous (text[] || untyped-literal
  -- would try to parse the literal as an array).
  if v_old.name is distinct from v_name then v_changed := array_append(v_changed, 'name'); end if;
  if v_old.contact_name is distinct from v_contact then v_changed := array_append(v_changed, 'contact_name'); end if;
  if v_old.phone is distinct from v_phone then v_changed := array_append(v_changed, 'phone'); end if;
  if v_old.city_ar is distinct from v_city_ar
     or v_old.city_he is distinct from v_city_he
     or v_old.city_en is distinct from v_city_en then v_changed := array_append(v_changed, 'city'); end if;
  if v_old.address is distinct from v_address then v_changed := array_append(v_changed, 'address'); end if;
  if v_old.notes is distinct from v_notes then v_changed := array_append(v_changed, 'notes'); end if;
  if v_old.customer_type is distinct from v_new_type then v_changed := array_append(v_changed, 'customer_type'); end if;

  -- No effective change → no misleading event (the UPDATE still ran to preserve
  -- the existing response + updated_at behavior).
  if array_length(v_changed, 1) is not null then
    v_meta := jsonb_build_object('changed_fields', to_jsonb(v_changed));
    -- Safe enum before/after ONLY for the non-PII customer_type field.
    if v_old.customer_type is distinct from v_new_type then
      v_meta := v_meta || jsonb_build_object(
        'customer_type', jsonb_build_object('from', v_old.customer_type::text, 'to', v_new_type::text));
    end if;
    perform public._log_customer_audit_event(
      p_tenant_id, 'customer.updated', p_customer_id, v_meta);
  end if;
  return v_updated;
end;
$$;

revoke all on function public.update_customer(
  uuid, uuid, text, text, text, text, text, text, text, public.customer_type, text)
  from public, anon;
grant execute on function public.update_customer(
  uuid, uuid, text, text, text, text, text, text, text, public.customer_type, text)
  to authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════
-- ACTIVATION — distinct activated/deactivated events, state-change-gated.
-- ═══════════════════════════════════════════════════════════════════════
create or replace function public.set_customer_active(
  p_tenant_id uuid,
  p_customer_id uuid,
  p_active boolean
)
returns boolean
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_tenant uuid;
  v_before boolean;
begin
  v_tenant := public.authorize_tenant(p_tenant_id, array['owner', 'admin']::public.tenant_role[]);
  if p_active is null then
    raise exception 'set_customer_active: p_active is required' using errcode = '22023';
  end if;

  -- Capture the prior state (locked) to gate the event on a REAL transition.
  select c.is_active into v_before
  from public.customers c
  where c.id = p_customer_id and c.tenant_id = v_tenant
  for update;
  if not found then
    raise exception 'set_customer_active: customer is unknown or belongs to another tenant'
      using errcode = '22023';
  end if;

  update public.customers c
     set is_active = p_active, updated_at = now()
   where c.id = p_customer_id and c.tenant_id = v_tenant;

  -- Requesting the already-current state → no event.
  if v_before is distinct from p_active then
    perform public._log_customer_audit_event(
      v_tenant,
      case when p_active then 'customer.activated' else 'customer.deactivated' end,
      p_customer_id,
      jsonb_build_object('before_active', v_before, 'after_active', p_active));
  end if;
  return p_active;
end;
$$;

revoke all on function public.set_customer_active(uuid, uuid, boolean) from public, anon;
grant execute on function public.set_customer_active(uuid, uuid, boolean)
  to authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════
-- ORDER LINK — customer.order_linked (customer-category; no origin change).
-- ═══════════════════════════════════════════════════════════════════════
create or replace function public.link_order_to_customer(
  p_tenant_id uuid,
  p_order_id uuid,
  p_customer_id uuid
)
returns void
language plpgsql volatile security definer set search_path = ''
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
end;
$$;

revoke all on function public.link_order_to_customer(uuid, uuid, uuid) from public, anon;
grant execute on function public.link_order_to_customer(uuid, uuid, uuid)
  to authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════
-- ACCESS LINKS — created / rotated / revoked (never a token/hash/URL).
-- ═══════════════════════════════════════════════════════════════════════

-- replace_customer_access_link → created (no prior active link) OR rotated.
create or replace function public.replace_customer_access_link(
  p_tenant_id uuid,
  p_customer_id uuid,
  p_token_hash text,
  p_token_preview text default null,
  p_label text default null,
  p_expires_at timestamptz default null
)
returns table (
  id uuid,
  token_preview text,
  label text,
  expires_at timestamptz,
  created_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_customer public.customers%rowtype;
  v_id uuid;
  v_revoked integer;
begin
  v_tenant := public.authorize_tenant(
    p_tenant_id, array['owner', 'admin']::public.tenant_role[]);

  if p_token_hash is null or length(p_token_hash) < 32 or length(p_token_hash) > 128 then
    raise exception 'replace_customer_access_link: invalid token hash' using errcode = '22023';
  end if;

  select * into v_customer
  from public.customers c
  where c.id = p_customer_id and c.tenant_id = v_tenant
  for update;
  if not found then
    raise exception 'replace_customer_access_link: customer is unknown or belongs to another tenant'
      using errcode = '22023';
  end if;

  if not v_customer.is_active then
    raise exception 'replace_customer_access_link: customer % is deactivated (inactive)', p_customer_id
      using errcode = 'MDF33';
  end if;

  update public.customer_access_links l
     set revoked_at = now()
   where l.tenant_id = v_tenant
     and l.customer_id = p_customer_id
     and l.revoked_at is null;
  get diagnostics v_revoked = row_count;

  insert into public.customer_access_links
    (tenant_id, customer_id, token_hash, token_preview, label, expires_at, created_by)
  values
    (v_tenant, p_customer_id, p_token_hash,
     nullif(trim(coalesce(p_token_preview, '')), ''),
     nullif(trim(coalesce(p_label, '')), ''),
     p_expires_at, (select auth.uid()))
  returning customer_access_links.id into v_id;

  -- M8G.2: created (first link) vs rotated (replaced ≥1 active link). Only the
  -- link id + optional expiry — NEVER the token, token hash, preview, or URL.
  perform public._log_customer_audit_event(
    v_tenant,
    case when v_revoked > 0 then 'customer.access_link.rotated'
         else 'customer.access_link.created' end,
    p_customer_id,
    jsonb_build_object('link_id', v_id)
      || case when p_expires_at is not null
              then jsonb_build_object('expires_at', p_expires_at)
              else '{}'::jsonb end);

  return query
    select l.id, l.token_preview, l.label, l.expires_at, l.created_at
    from public.customer_access_links l
    where l.id = v_id;
end;
$$;

revoke all on function public.replace_customer_access_link(uuid, uuid, text, text, text, timestamptz)
  from public, anon;
grant execute on function public.replace_customer_access_link(uuid, uuid, text, text, text, timestamptz)
  to authenticated, service_role;

-- revoke_customer_access_link → revoked (ONLY when an active link was revoked).
-- The ACTIVE signature is the M4C 2-arg (p_tenant_id, p_link_id) — the legacy
-- 1-arg overload was DROPPED in 20260707100000; we preserve the current
-- signature/security/grants exactly and add only the transactional event.
create or replace function public.revoke_customer_access_link(
  p_tenant_id uuid,
  p_link_id uuid
)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_tenant uuid;
  v_customer uuid;
begin
  v_tenant := public.authorize_tenant(p_tenant_id, array['owner', 'admin']::public.tenant_role[]);

  -- Revoke ONLY if currently active; capture the customer for the event scope.
  update public.customer_access_links l
     set revoked_at = now()
   where l.id = p_link_id and l.tenant_id = v_tenant and l.revoked_at is null
  returning l.customer_id into v_customer;

  if found then
    -- A real revocation happened → one event (link id only; no token/URL).
    perform public._log_customer_audit_event(
      v_tenant, 'customer.access_link.revoked', v_customer,
      jsonb_build_object('link_id', p_link_id));
  else
    -- Not active: either unknown/cross-tenant (raise, as before) or already
    -- revoked (idempotent no-op success → NO event).
    if not exists (
      select 1 from public.customer_access_links l
      where l.id = p_link_id and l.tenant_id = v_tenant
    ) then
      raise exception 'revoke_customer_access_link: link is unknown or belongs to another tenant'
        using errcode = '22023';
    end if;
  end if;
  return p_link_id;
end;
$$;

revoke all on function public.revoke_customer_access_link(uuid, uuid) from public, anon;
grant execute on function public.revoke_customer_access_link(uuid, uuid) to authenticated, service_role;
