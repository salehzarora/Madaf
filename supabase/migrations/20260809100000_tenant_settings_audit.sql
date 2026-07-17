-- ═══════════════════════════════════════════════════════════════════════
-- PILOT-OPS-AUDIT-004 — TENANT SETTINGS & TIMEZONE AUDIT (M8I.4)
--
-- Transactional audit for the three REAL tenant-shared settings mutations, a
-- shared serialization lock so before/after values are honest under concurrency,
-- a strict metadata contract (safe values only for approved scalars/enums +
-- timezone; PII/legal/free-text recorded keys-only), and removal of the unused
-- direct authenticated tenants UPDATE path so the audited RPCs are the genuine
-- (non-bypassable) write path.
--
-- WHAT IS AUDITED (closed 3-event vocabulary, entity_type='settings',
-- entity_id = the authorized tenant_id):
--   settings.business_updated  — update_tenant_profile changed >=1 field.
--   settings.timezone_changed  — update_tenant_timezone changed the timezone.
--   settings.tax_updated       — upsert_tenant_tax_settings created the first
--                                tenant_tax_settings row or changed an existing one.
--
-- SAFE VALUES vs KEYS-ONLY. Full before/after is stored ONLY for approved,
-- non-sensitive scalars/enums (business: display_vat_rate; tax: country_code,
-- default_vat_rate, invoice_language, legal_invoicing_ready) and the timezone
-- IANA transition. Every other field (business/legal names, company/registration/
-- VAT identifiers, phone, email, addresses, contact fields, readiness_notes,
-- logo_url) is recorded as a CHANGED-FIELD KEY only — the operator learns THAT it
-- changed, by whom and when, without the sensitive value entering the append-only
-- log. This mirrors the customer/product KEYS-only convention.
--
-- SHARED LOCK. All three RPCs lock the guaranteed public.tenants row for the
-- authorized tenant (SELECT … FOR UPDATE) as their first data step, then read the
-- before-state, canonicalize, diff, mutate, and log — so first-tax-create races,
-- concurrent cross-section saves and stale before-values are all serialized on one
-- deterministic lock (no deadlock, no advisory locks, no versioning framework).
--
-- CANONICAL DIFF. Differences use the values that will ACTUALLY be stored (the
-- RPCs' existing btrim/lower/nullif/left/round normalization), compared null-safely
-- (IS DISTINCT FROM), so whitespace/case/rounding-equivalent input is a no-op:
-- no UPDATE, no updated_at churn, no event — and the established return shape is
-- preserved.
--
-- DIRECT-WRITE LOCKDOWN. `authenticated` had a direct UPDATE grant + an owner/admin
-- UPDATE policy on public.tenants (RLS-gated). No application path uses it (all
-- settings writes go through the SECURITY DEFINER RPCs; onboarding via
-- create_tenant_with_owner). Both are removed here so the RPCs are the only write
-- path; SELECT, INSERT/onboarding, the timezone validation trigger, service_role
-- and every DEFINER RPC are untouched.
--
-- ADDITIVE: one private helper + a redefinition of the three latest-effective
-- settings RPCs (signatures / return types / DEFINER / search_path / grants /
-- normalization / error contracts PRESERVED) + the tenants UPDATE lockdown + one
-- additive settings clause on the audit_events SELECT policy + one partial index.
-- No table/column drop, no backfill, no historical event, no row rewrite at
-- migration time.
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1. Private Settings audit helper ──────────────────────────────────────
-- SECURITY INVOKER (like the customer/product/inventory/team helpers): callable
-- only from the SECURITY DEFINER settings RPCs; revoked from every client role.
-- Closed 3-event allowlist, entity_type='settings', actor auth.uid(), entity_id
-- must equal the tenant id. STRICT metadata: changed_fields is a non-empty,
-- unique, allowlisted, canonically-ordered string array; a safe {from,to} object
-- may appear ONLY for an approved safe field that is itself in changed_fields, must
-- contain exactly from+to of the correct type with from<>to; a sensitive field can
-- never carry a value object; the timezone event is exactly {changed_fields:
-- ["timezone"], timezone:{from,to}}. Any unknown key / secret-shaped key / raw
-- object is rejected.
create function public._log_settings_audit_event(
  p_tenant_id uuid,
  p_event_type text,
  p_entity_id uuid,
  p_metadata jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_meta jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_fields text[];
  v_safe text[];
  v_changed text[] := array[]::text[];
  v_canonical text[];
  v_elem jsonb;
  v_key text;
  v_from jsonb;
  v_to jsonb;
begin
  if p_tenant_id is null then
    raise exception '_log_settings_audit_event: tenant is required' using errcode = '22023';
  end if;
  if p_entity_id is null then
    raise exception '_log_settings_audit_event: entity id is required' using errcode = '22023';
  end if;
  if p_entity_id <> p_tenant_id then
    raise exception '_log_settings_audit_event: entity id must equal the tenant id' using errcode = '22023';
  end if;

  -- Closed event allowlist + per-event field / safe-value lists.
  if p_event_type = 'settings.business_updated' then
    v_fields := array['name_ar','name_he','name_en','phone','email','address_ar','address_he',
                      'address_en','legal_name','company_id','display_vat_rate','logo_url'];
    v_safe := array['display_vat_rate'];
  elsif p_event_type = 'settings.timezone_changed' then
    v_fields := array['timezone'];
    v_safe := array['timezone'];
  elsif p_event_type = 'settings.tax_updated' then
    v_fields := array['legal_name','business_registration_number','vat_registration_number',
                      'vat_registration_type','country_code','default_vat_rate','invoice_language',
                      'street','city','postal_code','country','contact_email','contact_phone',
                      'legal_invoicing_ready','readiness_notes'];
    v_safe := array['country_code','default_vat_rate','invoice_language','legal_invoicing_ready'];
  else
    raise exception '_log_settings_audit_event: unknown settings event type %', p_event_type
      using errcode = '22023';
  end if;

  if jsonb_typeof(v_meta) <> 'object' then
    raise exception '_log_settings_audit_event: metadata must be a JSON object' using errcode = '22023';
  end if;
  if length(v_meta::text) > 4000 then
    raise exception '_log_settings_audit_event: metadata exceeds the size bound' using errcode = '22023';
  end if;

  -- changed_fields: required non-empty array of unique, allowlisted strings.
  if not (v_meta ? 'changed_fields') or jsonb_typeof(v_meta -> 'changed_fields') <> 'array' then
    raise exception '_log_settings_audit_event: changed_fields must be a JSON array' using errcode = '22023';
  end if;
  for v_elem in select * from jsonb_array_elements(v_meta -> 'changed_fields') loop
    if jsonb_typeof(v_elem) <> 'string' then
      raise exception '_log_settings_audit_event: changed_fields entries must be strings' using errcode = '22023';
    end if;
    v_changed := array_append(v_changed, v_elem #>> '{}');
  end loop;
  if array_length(v_changed, 1) is null then
    raise exception '_log_settings_audit_event: changed_fields must be non-empty' using errcode = '22023';
  end if;
  if (select count(*) from unnest(v_changed)) <> (select count(distinct e) from unnest(v_changed) e) then
    raise exception '_log_settings_audit_event: changed_fields must not contain duplicates' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(v_changed) e where not (e = any (v_fields))) then
    raise exception '_log_settings_audit_event: changed_fields contains an unknown field for %', p_event_type
      using errcode = '22023';
  end if;
  -- Canonical order = allowlist order filtered to the present fields.
  v_canonical := (select array_agg(f order by ord)
                  from unnest(v_fields) with ordinality as t(f, ord)
                  where f = any (v_changed));
  if v_changed is distinct from v_canonical then
    raise exception '_log_settings_audit_event: changed_fields must be in canonical allowlist order'
      using errcode = '22023';
  end if;

  -- Every top-level key other than changed_fields must be a SAFE field that is
  -- itself listed in changed_fields, carrying exactly a {from,to} of the right type.
  for v_key in select jsonb_object_keys(v_meta) loop
    if v_key = 'changed_fields' then
      continue;
    end if;
    if not (v_key = any (v_safe)) then
      raise exception '_log_settings_audit_event: key % is not an allowed safe transition for %',
        v_key, p_event_type using errcode = '22023';
    end if;
    if not (v_key = any (v_changed)) then
      raise exception '_log_settings_audit_event: transition % is not listed in changed_fields', v_key
        using errcode = '22023';
    end if;
    if jsonb_typeof(v_meta -> v_key) <> 'object' then
      raise exception '_log_settings_audit_event: transition % must be an object', v_key using errcode = '22023';
    end if;
    if (select count(*) from jsonb_object_keys(v_meta -> v_key)) <> 2
       or not ((v_meta -> v_key) ? 'from') or not ((v_meta -> v_key) ? 'to') then
      raise exception '_log_settings_audit_event: transition % must contain exactly from and to', v_key
        using errcode = '22023';
    end if;
    v_from := v_meta -> v_key -> 'from';
    v_to := v_meta -> v_key -> 'to';
    if v_from = v_to then
      raise exception '_log_settings_audit_event: transition % from and to must differ', v_key using errcode = '22023';
    end if;
    if v_key in ('display_vat_rate', 'default_vat_rate') then
      if jsonb_typeof(v_from) not in ('number', 'null') or jsonb_typeof(v_to) not in ('number', 'null') then
        raise exception '_log_settings_audit_event: transition % must be numeric or null', v_key using errcode = '22023';
      end if;
    elsif v_key in ('country_code', 'invoice_language', 'timezone') then
      if jsonb_typeof(v_from) not in ('string', 'null') or jsonb_typeof(v_to) not in ('string', 'null') then
        raise exception '_log_settings_audit_event: transition % must be a string or null', v_key using errcode = '22023';
      end if;
    elsif v_key = 'legal_invoicing_ready' then
      if jsonb_typeof(v_from) not in ('boolean', 'null') or jsonb_typeof(v_to) not in ('boolean', 'null') then
        raise exception '_log_settings_audit_event: transition % must be boolean or null', v_key using errcode = '22023';
      end if;
    end if;
  end loop;

  -- Timezone event: exactly {changed_fields:["timezone"], timezone:{from,to}} with
  -- two NON-NULL distinct IANA strings.
  if p_event_type = 'settings.timezone_changed' then
    if v_changed <> array['timezone'] then
      raise exception '_log_settings_audit_event: timezone changed_fields must be exactly [timezone]' using errcode = '22023';
    end if;
    if not (v_meta ? 'timezone') then
      raise exception '_log_settings_audit_event: timezone event must carry the timezone transition' using errcode = '22023';
    end if;
    if jsonb_typeof(v_meta -> 'timezone' -> 'from') <> 'string'
       or jsonb_typeof(v_meta -> 'timezone' -> 'to') <> 'string' then
      raise exception '_log_settings_audit_event: timezone from/to must be non-null strings' using errcode = '22023';
    end if;
  end if;

  insert into public.audit_events
    (tenant_id, actor_user_id, event_type, entity_type, entity_id, metadata)
  values
    (p_tenant_id, (select auth.uid()), p_event_type, 'settings', p_entity_id, v_meta);
end;
$$;

comment on function public._log_settings_audit_event(uuid, text, uuid, jsonb) is
  'M8I.4 — PRIVATE transactional Settings audit producer. Closed 3-event allowlist '
  '(settings.business_updated / timezone_changed / tax_updated), entity_type=settings, '
  'entity_id=tenant_id, actor=auth.uid(). Strict metadata: canonical unique allowlisted '
  'changed_fields; safe {from,to} only for approved scalar/enum fields + timezone; '
  'sensitive fields keys-only; unknown/secret keys rejected. Callable only from the '
  'settings RPCs; no client role may execute it.';

revoke all on function public._log_settings_audit_event(uuid, text, uuid, jsonb)
  from public, anon, authenticated;

-- ── 2. audit_events SELECT policy — ADDITIVE settings clause ───────────────
-- The customer/order/product/inventory/team clauses are reproduced VERBATIM and a
-- settings clause is AND-ed on (owner/admin only). Vacuous for other entity types,
-- so they behave exactly as before; a settings row additionally requires owner/admin.
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
  );

-- ── 3. Tenant-wide Settings Timeline index (PARTIAL) ───────────────────────
-- Tenant-wide settings stream (all entity_type='settings' rows). A partial index
-- on (tenant_id, created_at desc, id desc) WHERE entity_type='settings' serves the
-- keyset read and, being partial, never competes for the per-entity audit reads.
-- No equivalent index exists.
create index audit_events_tenant_settings_time_idx
  on public.audit_events (tenant_id, created_at desc, id desc)
  where entity_type = 'settings';

comment on index public.audit_events_tenant_settings_time_idx is
  'M8I.4 - partial index (entity_type=settings) for the tenant-wide Settings Activity '
  'read (created_at DESC, id DESC) as a keyset range scan; partial so it never '
  'competes for the per-entity audit timeline reads.';

-- ── 4. Direct authenticated tenants UPDATE lockdown ────────────────────────
-- Remove the client-accessible direct UPDATE bypass so the audited SECURITY
-- DEFINER RPCs are the only tenants write path. No application route/action/data
-- function/RPC uses the direct grant (verified); the SELECT grant/policy,
-- INSERT/onboarding (create_tenant_with_owner), the timezone validation trigger and
-- service_role all remain. The DEFINER RPCs run as the table owner and are
-- unaffected by removing the authenticated grant.
drop policy if exists "tenants: owners/admins can update their tenant" on public.tenants;
revoke update on public.tenants from authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- REDEFINE THE THREE LATEST-EFFECTIVE SETTINGS RPCs
-- Signatures / return types / DEFINER / search_path / grants / normalization /
-- error contracts PRESERVED. Added: shared tenants-row FOR UPDATE lock, canonical
-- IS DISTINCT FROM diff, no-op gate (return the established shape without an
-- UPDATE), and exactly-once transactional audit.
-- ═══════════════════════════════════════════════════════════════════════

-- ── 4a. update_tenant_profile → settings.business_updated ──────────────────
-- Base: 20260725100000 (M8E.4). Normalization + validation + error messages
-- unchanged; adds the lock, the diff, the no-op return, and the audit event.
create or replace function public.update_tenant_profile(
  p_tenant_id uuid,
  p_name_ar text,
  p_name_he text,
  p_name_en text,
  p_phone text default null,
  p_email text default null,
  p_address_ar text default null,
  p_address_he text default null,
  p_address_en text default null,
  p_legal_name text default null,
  p_company_id text default null,
  p_display_vat_rate numeric default null,
  p_logo_url text default null
)
returns setof public.tenants
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_old public.tenants%rowtype;
  v_ar text;
  v_he text;
  v_en text;
  v_email text;
  v_rate numeric;
  v_phone text;
  v_addr_ar text;
  v_addr_he text;
  v_addr_en text;
  v_legal text;
  v_company text;
  v_logo text;
  v_changed text[] := array[]::text[];
  v_meta jsonb;
begin
  v_tenant := public.authorize_tenant(
    p_tenant_id, array['owner', 'admin']::public.tenant_role[]);

  -- Shared serialization lock on the guaranteed tenant row (before-state read).
  select * into v_old from public.tenants where id = v_tenant for update;

  v_ar := nullif(btrim(coalesce(p_name_ar, '')), '');
  v_he := nullif(btrim(coalesce(p_name_he, '')), '');
  v_en := nullif(btrim(coalesce(p_name_en, '')), '');
  if v_ar is null or v_he is null or v_en is null then
    raise exception 'update_tenant_profile: name_ar, name_he and name_en are required'
      using errcode = '22023';
  end if;
  if char_length(v_ar) > 120 or char_length(v_he) > 120 or char_length(v_en) > 120 then
    raise exception 'update_tenant_profile: name too long (<=120)'
      using errcode = '22023';
  end if;

  v_email := nullif(btrim(lower(coalesce(p_email, ''))), '');
  if v_email is not null and (char_length(v_email) > 254 or position('@' in v_email) < 2) then
    raise exception 'update_tenant_profile: email is not a valid address'
      using errcode = '22023';
  end if;

  v_rate := round(p_display_vat_rate, 4);
  if v_rate is not null and (v_rate < 0 or v_rate >= 1) then
    raise exception 'update_tenant_profile: display_vat_rate must be a fraction in [0, 1)'
      using errcode = '22023';
  end if;

  v_phone := left(nullif(btrim(coalesce(p_phone, '')), ''), 40);
  v_addr_ar := left(nullif(btrim(coalesce(p_address_ar, '')), ''), 200);
  v_addr_he := left(nullif(btrim(coalesce(p_address_he, '')), ''), 200);
  v_addr_en := left(nullif(btrim(coalesce(p_address_en, '')), ''), 200);
  v_legal := left(nullif(btrim(coalesce(p_legal_name, '')), ''), 200);
  v_company := left(nullif(btrim(coalesce(p_company_id, '')), ''), 40);
  v_logo := left(nullif(btrim(coalesce(p_logo_url, '')), ''), 500);

  -- Canonical diff vs the locked before-state (allowlist order).
  if v_old.name_ar is distinct from v_ar then v_changed := array_append(v_changed, 'name_ar'); end if;
  if v_old.name_he is distinct from v_he then v_changed := array_append(v_changed, 'name_he'); end if;
  if v_old.name_en is distinct from v_en then v_changed := array_append(v_changed, 'name_en'); end if;
  if v_old.phone is distinct from v_phone then v_changed := array_append(v_changed, 'phone'); end if;
  if v_old.email is distinct from v_email then v_changed := array_append(v_changed, 'email'); end if;
  if v_old.address_ar is distinct from v_addr_ar then v_changed := array_append(v_changed, 'address_ar'); end if;
  if v_old.address_he is distinct from v_addr_he then v_changed := array_append(v_changed, 'address_he'); end if;
  if v_old.address_en is distinct from v_addr_en then v_changed := array_append(v_changed, 'address_en'); end if;
  if v_old.legal_name is distinct from v_legal then v_changed := array_append(v_changed, 'legal_name'); end if;
  if v_old.company_id is distinct from v_company then v_changed := array_append(v_changed, 'company_id'); end if;
  if v_old.display_vat_rate is distinct from v_rate then v_changed := array_append(v_changed, 'display_vat_rate'); end if;
  if v_old.logo_url is distinct from v_logo then v_changed := array_append(v_changed, 'logo_url'); end if;

  -- No-op: return the existing locked row (established shape), no UPDATE, no event.
  if array_length(v_changed, 1) is null then
    return next v_old;
    return;
  end if;

  -- Safe metadata: keys + display_vat_rate before/after only (all others keys-only).
  v_meta := jsonb_build_object('changed_fields', to_jsonb(v_changed));
  if v_old.display_vat_rate is distinct from v_rate then
    v_meta := v_meta || jsonb_build_object(
      'display_vat_rate', jsonb_build_object('from', v_old.display_vat_rate, 'to', v_rate));
  end if;
  perform public._log_settings_audit_event(v_tenant, 'settings.business_updated', v_tenant, v_meta);

  return query
  update public.tenants t set
    name_ar = v_ar,
    name_he = v_he,
    name_en = v_en,
    phone = v_phone,
    email = v_email,
    address_ar = v_addr_ar,
    address_he = v_addr_he,
    address_en = v_addr_en,
    legal_name = v_legal,
    company_id = v_company,
    display_vat_rate = v_rate,
    logo_url = v_logo,
    updated_at = now()
  where t.id = v_tenant
  returning t.*;
end;
$$;

comment on function public.update_tenant_profile(uuid, text, text, text, text, text, text, text, text, text, text, numeric, text) is
  'M8E.4/M8I.4: update a tenant''s BUSINESS PROFILE (owner/admin only), the ONLY write path. '
  'SECURITY DEFINER + authorize_tenant; locks the tenant row, diffs canonical values, and emits '
  'one transactional settings.business_updated (display_vat_rate before/after; all other fields '
  'keys-only). A no-op returns the existing row unchanged. DISPLAY configuration only; no legal effect.';

revoke all on function public.update_tenant_profile(uuid, text, text, text, text, text, text, text, text, text, text, numeric, text) from public, anon;
grant execute on function public.update_tenant_profile(uuid, text, text, text, text, text, text, text, text, text, text, numeric, text) to authenticated, service_role;

-- ── 4b. update_tenant_timezone → settings.timezone_changed ─────────────────
-- Base: 20260803100000 (M8H.2). IANA validation (RPC + trigger) preserved; adds the
-- lock, the change gate, the no-op return, and the audit event with the IANA transition.
create or replace function public.update_tenant_timezone(
  p_tenant_id uuid,
  p_timezone text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_tz text := btrim(coalesce(p_timezone, ''));
  v_old text;
begin
  v_tenant := public.authorize_tenant(
    p_tenant_id, array['owner', 'admin']::public.tenant_role[]);

  -- Shared serialization lock on the guaranteed tenant row.
  select timezone into v_old from public.tenants where id = v_tenant for update;

  if not public._is_valid_timezone(v_tz) then
    raise exception
      'update_tenant_timezone: % is not a recognized IANA timezone name', coalesce(nullif(v_tz, ''), '<empty>')
      using errcode = '22023';
  end if;

  -- No-op: same effective zone → no UPDATE, no event, return the current value.
  if v_old is not distinct from v_tz then
    return v_old;
  end if;

  perform public._log_settings_audit_event(
    v_tenant, 'settings.timezone_changed', v_tenant,
    jsonb_build_object(
      'changed_fields', jsonb_build_array('timezone'),
      'timezone', jsonb_build_object('from', v_old, 'to', v_tz)));

  update public.tenants
     set timezone = v_tz, updated_at = now()
   where id = v_tenant;

  return v_tz;
end;
$$;

comment on function public.update_tenant_timezone(uuid, text) is
  'M8H.2/M8I.4 — owner/admin-only tenant timezone update (authorize_tenant). Locks the tenant row, '
  'accepts an IANA name only (rejects fixed offsets), and on a real change emits one '
  'settings.timezone_changed with the stored IANA from/to. A no-op returns the current timezone. '
  'Changes DISPLAY + future tenant-local date boundaries — never a stored timestamp.';

revoke all on function public.update_tenant_timezone(uuid, text) from public, anon;
grant execute on function public.update_tenant_timezone(uuid, text) to authenticated;

-- ── 4c. upsert_tenant_tax_settings → settings.tax_updated ──────────────────
-- Base: 20260712100000 (M6B). Normalization + validation preserved; adds the shared
-- PARENT tenant-row lock (so first-create serializes even with no tax row yet), the
-- canonical diff vs the locked before (NULL when no row → null→value on first create),
-- the no-op return, and the transactional audit event. ON CONFLICT retained as defense.
create or replace function public.upsert_tenant_tax_settings(
  p_tenant_id uuid,
  p_legal_name text default null,
  p_business_registration_number text default null,
  p_vat_registration_number text default null,
  p_vat_registration_type text default null,
  p_country_code text default null,
  p_default_vat_rate numeric default null,
  p_invoice_language text default null,
  p_street text default null,
  p_city text default null,
  p_postal_code text default null,
  p_country text default null,
  p_contact_email text default null,
  p_contact_phone text default null,
  p_legal_invoicing_ready boolean default false,
  p_readiness_notes text default null
)
returns setof public.tenant_tax_settings
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_old public.tenant_tax_settings%rowtype;
  v_country text;
  v_lang text;
  v_rate numeric;
  v_legal text;
  v_breg text;
  v_vreg text;
  v_vtype text;
  v_street text;
  v_city text;
  v_postal text;
  v_country_free text;
  v_cemail text;
  v_cphone text;
  v_ready boolean;
  v_notes text;
  v_changed text[] := array[]::text[];
  v_meta jsonb;
begin
  v_tenant := public.authorize_tenant(
    p_tenant_id, array['owner', 'admin']::public.tenant_role[]);

  -- Shared serialization lock on the PARENT tenants row — it always exists, so
  -- concurrent first-creates serialize here (the tax row may not exist yet).
  perform 1 from public.tenants where id = v_tenant for update;

  -- Locked before-state (all-NULL rowtype when no row exists → first create).
  select * into v_old from public.tenant_tax_settings where tenant_id = v_tenant;

  -- Canonicalize exactly as before.
  v_country := upper(nullif(btrim(coalesce(p_country_code, '')), ''));
  if v_country is null then
    v_country := 'IL';
  end if;
  if char_length(v_country) not between 2 and 3 then
    raise exception 'upsert_tenant_tax_settings: country_code must be 2-3 letters' using errcode = '22023';
  end if;
  v_lang := nullif(btrim(lower(coalesce(p_invoice_language, ''))), '');
  if v_lang is not null and v_lang not in ('ar', 'he', 'en') then
    raise exception 'upsert_tenant_tax_settings: invoice_language must be ar/he/en' using errcode = '22023';
  end if;
  v_rate := round(p_default_vat_rate, 4);
  if v_rate is not null and (v_rate < 0 or v_rate >= 1) then
    raise exception 'upsert_tenant_tax_settings: default_vat_rate must be a fraction in [0, 1)' using errcode = '22023';
  end if;
  v_legal := left(nullif(btrim(coalesce(p_legal_name, '')), ''), 200);
  v_breg := left(nullif(btrim(coalesce(p_business_registration_number, '')), ''), 40);
  v_vreg := left(nullif(btrim(coalesce(p_vat_registration_number, '')), ''), 40);
  v_vtype := left(nullif(btrim(coalesce(p_vat_registration_type, '')), ''), 60);
  v_street := left(nullif(btrim(coalesce(p_street, '')), ''), 200);
  v_city := left(nullif(btrim(coalesce(p_city, '')), ''), 120);
  v_postal := left(nullif(btrim(coalesce(p_postal_code, '')), ''), 20);
  v_country_free := left(nullif(btrim(coalesce(p_country, '')), ''), 80);
  v_cemail := left(nullif(btrim(lower(coalesce(p_contact_email, ''))), ''), 254);
  v_cphone := left(nullif(btrim(coalesce(p_contact_phone, '')), ''), 40);
  v_ready := coalesce(p_legal_invoicing_ready, false);
  v_notes := left(nullif(btrim(coalesce(p_readiness_notes, '')), ''), 2000);

  -- Canonical diff vs the locked before (NULL for every column when no row).
  if v_old.legal_name is distinct from v_legal then v_changed := array_append(v_changed, 'legal_name'); end if;
  if v_old.business_registration_number is distinct from v_breg then v_changed := array_append(v_changed, 'business_registration_number'); end if;
  if v_old.vat_registration_number is distinct from v_vreg then v_changed := array_append(v_changed, 'vat_registration_number'); end if;
  if v_old.vat_registration_type is distinct from v_vtype then v_changed := array_append(v_changed, 'vat_registration_type'); end if;
  if v_old.country_code is distinct from v_country then v_changed := array_append(v_changed, 'country_code'); end if;
  if v_old.default_vat_rate is distinct from v_rate then v_changed := array_append(v_changed, 'default_vat_rate'); end if;
  if v_old.invoice_language is distinct from v_lang then v_changed := array_append(v_changed, 'invoice_language'); end if;
  if v_old.street is distinct from v_street then v_changed := array_append(v_changed, 'street'); end if;
  if v_old.city is distinct from v_city then v_changed := array_append(v_changed, 'city'); end if;
  if v_old.postal_code is distinct from v_postal then v_changed := array_append(v_changed, 'postal_code'); end if;
  if v_old.country is distinct from v_country_free then v_changed := array_append(v_changed, 'country'); end if;
  if v_old.contact_email is distinct from v_cemail then v_changed := array_append(v_changed, 'contact_email'); end if;
  if v_old.contact_phone is distinct from v_cphone then v_changed := array_append(v_changed, 'contact_phone'); end if;
  if v_old.legal_invoicing_ready is distinct from v_ready then v_changed := array_append(v_changed, 'legal_invoicing_ready'); end if;
  if v_old.readiness_notes is distinct from v_notes then v_changed := array_append(v_changed, 'readiness_notes'); end if;

  -- Existing-row no-op: return the existing row (established shape), no write, no event.
  if array_length(v_changed, 1) is null then
    return next v_old;
    return;
  end if;

  -- Safe metadata: keys + safe scalar/enum before/after only (all others keys-only).
  v_meta := jsonb_build_object('changed_fields', to_jsonb(v_changed));
  if v_old.country_code is distinct from v_country then
    v_meta := v_meta || jsonb_build_object('country_code', jsonb_build_object('from', v_old.country_code, 'to', v_country));
  end if;
  if v_old.default_vat_rate is distinct from v_rate then
    v_meta := v_meta || jsonb_build_object('default_vat_rate', jsonb_build_object('from', v_old.default_vat_rate, 'to', v_rate));
  end if;
  if v_old.invoice_language is distinct from v_lang then
    v_meta := v_meta || jsonb_build_object('invoice_language', jsonb_build_object('from', v_old.invoice_language, 'to', v_lang));
  end if;
  if v_old.legal_invoicing_ready is distinct from v_ready then
    v_meta := v_meta || jsonb_build_object('legal_invoicing_ready', jsonb_build_object('from', v_old.legal_invoicing_ready, 'to', v_ready));
  end if;
  perform public._log_settings_audit_event(v_tenant, 'settings.tax_updated', v_tenant, v_meta);

  return query
  insert into public.tenant_tax_settings as t (
    tenant_id, legal_name, business_registration_number, vat_registration_number,
    vat_registration_type, country_code, default_vat_rate, invoice_language,
    street, city, postal_code, country, contact_email, contact_phone,
    legal_invoicing_ready, readiness_notes, updated_by)
  values (
    v_tenant, v_legal, v_breg, v_vreg, v_vtype, v_country, v_rate, v_lang,
    v_street, v_city, v_postal, v_country_free, v_cemail, v_cphone,
    v_ready, v_notes, (select auth.uid()))
  on conflict (tenant_id) do update set
    legal_name = excluded.legal_name,
    business_registration_number = excluded.business_registration_number,
    vat_registration_number = excluded.vat_registration_number,
    vat_registration_type = excluded.vat_registration_type,
    country_code = excluded.country_code,
    default_vat_rate = excluded.default_vat_rate,
    invoice_language = excluded.invoice_language,
    street = excluded.street,
    city = excluded.city,
    postal_code = excluded.postal_code,
    country = excluded.country,
    contact_email = excluded.contact_email,
    contact_phone = excluded.contact_phone,
    legal_invoicing_ready = excluded.legal_invoicing_ready,
    readiness_notes = excluded.readiness_notes,
    updated_by = excluded.updated_by
  returning t.*;
end;
$$;

comment on function public.upsert_tenant_tax_settings(uuid, text, text, text, text, text, numeric, text, text, text, text, text, text, text, boolean, text) is
  'M6B/M8I.4: create/update a tenant''s tax settings (owner/admin only), the ONLY write path. '
  'SECURITY DEFINER + authorize_tenant; locks the parent tenant row (serializing first-create), '
  'diffs canonical values vs the locked before, and emits one transactional settings.tax_updated '
  '(country_code/default_vat_rate/invoice_language/legal_invoicing_ready before/after; all other '
  'fields keys-only). A no-op returns the existing row. Persists configuration only — issues NOTHING.';

revoke all on function public.upsert_tenant_tax_settings(uuid, text, text, text, text, text, numeric, text, text, text, text, text, text, text, boolean, text) from public, anon;
grant execute on function public.upsert_tenant_tax_settings(uuid, text, text, text, text, text, numeric, text, text, text, text, text, text, text, boolean, text) to authenticated, service_role;
