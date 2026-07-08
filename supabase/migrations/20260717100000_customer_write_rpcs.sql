-- ═══════════════════════════════════════════════════════════════════════
-- Madaf M7F.2 — customer (store/shop) write RPCs
--
-- Until now customers could only be created by the seed: M3B.1
-- (20260705160000_lock_catalog_writes.sql) dropped the direct owner/admin
-- INSERT/UPDATE/DELETE policies on public.customers and never added a
-- replacement RPC, so a freshly-onboarded tenant had NO way to add a store
-- from the app — which blocked the entire tokenized shop-link demo (no
-- customer ⇒ no private link ⇒ no /shop/<token> order).
--
-- This migration adds the missing validated write path, mirroring the
-- catalog RPCs (create_manufacturer, 20260705170000): SECURITY DEFINER,
-- search_path = '', tenant DERIVED via authorize_tenant (owner/admin only —
-- never a client-supplied tenant_id), length-capped, RPC-only. Direct table
-- writes stay blocked; customers remain SELECT-only for authenticated.
--
-- No schema change to the customers table — every column already exists
-- (name, contact_name, phone, city_ar/he/en, address, customer_type, notes;
-- core_schema.sql). Local stack is the only environment in scope; apply to
-- hosted staging with `supabase db push`.
-- ═══════════════════════════════════════════════════════════════════════

-- ── create_customer ──────────────────────────────────────────────────────

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
  -- owner/admin on the caller's OWN tenant; never trusts a client tenant_id.
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
     city_ar, city_he, city_en, address, customer_type, notes)
  values
    (p_tenant_id, v_name, v_contact, v_phone,
     v_city_ar, v_city_he, v_city_en, v_address,
     coalesce(p_customer_type, 'grocery'), v_notes)
  returning id into v_id;
  return v_id;
end;
$$;

comment on function public.create_customer(
  uuid, text, text, text, text, text, text, text, public.customer_type, text) is
  'Create a store/customer for the caller''s tenant (owner/admin only, via authorize_tenant). RPC-only write path; direct table inserts stay blocked (M7F.2).';

revoke all on function public.create_customer(
  uuid, text, text, text, text, text, text, text, public.customer_type, text)
  from public, anon;
grant execute on function public.create_customer(
  uuid, text, text, text, text, text, text, text, public.customer_type, text)
  to authenticated, service_role;

-- ── update_customer ──────────────────────────────────────────────────────

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

  update public.customers
     set name = v_name,
         contact_name = v_contact,
         phone = v_phone,
         city_ar = v_city_ar,
         city_he = v_city_he,
         city_en = v_city_en,
         address = v_address,
         customer_type = coalesce(p_customer_type, customer_type),
         notes = v_notes,
         updated_at = now()
   where tenant_id = p_tenant_id
     and id = p_customer_id
  returning id into v_updated;

  if v_updated is null then
    raise exception 'customer: unknown customer or not in this tenant'
      using errcode = '22023';
  end if;
  return v_updated;
end;
$$;

comment on function public.update_customer(
  uuid, uuid, text, text, text, text, text, text, text, public.customer_type, text) is
  'Update a store/customer in the caller''s tenant (owner/admin only, via authorize_tenant). RPC-only write path (M7F.2).';

revoke all on function public.update_customer(
  uuid, uuid, text, text, text, text, text, text, text, public.customer_type, text)
  from public, anon;
grant execute on function public.update_customer(
  uuid, uuid, text, text, text, text, text, text, text, public.customer_type, text)
  to authenticated, service_role;
